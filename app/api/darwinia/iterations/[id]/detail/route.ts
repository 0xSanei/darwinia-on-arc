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
import { createClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';
import { decodeXPaymentHeader } from '@/lib/darwinia/eip3009';
import {
  getPublicClient,
  ARC_USDC_ADDRESS,
  USDC_ABI,
  explorerTxUrl,
  parseUSDC,
  arcTestnet,
} from '@/lib/darwinia/arc-chain';
import { createWalletClient, http } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

const AGENT_ADDRESS = process.env.ARC_AGENT_ADDRESS as `0x${string}`;
const PRICE_PER_ITERATION = '0.001';  // 0.001 USDC per iteration unlock

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const supabase = await createClient();

  // Auth check
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

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

    // Check validBefore hasn't expired
    const now = BigInt(Math.floor(Date.now() / 1000));
    if (payment.payload.validBefore < now) {
      return NextResponse.json({ error: 'Payment authorization expired' }, { status: 400 });
    }

    // Submit TransferWithAuthorization on-chain
    const publicClient = getPublicClient();

    // Parse signature
    const sig = payment.payload.signature;
    const r = sig.slice(0, 66) as `0x${string}`;
    const s = ('0x' + sig.slice(66, 130)) as `0x${string}`;
    const v = parseInt(sig.slice(130, 132), 16);

    const hash = await publicClient.simulateContract({
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
      account: AGENT_ADDRESS,
    }).then(async ({ request }) => {
      // Need a wallet client to actually send. Use agent private key if available,
      // otherwise use Circle API to sign (fallback).
      // Use relay key (= client key for demo) to submit on-chain
      // Anyone can submit a valid EIP-3009 signature — relay just pays gas.
      const relayKey = process.env.ARC_RELAY_PRIVATE_KEY;
      if (!relayKey) throw new Error('ARC_RELAY_PRIVATE_KEY not configured');
      const relayAccount = privateKeyToAccount(
        relayKey.startsWith('0x') ? relayKey as `0x${string}` : `0x${relayKey}`,
      );
      const walletClient = createWalletClient({
        account: relayAccount,
        chain: arcTestnet,
        transport: http(),
      });
      return walletClient.writeContract(request);
    });

    // Wait for receipt
    const receipt = await publicClient.waitForTransactionReceipt({ hash, timeout: 30_000 });
    if (receipt.status !== 'success') {
      return NextResponse.json({ error: 'On-chain transfer failed' }, { status: 500 });
    }

    // Mark iteration unlocked + record payment
    const serviceSupabase = createServiceClient();

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
