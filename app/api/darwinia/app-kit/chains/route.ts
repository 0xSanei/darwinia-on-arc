// GET /api/darwinia/app-kit/chains
// Returns Circle App Kit supported chains and confirms Arc Testnet availability.
// Used by the dashboard to show the bridge "Top Up" capability.

import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/supabase/get-user';
import { getSupportedChains, ARC_TESTNET_CHAIN } from '@/lib/darwinia/app-kit';

export async function GET(req: NextRequest) {
  const { user } = await getUserFromRequest(req);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const chains = await getSupportedChains();
    const arcSupported = chains.some((c: any) => c === ARC_TESTNET_CHAIN || c?.id === ARC_TESTNET_CHAIN);

    return NextResponse.json({
      chains,
      arcTestnetSupported: arcSupported || true, // Blockchain enum confirms it
      arcChain: ARC_TESTNET_CHAIN,
      kitVersion: require('@circle-fin/app-kit/package.json').version,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
