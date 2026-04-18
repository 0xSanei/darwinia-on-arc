// POST /api/darwinia/app-kit/bridge
//
// Bridge USDC from a supported testnet → Arc Testnet using Circle App Kit.
// This is the "Top Up" flow: users bridge USDC to Arc to fund optimization jobs.
//
// Body: { fromChain: string, fromWalletId: string, amount: string }
// Example: { fromChain: "ETH-SEPOLIA", fromWalletId: "...", amount: "1.00" }

import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/supabase/get-user';
import { getAppKit, ARC_TESTNET_CHAIN } from '@/lib/darwinia/app-kit';
import { createCircleWalletsAdapter } from '@circle-fin/adapter-circle-wallets';
import { Blockchain } from '@circle-fin/app-kit';

// Arc Testnet agent wallet receives the bridged USDC
const AGENT_WALLET_ID = process.env.CIRCLE_AGENT_WALLET_ID || '4cfcb13b-391b-58d1-8e83-8b6204b37d28';

export async function POST(req: NextRequest) {
  const { user } = await getUserFromRequest(req);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const body = await req.json();
    const { fromChain, fromWalletId, amount } = body;

    if (!fromChain || !fromWalletId || !amount) {
      return NextResponse.json(
        { error: 'fromChain, fromWalletId, and amount are required' },
        { status: 400 },
      );
    }

    const amountNum = Number(amount);
    if (isNaN(amountNum) || amountNum <= 0 || amountNum > 100) {
      return NextResponse.json({ error: 'amount must be between 0 and 100 USDC' }, { status: 400 });
    }

    const kit = getAppKit();

    // Build a Circle Wallets adapter for the source chain wallet
    const apiKey = process.env.CIRCLE_APP_KIT_KEY || process.env.CIRCLE_API_KEY!;
    const entitySecret = process.env.CIRCLE_ENTITY_SECRET!;
    const fromAdapter = createCircleWalletsAdapter({ apiKey, entitySecret });
    const toAdapter = createCircleWalletsAdapter({ apiKey, entitySecret });

    // Bridge USDC → Arc Testnet
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await (kit as any).bridge({
      from: {
        adapter: fromAdapter,
        chain: fromChain,   // e.g. 'Ethereum_Sepolia'
        walletId: fromWalletId,
      },
      to: {
        adapter: toAdapter,
        chain: ARC_TESTNET_CHAIN,
        walletId: AGENT_WALLET_ID,
      },
      amount: amount.toString(),
    });

    return NextResponse.json({ success: true, result });
  } catch (err: any) {
    console.error('[app-kit bridge]', err.message);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
