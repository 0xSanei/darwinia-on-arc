// EIP-3009 TransferWithAuthorization signing helpers for x402 Nanopayments.
// Used by client agent to authorize USDC payment before calling a paid endpoint.

import { privateKeyToAccount, type PrivateKeyAccount } from 'viem/accounts';
import { toHex, hexToBytes, keccak256, encodeAbiParameters, parseAbiParameters } from 'viem';
import { ARC_USDC_ADDRESS, ARC_USDC_DECIMALS, arcTestnet } from './arc-chain';
import { parseUnits } from 'viem';

// EIP-712 typed data for EIP-3009
export const EIP3009_DOMAIN = {
  name: 'USDC',
  version: '2',
  chainId: arcTestnet.id,
  verifyingContract: ARC_USDC_ADDRESS,
} as const;

export const TRANSFER_WITH_AUTHORIZATION_TYPES = {
  TransferWithAuthorization: [
    { name: 'from', type: 'address' },
    { name: 'to', type: 'address' },
    { name: 'value', type: 'uint256' },
    { name: 'validAfter', type: 'uint256' },
    { name: 'validBefore', type: 'uint256' },
    { name: 'nonce', type: 'bytes32' },
  ],
} as const;

export interface EIP3009Payload {
  from: `0x${string}`;
  to: `0x${string}`;
  value: bigint;
  validAfter: bigint;
  validBefore: bigint;
  nonce: `0x${string}`;
  signature: `0x${string}`;
}

export interface SignedX402Payment {
  payload: EIP3009Payload;
  scheme: 'exact';
  network: string;
  asset: string;
}

/**
 * Sign an EIP-3009 TransferWithAuthorization using a private key.
 * This is the client-side signing step in the x402 flow.
 *
 * @param privateKey - hex private key (without 0x)
 * @param to - recipient address (agent wallet)
 * @param amountUsdc - amount as decimal string e.g. "0.001"
 * @param validitySeconds - how long the authorization is valid (default 60s)
 */
export async function signEIP3009(
  privateKey: string,
  to: `0x${string}`,
  amountUsdc: string,
  validitySeconds = 60,
): Promise<SignedX402Payment> {
  const pk = privateKey.startsWith('0x') ? privateKey : ('0x' + privateKey) as `0x${string}`;
  const account: PrivateKeyAccount = privateKeyToAccount(pk);

  const value = parseUnits(amountUsdc, ARC_USDC_DECIMALS);
  const now = BigInt(Math.floor(Date.now() / 1000));
  const validAfter = 0n;
  const validBefore = now + BigInt(validitySeconds);

  // Random 32-byte nonce
  const nonceBytes = new Uint8Array(32);
  crypto.getRandomValues(nonceBytes);
  const nonce = toHex(nonceBytes) as `0x${string}`;

  const message = {
    from: account.address,
    to,
    value,
    validAfter,
    validBefore,
    nonce,
  };

  const signature = await account.signTypedData({
    domain: EIP3009_DOMAIN,
    types: TRANSFER_WITH_AUTHORIZATION_TYPES,
    primaryType: 'TransferWithAuthorization',
    message,
  });

  return {
    payload: { ...message, signature },
    scheme: 'exact',
    network: 'arc-testnet',
    asset: ARC_USDC_ADDRESS,
  };
}

/**
 * Encode a signed EIP-3009 payload as the X-PAYMENT header value.
 * Base64-encoded JSON.
 */
export function encodeXPaymentHeader(payment: SignedX402Payment): string {
  const json = JSON.stringify({
    scheme: payment.scheme,
    network: payment.network,
    asset: payment.asset,
    payload: {
      from: payment.payload.from,
      to: payment.payload.to,
      value: payment.payload.value.toString(),
      validAfter: payment.payload.validAfter.toString(),
      validBefore: payment.payload.validBefore.toString(),
      nonce: payment.payload.nonce,
      signature: payment.payload.signature,
    },
  });
  return Buffer.from(json).toString('base64');
}

/**
 * Decode an X-PAYMENT header value.
 */
export function decodeXPaymentHeader(header: string): SignedX402Payment {
  const json = JSON.parse(Buffer.from(header, 'base64').toString('utf8'));
  return {
    scheme: json.scheme,
    network: json.network,
    asset: json.asset,
    payload: {
      from: json.payload.from,
      to: json.payload.to,
      value: BigInt(json.payload.value),
      validAfter: BigInt(json.payload.validAfter),
      validBefore: BigInt(json.payload.validBefore),
      nonce: json.payload.nonce,
      signature: json.payload.signature,
    },
  };
}
