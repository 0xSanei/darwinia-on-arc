/**
 * On-chain helpers for the agent worker (CommonJS).
 * Uses viem 2.x (works in both ESM and CJS).
 *
 * Opt-in: requires ARC_AGENT_PRIVATE_KEY (provider EOA, must be the address
 * passed as `provider` in createJob, and ideally registered on
 * IdentityRegistry so reputation increments).
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { createPublicClient, createWalletClient, http, keccak256, toBytes } = require('viem');
const { privateKeyToAccount } = require('viem/accounts');

const deployment = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', 'deployments', 'arc-testnet.json'), 'utf8'),
);

const AC = deployment.contracts.AgenticCommerce.address;
const AC_ABI = deployment.abis.AgenticCommerce;
const IDENTITY = deployment.contracts.IdentityRegistry.address;
const IDENTITY_ABI = deployment.abis.IdentityRegistry;

const RPC = process.env.ARC_RPC_URL || 'https://rpc.testnet.arc.network';
const CHAIN_ID = Number(process.env.ARC_CHAIN_ID || 5042002);

const arcTestnet = {
  id: CHAIN_ID,
  name: 'Arc Testnet',
  nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 18 },
  rpcUrls: { default: { http: [RPC] }, public: { http: [RPC] } },
  testnet: true,
};

const ZERO_BYTES = '0x';

function pk(s) {
  return s.startsWith('0x') ? s : `0x${s}`;
}

function pub() {
  return createPublicClient({ chain: arcTestnet, transport: http(RPC) });
}

function wallet(pkStr) {
  const account = privateKeyToAccount(pk(pkStr));
  return { account, client: createWalletClient({ account, chain: arcTestnet, transport: http(RPC) }) };
}

async function send(label, hash) {
  const r = await pub().waitForTransactionReceipt({ hash });
  if (r.status !== 'success') throw new Error(`${label} reverted: ${hash}`);
  return r;
}

/** Submit deliverable as the provider EOA. Returns tx hash. */
async function submitOnChain(jobId, deliverable) {
  const providerPk = process.env.ARC_AGENT_PRIVATE_KEY;
  if (!providerPk) throw new Error('ARC_AGENT_PRIVATE_KEY not set');
  const { client } = wallet(providerPk);
  const hash = await client.writeContract({
    address: AC,
    abi: AC_ABI,
    functionName: 'submit',
    args: [BigInt(jobId), deliverable, ZERO_BYTES],
  });
  await send('submit', hash);
  return hash;
}

/** Complete as the evaluator (= client/relay EOA). Returns tx hash. */
async function completeOnChain(jobId, reasonText) {
  const relayPk = process.env.ARC_RELAY_PRIVATE_KEY || process.env.ARC_CLIENT_PRIVATE_KEY;
  if (!relayPk) throw new Error('ARC_RELAY_PRIVATE_KEY not set');
  const { client } = wallet(relayPk);
  const reason = keccak256(toBytes((reasonText || 'ok').slice(0, 32)));
  const hash = await client.writeContract({
    address: AC,
    abi: AC_ABI,
    functionName: 'complete',
    args: [BigInt(jobId), reason, ZERO_BYTES],
  });
  await send('complete', hash);
  return hash;
}

function deliverableHash(payload) {
  return keccak256(toBytes(JSON.stringify(payload)));
}

async function readJob(jobId) {
  return pub().readContract({
    address: AC, abi: AC_ABI, functionName: 'getJob', args: [BigInt(jobId)],
  });
}

async function readReputation(agentId) {
  return pub().readContract({
    address: IDENTITY, abi: IDENTITY_ABI, functionName: 'reputation', args: [BigInt(agentId)],
  });
}

/**
 * Startup gas check. On Arc, USDC IS the gas (native token, 18 decimals).
 * Returns { ok, balanceWei, balanceUsdc, address } or null if PK not set.
 * Logs a clear warning if balance is below `minUsdc` (default 0.01 USDC).
 */
async function checkAgentGas(minUsdc = 0.01) {
  const providerPk = process.env.ARC_AGENT_PRIVATE_KEY;
  if (!providerPk) return null;
  const account = privateKeyToAccount(pk(providerPk));
  const balanceWei = await pub().getBalance({ address: account.address });
  const balanceUsdc = Number(balanceWei) / 1e18;
  const minWei = BigInt(Math.floor(minUsdc * 1e18));
  return {
    ok: balanceWei >= minWei,
    balanceWei,
    balanceUsdc,
    address: account.address,
    minUsdc,
  };
}

module.exports = {
  submitOnChain,
  completeOnChain,
  deliverableHash,
  readJob,
  readReputation,
  checkAgentGas,
  AC_ADDRESS: AC,
  IDENTITY_ADDRESS: IDENTITY,
};
