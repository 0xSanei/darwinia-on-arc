// On-chain wrappers for ERC-8183 AgenticCommerce + ERC-8004 IdentityRegistry on Arc Testnet.
// Used by:
//   - app/api/darwinia/jobs/route.ts  → createJobOnChain after DB insert
//   - agent-worker/index.js (CJS port) → submitJobOnChain / completeJobOnChain
//
// Server-only. Reads private keys from process.env. Never bundle into client.

import {
  createPublicClient,
  createWalletClient,
  http,
  keccak256,
  toBytes,
  type Hex,
  type Address,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { arcTestnet } from './arc-chain';
import deployment from '@/deployments/arc-testnet.json';

export const IDENTITY_REGISTRY_ADDRESS =
  deployment.contracts.IdentityRegistry.address as Address;
export const AGENTIC_COMMERCE_ADDRESS =
  deployment.contracts.AgenticCommerce.address as Address;

const IDENTITY_ABI = deployment.abis.IdentityRegistry;
const AC_ABI = deployment.abis.AgenticCommerce;

const ZERO_HOOK: Address = '0x0000000000000000000000000000000000000000';
const EMPTY_BYTES: Hex = '0x';

function normalizePk(pk: string): Hex {
  return (pk.startsWith('0x') ? pk : `0x${pk}`) as Hex;
}

function relayClient() {
  const pk = process.env.ARC_RELAY_PRIVATE_KEY || process.env.ARC_CLIENT_PRIVATE_KEY;
  if (!pk) throw new Error('ARC_RELAY_PRIVATE_KEY or ARC_CLIENT_PRIVATE_KEY must be set');
  const account = privateKeyToAccount(normalizePk(pk));
  const wallet = createWalletClient({ account, chain: arcTestnet, transport: http() });
  return { account, wallet };
}

function publicClient() {
  return createPublicClient({ chain: arcTestnet, transport: http() });
}

export interface CreateJobOnChainResult {
  jobId: string;
  txHash: Hex;
  blockNumber: bigint;
  client: Address;
  provider: Address;
  evaluator: Address;
  expiredAt: bigint;
}

/**
 * Create an on-chain Job. Client = relay EOA, evaluator = client (same EOA),
 * provider = agent wallet. Budget stays 0 — per-iteration billing happens via
 * EIP-3009 Nanopayments off this contract.
 */
export async function createJobOnChain(opts: {
  provider: Address;
  description: string;
  expirySeconds?: number; // default 24h
}): Promise<CreateJobOnChainResult> {
  const { account, wallet } = relayClient();
  const pub = publicClient();

  const expirySeconds = opts.expirySeconds ?? 24 * 3600;
  const expiredAt = BigInt(Math.floor(Date.now() / 1000) + expirySeconds);

  const hash = await wallet.writeContract({
    address: AGENTIC_COMMERCE_ADDRESS,
    abi: AC_ABI,
    functionName: 'createJob',
    args: [opts.provider, account.address, expiredAt, opts.description, ZERO_HOOK],
  });

  const receipt = await pub.waitForTransactionReceipt({ hash });
  if (receipt.status !== 'success') throw new Error(`createJob reverted: tx ${hash}`);

  // Read the post-tx counter — single-writer relay = safe enough for a hackathon demo.
  const jobId = (await pub.readContract({
    address: AGENTIC_COMMERCE_ADDRESS,
    abi: AC_ABI,
    functionName: 'jobCounter',
  })) as bigint;

  return {
    jobId: jobId.toString(),
    txHash: hash,
    blockNumber: receipt.blockNumber,
    client: account.address,
    provider: opts.provider,
    evaluator: account.address,
    expiredAt,
  };
}

/**
 * Provider submits the deliverable hash. Caller must be the provider EOA.
 * Returns the tx hash.
 */
export async function submitJobOnChain(opts: {
  jobId: bigint | string;
  deliverable: Hex;
  providerPrivateKey: string;
}): Promise<Hex> {
  const account = privateKeyToAccount(normalizePk(opts.providerPrivateKey));
  const wallet = createWalletClient({ account, chain: arcTestnet, transport: http() });
  const pub = publicClient();

  const hash = await wallet.writeContract({
    address: AGENTIC_COMMERCE_ADDRESS,
    abi: AC_ABI,
    functionName: 'submit',
    args: [BigInt(opts.jobId), opts.deliverable, EMPTY_BYTES],
  });
  const receipt = await pub.waitForTransactionReceipt({ hash });
  if (receipt.status !== 'success') throw new Error(`submit reverted: tx ${hash}`);
  return hash;
}

/**
 * Evaluator (= client = relay EOA in our demo) completes the Job. This triggers
 * IdentityRegistry.incrementReputation(providerAgentId, 1).
 */
export async function completeJobOnChain(opts: {
  jobId: bigint | string;
  reason: string;
}): Promise<Hex> {
  const { wallet } = relayClient();
  const pub = publicClient();

  const reasonHash = keccak256(toBytes(opts.reason.slice(0, 32)));
  const hash = await wallet.writeContract({
    address: AGENTIC_COMMERCE_ADDRESS,
    abi: AC_ABI,
    functionName: 'complete',
    args: [BigInt(opts.jobId), reasonHash, EMPTY_BYTES],
  });
  const receipt = await pub.waitForTransactionReceipt({ hash });
  if (receipt.status !== 'success') throw new Error(`complete reverted: tx ${hash}`);
  return hash;
}

/**
 * Helper: hash an iteration result into a deliverable bytes32 for submit().
 * We use keccak256(JSON.stringify(result)) so anyone can verify off-chain.
 */
export function deliverableHash(payload: unknown): Hex {
  const bytes = toBytes(JSON.stringify(payload));
  return keccak256(bytes);
}

export async function readJobOnChain(jobId: bigint | string) {
  const pub = publicClient();
  return (await pub.readContract({
    address: AGENTIC_COMMERCE_ADDRESS,
    abi: AC_ABI,
    functionName: 'getJob',
    args: [BigInt(jobId)],
  })) as {
    id: bigint;
    client: Address;
    provider: Address;
    evaluator: Address;
    description: string;
    budget: bigint;
    expiredAt: bigint;
    status: number;
    hook: Address;
  };
}

export async function readReputation(agentId: bigint | number): Promise<bigint> {
  const pub = publicClient();
  return (await pub.readContract({
    address: IDENTITY_REGISTRY_ADDRESS,
    abi: IDENTITY_ABI,
    functionName: 'reputation',
    args: [BigInt(agentId)],
  })) as bigint;
}

export const JOB_STATUS_LABELS = [
  'Open',
  'Funded',
  'Submitted',
  'Completed',
  'Rejected',
  'Expired',
] as const;
