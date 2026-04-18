# Darwinia on Arc

> **Agentic Economy on Arc Hackathon 2026** · Built by [0xSanei](https://github.com/0xSanei)

AI-driven genetic algorithm optimization as a service, settled with **$0.001 USDC Nanopayments** on Arc Network. Post a job, an autonomous agent evolves trading strategies across generations, and you unlock results pay-per-insight — no subscriptions, no upfront cost.

**Live demo:** https://darwinia-on-arc.vercel.app

---

## What it does

1. **Post a Job** — specify target symbol (BTC/USDT), budget, and number of generations
2. **Agent Evolves** — an autonomous worker polls for pending jobs, runs the [Darwinia](https://github.com/darwinia-network/darwinia) genetic algorithm engine, and reports 17-gene champion DNA per generation
3. **Pay Per Insight** — each generation result is locked behind an x402 HTTP 402 gate; unlock for exactly $0.001 USDC via EIP-3009 TransferWithAuthorization on Arc Testnet
4. **Gas-Free UX** — the client signs a meta-transaction; a relay wallet submits it on-chain, so the user never touches gas

### Why Arc makes this possible

On Ethereum mainnet, a single `transferWithAuthorization` costs **$3–15 in gas** — making $0.001 micropayments economically impossible (gas > payment by 3000×). Arc's sub-cent gas and sub-second finality collapse this ratio to near zero, enabling a genuine **pay-per-result** business model that cannot exist on any other chain today.

---

## Architecture

```
User Browser
  └─► Next.js Dashboard (Vercel)
        ├─► POST /api/darwinia/jobs        → create job (Supabase)
        ├─► GET  /api/darwinia/jobs/:id    → job detail + iterations
        └─► GET  /api/darwinia/iterations/:id/detail
              ├─ if locked: 402 + paymentRequirement
              └─ if X-PAYMENT header present:
                   1. off-chain EIP-712 sig verify
                   2. DB nonce replay check
                   3. relay wallet → transferWithAuthorization → Arc Testnet
                   4. mark unlocked, return full genome

Agent Worker (Node.js, PM2)
  └─► polls Supabase for pending jobs
  └─► claims job (Supabase PATCH, atomic)
  └─► spawns `python -m darwinia evolve -g N --json`
  └─► POSTs each generation result to Supabase
  └─► on completion:
        ├─ AgenticCommerce.submit(jobId, deliverableHash)   (provider EOA)
        ├─ AgenticCommerce.complete(jobId, reason)          (evaluator EOA)
        │   └─ triggers IdentityRegistry.incrementReputation(agent, 1)
        └─ increment_agent_stats RPC (off-chain mirror)
```

---

## Circle Products Used

| Product | Usage |
|---------|-------|
| **USDC on Arc Testnet** | Settlement token for all Nanopayments ($0.001/iteration) |
| **Nanopayments / x402** | HTTP 402 payment-gated API; EIP-3009 TransferWithAuthorization flow |
| **Developer Controlled Wallets** | Agent wallet management (wallet ID `4cfcb13b...`) |

---

## Hackathon Track

**Agentic Economy on Arc** · Tracks: **Per-API Monetization Engine** + **Usage-Based Compute Billing** + **Agent Identity & Reputation**.

Each API response (iteration result) is individually priced and settled on-chain in real time. Every completed Job bumps the agent's on-chain reputation through ERC-8004.

---

## Agentic Architecture (ERC-8004 + ERC-8183)

This is the first deployment we know of that wires **ERC-8004 Agent Identity Registry** and **ERC-8183 AgenticCommerce Job primitive** together on Arc Testnet, with a working dApp on top.

| Contract | Address (Arc Testnet) | Role |
|---|---|---|
| `IdentityRegistry` (ERC-8004) | [`0x9663…1d05`](https://explorer.testnet.arc.network/address/0x96631e6cdc6bb37f10c3a132149ddde7e8061d05) | Agents register, get a `agentId`, accumulate reputation |
| `AgenticCommerce` (ERC-8183) | [`0xe1bb…f5f5`](https://explorer.testnet.arc.network/address/0xe1bb5422bc3b4b03e6b4442a5195721fabdbf5f5) | Job lifecycle (`createJob → submit → complete`); on completion calls `IdentityRegistry.incrementReputation(provider, 1)` |

**Lifecycle**:

```
User ──POST /api/darwinia/jobs──► Next.js
                                    │  (1) supabase.insert(jobs)
                                    │  (2) AgenticCommerce.createJob(provider=agent, evaluator=client, ...)
                                    │      → onchain_job_id stored in DB
                                    ▼
                     Agent Worker (PM2) polls pending jobs
                                    │  (3) python -m darwinia evolve  (per-iteration loop)
                                    │      ├─ each iteration → x402 / EIP-3009 / Nanopayment ($0.001 USDC)
                                    │      └─ job complete →
                                    │              AgenticCommerce.submit(jobId, keccak256(result))
                                    │              AgenticCommerce.complete(jobId, "evolution-done")
                                    │              ⇒ IdentityRegistry.incrementReputation(agent, 1)
                                    ▼
                            Reputation visible on-chain
```

**Cross-chain capital**: clients can fund their Arc balance from Solana via Circle Gateway (`gatewayMint(bytes,bytes)`). End-to-end smoke test in [`scripts/smoke-test-solana-to-arc.mjs`](scripts/smoke-test-solana-to-arc.mjs) — sent 2.5 USDC from Solana, received 2.497 USDC on Arc, fee 0.003 USDC.

---

## Tech Stack

- **Frontend:** Next.js 15, TypeScript, Tailwind CSS, Supabase Realtime
- **Backend:** Next.js API Routes, Supabase (Postgres + RLS + RPC)
- **Payments:** viem, EIP-3009 TransferWithAuthorization, Arc Testnet
- **Agent:** Node.js worker + Python Darwinia GA engine (PM2)
- **Infra:** Vercel (frontend) + local PM2 (agent)

---

## Getting Started

### Prerequisites

- Node.js v22+
- Python 3.10+ with `darwinia` package (`pip install darwinia`)
- Supabase project (cloud or local)
- Arc Testnet USDC (from [faucet.circle.com](http://faucet.circle.com))

### Setup

```bash
git clone https://github.com/0xSanei/darwinia-on-arc.git
cd darwinia-on-arc
npm install
cp .env.example .env.local   # fill in values — see Environment Variables below
```

Run database migrations:

```bash
npx supabase db push
# or apply manually: supabase/migrations/*.sql
```

Start the app:

```bash
npm run dev
```

Start the agent worker:

```bash
node agent-worker/index.js
# or via PM2: pm2 start agent-worker/index.js --name darwinia-agent
```

### Environment Variables

| Variable | Description |
|----------|-------------|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Supabase anon key |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service role key (server only) |
| `ARC_CLIENT_PRIVATE_KEY` | EOA private key for signing EIP-3009 |
| `ARC_RELAY_PRIVATE_KEY` | EOA private key for relay wallet (submits on-chain) |
| `ARC_AGENT_ADDRESS` | Agent wallet address (receives USDC) |
| `ARC_AGENT_PRIVATE_KEY` | (Optional) provider EOA key for on-chain `submit()` — opt-in |
| `ARC_CLIENT_ADDRESS` | Client wallet address (pays USDC) |
| `NEXT_PUBLIC_ARC_CLIENT_ADDRESS` | Same as above, exposed to frontend |
| `NEXT_PUBLIC_ARC_AGENT_ADDRESS` | Agent address, exposed to frontend (provider in `createJob`) |
| `NEXT_PUBLIC_ARC_AGENTIC_COMMERCE` | ERC-8183 contract address, exposed to frontend |
| `NEXT_PUBLIC_ARC_IDENTITY_REGISTRY` | ERC-8004 contract address, exposed to frontend |
| `AGENT_API_SECRET` | Shared secret for agent-worker → API auth |
| `CIRCLE_API_KEY` | Circle Developer Controlled Wallets API key |
| `CIRCLE_ENTITY_SECRET` | Circle entity secret |

---

## x402 Payment Flow

```
Client                          Server (Next.js)                Arc Testnet
  │                                    │                              │
  ├─GET /iterations/:id/detail ────────►│                              │
  │◄──── 402 + paymentRequirement ──────┤                              │
  │                                    │                              │
  ├─POST /sign-payment ────────────────►│                              │
  │◄──── xPaymentHeader (base64 JSON) ──┤                              │
  │                                    │                              │
  ├─GET /iterations/:id/detail ────────►│                              │
  │    (X-PAYMENT: <header>)           │                              │
  │                               verifyTypedData()                   │
  │                               check nonce in DB                   │
  │                                    ├─transferWithAuthorization()──►│
  │                                    │◄─────── tx receipt ───────────┤
  │◄──── 200 + iteration.champion_genes ┤                              │
```

---

## License

MIT — see [LICENSE](LICENSE)
