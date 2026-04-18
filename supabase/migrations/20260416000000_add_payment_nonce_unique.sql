-- Ensure EIP-3009 nonces cannot be replayed.
-- The on-chain USDC contract also enforces uniqueness, but this DB-level
-- constraint provides fast-fail protection before the tx is even submitted.

ALTER TABLE darwinia_payments
  ADD CONSTRAINT darwinia_payments_eip3009_nonce_key UNIQUE (eip3009_nonce);
