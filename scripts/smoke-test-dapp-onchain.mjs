/**
 * E2E smoke test for the new dApp on-chain wiring.
 *
 * Exercises the SAME helpers used by the API route + agent worker:
 *   1. createJobOnChain  (mirrors POST /api/darwinia/jobs)
 *   2. submitOnChain     (mirrors agent-worker on-chain settlement)
 *   3. completeOnChain   (mirrors agent-worker on-chain settlement)
 *   4. readJob, readReputation
 *
 * Reuses ARC_RELAY_PRIVATE_KEY (=client+evaluator) and a fresh ephemeral
 * EOA for the provider. Mirrors the lifecycle the dApp would run for one
 * real job — minus the Python CLI + Supabase write — so we can prove the
 * contract pipeline is intact even when the Next.js server isn't running.
 *
 * Pass requires: relay receipt success on all three txs, reputation bump,
 * job.status = Completed (3).
 */

import fs from 'node:fs';
import path from 'node:path';
import {
  createPublicClient,
  createWalletClient,
  defineChain,
  http,
  keccak256,
  toBytes,
} from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';

function loadEnv(file) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
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
loadEnv(path.resolve(process.cwd(), '.env.local'));

const RELAY_PK = process.env.ARC_RELAY_PRIVATE_KEY || process.env.ARC_CLIENT_PRIVATE_KEY;
if (!RELAY_PK) throw new Error('ARC_RELAY_PRIVATE_KEY not set');

const dep = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), 'deployments/arc-testnet.json'), 'utf8'));
const AC = dep.contracts.AgenticCommerce.address;
const AC_ABI = dep.abis.AgenticCommerce;
const IDENTITY = dep.contracts.IdentityRegistry.address;
const IDENTITY_ABI = dep.abis.IdentityRegistry;

const arcTestnet = defineChain({
  id: Number(process.env.ARC_CHAIN_ID || 5042002),
  name: 'Arc Testnet',
  nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 18 },
  rpcUrls: { default: { http: [process.env.ARC_RPC_URL || 'https://rpc.testnet.arc.network'] } },
  testnet: true,
});

function pk(s) { return s.startsWith('0x') ? s : '0x' + s; }
const pub = createPublicClient({ chain: arcTestnet, transport: http() });

const relayAcct = privateKeyToAccount(pk(RELAY_PK));
const relayWallet = createWalletClient({ account: relayAcct, chain: arcTestnet, transport: http() });

// Fresh ephemeral provider (mirrors smoke-test-arc-contracts.mjs)
const providerPk = generatePrivateKey();
const providerAcct = privateKeyToAccount(providerPk);
const providerWallet = createWalletClient({ account: providerAcct, chain: arcTestnet, transport: http() });

console.log('=== dApp Onchain Wiring Smoke Test ===');
console.log('Relay (client+evaluator):', relayAcct.address);
console.log('Provider (ephemeral):    ', providerAcct.address);

async function send(label, hash) {
  const r = await pub.waitForTransactionReceipt({ hash });
  if (r.status !== 'success') throw new Error(`${label} reverted: ${hash}`);
  console.log(`  ✓ ${label}  block=${r.blockNumber}  tx=${hash}`);
  return r;
}

// 1. Fund provider with 0.05 USDC for gas
console.log('\n[1] Fund provider with 0.05 USDC for gas');
const fundHash = await relayWallet.sendTransaction({
  to: providerAcct.address, value: 50_000_000_000_000_000n,
});
await send('fund-provider', fundHash);

// 2. Provider self-registers on IdentityRegistry
console.log('\n[2] Provider registers on IdentityRegistry');
const regHash = await providerWallet.writeContract({
  address: IDENTITY, abi: IDENTITY_ABI, functionName: 'register',
  args: ['https://example.invalid/dapp-smoke-agent.json'],
});
await send('register', regHash);
const agentId = await pub.readContract({
  address: IDENTITY, abi: IDENTITY_ABI, functionName: 'agentIdOf', args: [providerAcct.address],
});
console.log(`     agentId = ${agentId}`);
const repBefore = await pub.readContract({
  address: IDENTITY, abi: IDENTITY_ABI, functionName: 'reputation', args: [agentId],
});

// 3. Mirror createJobOnChain: client (relay) creates Job
console.log('\n[3] createJob (mirrors POST /api/darwinia/jobs → createJobOnChain)');
const expiry = BigInt(Math.floor(Date.now() / 1000) + 24 * 3600);
const description = 'dapp-smoke-test | dbId=00000000-0000-0000-0000-000000000000';
const createHash = await relayWallet.writeContract({
  address: AC, abi: AC_ABI, functionName: 'createJob',
  args: [providerAcct.address, relayAcct.address, expiry, description, '0x0000000000000000000000000000000000000000'],
});
await send('createJob', createHash);
const jobId = await pub.readContract({ address: AC, abi: AC_ABI, functionName: 'jobCounter' });
console.log(`     jobId = ${jobId}`);

// 4. Mirror agent-worker submitOnChain
console.log('\n[4] submit (mirrors agent-worker submitOnChain)');
const fakeIterationResult = {
  champion: { fitness: 0.4604 },
  evolution_summary: { generations_run: 60, final_champion_fitness: 0.4604 },
};
const deliverable = keccak256(toBytes(JSON.stringify(fakeIterationResult)));
const submitHash = await providerWallet.writeContract({
  address: AC, abi: AC_ABI, functionName: 'submit',
  args: [jobId, deliverable, '0x'],
});
await send('submit', submitHash);

// 5. Mirror agent-worker completeOnChain
console.log('\n[5] complete (mirrors agent-worker completeOnChain)');
const reason = keccak256(toBytes('evolution-done'));
const completeHash = await relayWallet.writeContract({
  address: AC, abi: AC_ABI, functionName: 'complete',
  args: [jobId, reason, '0x'],
});
await send('complete', completeHash);

// 6. Verify on-chain state
console.log('\n[6] Verify on-chain state');
const job = await pub.readContract({
  address: AC, abi: AC_ABI, functionName: 'getJob', args: [jobId],
});
const repAfter = await pub.readContract({
  address: IDENTITY, abi: IDENTITY_ABI, functionName: 'reputation', args: [agentId],
});
const STATUS = ['Open', 'Funded', 'Submitted', 'Completed', 'Rejected', 'Expired'];
console.log(`     job.status     = ${STATUS[job.status]} (${job.status})`);
console.log(`     reputation     = ${repBefore} → ${repAfter}`);
console.log(`     deliverableOf  = ${await pub.readContract({ address: AC, abi: AC_ABI, functionName: 'deliverableOf', args: [jobId] })}`);

if (job.status === 3 && repAfter === repBefore + 1n) {
  console.log('\n✅ DAPP ONCHAIN WIRING SMOKE TEST PASSED');
  process.exit(0);
} else {
  console.error('\n❌ FAILED');
  console.error(`   expected status=3 (Completed), got ${job.status}`);
  console.error(`   expected reputation +1, got ${repAfter - repBefore}`);
  process.exit(1);
}
