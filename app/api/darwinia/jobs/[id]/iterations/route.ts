// POST /api/darwinia/jobs/[id]/iterations — agent writes iteration result
// Called by agent-worker after each Darwinia evolution batch.

import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/service';
import type { IterationPayload } from '@/lib/darwinia/types';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const body: IterationPayload = await req.json();

    if (!body.agent_id || body.generation === undefined || !body.result) {
      return NextResponse.json({ error: 'agent_id, generation, result required' }, { status: 400 });
    }

    const supabase = createServiceClient();

    const { evolution_summary, champion, patterns, survivors } = body.result;

    const { data: iteration, error } = await supabase
      .from('darwinia_iterations')
      .insert({
        job_id: id,
        agent_id: body.agent_id,
        generation: body.generation,
        champion_fitness: evolution_summary.final_champion_fitness,
        avg_fitness: evolution_summary.final_avg_fitness,
        genetic_diversity: evolution_summary.genetic_diversity,
        patterns_discovered: evolution_summary.patterns_discovered,
        champion_genes: champion.genes,
        survivors: survivors?.slice(0, 5) || [],   // top 5 only
        patterns: patterns || [],
        raw_json: body.result,
        is_unlocked: false,
      })
      .select()
      .single();

    if (error) throw error;

    // Update job status to 'running' if still 'claimed'
    await supabase
      .from('darwinia_jobs')
      .update({ status: 'running', updated_at: new Date().toISOString() })
      .eq('id', id)
      .eq('status', 'claimed');

    // Check if all generations done
    const { data: job } = await supabase
      .from('darwinia_jobs')
      .select('max_generations')
      .eq('id', id)
      .single();

    if (job && body.generation >= job.max_generations - 1) {
      await supabase
        .from('darwinia_jobs')
        .update({
          status: 'completed',
          updated_at: new Date().toISOString(),
          completed_at: new Date().toISOString(),
        })
        .eq('id', id);

      // Increment agent reputation
      await supabase.rpc('increment_agent_stats', {
        p_agent_id: body.agent_id,
        p_iterations: body.generation + 1,
      }).catch(() => {
        // RPC may not exist yet; non-fatal
      });
    }

    return NextResponse.json({ iteration }, { status: 201 });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
