/**
 * End-to-end smoke test: Solana Gateway burn → Arc Testnet mint.
 *
 * Flow:
 *   1. Read Solana signer (depositor) credit + Arc recipient USDC balance (pre).
 *   2. Build + ed25519-sign Solana burn intent (sourceDomain=5 → destDomain=26).
 *   3. POST to https://gateway-api-testnet.circle.com/v1/transfer → attestation+signature.
 *   4. Call gatewayMint(bytes,bytes) on Arc Gateway Minter via viem (paid by client EOA).
 *   5. Read recipient USDC balance (post). Assert delta == amount - maxFee.
 *
 * Usage:
 *   node scripts/smoke-test-solana-to-arc.mjs --amount 2.5
 *   node scripts/smoke-test-solana-to-arc.mjs --amount 2.5 --recipient 0xabc...
 *
 * Notes:
 *   - amount is in USDC (6 decimals). Minimum useful amount: ~2.05 USDC (must
 *     cover Gateway maxFee of 2.01 USDC; recipient receives amount - maxFee).
 *   - recipient defaults to the Arc client EOA derived from ARC_CLIENT_PRIVATE_KEY.
 *   - Source signer must already have Gateway Wallet credit ≥ amount (run
 *     deposit-solana-gateway.mjs first).
 */

import fs from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { Keypair, PublicKey } from "@solana/web3.js";
import bs58 from "bs58";
import nacl from "tweetnacl";
import {
  createPublicClient,
  createWalletClient,
  defineChain,
  encodeFunctionData,
  http,
  parseAbi,
  pad,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

function loadEnvFile(file) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (!m) continue;
    if (process.env[m[1]]) continue;
    let v = m[2];
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    process.env[m[1]] = v;
  }
}
loadEnvFile(path.resolve(process.cwd(), ".env.local"));
loadEnvFile(path.resolve(process.cwd(), ".env"));

function parseArgs(argv) {
  const out = { amount: null, recipient: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--amount") out.amount = argv[++i];
    else if (argv[i] === "--recipient") out.recipient = argv[++i];
  }
  return out;
}
const args = parseArgs(process.argv.slice(2));
if (!args.amount) {
  console.error("Usage: node scripts/smoke-test-solana-to-arc.mjs --amount <usdc> [--recipient 0x...]");
  process.exit(1);
}
const amountUsdc = Number(args.amount);
if (!isFinite(amountUsdc) || amountUsdc <= 0) {
  console.error(`Invalid --amount: ${args.amount}`);
  process.exit(1);
}
const amount = BigInt(Math.round(amountUsdc * 1_000_000)); // 6 decimals

// ─── Constants (mirrored from lib/circle/gateway-sdk.ts + gateway-solana.ts) ───
const SOLANA_DOMAIN = 5;
const ARC_DOMAIN = 26;
const ARC_CHAIN_ID = Number(process.env.ARC_CHAIN_ID || 5042002);
const ARC_RPC = process.env.ARC_RPC_URL || "https://rpc.testnet.arc.network";
const SOLANA_USDC_MINT = "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU";
const SOLANA_GATEWAY_WALLET = "GATEwdfmYNELfp5wDmmR6noSr2vHnAfBPMm2PvCzX5vu";
const ARC_USDC = "0x3600000000000000000000000000000000000000";
const GATEWAY_MINTER = "0x0022222ABE238Cc2C7Bb1f21003F0a260052475B";
const GATEWAY_API = "https://gateway-api-testnet.circle.com/v1/transfer";
const TRANSFER_SPEC_MAGIC = 0xca85def7;
const BURN_INTENT_MAGIC = 0x070afbc2;
const MAX_UINT64 = (1n << 64n) - 1n;
const MAX_FEE = 2_010_000n; // Gateway requires ≥ 2.000005 USDC

// ─── Keys ───
const solRaw = process.env.SOLANA_GATEWAY_PRIVATE_KEY;
if (!solRaw) throw new Error("SOLANA_GATEWAY_PRIVATE_KEY not set");
const solSecret = bs58.decode(solRaw.trim());
if (solSecret.length !== 64) throw new Error(`SOLANA_GATEWAY_PRIVATE_KEY len=${solSecret.length}, expected 64`);
const solKeypair = Keypair.fromSecretKey(solSecret);
const solSigner = solKeypair.publicKey.toBase58();

const clientPk = process.env.ARC_CLIENT_PRIVATE_KEY;
if (!clientPk) throw new Error("ARC_CLIENT_PRIVATE_KEY not set");
const clientAcct = privateKeyToAccount(clientPk.startsWith("0x") ? clientPk : `0x${clientPk}`);
const recipient = (args.recipient || clientAcct.address).toLowerCase();
if (!/^0x[0-9a-f]{40}$/.test(recipient)) throw new Error(`Invalid recipient: ${recipient}`);

// ─── Encoding helpers (matches lib/circle/gateway-solana.ts BurnIntentLayout) ───
function u32beBuf(n) { const b = Buffer.alloc(4); b.writeUInt32BE(Number(n), 0); return b; }
function u256beBuf(n) { const b = Buffer.alloc(32); b.writeBigUInt64BE(BigInt(n), 24); return b; }
function pubkeyBuf(b58) { return new PublicKey(b58).toBuffer(); }
function evmBuf(addr) {
  const padded = pad(addr.toLowerCase(), { size: 32 });
  return Buffer.from(padded.slice(2), "hex");
}

function encodeBurnIntent({ maxBlockHeight, maxFee, spec }) {
  const hookData = Buffer.from(spec.hookData.slice(2), "hex");
  const specBuf = Buffer.concat([
    u32beBuf(TRANSFER_SPEC_MAGIC),
    u32beBuf(spec.version),
    u32beBuf(spec.sourceDomain),
    u32beBuf(spec.destinationDomain),
    spec.sourceContract,
    spec.destinationContract,
    spec.sourceToken,
    spec.destinationToken,
    spec.sourceDepositor,
    spec.destinationRecipient,
    spec.sourceSigner,
    spec.destinationCaller,
    u256beBuf(spec.value),
    spec.salt,
    u32beBuf(hookData.length),
    hookData,
  ]);
  return Buffer.concat([
    u32beBuf(BURN_INTENT_MAGIC),
    u256beBuf(maxBlockHeight),
    u256beBuf(maxFee),
    u32beBuf(specBuf.length),
    specBuf,
  ]);
}

function signBurnIntent(encoded) {
  const prefixed = new Uint8Array(16 + encoded.length);
  prefixed[0] = 0xff;
  prefixed.set(encoded, 16);
  return "0x" + Buffer.from(nacl.sign.detached(prefixed, solKeypair.secretKey)).toString("hex");
}

// ─── Build intent ───
const salt = randomBytes(32);
const intentJson = {
  maxBlockHeight: MAX_UINT64,
  maxFee: MAX_FEE,
  spec: {
    version: 1,
    sourceDomain: SOLANA_DOMAIN,
    destinationDomain: ARC_DOMAIN,
    sourceContract: pubkeyBuf(SOLANA_GATEWAY_WALLET),
    destinationContract: evmBuf(GATEWAY_MINTER),
    sourceToken: pubkeyBuf(SOLANA_USDC_MINT),
    destinationToken: evmBuf(ARC_USDC),
    sourceDepositor: pubkeyBuf(solSigner),
    destinationRecipient: evmBuf(recipient),
    sourceSigner: pubkeyBuf(solSigner),
    destinationCaller: evmBuf("0x0000000000000000000000000000000000000000"),
    value: amount,
    salt,
    hookData: "0x",
  },
};

// ─── Pretty-print intent for the API (uses base58/hex as Circle expects) ───
function buf32ToHex(b) { return "0x" + b.toString("hex"); }
const intentForApi = {
  maxBlockHeight: intentJson.maxBlockHeight.toString(),
  maxFee: intentJson.maxFee.toString(),
  spec: {
    version: 1,
    sourceDomain: SOLANA_DOMAIN,
    destinationDomain: ARC_DOMAIN,
    sourceContract: buf32ToHex(intentJson.spec.sourceContract),
    destinationContract: buf32ToHex(intentJson.spec.destinationContract),
    sourceToken: buf32ToHex(intentJson.spec.sourceToken),
    destinationToken: buf32ToHex(intentJson.spec.destinationToken),
    sourceDepositor: buf32ToHex(intentJson.spec.sourceDepositor),
    destinationRecipient: buf32ToHex(intentJson.spec.destinationRecipient),
    sourceSigner: buf32ToHex(intentJson.spec.sourceSigner),
    destinationCaller: buf32ToHex(intentJson.spec.destinationCaller),
    value: amount.toString(),
    salt: buf32ToHex(salt),
    hookData: "0x",
  },
};

// ─── Arc viem client ───
const arcChain = defineChain({
  id: ARC_CHAIN_ID,
  name: "Arc Testnet",
  nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
  rpcUrls: { default: { http: [ARC_RPC] }, public: { http: [ARC_RPC] } },
  testnet: true,
});
const pub = createPublicClient({ chain: arcChain, transport: http(ARC_RPC) });
const wallet = createWalletClient({ account: clientAcct, chain: arcChain, transport: http(ARC_RPC) });
const usdcAbi = parseAbi(["function balanceOf(address) view returns (uint256)"]);
const minterAbi = parseAbi(["function gatewayMint(bytes attestation, bytes signature)"]);

async function readUsdc(addr) {
  return await pub.readContract({ address: ARC_USDC, abi: usdcAbi, functionName: "balanceOf", args: [addr] });
}

// ─── Run ───
console.log("=== Solana → Arc Burn Intent Smoke Test ===");
console.log(`Solana signer:    ${solSigner}`);
console.log(`Arc recipient:    ${recipient}`);
console.log(`Amount:           ${amountUsdc} USDC (${amount} micro)`);
console.log(`Gateway maxFee:   ${Number(MAX_FEE) / 1e6} USDC`);
console.log(`Net to recipient: ~${(Number(amount - MAX_FEE) / 1e6).toFixed(6)} USDC`);
console.log();

const balPre = await readUsdc(recipient);
console.log(`1. Recipient USDC pre  = ${Number(balPre) / 1e6}`);

console.log("\n2. Building + signing burn intent ...");
const encoded = encodeBurnIntent(intentJson);
const signature = signBurnIntent(encoded);
console.log(`   encoded: ${encoded.length} bytes, sig: ${signature.slice(0, 18)}...`);

console.log("\n3. POST to Circle Gateway API ...");
const apiBody = JSON.stringify([{ burnIntent: intentForApi, signature }]);
const apiRes = await fetch(GATEWAY_API, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: apiBody,
});
const apiText = await apiRes.text();
if (!apiRes.ok) {
  console.error(`   ❌ Gateway API ${apiRes.status}: ${apiText}`);
  process.exit(1);
}
let parsed;
try { parsed = JSON.parse(apiText); } catch { console.error("   ❌ Bad JSON:", apiText); process.exit(1); }
const result = Array.isArray(parsed) ? parsed[0] : parsed;
const attestation = result?.attestation;
const attestationSig = result?.signature;
const transferId = result?.transferId;
if (!attestation || !attestationSig) {
  console.error("   ❌ Missing attestation/signature in response:", JSON.stringify(result));
  process.exit(1);
}
console.log(`   ✅ transferId=${transferId}`);
console.log(`      attestation: ${attestation.length} chars, sig: ${attestationSig.slice(0, 18)}...`);

console.log("\n4. gatewayMint(...) on Arc ...");
const data = encodeFunctionData({ abi: minterAbi, functionName: "gatewayMint", args: [attestation, attestationSig] });
const mintHash = await wallet.sendTransaction({ to: GATEWAY_MINTER, data });
console.log(`   tx ${mintHash}`);
const receipt = await pub.waitForTransactionReceipt({ hash: mintHash });
if (receipt.status !== "success") {
  console.error(`   ❌ Mint reverted (block ${receipt.blockNumber})`);
  process.exit(1);
}
console.log(`   ✅ block ${receipt.blockNumber}, gas ${receipt.gasUsed}`);

console.log("\n5. Verifying ...");
const balPost = await readUsdc(recipient);
const delta = balPost - balPre;
const actualFee = amount - delta;
console.log(`   recipient USDC post = ${Number(balPost) / 1e6}`);
console.log(`   delta = ${Number(delta) / 1e6} USDC`);
console.log(`   actual fee = ${Number(actualFee) / 1e6} USDC (maxFee cap was ${Number(MAX_FEE) / 1e6})`);

// Pass criterion: delta is in [0, amount] and fee did not exceed the maxFee cap.
// Circle testnet typically charges far less than maxFee (observed ~0.003 USDC).
if (delta > 0n && delta <= amount && actualFee <= MAX_FEE) {
  console.log("\n✅ SMOKE TEST PASSED — Solana → Arc burn intent + mint works.");
} else {
  console.error(`\n❌ delta out of bounds (got ${delta}, amount ${amount}, fee ${actualFee}, maxFee ${MAX_FEE}).`);
  process.exit(1);
}
