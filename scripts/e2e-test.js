/**
 * Darwinia on Arc — End-to-End Test
 * Tests the full flow: Auth → Create Job → Agent Claim → Iterations → x402 Unlock
 *
 * Usage: node scripts/e2e-test.js
 * Requires: npm run dev + migration applied + darwinia Python package installed
 */

'use strict';

// Load .env.local
const path = require('path');
const fs = require('fs');
const envPath = path.join(__dirname, '..', '.env.local');
if (fs.existsSync(envPath)) {
  fs.readFileSync(envPath, 'utf8').split('\n').forEach(line => {
    const m = line.match(/^([^#=\s][^=]*)=(.+)$/);
    if (m) process.env[m[1].trim()] = m[2].trim();
  });
}

const BASE = process.env.API_BASE || 'http://localhost:3000';
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const EMAIL = 'demo@darwinia.arc';
const PASSWORD = 'darwinia2026!';

let sessionToken = null;

async function api(path, opts = {}) {
  const res = await fetch(`${BASE}${path}`, {
    ...opts,
    headers: {
      'Content-Type': 'application/json',
      ...(sessionToken ? { Cookie: `sb-usvdvmtwagfvgxpqgxce-auth-token=${sessionToken}` } : {}),
      ...opts.headers,
    },
  });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = text; }
  return { status: res.status, data };
}

function pass(msg) { console.log('  ✅', msg); }
function fail(msg) { console.log('  ❌', msg); process.exit(1); }
function step(msg) { console.log('\n▶', msg); }

async function run() {
  console.log('🧬 Darwinia on Arc — E2E Test');
  console.log(`   API: ${BASE}\n`);

  // ── Step 1: Sign in ──────────────────────────────────────────────────────────
  step('Sign in as demo user');
  const { createClient } = require('@supabase/supabase-js');
  const supabase = createClient(SUPABASE_URL, ANON_KEY);
  const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
    email: EMAIL, password: PASSWORD,
  });
  if (authError) fail(`Auth failed: ${authError.message}`);
  sessionToken = authData.session?.access_token;
  pass(`Signed in as ${EMAIL} (token: ${sessionToken?.slice(0, 20)}...)`);

  // ── Step 2: Create job ───────────────────────────────────────────────────────
  step('Create optimization job');
  const { status: s2, data: d2 } = await api('/api/darwinia/jobs', {
    method: 'POST',
    headers: { Authorization: `Bearer ${sessionToken}` },
    body: JSON.stringify({
      title: 'E2E Test Job',
      description: 'Automated test',
      target_symbol: 'BTC/USDT',
      max_generations: 3,
      population_size: 10,
      budget_usdc: 0.01,
      price_per_iteration_usdc: 0.001,
      client_wallet_address: '0xa785c26A95a6CDfbE85edD71388a23854d441c36',
    }),
  });
  if (s2 !== 201) fail(`Create job failed: ${JSON.stringify(d2)}`);
  const jobId = d2.job?.id;
  pass(`Job created: ${jobId}`);

  // ── Step 3: Fetch job (verify pending) ──────────────────────────────────────
  step('Verify job status = pending');
  const { data: d3 } = await api(`/api/darwinia/jobs/${jobId}`, {
    headers: { Authorization: `Bearer ${sessionToken}` },
  });
  if (d3.job?.status !== 'pending') fail(`Expected pending, got: ${d3.job?.status}`);
  pass('Job is pending');

  // ── Step 4: Request iteration detail → expect 402 ───────────────────────────
  step('Test x402 gate — POST iteration first (simulate agent)');
  // First simulate agent posting an iteration (normally agent-worker does this)
  const { createClient: createServiceClient } = require('@supabase/supabase-js');
  const serviceClient = createServiceClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  // Get agent ID
  const { data: agents } = await serviceClient
    .from('darwinia_agents')
    .select('id')
    .limit(1);
  if (!agents?.length) fail('No agent found — run migration first!');
  const agentId = agents[0].id;
  pass(`Agent ID: ${agentId}`);

  // Claim job
  const { data: claimedJobs } = await serviceClient
    .from('darwinia_jobs')
    .update({ status: 'claimed', agent_id: agentId, updated_at: new Date().toISOString() })
    .eq('id', jobId)
    .eq('status', 'pending')
    .select();
  if (!claimedJobs?.length) fail('Claim failed');
  pass('Job claimed by agent');

  // Insert a test iteration
  const { data: iterRows, error: iterErr } = await serviceClient
    .from('darwinia_iterations')
    .insert({
      job_id: jobId,
      agent_id: agentId,
      generation: 0,
      champion_fitness: 0.8458,
      avg_fitness: 0.5026,
      genetic_diversity: 1.3358,
      patterns_discovered: 6,
      champion_genes: {
        weight_price_momentum: 0.267, weight_volume: 0.285,
        weight_volatility: 0.546, weight_mean_reversion: 0.487,
        weight_trend: 0.320, entry_threshold: 0.6,
        exit_threshold: 0.4, stop_loss_pct: 0.05,
        take_profit_pct: 0.662, risk_appetite: 0.765,
        time_horizon: 0.921, contrarian_bias: 0.452,
        patience: 1.0, position_sizing: 0.5,
        regime_sensitivity: 0.815, memory_length: 0.209,
        noise_filter: 0.5,
      },
      survivors: [],
      patterns: [],
      is_unlocked: false,
    })
    .select()
    .single();
  if (iterErr) fail(`Insert iteration failed: ${iterErr.message}`);
  const iterationId = iterRows.id;
  pass(`Iteration inserted: ${iterationId}`);

  // ── Step 5: Request detail → 402 ────────────────────────────────────────────
  step('GET /iterations/[id]/detail → expect 402');
  const { status: s5, data: d5 } = await api(`/api/darwinia/iterations/${iterationId}/detail`, {
    headers: { Authorization: `Bearer ${sessionToken}` },
  });
  if (s5 !== 402) fail(`Expected 402, got ${s5}: ${JSON.stringify(d5)}`);
  pass(`402 received ✓ payTo: ${d5.paymentRequirement?.payTo}`);

  // ── Step 6: Sign payment ─────────────────────────────────────────────────────
  step('Sign EIP-3009 payment');
  const { status: s6, data: d6 } = await api('/api/darwinia/sign-payment', {
    method: 'POST',
    headers: { Authorization: `Bearer ${sessionToken}` },
    body: JSON.stringify({
      to: d5.paymentRequirement.payTo,
      amountUsdc: '0.001',
    }),
  });
  if (s6 !== 200) fail(`Sign payment failed: ${JSON.stringify(d6)}`);
  pass(`Payment signed (header: ${d6.xPaymentHeader?.slice(0, 30)}...)`);

  // ── Step 7: Retry with X-PAYMENT → 200 ──────────────────────────────────────
  step('GET /iterations/[id]/detail with X-PAYMENT → expect 200 + on-chain TX');
  const { status: s7, data: d7 } = await api(`/api/darwinia/iterations/${iterationId}/detail`, {
    headers: {
      Authorization: `Bearer ${sessionToken}`,
      'x-payment': d6.xPaymentHeader,
    },
  });
  if (s7 !== 200) fail(`Payment failed: ${JSON.stringify(d7)}`);
  pass(`Payment settled! TX: ${d7.payment?.tx_hash}`);
  pass(`Explorer: ${d7.payment?.explorer}`);
  pass(`Iteration unlocked: ${d7.iteration?.is_unlocked}`);

  console.log('\n🎉 All tests passed! x402 Nanopayment flow working end-to-end.\n');

  // Cleanup
  await serviceClient.from('darwinia_iterations').delete().eq('id', iterationId);
  await serviceClient.from('darwinia_jobs').delete().eq('id', jobId);
  console.log('🧹 Test data cleaned up.');
}

run().catch(err => {
  console.error('\n💥 Test failed:', err.message);
  process.exit(1);
});
