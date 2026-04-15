// POST /api/darwinia/jobs/[id]/claim — agent claims a pending job

import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/service';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const { agent_id } = await req.json();

    if (!agent_id) {
      return NextResponse.json({ error: 'agent_id required' }, { status: 400 });
    }

    const supabase = createServiceClient();

    // Atomic claim: only claim if still pending
    const { data: job, error } = await supabase
      .from('darwinia_jobs')
      .update({ status: 'claimed', agent_id, updated_at: new Date().toISOString() })
      .eq('id', id)
      .eq('status', 'pending')  // only if still pending
      .select()
      .single();

    if (error || !job) {
      return NextResponse.json(
        { error: 'Job not found or already claimed' },
        { status: 409 },
      );
    }

    return NextResponse.json({ job });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
