// POST /api/darwinia/sign-payment
// Server-side EIP-3009 signing using ARC_CLIENT_PRIVATE_KEY.
// In production, this would be replaced by a MetaMask wallet signature on the frontend.
// For demo: server holds the private key and signs on behalf of the client agent.

import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/supabase/get-user';
import { signEIP3009, encodeXPaymentHeader } from '@/lib/darwinia/eip3009';

const AGENT_ADDRESS = (process.env.ARC_AGENT_ADDRESS || '').toLowerCase();
const MAX_AMOUNT_USDC = 10; // hard cap per single signing request

export async function POST(req: NextRequest) {
  try {
    // Require authenticated user — prevents arbitrary draining of the demo wallet
    const { user } = await getUserFromRequest(req);
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { to, amountUsdc } = await req.json();

    if (!to || !amountUsdc) {
      return NextResponse.json({ error: 'to and amountUsdc required' }, { status: 400 });
    }

    // Only allow signing payments to the known agent address
    if (to.toLowerCase() !== AGENT_ADDRESS) {
      return NextResponse.json({ error: 'Invalid payment recipient' }, { status: 400 });
    }

    const amount = Number(amountUsdc);
    if (isNaN(amount) || amount <= 0 || amount > MAX_AMOUNT_USDC) {
      return NextResponse.json(
        { error: `amountUsdc must be between 0 and ${MAX_AMOUNT_USDC}` },
        { status: 400 },
      );
    }

    const privateKey = process.env.ARC_CLIENT_PRIVATE_KEY;
    if (!privateKey) {
      return NextResponse.json({ error: 'ARC_CLIENT_PRIVATE_KEY not configured' }, { status: 500 });
    }

    const payment = await signEIP3009(privateKey, to as `0x${string}`, amount.toString());
    const xPaymentHeader = encodeXPaymentHeader(payment);

    return NextResponse.json({ xPaymentHeader });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
