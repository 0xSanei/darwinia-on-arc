/**
 * Solana Gateway signer status + on-chain deposit (Anchor path B).
 *
 * Usage:
 *   node scripts/deposit-solana-gateway.mjs                     # status only
 *   node scripts/deposit-solana-gateway.mjs --deposit 10        # deposit 10 USDC
 *   node scripts/deposit-solana-gateway.mjs --deposit 10 --rpc https://...
 *
 * Reads SOLANA_GATEWAY_PRIVATE_KEY (bs58) from .env.local / .env. The deposit
 * call is the Circle Gateway Wallet program `deposit` Anchor instruction
 * (program GATEwdfm…CzX5vu, discriminator [22, 0]) — IDL mirrored from
 * github.com/circlefin/skills (use-gateway/references/config.md).
 */

import fs from "node:fs";
import path from "node:path";
import {
  Connection,
  Keypair,
  PublicKey,
  LAMPORTS_PER_SOL,
  SystemProgram,
} from "@solana/web3.js";
import {
  getAssociatedTokenAddress,
  getAccount,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import bs58 from "bs58";
import anchor from "@coral-xyz/anchor";
const { AnchorProvider, Program, BN, Wallet } = anchor;

function loadEnvFile(file) {
  if (!fs.existsSync(file)) return;
  const src = fs.readFileSync(file, "utf8");
  for (const line of src.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (!m) continue;
    if (process.env[m[1]]) continue;
    let v = m[2];
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    process.env[m[1]] = v;
  }
}

loadEnvFile(path.resolve(process.cwd(), ".env.local"));
loadEnvFile(path.resolve(process.cwd(), ".env"));

function parseArgs(argv) {
  const out = { deposit: null, rpc: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--deposit") out.deposit = argv[++i];
    else if (argv[i] === "--rpc") out.rpc = argv[++i];
  }
  return out;
}
const args = parseArgs(process.argv.slice(2));

const SOLANA_RPC_ENDPOINT =
  args.rpc || process.env.SOLANA_RPC_ENDPOINT || "https://api.devnet.solana.com";
const SOLANA_USDC_MINT = "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU";
const SOLANA_GATEWAY_WALLET_ADDRESS = "GATEwdfmYNELfp5wDmmR6noSr2vHnAfBPMm2PvCzX5vu";

const raw = process.env.SOLANA_GATEWAY_PRIVATE_KEY;
if (!raw) {
  console.error("SOLANA_GATEWAY_PRIVATE_KEY not set. Run: node scripts/generate-solana-keypair.mjs");
  process.exit(1);
}
const secretKey = bs58.decode(raw.trim());
if (secretKey.length !== 64) {
  console.error(`SOLANA_GATEWAY_PRIVATE_KEY decodes to ${secretKey.length} bytes; expected 64.`);
  process.exit(1);
}

const keypair = Keypair.fromSecretKey(secretKey);
const signer = keypair.publicKey.toBase58();
const connection = new Connection(SOLANA_RPC_ENDPOINT, "confirmed");

async function fetchBalances() {
  const lamports = await connection.getBalance(keypair.publicKey);
  const ata = await getAssociatedTokenAddress(
    new PublicKey(SOLANA_USDC_MINT),
    keypair.publicKey
  );
  let usdc = 0n;
  try {
    const account = await getAccount(connection, ata);
    usdc = account.amount;
  } catch (err) {
    if (!(err?.name === "TokenAccountNotFoundError" || String(err?.message).includes("could not find account"))) {
      throw err;
    }
  }
  return { sol: lamports / LAMPORTS_PER_SOL, usdc, ata };
}

function printStatus({ sol, usdc, custody, depositPda }) {
  console.log("\n=== Solana Gateway Signer Status ===\n");
  console.log("Signer address:           " + signer);
  console.log("RPC endpoint:             " + SOLANA_RPC_ENDPOINT);
  console.log("SOL balance:              " + sol.toFixed(6) + " SOL");
  console.log("USDC balance (wallet):    " + (Number(usdc) / 1e6).toFixed(6) + " USDC");
  if (custody !== undefined) {
    console.log("Gateway custody balance:  " + (Number(custody) / 1e6).toFixed(6) + " USDC (program PDA)");
  }
  console.log();
  console.log("Gateway Wallet program:   " + SOLANA_GATEWAY_WALLET_ADDRESS);
  console.log("USDC mint (devnet):       " + SOLANA_USDC_MINT);
  if (depositPda) {
    console.log("Your deposit PDA:         " + depositPda);
  }
  console.log("Signer explorer: https://explorer.solana.com/address/" + signer + "?cluster=devnet");
  console.log();
}

const GATEWAY_WALLET_IDL = {
  address: SOLANA_GATEWAY_WALLET_ADDRESS,
  metadata: { name: "gatewayWallet", version: "0.1.0", spec: "0.1.0" },
  instructions: [
    {
      name: "deposit",
      discriminator: [22, 0],
      accounts: [
        { name: "payer", writable: true, signer: true },
        { name: "owner", signer: true },
        { name: "gatewayWallet" },
        { name: "ownerTokenAccount", writable: true },
        { name: "custodyTokenAccount", writable: true },
        { name: "deposit", writable: true },
        { name: "depositorDenylist" },
        { name: "tokenProgram" },
        { name: "systemProgram" },
        { name: "eventAuthority" },
        { name: "program" },
      ],
      args: [{ name: "amount", type: "u64" }],
    },
  ],
};

function findPDAs(programId, usdcMint, owner) {
  return {
    wallet: PublicKey.findProgramAddressSync(
      [Buffer.from("gateway_wallet")],
      programId
    )[0],
    custody: PublicKey.findProgramAddressSync(
      [Buffer.from("gateway_wallet_custody"), usdcMint.toBuffer()],
      programId
    )[0],
    deposit: PublicKey.findProgramAddressSync(
      [Buffer.from("gateway_deposit"), usdcMint.toBuffer(), owner.toBuffer()],
      programId
    )[0],
    denylist: PublicKey.findProgramAddressSync(
      [Buffer.from("denylist"), owner.toBuffer()],
      programId
    )[0],
    eventAuthority: PublicKey.findProgramAddressSync(
      [Buffer.from("__event_authority")],
      programId
    )[0],
  };
}

async function getCustodyBalance(custody) {
  try {
    const account = await getAccount(connection, custody);
    return account.amount;
  } catch (err) {
    if (err?.name === "TokenAccountNotFoundError" || String(err?.message).includes("could not find account")) {
      return 0n;
    }
    throw err;
  }
}

const programId = new PublicKey(SOLANA_GATEWAY_WALLET_ADDRESS);
const usdcMint = new PublicKey(SOLANA_USDC_MINT);
const pdas = findPDAs(programId, usdcMint, keypair.publicKey);

const before = await fetchBalances();
const custodyBefore = await getCustodyBalance(pdas.custody);
printStatus({ ...before, custody: custodyBefore, depositPda: pdas.deposit.toBase58() });

if (!args.deposit) {
  if (before.sol < 0.01) console.warn("⚠️  Low SOL. Fund at https://faucet.solana.com/");
  if (before.usdc < 1_000_000n) console.warn("⚠️  Low USDC. Fund at https://faucet.circle.com/ (Solana Devnet)");
  console.log("Pass --deposit <amount-usdc> to deposit (e.g. --deposit 10).");
  process.exit(0);
}

const amountUsdc = Number(args.deposit);
if (!Number.isFinite(amountUsdc) || amountUsdc <= 0) {
  console.error(`Invalid --deposit value: ${args.deposit}`);
  process.exit(1);
}
const amountBaseUnits = BigInt(Math.round(amountUsdc * 1e6));
if (before.usdc < amountBaseUnits) {
  console.error(
    `Insufficient USDC. Want ${amountUsdc} USDC (${amountBaseUnits} base units), have ${Number(before.usdc) / 1e6}.`
  );
  process.exit(1);
}
if (before.sol < 0.005) {
  console.error("Insufficient SOL for tx fee + rent. Need at least ~0.005 SOL.");
  process.exit(1);
}

console.log(`>>> Depositing ${amountUsdc} USDC into Gateway Wallet program ...`);

const wallet = new Wallet(keypair);
const provider = new AnchorProvider(connection, wallet, {
  commitment: "confirmed",
  preflightCommitment: "confirmed",
});

const program = new Program(GATEWAY_WALLET_IDL, provider);

const sig = await program.methods
  .deposit(new BN(amountBaseUnits.toString()))
  .accountsPartial({
    payer: keypair.publicKey,
    owner: keypair.publicKey,
    gatewayWallet: pdas.wallet,
    ownerTokenAccount: before.ata,
    custodyTokenAccount: pdas.custody,
    deposit: pdas.deposit,
    depositorDenylist: pdas.denylist,
    tokenProgram: TOKEN_PROGRAM_ID,
    systemProgram: SystemProgram.programId,
    eventAuthority: pdas.eventAuthority,
    program: programId,
  })
  .rpc();

console.log("✅ Deposit submitted. Signature: " + sig);
console.log("   Explorer: https://explorer.solana.com/tx/" + sig + "?cluster=devnet");

console.log("\n>>> Confirming new balances ...");
const after = await fetchBalances();
const custodyAfter = await getCustodyBalance(pdas.custody);
printStatus({ ...after, custody: custodyAfter, depositPda: pdas.deposit.toBase58() });

const delta = (Number(custodyAfter) - Number(custodyBefore)) / 1e6;
console.log(`Custody change: +${delta.toFixed(6)} USDC`);
