// GET /api/darwinia/jobs  — list user's jobs
// POST /api/darwinia/jobs — create a new optimization job

import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/supabase/get-user';
import type { CreateJobRequest } from '@/lib/darwinia/types';
import {
  createJobOnChain,
  AGENTIC_COMMERCE_ADDRESS,
  IDENTITY_REGISTRY_ADDRESS,
} from '@/lib/darwinia/arc-contracts';

export async function GET(req: NextRequest) {
  try {
    const { user, supabase } = await getUserFromRequest(req);
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { data, error } = await supabase
      .from('darwinia_jobs')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false });

    if (error) throw error;
    return NextResponse.json({ jobs: data });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const { user, supabase } = await getUserFromRequest(req);
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const body: CreateJobRequest = await req.json();

    if (!body.title || !body.budget_usdc || !body.client_wallet_address) {
      return NextResponse.json(
        { error: 'title, budget_usdc, and client_wallet_address are required' },
        { status: 400 },
      );
    }

    // Input bounds validation
    const maxGens = Number(body.max_generations) || 20;
    const popSize = Number(body.population_size) || 50;
    const budget = Number(body.budget_usdc);
    const pricePerIter = Number(body.price_per_iteration_usdc) || 0.001;

    if (maxGens < 1 || maxGens > 500) {
      return NextResponse.json({ error: 'max_generations must be between 1 and 500' }, { status: 400 });
    }
    if (popSize < 10 || popSize > 500) {
      return NextResponse.json({ error: 'population_size must be between 10 and 500' }, { status: 400 });
    }
    if (budget <= 0 || budget > 1000) {
      return NextResponse.json({ error: 'budget_usdc must be between 0 and 1000' }, { status: 400 });
    }
    if (pricePerIter < 0.0001 || pricePerIter > 100) {
      return NextResponse.json({ error: 'price_per_iteration_usdc must be >= 0.0001' }, { status: 400 });
    }

    const { data, error } = await supabase
      .from('darwinia_jobs')
      .insert({
        user_id: user.id,
        title: body.title.slice(0, 200),
        description: body.description ? body.description.slice(0, 1000) : null,
        target_symbol: body.target_symbol || 'BTC/USDT',
        max_generations: maxGens,
        population_size: popSize,
        budget_usdc: budget,
        price_per_iteration_usdc: pricePerIter,
        client_wallet_id: 'eoa-old-wallet',
        client_wallet_address: body.client_wallet_address,
        status: 'pending',
      })
      .select()
      .single();

    if (error) throw error;

    // ERC-8183 on-chain Job creation. Failure here is non-fatal — the DB row is
    // already there; the agent worker can still run. We surface the error in
    // the response so the UI can show a warning.
    let onchainJobId: string | null = null;
    let onchainTxHash: string | null = null;
    let onchainError: string | null = null;

    try {
      const provider = (process.env.NEXT_PUBLIC_ARC_AGENT_ADDRESS || '') as `0x${string}`;
      if (!provider) throw new Error('NEXT_PUBLIC_ARC_AGENT_ADDRESS not set');

      const onchain = await createJobOnChain({
        provider,
        description: `${body.title.slice(0, 80)} | dbId=${data.id}`,
      });

      onchainJobId = onchain.jobId;
      onchainTxHash = onchain.txHash;

      const { error: updErr } = await supabase
        .from('darwinia_jobs')
        .update({ onchain_job_id: onchainJobId })
        .eq('id', data.id);
      if (updErr) console.error('[jobs] onchain_job_id update failed:', updErr.message);
      data.onchain_job_id = onchainJobId;
    } catch (e: any) {
      onchainError = e?.message || String(e);
      console.error('[jobs] createJobOnChain failed (DB row kept):', onchainError);
    }

    return NextResponse.json(
      {
        job: data,
        onchain: {
          job_id: onchainJobId,
          tx_hash: onchainTxHash,
          contracts: {
            agentic_commerce: AGENTIC_COMMERCE_ADDRESS,
            identity_registry: IDENTITY_REGISTRY_ADDRESS,
          },
          error: onchainError,
        },
      },
      { status: 201 },
    );
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
