/**
 * Bootstrap a brand-new on-chain agent EOA for darwinia-on-arc.
 *
 * One-shot script that:
 *   1. Generates a fresh viem private key (random EOA)
 *   2. Funds it with 0.05 USDC native gas from ARC_RELAY_PRIVATE_KEY (= the old
 *      wallet 0xa785...c36, which holds the funds)
 *   3. Self-registers the new EOA on IdentityRegistry → returns agentId
 *   4. UPDATEs Supabase darwinia_agents row (wallet_address, onchain_agent_id)
 *   5. Persists ARC_AGENT_PRIVATE_KEY / ARC_AGENT_ADDRESS / NEXT_PUBLIC_ARC_AGENT_ADDRESS
 *      into .env.local (idempotent — replaces existing keys, appends if missing)
 *
 * After this runs, restart the agent worker (pm2 restart darwinia-agent or
 * `node agent-worker/index.js`) and the on-chain submit/complete pipeline is
 * fully wired with a real EOA the worker controls.
 *
 * Re-running: aborts if ARC_AGENT_PRIVATE_KEY already exists in .env.local
 * unless --force is passed.
 *
 * Run: node scripts/bootstrap-agent-eoa.mjs [--force]
 */

import fs from 'node:fs';
import path from 'node:path';
import {
  createPublicClient,
  createWalletClient,
  defineChain,
  http,
} from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';

// ── env loader ───────────────────────────────────────────────────────────────
const ENV_PATH = path.resolve(process.cwd(), '.env.local');
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
loadEnv(ENV_PATH);

const FORCE = process.argv.includes('--force');

// ── config ───────────────────────────────────────────────────────────────────
const RELAY_PK = process.env.ARC_RELAY_PRIVATE_KEY || process.env.ARC_CLIENT_PRIVATE_KEY;
if (!RELAY_PK) throw new Error('ARC_RELAY_PRIVATE_KEY (or ARC_CLIENT_PRIVATE_KEY) must be set in .env.local');

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  throw new Error('NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set');
}

if (process.env.ARC_AGENT_PRIVATE_KEY && !FORCE) {
  console.error('❌ ARC_AGENT_PRIVATE_KEY already set in .env.local.');
  console.error('   Re-run with --force to overwrite (this will orphan the previous agent).');
  process.exit(1);
}

const dep = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), 'deployments/arc-testnet.json'), 'utf8'));
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

// ── helpers ──────────────────────────────────────────────────────────────────
async function send(label, hash) {
  const r = await pub.waitForTransactionReceipt({ hash });
  if (r.status !== 'success') throw new Error(`${label} reverted: ${hash}`);
  console.log(`  ✓ ${label}  block=${r.blockNumber}  tx=${hash}`);
  return r;
}

async function supabaseFetch(p, opts = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1${p}`, {
    ...opts,
    headers: {
      apikey: SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
      ...opts.headers,
    },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Supabase ${p}: ${res.status} ${text}`);
  return text ? JSON.parse(text) : null;
}

function upsertEnv(file, kv) {
  const src = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  const lines = src.split(/\r?\n/);
  const seen = new Set();
  const out = lines.map((line) => {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=/);
    if (!m) return line;
    const key = m[1];
    if (key in kv) {
      seen.add(key);
      return `${key}=${kv[key]}`;
    }
    return line;
  });
  // append missing
  const missing = Object.keys(kv).filter((k) => !seen.has(k));
  if (missing.length > 0) {
    if (out[out.length - 1] !== '') out.push('');
    out.push('# Bootstrapped by scripts/bootstrap-agent-eoa.mjs');
    for (const k of missing) out.push(`${k}=${kv[k]}`);
    out.push('');
  }
  fs.writeFileSync(file, out.join('\n'));
}

// ── main ─────────────────────────────────────────────────────────────────────
console.log('=== Bootstrap new on-chain agent EOA ===');
console.log('Relay (funder):', relayAcct.address);

const relayBal = await pub.getBalance({ address: relayAcct.address });
console.log(`Relay balance: ${(Number(relayBal) / 1e18).toFixed(6)} USDC`);
if (relayBal < 100_000_000_000_000_000n) {
  throw new Error(`Relay balance < 0.1 USDC; please top up ${relayAcct.address} on Arc`);
}

// 1. Generate new EOA
console.log('\n[1] Generate new agent EOA');
const newPk = generatePrivateKey();
const newAcct = privateKeyToAccount(newPk);
const newWallet = createWalletClient({ account: newAcct, chain: arcTestnet, transport: http() });
console.log(`     address = ${newAcct.address}`);
console.log(`     pk      = ${newPk.slice(0, 10)}...${newPk.slice(-4)}`);

// 2. Fund with 0.05 USDC native gas
console.log('\n[2] Fund new EOA with 0.05 USDC gas (from relay)');
const fundHash = await relayWallet.sendTransaction({
  to: newAcct.address,
  value: 50_000_000_000_000_000n,
});
await send('fund', fundHash);
const newBal = await pub.getBalance({ address: newAcct.address });
console.log(`     new EOA balance: ${(Number(newBal) / 1e18).toFixed(6)} USDC`);

// 3. Self-register on IdentityRegistry
console.log('\n[3] Self-register on IdentityRegistry');
const metadataUri = 'https://example.invalid/darwinia-agent.json';
const regHash = await newWallet.writeContract({
  address: IDENTITY,
  abi: IDENTITY_ABI,
  functionName: 'register',
  args: [metadataUri],
});
await send('register', regHash);

const agentId = await pub.readContract({
  address: IDENTITY,
  abi: IDENTITY_ABI,
  functionName: 'agentIdOf',
  args: [newAcct.address],
});
const reputation = await pub.readContract({
  address: IDENTITY,
  abi: IDENTITY_ABI,
  functionName: 'reputation',
  args: [agentId],
});
console.log(`     agentId    = ${agentId}`);
console.log(`     reputation = ${reputation}`);

// 4. Update Supabase darwinia_agents row
console.log('\n[4] Update Supabase darwinia_agents');
// Find the existing default agent row (the one with old Circle DCW address).
const OLD_ADDR = (process.env.NEXT_PUBLIC_ARC_AGENT_ADDRESS || process.env.ARC_AGENT_ADDRESS || '').toLowerCase();
let targetRow = null;
if (OLD_ADDR) {
  const rows = await supabaseFetch(`/darwinia_agents?wallet_address=eq.${OLD_ADDR}&select=id,name,wallet_address,onchain_agent_id`);
  if (rows && rows.length > 0) targetRow = rows[0];
}
if (!targetRow) {
  // fallback: find by name
  const rows = await supabaseFetch(`/darwinia_agents?name=eq.darwinia-default&select=id,name,wallet_address,onchain_agent_id`);
  if (rows && rows.length > 0) targetRow = rows[0];
}

if (targetRow) {
  console.log(`     found row id=${targetRow.id} (was wallet=${targetRow.wallet_address}, onchain_id=${targetRow.onchain_agent_id})`);
  const [updated] = await supabaseFetch(`/darwinia_agents?id=eq.${targetRow.id}`, {
    method: 'PATCH',
    body: JSON.stringify({
      wallet_address: newAcct.address.toLowerCase(),
      onchain_agent_id: Number(agentId),
    }),
  });
  console.log(`     ✓ updated → wallet=${updated.wallet_address}, onchain_id=${updated.onchain_agent_id}`);
} else {
  console.log('     no existing row found — creating new');
  const [created] = await supabaseFetch('/darwinia_agents', {
    method: 'POST',
    body: JSON.stringify({
      name: 'darwinia-default',
      wallet_address: newAcct.address.toLowerCase(),
      onchain_agent_id: Number(agentId),
    }),
  });
  console.log(`     ✓ created row id=${created.id}`);
}

// 5. Persist to .env.local
console.log('\n[5] Persist secrets to .env.local');
upsertEnv(ENV_PATH, {
  ARC_AGENT_PRIVATE_KEY: newPk,
  ARC_AGENT_ADDRESS: newAcct.address,
  NEXT_PUBLIC_ARC_AGENT_ADDRESS: newAcct.address,
});
console.log(`     ✓ wrote ARC_AGENT_PRIVATE_KEY / ARC_AGENT_ADDRESS / NEXT_PUBLIC_ARC_AGENT_ADDRESS`);

// ── summary ──────────────────────────────────────────────────────────────────
console.log('\n========================================');
console.log('✅ BOOTSTRAP COMPLETE');
console.log('========================================');
console.log(`New agent EOA:    ${newAcct.address}`);
console.log(`Funded with:      0.05 USDC (from ${relayAcct.address})`);
console.log(`On-chain agentId: ${agentId}`);
console.log(`Initial reputation: ${reputation}`);
console.log(`\nNext steps:`);
console.log(`  1. (Optional) Update agent-worker/index.js line 41: AGENT_WALLET_ADDRESS = process.env.ARC_AGENT_ADDRESS || '...';`);
console.log(`  2. Restart agent worker:  pm2 restart darwinia-agent  (or rerun node agent-worker/index.js)`);
console.log(`  3. Create a new job — agent will now submit() + complete() on-chain and earn reputation.`);
