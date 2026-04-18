/**
 * End-to-end smoke test of the Arc deployment.
 *
 * Flow (all on-chain on Arc Testnet):
 *   1. Generate ephemeral provider EOA, fund it with 0.001 USDC for gas
 *   2. Provider EOA self-registers via IdentityRegistry.register() → agentId N
 *   3. Client (deployer) creates a Job with provider=ephemeral, evaluator=client
 *   4. Provider calls setBudget(0)
 *   5. Client funds the Job
 *   6. Provider submits with deliverable = keccak256("smoke-test")
 *   7. Client (acting as evaluator) completes the Job
 *   8. Read IdentityRegistry.reputation(N) — must be 1
 *
 * Proves: contract bytecode + admin handover + ERC-8004↔ERC-8183 reputation
 *         hook all work on Arc.
 */

import fs from "node:fs";
import path from "node:path";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import {
  createPublicClient,
  createWalletClient,
  defineChain,
  http,
  keccak256,
  toBytes,
} from "viem";

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

const RPC = process.env.ARC_RPC_URL || "https://rpc.testnet.arc.network";
const CHAIN_ID = Number(process.env.ARC_CHAIN_ID || 5042002);
const CLIENT_PK = process.env.ARC_CLIENT_PRIVATE_KEY;
if (!CLIENT_PK) throw new Error("ARC_CLIENT_PRIVATE_KEY not set");

const dep = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), "deployments", "arc-testnet.json"), "utf8"));
const IDENTITY = dep.contracts.IdentityRegistry.address;
const AC = dep.contracts.AgenticCommerce.address;
const IDENTITY_ABI = dep.abis.IdentityRegistry;
const AC_ABI = dep.abis.AgenticCommerce;

const arcTestnet = defineChain({
  id: CHAIN_ID,
  name: "Arc Testnet",
  nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
  rpcUrls: { default: { http: [RPC] }, public: { http: [RPC] } },
  testnet: true,
});

const pub = createPublicClient({ chain: arcTestnet, transport: http(RPC) });

const clientAcct = privateKeyToAccount(CLIENT_PK.startsWith("0x") ? CLIENT_PK : `0x${CLIENT_PK}`);
const providerPk = generatePrivateKey();
const providerAcct = privateKeyToAccount(providerPk);
const clientWallet = createWalletClient({ account: clientAcct, chain: arcTestnet, transport: http(RPC) });
const providerWallet = createWalletClient({ account: providerAcct, chain: arcTestnet, transport: http(RPC) });

console.log("=== Arc Smoke Test ===");
console.log("Identity:  " + IDENTITY);
console.log("Commerce:  " + AC);
console.log("Client:    " + clientAcct.address);
console.log("Provider:  " + providerAcct.address + " (ephemeral)");
console.log();

async function send(label, hash) {
  console.log(`  → ${label} tx ${hash}`);
  const r = await pub.waitForTransactionReceipt({ hash });
  if (r.status !== "success") throw new Error(`${label} reverted (block ${r.blockNumber})`);
  console.log(`    ✅ block ${r.blockNumber}, gas ${r.gasUsed}`);
  return r;
}

// 1. Fund provider with gas
console.log("1. Funding provider EOA with 0.05 USDC (Arc native gas) ...");
const fundHash = await clientWallet.sendTransaction({
  to: providerAcct.address,
  value: 50_000_000_000_000_000n, // 0.05 * 1e18
});
await send("fund-provider", fundHash);

// 2. Provider self-registers
console.log("\n2. Provider registers as agent ...");
const regHash = await providerWallet.writeContract({
  address: IDENTITY,
  abi: IDENTITY_ABI,
  functionName: "register",
  args: ["https://example.invalid/smoke-test-agent.json"],
});
await send("register", regHash);
const newAgentId = await pub.readContract({
  address: IDENTITY, abi: IDENTITY_ABI, functionName: "agentIdOf", args: [providerAcct.address],
});
console.log(`    minted agentId = ${newAgentId}`);

// 3. createJob (client)
console.log("\n3. Creating Job ...");
const expiry = BigInt(Math.floor(Date.now() / 1000) + 24 * 3600);
const createHash = await clientWallet.writeContract({
  address: AC,
  abi: AC_ABI,
  functionName: "createJob",
  args: [providerAcct.address, clientAcct.address, expiry, "smoke-test job", "0x0000000000000000000000000000000000000000"],
});
const createReceipt = await send("createJob", createHash);
const jobCounter = await pub.readContract({
  address: AC, abi: AC_ABI, functionName: "jobCounter",
});
const jobId = jobCounter;
console.log(`    jobId = ${jobId}`);

// 4. provider setBudget(0)
console.log("\n4. Provider setBudget(0) ...");
const setBudgetHash = await providerWallet.writeContract({
  address: AC, abi: AC_ABI, functionName: "setBudget", args: [jobId, 0n, "0x"],
});
await send("setBudget", setBudgetHash);

// 5. client fund
console.log("\n5. Client funds Job ...");
const fundJobHash = await clientWallet.writeContract({
  address: AC, abi: AC_ABI, functionName: "fund", args: [jobId, "0x"],
});
await send("fund", fundJobHash);

// 6. provider submit
console.log("\n6. Provider submits ...");
const deliverable = keccak256(toBytes("smoke-test"));
const submitHash = await providerWallet.writeContract({
  address: AC, abi: AC_ABI, functionName: "submit", args: [jobId, deliverable, "0x"],
});
await send("submit", submitHash);

// 7. evaluator (= client) complete
console.log("\n7. Evaluator completes Job ...");
const reason = keccak256(toBytes("ok"));
const completeHash = await clientWallet.writeContract({
  address: AC, abi: AC_ABI, functionName: "complete", args: [jobId, reason, "0x"],
});
await send("complete", completeHash);

// 8. read reputation
console.log("\n8. Verifying on-chain state ...");
const rep = await pub.readContract({
  address: IDENTITY, abi: IDENTITY_ABI, functionName: "reputation", args: [newAgentId],
});
const job = await pub.readContract({
  address: AC, abi: AC_ABI, functionName: "getJob", args: [jobId],
});
const STATUS = ["Open", "Funded", "Submitted", "Completed", "Rejected", "Expired"];
console.log(`    reputation[agentId=${newAgentId}] = ${rep}`);
console.log(`    job.status = ${STATUS[job.status]} (${job.status})`);
console.log(`    job.budget = ${job.budget}`);

if (rep === 1n && job.status === 3) {
  console.log("\n✅ SMOKE TEST PASSED — full ERC-8004↔ERC-8183 lifecycle works on Arc.");
} else {
  console.error("\n❌ SMOKE TEST FAILED");
  console.error(`    expected reputation=1, got ${rep}`);
  console.error(`    expected job.status=3 (Completed), got ${job.status}`);
  process.exit(1);
}
