// GET /api/darwinia/jobs  — list user's jobs
// POST /api/darwinia/jobs — create a new optimization job

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';
import type { CreateJobRequest } from '@/lib/darwinia/types';

export async function GET() {
  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { data, error } = await supabase
      .from('darwinia_jobs')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) throw error;
    return NextResponse.json({ jobs: data });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body: CreateJobRequest = await req.json();

    if (!body.title || !body.budget_usdc || !body.client_wallet_address) {
      return NextResponse.json(
        { error: 'title, budget_usdc, and client_wallet_address are required' },
        { status: 400 },
      );
    }

    const { data, error } = await supabase
      .from('darwinia_jobs')
      .insert({
        user_id: user.id,
        title: body.title,
        description: body.description || null,
        target_symbol: body.target_symbol || 'BTC/USDT',
        max_generations: body.max_generations || 20,
        population_size: body.population_size || 50,
        budget_usdc: body.budget_usdc,
        price_per_iteration_usdc: body.price_per_iteration_usdc || 0.001,
        client_wallet_id: 'eoa-old-wallet',
        client_wallet_address: body.client_wallet_address,
        status: 'pending',
      })
      .select()
      .single();

    if (error) throw error;
    return NextResponse.json({ job: data }, { status: 201 });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
