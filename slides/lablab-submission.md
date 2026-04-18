# lablab.ai Submission Content — Darwinia on Arc

## Project Title
Darwinia on Arc

## Short Description
AI-driven genetic algorithm optimization as a service, settled with $0.001 USDC Nanopayments on Arc Network. Post a job, an autonomous agent evolves trading strategies, and you unlock results pay-per-insight.

## Long Description
Darwinia on Arc is an agentic optimization marketplace where autonomous genetic algorithm agents evolve trading strategies on demand. Users post optimization jobs specifying their target (e.g., BTC/USDT), budget, and number of generations. An autonomous agent worker claims the job, runs the Darwinia genetic algorithm engine, and produces strategy variants across generations — each characterized by a 17-gene DNA (patience, noise_filter, risk_appetite, stop_loss, entry/exit thresholds, and more).

Results are locked behind an x402 Nanopayment gate: each iteration can be unlocked individually for just $0.001 USDC via EIP-3009 TransferWithAuthorization on Arc Testnet. The client signs a meta-transaction, and a relay wallet submits it on-chain — making the experience completely gas-free for the user.

**On-chain agent identity (ERC-8004 + ERC-8183):**
We deploy and use the **AgenticCommerce** Job primitive (ERC-8183) and the **IdentityRegistry** (ERC-8004) on Arc Testnet. Every job posted by a user is mirrored into a real on-chain Job: `createJob → submit → complete`. On `complete`, the contract calls `IdentityRegistry.incrementReputation(provider)` — so the agent's reputation grows verifiably with every completed job, no central authority required. To our knowledge this is the first production-style dApp wiring these two emerging EIPs together on Arc.

- IdentityRegistry: `0x96631e6cdc6bb37f10c3a132149ddde7e8061d05`
- AgenticCommerce:  `0xe1bb5422bc3b4b03e6b4442a5195721fabdbf5f5`

**Cross-chain capital (Circle Gateway):**
A user can fund their Arc balance from Solana in one click — the dApp burns USDC on Solana via Circle's Gateway program, fetches an attestation from `gateway-api-testnet.circle.com`, and calls `gatewayMint(bytes,bytes)` on Arc. End-to-end smoke test moves 2.5 USDC from Solana → Arc with a 0.003 USDC fee (~3 seconds total). This unifies liquidity across chains so users don't need to first hold USDC on Arc to start a job.

**Why Arc makes this viable (economic proof):**
On Ethereum mainnet, a single `transferWithAuthorization` call costs $3–15 in gas. A $0.001 payment would require 3,000–15,000× more in gas than the payment itself — economically impossible. Arc's native USDC and sub-cent finality reduce per-transaction cost to near zero, making $0.001 micropayments genuinely profitable. The demo shows 60+ on-chain settlements totaling $0.06 USDC — a transaction volume that would cost $180–900 in gas on Ethereum.

**Hackathon tracks:** Agentic Economy on Arc · Per-API Monetization Engine + Usage-Based Compute Billing + Agent Identity & Reputation

Key features:
- **Agentic GA Engine**: Autonomous agent worker polls for pending jobs, runs Python-based genetic algorithms, and reports results in real-time via Supabase
- **ERC-8183 Job Lifecycle**: Every job is also an on-chain Job (`createJob → submit → complete`); on completion the contract calls `IdentityRegistry.incrementReputation(provider)` — verifiable agent reputation
- **ERC-8004 Identity Registry**: Agents register once, get a `agentId`, and accumulate reputation across all completed jobs
- **Cross-chain capital via Circle Gateway**: One-click Solana → Arc USDC bridge directly inside the dApp (`signAndSubmitSolanaSourceBurnIntent` + `gatewayMint` on Arc)
- **x402 Payment Gate**: HTTP 402 responses with payment requirements, settled via EIP-3009 meta-transactions on Arc
- **17-Gene Champion DNA**: Each evolved strategy is represented by 17 configurable genes, visualized in the dashboard
- **Pay-Per-Insight**: No subscriptions — users only pay for results they want to review ($0.001 per iteration)
- **60+ On-Chain Transactions**: Demo job runs 60 generations, each unlock is one on-chain `transferWithAuthorization`

Built with Next.js, Supabase, Circle Developer Controlled Wallets, and the Darwinia open-source genetic algorithm library.

## Technology Tags
- Circle USDC
- Arc Network
- Circle Gateway (cross-chain USDC)
- Nanopayments (x402)
- EIP-3009
- ERC-8004 (Agent Identity Registry)
- ERC-8183 (AgenticCommerce Job)
- Genetic Algorithms
- AI Agents
- Next.js
- Supabase
- TypeScript
- Python

## Category Tags
- DeFi
- AI/ML
- Agentic Economy
- Trading
- Micropayments

## Application URL
https://darwinia-on-arc.vercel.app

## GitHub Repository
https://github.com/0xSanei/darwinia-on-arc

## Video Presentation
(Upload demo-recording.mp4 or provide YouTube link after upload)

## Slide Presentation
(Upload pitch-deck.pptx)

## Cover Image
(Use darwinia-on-arc-cover.png from D:\Sanei\arc-content\)

## Circle Product Feedback (Required)
We integrated four Circle products in Darwinia on Arc:

1. **Developer Controlled Wallets**: Used for agent wallet management. The SDK made it straightforward to create and manage wallets programmatically. Suggestion: Add batch wallet creation for multi-agent scenarios.

2. **USDC on Arc Testnet**: Native USDC as the settlement layer for micropayments. The 6-decimal precision works well for sub-cent transactions ($0.001). The faucet was reliable for testing. Suggestion: Consider adding a "drip" mode for continuous small amounts during development.

3. **Circle Gateway (Solana → Arc)**: Used for cross-chain USDC unification. The Anchor-based burn intent program on Solana plus `gatewayMint(bytes,bytes)` on EVM let us move 2.5 USDC end-to-end with a 0.003 USDC fee in ~3 seconds. Suggestions:
   - Publish a TypeScript helper for building the BurnIntent layout (we had to mirror the layout from `@solana/buffer-layout` manually)
   - Document the asymmetry between the synchronous attestation path on testnet vs. polling on mainnet more prominently

4. **x402 / Nanopayments**: This is the core innovation enabling our business model. HTTP 402 payment-gated APIs are a natural fit for pay-per-result services. The EIP-3009 TransferWithAuthorization standard enables gas-free client experiences. Suggestions:
   - Provide a reference middleware library for Next.js/Express to simplify 402 gateway implementation
   - Add webhook notifications for payment confirmations
   - Consider a client-side SDK that handles the sign-and-submit flow automatically

Overall, Arc's native USDC + sub-second finality makes micropayment business models genuinely viable for the first time. The combination of x402 + EIP-3009 + ERC-8004/8183 eliminates both subscription fatigue (for users) and identity centralization (for agents).

## Transaction Flow Demonstration
The demo video shows the complete transaction flow:
1. User creates an optimization job with USDC budget
2. Agent worker auto-claims and processes the job
3. User requests locked iteration data → receives HTTP 402 with payment requirement
4. Client wallet signs EIP-3009 TransferWithAuthorization message
5. Relay wallet submits the signed authorization on-chain to Arc Testnet
6. USDC transfers from user wallet to agent wallet
7. Iteration data unlocked and full 17-gene Champion DNA displayed
