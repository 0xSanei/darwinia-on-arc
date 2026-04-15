// POST /api/darwinia/sign-payment
// Server-side EIP-3009 signing using ARC_CLIENT_PRIVATE_KEY.
// In production, this would be replaced by a MetaMask wallet signature on the frontend.
// For demo: server holds the private key and signs on behalf of the client agent.

import { NextRequest, NextResponse } from 'next/server';
import { signEIP3009, encodeXPaymentHeader } from '@/lib/darwinia/eip3009';

export async function POST(req: NextRequest) {
  try {
    const { to, amountUsdc } = await req.json();

    if (!to || !amountUsdc) {
      return NextResponse.json({ error: 'to and amountUsdc required' }, { status: 400 });
    }

    const privateKey = process.env.ARC_CLIENT_PRIVATE_KEY;
    if (!privateKey) {
      return NextResponse.json({ error: 'ARC_CLIENT_PRIVATE_KEY not configured' }, { status: 500 });
    }

    const payment = await signEIP3009(privateKey, to as `0x${string}`, amountUsdc.toString());
    const xPaymentHeader = encodeXPaymentHeader(payment);

    return NextResponse.json({ xPaymentHeader });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
