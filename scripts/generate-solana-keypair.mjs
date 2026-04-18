/**
 * Generate a Solana ed25519 keypair for Circle Gateway signing.
 *
 * Usage:
 *   node scripts/generate-solana-keypair.mjs
 *
 * Copy the printed SOLANA_GATEWAY_PRIVATE_KEY into .env.local, then fund the
 * printed public key with devnet SOL and devnet USDC before depositing to the
 * Solana Gateway Wallet program.
 *
 * Devnet faucets:
 *   SOL:  https://faucet.solana.com/
 *   USDC: https://faucet.circle.com/ (select Solana Devnet)
 */

import { Keypair } from "@solana/web3.js";
import bs58 from "bs58";

const keypair = Keypair.generate();
const privateKeyBs58 = bs58.encode(keypair.secretKey);

console.log("\n=== Solana Gateway Signer Keypair ===\n");
console.log("Public key (fund this address with devnet SOL + USDC):");
console.log("  " + keypair.publicKey.toBase58());
console.log("\nAdd this line to .env.local:");
console.log("  SOLANA_GATEWAY_PRIVATE_KEY=" + privateKeyBs58);
console.log("\nNext steps:");
console.log("  1. Fund SOL:  https://faucet.solana.com/  (address above)");
console.log("  2. Fund USDC: https://faucet.circle.com/  (Solana Devnet)");
console.log("  3. Verify:    node scripts/deposit-solana-gateway.mjs");
console.log();
