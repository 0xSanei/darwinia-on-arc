/**
 * Darwinia on Arc — Agent Worker
 *
 * This process:
 *   1. Polls /api/darwinia/jobs?status=pending every N seconds
 *   2. Claims the first available job
 *   3. Spawns `python -m darwinia evolve -g N --json` for each generation batch
 *   4. POSTs each generation result to /api/darwinia/jobs/:id/iterations
 *   5. Repeats until job.max_generations is reached
 *
 * Run: node agent-worker/index.js
 * Or via pm2: pm2 start agent-worker/index.js --name darwinia-agent
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const onchain = require('./arc-onchain.cjs');

// ── Config ──────────────────────────────────────────────────────────────────

// Load .env.local
const envPath = path.join(__dirname, '..', '.env.local');
if (fs.existsSync(envPath)) {
  fs.readFileSync(envPath, 'utf8').split('\n').forEach((line) => {
    const m = line.match(/^([^#=\s][^=]*)=(.+)$/);
    if (m) process.env[m[1].trim()] = m[2].trim();
  });
}

const API_BASE = process.env.DARWINIA_API_URL || 'http://localhost:3000';
const POLL_INTERVAL_MS = 10_000;        // 10s poll
const BATCH_SIZE = 1;                   // 1 gen/batch → 1 iteration record/gen → 1 on-chain unlock/gen
const DARWINIA_DIR = path.join(__dirname, '..', '..', 'darwinia');
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

// Agent identity — prefers ARC_AGENT_ADDRESS (the EOA the worker controls via
// ARC_AGENT_PRIVATE_KEY); falls back to the Circle DCW for legacy setups.
const AGENT_WALLET_ADDRESS = (
  process.env.ARC_AGENT_ADDRESS ||
  process.env.NEXT_PUBLIC_ARC_AGENT_ADDRESS ||
  '0x39e16991c1612ad82e0df07545cf792b983db6a5'
).toLowerCase();
let AGENT_ID = null;  // will be resolved from Supabase on startup

// ── Helpers ──────────────────────────────────────────────────────────────────

async function supabaseFetch(path, opts = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1${path}`, {
    ...opts,
    headers: {
      apikey: SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: opts.method === 'POST' ? 'return=representation' : undefined,
      ...opts.headers,
    },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Supabase ${path}: ${res.status} ${text}`);
  return text ? JSON.parse(text) : null;
}

async function resolveAgentId() {
  // Find or confirm the default agent
  const agents = await supabaseFetch(
    `/darwinia_agents?wallet_address=eq.${AGENT_WALLET_ADDRESS}&select=id,name`,
  );
  if (agents && agents.length > 0) {
    return agents[0].id;
  }
  // Create if not exists (shouldn't happen after migration, but defensive)
  const created = await supabaseFetch('/darwinia_agents', {
    method: 'POST',
    body: JSON.stringify({
      name: 'darwinia-default',
      wallet_id: '4cfcb13b-391b-58d1-8e83-8b6204b37d28',
      wallet_address: AGENT_WALLET_ADDRESS,
    }),
  });
  return created[0].id;
}

async function fetchPendingJob() {
  const jobs = await supabaseFetch(
    '/darwinia_jobs?status=eq.pending&order=created_at.asc&limit=1&select=*',
  );
  return jobs && jobs.length > 0 ? jobs[0] : null;
}

async function claimJob(jobId) {
  const [updated] = await supabaseFetch(
    `/darwinia_jobs?id=eq.${jobId}&status=eq.pending`,
    {
      method: 'PATCH',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify({
        status: 'claimed',
        agent_id: AGENT_ID,
        updated_at: new Date().toISOString(),
      }),
    },
  );
  return updated;
}

const DARWINIA_TIMEOUT_MS = 5 * 60 * 1000;  // 5 min per batch; kill if exceeded

function runDarwinia(generations, populationSize) {
  return new Promise((resolve, reject) => {
    const args = [
      '-m', 'darwinia', 'evolve',
      '-g', String(generations),
      '-p', String(populationSize),
      '--json',
    ];
    const proc = spawn('python', args, { cwd: DARWINIA_DIR });

    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', (d) => { stdout += d.toString(); });
    proc.stderr.on('data', (d) => { stderr += d.toString(); });

    const timer = setTimeout(() => {
      proc.kill('SIGKILL');
      reject(new Error(`darwinia timed out after ${DARWINIA_TIMEOUT_MS / 1000}s`));
    }, DARWINIA_TIMEOUT_MS);

    proc.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        reject(new Error(`darwinia exited ${code}: ${stderr.slice(-500)}`));
        return;
      }
      try {
        resolve(JSON.parse(stdout));
      } catch (e) {
        reject(new Error('Failed to parse darwinia JSON output'));
      }
    });
  });
}

async function postIteration(jobId, generation, result) {
  return supabaseFetch('/darwinia_iterations', {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify({
      job_id: jobId,
      agent_id: AGENT_ID,
      generation,
      champion_fitness: result.evolution_summary.final_champion_fitness,
      avg_fitness: result.evolution_summary.final_avg_fitness,
      genetic_diversity: result.evolution_summary.genetic_diversity,
      patterns_discovered: result.evolution_summary.patterns_discovered,
      champion_genes: result.champion.genes,
      survivors: (result.survivors || []).slice(0, 5),
      patterns: result.patterns || [],
      raw_json: result,
      is_unlocked: false,
    }),
  });
}

async function updateJobStatus(jobId, status) {
  await supabaseFetch(`/darwinia_jobs?id=eq.${jobId}`, {
    method: 'PATCH',
    body: JSON.stringify({
      status,
      updated_at: new Date().toISOString(),
      ...(status === 'completed' ? { completed_at: new Date().toISOString() } : {}),
    }),
  });
}

// ── Main loop ──────────────────────────────────────────────────────────────

async function processJob(job) {
  console.log(`[agent] Processing job ${job.id}: "${job.title}"`);
  console.log(`        generations=${job.max_generations}  pop=${job.population_size}`);
  if (job.onchain_job_id) {
    console.log(`        onchain_job_id=${job.onchain_job_id}`);
  }

  let lastResult = null;

  try {
    await updateJobStatus(job.id, 'running');

    for (let gen = 0; gen < job.max_generations; gen += BATCH_SIZE) {
      const batchGens = Math.min(BATCH_SIZE, job.max_generations - gen);
      console.log(`[agent] Job ${job.id} — evolving gen ${gen}→${gen + batchGens - 1}...`);

      const result = await runDarwinia(batchGens, job.population_size);
      lastResult = result;

      // The CLI resets per batch, so we report relative gen + offset
      const reportedGen = gen + (result.evolution_summary.generations_run - 1);

      await postIteration(job.id, reportedGen, result);
      console.log(
        `[agent] Iteration gen=${reportedGen} fitness=${result.evolution_summary.final_champion_fitness.toFixed(4)}`,
      );
    }

    // ── ERC-8183 on-chain settlement ────────────────────────────────────────
    // Only attempt if (a) job has an onchain_job_id and (b) ARC_AGENT_PRIVATE_KEY
    // is configured. Both submit() and complete() failures are non-fatal — the
    // job is still marked completed locally; the on-chain part is best-effort.
    if (job.onchain_job_id && process.env.ARC_AGENT_PRIVATE_KEY && lastResult) {
      try {
        const deliverable = onchain.deliverableHash(lastResult);
        console.log(`[agent] On-chain submit jobId=${job.onchain_job_id} deliverable=${deliverable}`);
        const subTx = await onchain.submitOnChain(job.onchain_job_id, deliverable);
        console.log(`[agent] submit tx: ${subTx}`);

        const cmpTx = await onchain.completeOnChain(job.onchain_job_id, 'evolution-done');
        console.log(`[agent] complete tx: ${cmpTx}`);
      } catch (chainErr) {
        console.error(`[agent] On-chain settlement failed (job still completed locally):`, chainErr.message);
      }
    } else if (job.onchain_job_id && !process.env.ARC_AGENT_PRIVATE_KEY) {
      console.log('[agent] Skipping on-chain settlement: ARC_AGENT_PRIVATE_KEY not set');
    }

    await updateJobStatus(job.id, 'completed');

    // Increment agent stats via RPC (REST PATCH can't do SQL arithmetic)
    await supabaseFetch('/rpc/increment_agent_stats', {
      method: 'POST',
      body: JSON.stringify({
        p_agent_id: AGENT_ID,
        p_iterations: job.max_generations,
      }),
    }).catch(() => {}); // non-fatal

    console.log(`[agent] Job ${job.id} COMPLETED`);
  } catch (err) {
    console.error(`[agent] Job ${job.id} FAILED:`, err.message);
    await updateJobStatus(job.id, 'failed').catch(() => {});
  }
}

async function poll() {
  try {
    const job = await fetchPendingJob();
    if (!job) {
      process.stdout.write('.');  // quiet heartbeat
      return;
    }

    console.log(`\n[agent] Found pending job: ${job.id}`);
    const claimed = await claimJob(job.id);
    if (!claimed) {
      console.log('[agent] Job already claimed by another agent, skipping.');
      return;
    }

    await processJob(claimed);
  } catch (err) {
    console.error('[agent] Poll error:', err.message);
  }
}

async function main() {
  console.log('🧬 Darwinia Agent Worker starting...');

  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
    console.error('Set them in .env.local and restart.');
    process.exit(1);
  }

  AGENT_ID = await resolveAgentId();
  console.log(`[agent] ID: ${AGENT_ID}`);
  console.log(`[agent] Wallet: ${AGENT_WALLET_ADDRESS}`);

  // On-chain readiness check (best-effort; does not block startup).
  try {
    const gas = await onchain.checkAgentGas();
    if (!gas) {
      console.log('[agent] On-chain mode: DISABLED (set ARC_AGENT_PRIVATE_KEY to enable submit/complete)');
    } else if (!gas.ok) {
      console.warn(
        `[agent] ⚠ Provider EOA ${gas.address} balance=${gas.balanceUsdc.toFixed(6)} USDC ` +
        `< min ${gas.minUsdc} USDC. submit() will revert until you fund it on Arc.`,
      );
    } else {
      console.log(
        `[agent] ✓ Provider EOA ${gas.address} balance=${gas.balanceUsdc.toFixed(6)} USDC (gas ready)`,
      );
    }
  } catch (e) {
    console.warn('[agent] gas check failed:', e.message);
  }

  console.log(`[agent] Polling every ${POLL_INTERVAL_MS / 1000}s...\n`);

  // Immediate first poll, then interval
  await poll();
  setInterval(poll, POLL_INTERVAL_MS);
}

main().catch((err) => {
  console.error('Fatal:', err.message);
  process.exit(1);
});
