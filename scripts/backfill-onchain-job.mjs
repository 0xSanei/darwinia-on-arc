/**
 * Quick: mint an on-chain Job for an existing DB row (or create a fresh demo
 * row) so the dApp shows ERC-8183/ERC-8004 badges. Mirrors the path that
 * POST /api/darwinia/jobs takes after my P0 wiring.
 *
 * Usage:
 *   node scripts/backfill-onchain-job.mjs                     # create new demo row
 *   node scripts/backfill-onchain-job.mjs <existing-job-uuid> # backfill existing row
 */

import fs from 'node:fs';
import path from 'node:path';
import {
  createPublicClient,
  createWalletClient,
  defineChain,
  http,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

function loadEnv(file) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (!m) continue;
    if (process.env[m[1]]) continue;
    let v = m[2];
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    process.env[m[1]] = v;
  }
}
loadEnv(path.resolve(process.cwd(), '.env.local'));

const RELAY_PK = process.env.ARC_RELAY_PRIVATE_KEY || process.env.ARC_CLIENT_PRIVATE_KEY;
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const PROVIDER_ADDR = process.env.NEXT_PUBLIC_ARC_AGENT_ADDRESS;
if (!RELAY_PK || !SUPABASE_URL || !KEY || !PROVIDER_ADDR) {
  throw new Error('Missing env: ARC_RELAY_PRIVATE_KEY, NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, NEXT_PUBLIC_ARC_AGENT_ADDRESS');
}

const dep = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), 'deployments/arc-testnet.json'), 'utf8'));
const AC = dep.contracts.AgenticCommerce.address;
const AC_ABI = dep.abis.AgenticCommerce;

const arcTestnet = defineChain({
  id: Number(process.env.ARC_CHAIN_ID || 5042002),
  name: 'Arc Testnet',
  nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 18 },
  rpcUrls: { default: { http: [process.env.ARC_RPC_URL || 'https://rpc.testnet.arc.network'] } },
  testnet: true,
});

const pub = createPublicClient({ chain: arcTestnet, transport: http() });
const relayAcct = privateKeyToAccount(RELAY_PK.startsWith('0x') ? RELAY_PK : '0x' + RELAY_PK);
const relayWallet = createWalletClient({ account: relayAcct, chain: arcTestnet, transport: http() });

async function sb(p, opts = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1${p}`, {
    ...opts,
    headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json', Prefer: 'return=representation', ...opts.headers },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Supabase ${p}: ${res.status} ${text}`);
  return text ? JSON.parse(text) : null;
}

const argId = process.argv[2];
let row;

if (argId) {
  const rows = await sb(`/darwinia_jobs?id=eq.${argId}&select=*`);
  if (!rows || rows.length === 0) throw new Error(`Job ${argId} not found`);
  row = rows[0];
  console.log(`Backfilling existing job: "${row.title}" (id=${row.id})`);
} else {
  // Pick an existing user_id
  const owners = await sb(`/darwinia_jobs?select=user_id,client_wallet_id,client_wallet_address&limit=1`);
  if (!owners || owners.length === 0) throw new Error('No existing job to derive user_id');
  const u = owners[0];
  const [created] = await sb(`/darwinia_jobs`, {
    method: 'POST',
    body: JSON.stringify({
      user_id: u.user_id,
      title: 'On-chain Demo — ETH/USDT 5-gen',
      description: 'Live demo: agent picks up → submit() + complete() → reputation +1',
      target_symbol: 'ETH/USDT',
      max_generations: 5,
      population_size: 30,
      budget_usdc: 0.05,
      price_per_iteration_usdc: 0.001,
      client_wallet_id: u.client_wallet_id,
      client_wallet_address: u.client_wallet_address,
    }),
  });
  row = created;
  console.log(`Created fresh demo job id=${row.id}`);
}

console.log('\nMinting on-chain Job…');
const description = `${row.title} | dbId=${row.id}`;
const expiredAt = BigInt(Math.floor(Date.now() / 1000) + 24 * 3600);
const hash = await relayWallet.writeContract({
  address: AC, abi: AC_ABI, functionName: 'createJob',
  args: [PROVIDER_ADDR, relayAcct.address, expiredAt, description, '0x0000000000000000000000000000000000000000'],
});
const r = await pub.waitForTransactionReceipt({ hash });
if (r.status !== 'success') throw new Error(`createJob reverted: ${hash}`);

const jobId = await pub.readContract({ address: AC, abi: AC_ABI, functionName: 'jobCounter' });
console.log(`  ✓ tx=${hash}`);
console.log(`  ✓ onchain_job_id=${jobId}`);

await sb(`/darwinia_jobs?id=eq.${row.id}`, {
  method: 'PATCH',
  body: JSON.stringify({ onchain_job_id: jobId.toString() }),
});

console.log(`\n✅ DB updated: job ${row.id} now has onchain_job_id=${jobId}`);
console.log(`Open: http://localhost:3000/dashboard/darwinia/${row.id}`);
console.log(`Explorer: https://explorer.testnet.arc.network/tx/${hash}`);
