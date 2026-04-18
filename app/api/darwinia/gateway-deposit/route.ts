// POST /api/darwinia/gateway-deposit
// Triggers the demo Solana → Arc Gateway burn intent + mint, using the
// server-side demo Solana wallet (env: SOLANA_GATEWAY_PRIVATE_KEY) and the
// relay EOA on Arc (env: ARC_RELAY_PRIVATE_KEY).
//
// Body: { amountUsdc: number, recipient?: `0x${string}` }
//   - amountUsdc defaults to 0.5 (USDC), recipient defaults to ARC_CLIENT_ADDRESS.
//
// Returns: { transferId, mintTxHash, fee, deltaUsdc }

import { NextRequest, NextResponse } from 'next/server';
import {
  createPublicClient,
  createWalletClient,
  http,
  parseAbi,
  type Address,
  type Hex,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { signAndSubmitSolanaSourceBurnIntent } from '@/lib/circle/gateway-solana';
import { arcTestnet } from '@/lib/darwinia/arc-chain';

const ARC_USDC: Address = '0x3600000000000000000000000000000000000000';
const GATEWAY_MINTER: Address = '0x0022222ABE238Cc2C7Bb1f21003F0a260052475B';
const ARC_DOMAIN = 26;

// 6 decimal USDC
function parseUsdc6(amount: number | string): bigint {
  const [int, frac = ''] = String(amount).split('.');
  const padded = (frac + '000000').slice(0, 6);
  return BigInt(int + padded);
}

function pk(s: string): Hex {
  return (s.startsWith('0x') ? s : `0x${s}`) as Hex;
}

const USDC_ABI = parseAbi(['function balanceOf(address) view returns (uint256)']);
const MINTER_ABI = parseAbi([
  'function gatewayMint(bytes attestation, bytes signature)',
]);

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => ({}))) as {
      amountUsdc?: number | string;
      recipient?: string;
    };

    const recipient =
      (body.recipient as Address | undefined) ||
      (process.env.NEXT_PUBLIC_ARC_CLIENT_ADDRESS as Address | undefined);
    if (!recipient) {
      return NextResponse.json(
        { error: 'recipient missing and NEXT_PUBLIC_ARC_CLIENT_ADDRESS not set' },
        { status: 400 },
      );
    }

    const amount = parseUsdc6(body.amountUsdc ?? 0.5);
    if (amount <= 0n) {
      return NextResponse.json({ error: 'amountUsdc must be > 0' }, { status: 400 });
    }

    const relayPk = process.env.ARC_RELAY_PRIVATE_KEY || process.env.ARC_CLIENT_PRIVATE_KEY;
    if (!relayPk) {
      return NextResponse.json({ error: 'ARC_RELAY_PRIVATE_KEY not configured' }, { status: 500 });
    }

    const pub = createPublicClient({ chain: arcTestnet, transport: http() });
    const before = (await pub.readContract({
      address: ARC_USDC, abi: USDC_ABI, functionName: 'balanceOf', args: [recipient],
    })) as bigint;

    // 1. Sign + submit burn intent to Circle Gateway → returns attestation
    const { transferId, attestation, attestationSignature } =
      await signAndSubmitSolanaSourceBurnIntent({
        amount,
        destinationDomain: ARC_DOMAIN,
        destinationContractEvm: GATEWAY_MINTER,
        destinationTokenEvm: ARC_USDC,
        destinationRecipientEvm: recipient as Hex,
      });

    // 2. Call gatewayMint on Arc using the relay EOA
    const account = privateKeyToAccount(pk(relayPk));
    const wallet = createWalletClient({ account, chain: arcTestnet, transport: http() });
    const mintTxHash = await wallet.writeContract({
      address: GATEWAY_MINTER,
      abi: MINTER_ABI,
      functionName: 'gatewayMint',
      args: [attestation, attestationSignature],
    });
    const receipt = await pub.waitForTransactionReceipt({ hash: mintTxHash });
    if (receipt.status !== 'success') {
      return NextResponse.json(
        { error: `gatewayMint reverted: ${mintTxHash}`, transferId },
        { status: 500 },
      );
    }

    const after = (await pub.readContract({
      address: ARC_USDC, abi: USDC_ABI, functionName: 'balanceOf', args: [recipient],
    })) as bigint;

    const delta = after - before;
    const fee = amount - delta;

    return NextResponse.json({
      transferId,
      mintTxHash,
      explorerUrl: `https://explorer.testnet.arc.network/tx/${mintTxHash}`,
      amountSent: amount.toString(),
      delta: delta.toString(),
      fee: fee.toString(),
      recipient,
    });
  } catch (err: any) {
    console.error('[gateway-deposit] failed:', err);
    return NextResponse.json({ error: err?.message || String(err) }, { status: 500 });
  }
}
