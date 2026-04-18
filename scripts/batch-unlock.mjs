// Batch-unlock all locked iterations of a job.
// For each iteration:
//   1. Sign EIP-3009 TransferWithAuthorization with ARC_CLIENT_PRIVATE_KEY
//   2. Submit transferWithAuthorization on-chain via ARC_RELAY_PRIVATE_KEY
//   3. Mark iteration unlocked + insert payment record (Supabase service role)
//
// Usage: JOB_ID=<uuid> node scripts/batch-unlock.mjs

import fs from 'fs';
import path from 'path';
import { createPublicClient, createWalletClient, http, parseUnits, toHex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

fs.readFileSync(path.join(process.cwd(), '.env.local'), 'utf8').split('\n').forEach((line) => {
  const m = line.match(/^([^#=\s][^=]*)=(.+)$/);
  if (m) process.env[m[1].trim()] = m[2].trim();
});

const JOB_ID = process.env.JOB_ID;
if (!JOB_ID) {
  console.error('Usage: JOB_ID=<uuid> node scripts/batch-unlock.mjs');
  process.exit(1);
}

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const CLIENT_PK = process.env.ARC_CLIENT_PRIVATE_KEY;
const RELAY_PK = process.env.ARC_RELAY_PRIVATE_KEY;
const AGENT_ADDR = process.env.ARC_AGENT_ADDRESS;

const arcTestnet = {
  id: 5042002,
  name: 'Arc Testnet',
  nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 18 },
  rpcUrls: { default: { http: ['https://rpc.testnet.arc.network'] } },
};

const USDC = '0x3600000000000000000000000000000000000000';
const USDC_ABI = [
  {
    name: 'transferWithAuthorization',
    type: 'function',
    inputs: [
      { name: 'from', type: 'address' },
      { name: 'to', type: 'address' },
      { name: 'value', type: 'uint256' },
      { name: 'validAfter', type: 'uint256' },
      { name: 'validBefore', type: 'uint256' },
      { name: 'nonce', type: 'bytes32' },
      { name: 'v', type: 'uint8' },
      { name: 'r', type: 'bytes32' },
      { name: 's', type: 'bytes32' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
];

const EIP3009_DOMAIN = {
  name: 'USDC',
  version: '2',
  chainId: arcTestnet.id,
  verifyingContract: USDC,
};

const TYPES = {
  TransferWithAuthorization: [
    { name: 'from', type: 'address' },
    { name: 'to', type: 'address' },
    { name: 'value', type: 'uint256' },
    { name: 'validAfter', type: 'uint256' },
    { name: 'validBefore', type: 'uint256' },
    { name: 'nonce', type: 'bytes32' },
  ],
};

const PRICE_USDC = '0.001';
const VALID_SECONDS = 600; // 10 min validity per sig
const AGENT_WALLET_ID = '4cfcb13b-391b-58d1-8e83-8b6204b37d28';

const publicClient = createPublicClient({ chain: arcTestnet, transport: http() });
const clientPk = (CLIENT_PK.startsWith('0x') ? CLIENT_PK : '0x' + CLIENT_PK);
const relayPk = (RELAY_PK.startsWith('0x') ? RELAY_PK : '0x' + RELAY_PK);
const clientAccount = privateKeyToAccount(clientPk);
const relayAccount = privateKeyToAccount(relayPk);
const relayClient = createWalletClient({ account: relayAccount, chain: arcTestnet, transport: http() });

const sbHeaders = {
  apikey: SUPABASE_KEY,
  Authorization: `Bearer ${SUPABASE_KEY}`,
  'Content-Type': 'application/json',
};

async function fetchLockedIterations() {
  const url = `${SUPABASE_URL}/rest/v1/darwinia_iterations?job_id=eq.${JOB_ID}&is_unlocked=eq.false&order=generation.asc&select=id,generation`;
  const r = await fetch(url, { headers: sbHeaders });
  if (!r.ok) throw new Error(`fetch iterations: ${r.status} ${await r.text()}`);
  return r.json();
}

async function unlockOne(iter) {
  const value = parseUnits(PRICE_USDC, 6);
  const now = BigInt(Math.floor(Date.now() / 1000));
  const validAfter = 0n;
  const validBefore = now + BigInt(VALID_SECONDS);
  const nonceBytes = new Uint8Array(32);
  crypto.getRandomValues(nonceBytes);
  const nonce = toHex(nonceBytes);

  const message = {
    from: clientAccount.address,
    to: AGENT_ADDR,
    value,
    validAfter,
    validBefore,
    nonce,
  };

  const sig = await clientAccount.signTypedData({
    domain: EIP3009_DOMAIN,
    types: TYPES,
    primaryType: 'TransferWithAuthorization',
    message,
  });

  const r = sig.slice(0, 66);
  const s = '0x' + sig.slice(66, 130);
  const v = parseInt(sig.slice(130, 132), 16);

  const hash = await relayClient.writeContract({
    address: USDC,
    abi: USDC_ABI,
    functionName: 'transferWithAuthorization',
    args: [message.from, message.to, message.value, message.validAfter, message.validBefore, message.nonce, v, r, s],
  });

  const receipt = await publicClient.waitForTransactionReceipt({ hash, timeout: 60_000 });
  if (receipt.status !== 'success') throw new Error(`tx reverted: ${hash}`);

  // Mark iteration unlocked
  const upd = await fetch(
    `${SUPABASE_URL}/rest/v1/darwinia_iterations?id=eq.${iter.id}`,
    { method: 'PATCH', headers: sbHeaders, body: JSON.stringify({ is_unlocked: true }) },
  );
  if (!upd.ok) throw new Error(`mark unlocked: ${upd.status} ${await upd.text()}`);

  // Insert payment record
  const ins = await fetch(`${SUPABASE_URL}/rest/v1/darwinia_payments`, {
    method: 'POST',
    headers: sbHeaders,
    body: JSON.stringify({
      job_id: JOB_ID,
      iteration_id: iter.id,
      from_wallet_id: 'eoa-old-wallet',
      from_wallet_address: clientAccount.address,
      to_wallet_id: AGENT_WALLET_ID,
      to_wallet_address: AGENT_ADDR,
      amount_usdc: Number(PRICE_USDC),
      tx_hash: hash,
      state: 'complete',
      x402_scheme: 'exact',
      x402_network: 'arc-testnet',
      eip3009_signature: sig,
      eip3009_nonce: nonce,
      settled_at: new Date().toISOString(),
    }),
  });
  if (!ins.ok) console.warn(`payment insert: ${ins.status} ${await ins.text()}`);

  return hash;
}

async function main() {
  const iters = await fetchLockedIterations();
  console.log(`Job ${JOB_ID}: ${iters.length} locked iterations to unlock`);
  if (iters.length === 0) return;

  const results = [];
  for (const iter of iters) {
    try {
      const hash = await unlockOne(iter);
      console.log(`  gen ${iter.generation}: ${hash}`);
      results.push({ generation: iter.generation, iteration_id: iter.id, tx_hash: hash, status: 'ok' });
    } catch (e) {
      console.error(`  gen ${iter.generation}: FAILED - ${e.message}`);
      results.push({ generation: iter.generation, iteration_id: iter.id, error: e.message, status: 'failed' });
    }
  }

  const ok = results.filter((r) => r.status === 'ok').length;
  console.log(`\nDone: ${ok}/${results.length} successful`);

  // Write tx log for submission evidence
  const out = path.join(process.cwd(), 'slides', `tx-evidence-${JOB_ID}.json`);
  fs.writeFileSync(out, JSON.stringify(results, null, 2));
  console.log(`Tx evidence written to ${out}`);
}

main().catch((e) => {
  console.error('Fatal:', e);
  process.exit(1);
});
