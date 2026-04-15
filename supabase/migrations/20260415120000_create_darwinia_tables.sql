-- Darwinia on Arc: core schema.
-- Tables:
--   darwinia_jobs        — optimization jobs posted by clients
--   darwinia_agents      — agents running evolution (1 for demo, extensible)
--   darwinia_iterations  — per-generation evolution results
--   darwinia_payments    — Nanopayment settlements on Arc (x402 / EIP-3009)

-- =============================================================================
-- darwinia_jobs
-- =============================================================================
create table if not exists public.darwinia_jobs (
  id uuid not null default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  description text,
  status text not null default 'pending'
    check (status in ('pending', 'claimed', 'running', 'completed', 'failed', 'cancelled')),

  -- Optimization target
  strategy_type text not null default 'darwinia_v1',
  target_symbol text not null default 'BTC/USDT',
  max_generations int not null default 20,
  population_size int not null default 50,

  -- Pricing (sub-cent USDC per iteration — the pitch)
  budget_usdc numeric(18, 6) not null,
  price_per_iteration_usdc numeric(18, 6) not null default 0.001,

  -- Client wallet (pays)
  client_wallet_id text not null,
  client_wallet_address text not null,

  -- Agent assigned (null until claimed)
  agent_id uuid,

  -- ERC-8183 on-chain Job id (null until contract deployed)
  onchain_job_id text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,

  constraint darwinia_jobs_pkey primary key (id)
);

create index if not exists darwinia_jobs_user_id_idx on public.darwinia_jobs(user_id);
create index if not exists darwinia_jobs_status_idx on public.darwinia_jobs(status);

-- =============================================================================
-- darwinia_agents
-- =============================================================================
create table if not exists public.darwinia_agents (
  id uuid not null default gen_random_uuid(),
  name text not null,
  wallet_id text not null,
  wallet_address text not null,

  -- ERC-8004 Reputation shadow (incremented locally, mirrored on-chain later)
  reputation int not null default 0,
  total_jobs_completed int not null default 0,
  total_iterations int not null default 0,

  is_active boolean not null default true,
  created_at timestamptz not null default now(),

  constraint darwinia_agents_pkey primary key (id),
  constraint darwinia_agents_wallet_id_key unique (wallet_id)
);

-- Add the FK to darwinia_jobs.agent_id now that darwinia_agents exists
alter table public.darwinia_jobs
  add constraint darwinia_jobs_agent_id_fkey
  foreign key (agent_id) references public.darwinia_agents(id) on delete set null;

-- =============================================================================
-- darwinia_iterations
-- =============================================================================
create table if not exists public.darwinia_iterations (
  id uuid not null default gen_random_uuid(),
  job_id uuid not null references public.darwinia_jobs(id) on delete cascade,
  agent_id uuid not null references public.darwinia_agents(id) on delete cascade,
  generation int not null,

  -- Darwinia evolution_summary fields
  champion_fitness numeric(10, 6),
  avg_fitness numeric(10, 6),
  genetic_diversity numeric(10, 6),
  patterns_discovered int,

  -- Champion DNA (17 genes) — jsonb so we do not schema-lock
  champion_genes jsonb,
  survivors jsonb,       -- top N survivors
  patterns jsonb,        -- discovered patterns with predictive_power

  -- Raw CLI output for forensics
  raw_json jsonb,

  -- Payment gating
  is_unlocked boolean not null default false,  -- set true once client pays

  created_at timestamptz not null default now(),

  constraint darwinia_iterations_pkey primary key (id),
  constraint darwinia_iterations_unique unique (job_id, generation)
);

create index if not exists darwinia_iterations_job_id_idx on public.darwinia_iterations(job_id);

-- =============================================================================
-- darwinia_payments
-- =============================================================================
create table if not exists public.darwinia_payments (
  id uuid not null default gen_random_uuid(),
  job_id uuid not null references public.darwinia_jobs(id) on delete cascade,
  iteration_id uuid references public.darwinia_iterations(id) on delete set null,

  from_wallet_id text not null,
  from_wallet_address text not null,
  to_wallet_id text not null,
  to_wallet_address text not null,

  amount_usdc numeric(18, 6) not null,
  tx_hash text,
  state text not null default 'pending'
    check (state in ('pending', 'complete', 'failed')),

  -- x402 / EIP-3009 flow metadata
  x402_scheme text,                -- e.g. 'exact'
  x402_network text,               -- e.g. 'arc-testnet'
  eip3009_signature text,
  eip3009_nonce text,

  settled_at timestamptz,
  created_at timestamptz not null default now(),

  constraint darwinia_payments_pkey primary key (id)
);

create index if not exists darwinia_payments_job_id_idx on public.darwinia_payments(job_id);
create index if not exists darwinia_payments_state_idx on public.darwinia_payments(state);

-- =============================================================================
-- Row Level Security
-- =============================================================================
alter table public.darwinia_jobs enable row level security;
alter table public.darwinia_agents enable row level security;
alter table public.darwinia_iterations enable row level security;
alter table public.darwinia_payments enable row level security;

-- darwinia_jobs: users see/write their own
create policy "Users can view their own darwinia jobs"
  on public.darwinia_jobs for select
  using (auth.uid() = user_id);
create policy "Users can insert their own darwinia jobs"
  on public.darwinia_jobs for insert
  with check (auth.uid() = user_id);
create policy "Users can update their own darwinia jobs"
  on public.darwinia_jobs for update
  using (auth.uid() = user_id);

-- darwinia_agents: public read (leaderboard), server-only write
create policy "Anyone can view darwinia agents"
  on public.darwinia_agents for select
  using (true);

-- darwinia_iterations: users can see iterations of their own jobs
create policy "Users can view iterations of their own jobs"
  on public.darwinia_iterations for select
  using (
    exists (
      select 1 from public.darwinia_jobs j
      where j.id = darwinia_iterations.job_id and j.user_id = auth.uid()
    )
  );

-- darwinia_payments: users can see payments of their own jobs
create policy "Users can view payments of their own jobs"
  on public.darwinia_payments for select
  using (
    exists (
      select 1 from public.darwinia_jobs j
      where j.id = darwinia_payments.job_id and j.user_id = auth.uid()
    )
  );

-- =============================================================================
-- Realtime
-- =============================================================================
alter publication supabase_realtime add table public.darwinia_jobs;
alter publication supabase_realtime add table public.darwinia_iterations;
alter publication supabase_realtime add table public.darwinia_payments;

-- =============================================================================
-- Seed: default demo agent
-- =============================================================================
-- Note: wallet_id + wallet_address will be set post-migration via seed script
-- that reads wallets.json. Leave blank here so migration is pure.
insert into public.darwinia_agents (name, wallet_id, wallet_address)
values ('darwinia-default', 'PLACEHOLDER_AGENT_WALLET_ID', '0x0000000000000000000000000000000000000000')
on conflict (wallet_id) do nothing;
