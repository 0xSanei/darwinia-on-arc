# Darwinia on Arc — Demo Script (3 min)

## Scene 1: Dashboard (0:00 - 0:20)
"This is Darwinia on Arc — an agentic optimization marketplace built on Arc Network. The dashboard shows multi-chain wallet balances powered by Circle Developer Controlled Wallets."

## Scene 2: Optimization Jobs (0:20 - 0:40)
"Here's where the magic happens. Users post optimization jobs that autonomous agents pick up. You can see we have 2 jobs — one completed, one claimed by an agent. Total budget is just $0.11 USDC."

## Scene 3: New Job Form + Cross-chain Capital (0:40 - 1:20)
"Creating a job is simple — set your target symbol, number of generations, and budget. The cost estimate shows 20 generations at $0.001 each = just $0.02 USDC total.

If you don't have USDC on Arc yet, click 'Bridge 0.5 USDC'. We use Circle Gateway to burn USDC on Solana, fetch an attestation, and call `gatewayMint` on Arc — all in one click. The whole round-trip completes in about 3 seconds with a 0.003 USDC fee."

## Scene 4: Job Detail + On-chain Identity (1:20 - 2:10)
"Let's look at a completed job. Notice the **ERC-8183** and **ERC-8004** badges at the top — every job is also a real on-chain Job on the AgenticCommerce contract. The on-chain Job ID links to the contract on the Arc explorer.

The BTC/USDT Strategy Evolution ran 60 generations. The current champion has a fitness of 0.4604 with 10 patterns found. Each iteration's full genome is locked behind an x402 Nanopayment gate — you only pay $0.001 to unlock results you actually want.

The Champion DNA shows 17 evolved genes: patience, noise_filter, time_horizon, risk_appetite, stop_loss, entry/exit thresholds, and more. These represent a complete trading strategy evolved through genetic algorithms."

## Scene 5: Agent Reputation (On-chain) (2:10 - 2:40)
"When an agent completes a job, the agent worker calls `submit()` and `complete()` on the AgenticCommerce contract. On `complete`, the contract calls `IdentityRegistry.incrementReputation(provider, 1)` — the agent's reputation grows verifiably with every completed job.

The leaderboard surfaces this on-chain reputation. In production, multiple agents would compete — higher reputation means more work."

## Scene 6: Under the Hood (2:40 - 3:00)
"Three Circle products, two emerging EIPs, all settled on Arc:
- **Circle Gateway** for cross-chain USDC liquidity
- **x402 + EIP-3009 Nanopayments** for $0.001 pay-per-result
- **ERC-8004 + ERC-8183** for verifiable on-chain agent identity and reputation

Sub-cent settlement, gas-free UX, agentic identity. Thank you."
