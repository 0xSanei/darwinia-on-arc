// Darwinia on Arc — TypeScript types
// Mirrors Supabase schema in 20260415120000_create_darwinia_tables.sql

export type JobStatus = 'pending' | 'claimed' | 'running' | 'completed' | 'failed' | 'cancelled';
export type PaymentState = 'pending' | 'complete' | 'failed';

export interface DarwiniaJob {
  id: string;
  user_id: string;
  title: string;
  description?: string;
  status: JobStatus;
  strategy_type: string;
  target_symbol: string;
  max_generations: number;
  population_size: number;
  budget_usdc: number;
  price_per_iteration_usdc: number;
  client_wallet_id: string;
  client_wallet_address: string;
  agent_id?: string;
  onchain_job_id?: string;
  created_at: string;
  updated_at: string;
  completed_at?: string;
}

export interface DarwiniaAgent {
  id: string;
  name: string;
  wallet_id: string;
  wallet_address: string;
  reputation: number;
  total_jobs_completed: number;
  total_iterations: number;
  is_active: boolean;
  created_at: string;
}

export interface DarwiniaIteration {
  id: string;
  job_id: string;
  agent_id: string;
  generation: number;
  champion_fitness: number;
  avg_fitness: number;
  genetic_diversity: number;
  patterns_discovered: number;
  champion_genes?: Record<string, number>;
  survivors?: DarwiniaGenomeEntry[];
  patterns?: DarwiniaPattern[];
  raw_json?: DarwiniaEvolutionResult;
  is_unlocked: boolean;
  created_at: string;
}

export interface DarwiniaPayment {
  id: string;
  job_id: string;
  iteration_id?: string;
  from_wallet_id: string;
  from_wallet_address: string;
  to_wallet_id: string;
  to_wallet_address: string;
  amount_usdc: number;
  tx_hash?: string;
  state: PaymentState;
  x402_scheme?: string;
  x402_network?: string;
  eip3009_signature?: string;
  eip3009_nonce?: string;
  settled_at?: string;
  created_at: string;
}

// Darwinia CLI output types
export interface DarwiniaGenes {
  weight_price_momentum: number;
  weight_volume: number;
  weight_volatility: number;
  weight_mean_reversion: number;
  weight_trend: number;
  entry_threshold: number;
  exit_threshold: number;
  stop_loss_pct: number;
  take_profit_pct: number;
  risk_appetite: number;
  time_horizon: number;
  contrarian_bias: number;
  patience: number;
  position_sizing: number;
  regime_sensitivity: number;
  memory_length: number;
  noise_filter: number;
}

export interface DarwiniaGenomeEntry {
  id: string;
  generation: number;
  genes: DarwiniaGenes;
  parent_ids: string[];
  mutation_log: string[];
  fitness: number;
  birth_time: string;
}

export interface DarwiniaPattern {
  name: string;
  features: Partial<DarwiniaGenes>;
  predictive_power: number;
  human_equivalent: string;
  discovered_by: string;
  generation: number;
}

export interface DarwiniaEvolutionSummary {
  generations_run: number;
  population_size: number;
  final_champion_fitness: number;
  final_avg_fitness: number;
  genetic_diversity: number;
  patterns_discovered: number;
}

export interface DarwiniaEvolutionResult {
  champion: DarwiniaGenomeEntry;
  evolution_summary: DarwiniaEvolutionSummary;
  patterns: DarwiniaPattern[];
  survivors: DarwiniaGenomeEntry[];
}

// API request/response types
export interface CreateJobRequest {
  title: string;
  description?: string;
  target_symbol?: string;
  max_generations?: number;
  population_size?: number;
  budget_usdc: number;
  price_per_iteration_usdc?: number;
  client_wallet_address: string;
}

export interface IterationPayload {
  job_id: string;
  agent_id: string;
  generation: number;
  result: DarwiniaEvolutionResult;
}

// x402 Payment Requirement (what server sends in 402 response)
export interface X402PaymentRequirement {
  scheme: 'exact';
  network: string;
  maxAmountRequired: string;  // USDC in base units (6 decimals)
  resource: string;
  payTo: string;
  maxTimeoutSeconds: number;
  asset: string;  // USDC contract address
  extra: { name: string; version: string; decimals: number };
}
