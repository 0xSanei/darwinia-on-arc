// Arc testnet viem chain definition + USDC helpers

import { createPublicClient, http, parseUnits, formatUnits, type Chain } from 'viem';

export const arcTestnet: Chain = {
  id: 5042002,
  name: 'Arc Testnet',
  nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 18 },
  rpcUrls: {
    default: { http: ['https://rpc.testnet.arc.network'] },
    public: { http: ['https://rpc.testnet.arc.network'] },
  },
  blockExplorers: {
    default: { name: 'Arc Explorer', url: 'https://explorer.testnet.arc.network' },
  },
  testnet: true,
};

// Arc testnet USDC: native system contract, 6 decimals for ERC-20 interface
export const ARC_USDC_ADDRESS = '0x3600000000000000000000000000000000000000' as const;
export const ARC_USDC_DECIMALS = 6;

export const USDC_ABI = [
  {
    name: 'balanceOf',
    type: 'function' as const,
    inputs: [{ name: 'account', type: 'address' as const }],
    outputs: [{ name: '', type: 'uint256' as const }],
    stateMutability: 'view' as const,
  },
  {
    name: 'transfer',
    type: 'function' as const,
    inputs: [
      { name: 'to', type: 'address' as const },
      { name: 'amount', type: 'uint256' as const },
    ],
    outputs: [{ name: '', type: 'bool' as const }],
    stateMutability: 'nonpayable' as const,
  },
  // EIP-3009 TransferWithAuthorization
  {
    name: 'transferWithAuthorization',
    type: 'function' as const,
    inputs: [
      { name: 'from', type: 'address' as const },
      { name: 'to', type: 'address' as const },
      { name: 'value', type: 'uint256' as const },
      { name: 'validAfter', type: 'uint256' as const },
      { name: 'validBefore', type: 'uint256' as const },
      { name: 'nonce', type: 'bytes32' as const },
      { name: 'v', type: 'uint8' as const },
      { name: 'r', type: 'bytes32' as const },
      { name: 's', type: 'bytes32' as const },
    ],
    outputs: [],
    stateMutability: 'nonpayable' as const,
  },
  {
    name: 'DOMAIN_SEPARATOR',
    type: 'function' as const,
    inputs: [],
    outputs: [{ name: '', type: 'bytes32' as const }],
    stateMutability: 'view' as const,
  },
] as const;

export function getPublicClient() {
  return createPublicClient({ chain: arcTestnet, transport: http() });
}

export function parseUSDC(amount: string): bigint {
  return parseUnits(amount, ARC_USDC_DECIMALS);
}

export function formatUSDC(amount: bigint): string {
  return formatUnits(amount, ARC_USDC_DECIMALS);
}

export function explorerTxUrl(hash: string): string {
  return `https://explorer.testnet.arc.network/tx/${hash}`;
}
