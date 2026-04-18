// GET /api/darwinia/iterations/[id]/detail
//
// x402 Nanopayment-gated endpoint.
// Flow:
//   1. Client requests detail → server checks is_unlocked
//   2. If locked: returns 402 with payment requirement
//   3. Client signs EIP-3009, retries with X-PAYMENT header
//   4. Server verifies signature, submits TransferWithAuthorization on-chain
//   5. On success: marks iteration unlocked, returns full detail

import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/supabase/get-user';
import { createServiceClient } from '@/lib/supabase/service';
import { decodeXPaymentHeader, EIP3009_DOMAIN, TRANSFER_WITH_AUTHORIZATION_TYPES } from '@/lib/darwinia/eip3009';
import {
  getPublicClient,
  ARC_USDC_ADDRESS,
  USDC_ABI,
  explorerTxUrl,
  parseUSDC,
  arcTestnet,
} from '@/lib/darwinia/arc-chain';
import { createWalletClient, http, verifyTypedData } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

const AGENT_ADDRESS = process.env.ARC_AGENT_ADDRESS as `0x${string}`;
const PRICE_PER_ITERATION = '0.001';  // 0.001 USDC per iteration unlock

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const { user, supabase } = await getUserFromRequest(req);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  // Fetch iteration
  const { data: iteration, error } = await supabase
    .from('darwinia_iterations')
    .select('*, darwinia_jobs!inner(user_id, client_wallet_address, price_per_iteration_usdc)')
    .eq('id', id)
    .single();

  if (error || !iteration) {
    return NextResponse.json({ error: 'Iteration not found' }, { status: 404 });
  }

  // Check ownership
  if ((iteration as any).darwinia_jobs.user_id !== user.id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  // Already unlocked?
  if (iteration.is_unlocked) {
    return NextResponse.json({ iteration });
  }

  // Check for X-PAYMENT header
  const xPayment = req.headers.get('x-payment');
  if (!xPayment) {
    // Return 402 with payment requirement
    const priceUsdc = (iteration as any).darwinia_jobs.price_per_iteration_usdc || PRICE_PER_ITERATION;
    const amountBaseUnits = parseUSDC(priceUsdc.toString()).toString();

    const paymentRequirement = {
      scheme: 'exact',
      network: 'arc-testnet',
      maxAmountRequired: amountBaseUnits,
      resource: req.url,
      payTo: AGENT_ADDRESS,
      maxTimeoutSeconds: 60,
      asset: ARC_USDC_ADDRESS,
      extra: { name: 'USDC', version: '2', decimals: 6 },
    };

    return NextResponse.json(
      { error: 'Payment required', paymentRequirement },
      {
        status: 402,
        headers: { 'x-payment-required': JSON.stringify(paymentRequirement) },
      },
    );
  }

  // Decode and verify payment
  try {
    const payment = decodeXPaymentHeader(xPayment);

    // Verify payment params
    if (
      payment.payload.to.toLowerCase() !== AGENT_ADDRESS.toLowerCase() ||
      payment.asset.toLowerCase() !== ARC_USDC_ADDRESS.toLowerCase()
    ) {
      return NextResponse.json({ error: 'Invalid payment parameters' }, { status: 400 });
    }

    // Check validBefore hasn't expired (with 5s clock skew tolerance)
    const now = BigInt(Math.floor(Date.now() / 1000));
    if (payment.payload.validBefore < now - 5n) {
      return NextResponse.json({ error: 'Payment authorization expired' }, { status: 400 });
    }

    // Off-chain signature verification (fast-fail before submitting to chain)
    const isValid = await verifyTypedData({
      address: payment.payload.from,
      domain: EIP3009_DOMAIN,
      types: TRANSFER_WITH_AUTHORIZATION_TYPES,
      primaryType: 'TransferWithAuthorization',
      message: {
        from: payment.payload.from,
        to: payment.payload.to,
        value: payment.payload.value,
        validAfter: payment.payload.validAfter,
        validBefore: payment.payload.validBefore,
        nonce: payment.payload.nonce,
      },
      signature: payment.payload.signature,
    });
    if (!isValid) {
      return NextResponse.json({ error: 'Invalid EIP-3009 signature' }, { status: 400 });
    }

    // DB-level nonce replay protection (on-chain contract also checks, but fail fast)
    const serviceSupabase = createServiceClient();
    const { data: existingNonce } = await serviceSupabase
      .from('darwinia_payments')
      .select('id')
      .eq('eip3009_nonce', payment.payload.nonce)
      .single();
    if (existingNonce) {
      return NextResponse.json({ error: 'Nonce already used' }, { status: 400 });
    }

    // Submit TransferWithAuthorization on-chain
    const publicClient = getPublicClient();

    // Parse signature components
    const sig = payment.payload.signature;
    const r = sig.slice(0, 66) as `0x${string}`;
    const s = ('0x' + sig.slice(66, 130)) as `0x${string}`;
    const v = parseInt(sig.slice(130, 132), 16);

    // Build relay wallet client (signs locally → eth_sendRawTransaction)
    const relayKey = process.env.ARC_RELAY_PRIVATE_KEY;
    if (!relayKey) throw new Error('ARC_RELAY_PRIVATE_KEY not configured');
    const relayAccount = privateKeyToAccount(
      (relayKey.startsWith('0x') ? relayKey : '0x' + relayKey) as `0x${string}`,
    );
    const walletClient = createWalletClient({
      account: relayAccount,
      chain: arcTestnet,
      transport: http(),
    });

    // Skip simulateContract — call writeContract directly so viem signs with
    // the relay private key (eth_sendRawTransaction) instead of wallet_sendTransaction.
    const hash = await walletClient.writeContract({
      address: ARC_USDC_ADDRESS,
      abi: USDC_ABI,
      functionName: 'transferWithAuthorization',
      args: [
        payment.payload.from,
        payment.payload.to,
        payment.payload.value,
        payment.payload.validAfter,
        payment.payload.validBefore,
        payment.payload.nonce as `0x${string}`,
        v,
        r,
        s,
      ],
    });

    // Wait for receipt
    const receipt = await publicClient.waitForTransactionReceipt({ hash, timeout: 30_000 });
    if (receipt.status !== 'success') {
      return NextResponse.json({ error: 'On-chain transfer failed' }, { status: 500 });
    }

    // Mark iteration unlocked + record payment
    await serviceSupabase.from('darwinia_iterations').update({ is_unlocked: true }).eq('id', id);

    await serviceSupabase.from('darwinia_payments').insert({
      job_id: iteration.job_id,
      iteration_id: id,
      from_wallet_id: 'eoa-old-wallet',
      from_wallet_address: payment.payload.from,
      to_wallet_id: '4cfcb13b-391b-58d1-8e83-8b6204b37d28',
      to_wallet_address: AGENT_ADDRESS,
      amount_usdc: Number((iteration as any).darwinia_jobs.price_per_iteration_usdc || PRICE_PER_ITERATION),
      tx_hash: hash,
      state: 'complete',
      x402_scheme: payment.scheme,
      x402_network: payment.network,
      eip3009_signature: payment.payload.signature,
      eip3009_nonce: payment.payload.nonce,
      settled_at: new Date().toISOString(),
    });

    // Re-fetch full iteration
    const { data: unlocked } = await supabase
      .from('darwinia_iterations')
      .select('*')
      .eq('id', id)
      .single();

    return NextResponse.json({
      iteration: unlocked,
      payment: { tx_hash: hash, explorer: explorerTxUrl(hash) },
    });
  } catch (err: any) {
    console.error('x402 payment error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
