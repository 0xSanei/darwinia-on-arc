// GET /api/darwinia/jobs/[id] — job detail with iterations

import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/supabase/get-user';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const { user, supabase } = await getUserFromRequest(req);
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { data: job, error: jobError } = await supabase
      .from('darwinia_jobs')
      .select('*')
      .eq('id', id)
      .single();

    if (jobError || !job) {
      return NextResponse.json({ error: 'Job not found' }, { status: 404 });
    }

    // Fetch iterations (only show locked=false in full detail; locked show summary)
    const { data: iterations, error: iterError } = await supabase
      .from('darwinia_iterations')
      .select(
        'id, generation, champion_fitness, avg_fitness, genetic_diversity, patterns_discovered, is_unlocked, created_at',
      )
      .eq('job_id', id)
      .order('generation', { ascending: true });

    if (iterError) throw iterError;

    return NextResponse.json({ job, iterations: iterations || [] });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
