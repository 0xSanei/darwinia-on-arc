/**
 * Circle Gateway — Solana source/destination support
 *
 * Architecture note: Circle Gateway's Solana burn-intent format is a custom
 * binary payload (NOT a valid Solana transaction), signed with Ed25519 after
 * prefixing 16 bytes (0xff + 15 zero bytes). Circle's Developer-Controlled
 * Wallets SDK only exposes signTransaction for SOL — which rejects this
 * payload format. Per Circle's own reference implementation
 * (github.com/circlefin/skills use-gateway/solana-to-evm.md), the signer
 * must be a Solana keypair signing via tweetnacl/ed25519 directly.
 *
 * We therefore load a dedicated Solana signer keypair from env
 * (SOLANA_GATEWAY_PRIVATE_KEY, bs58-encoded). This keypair both deposits USDC
 * to the Solana Gateway Wallet program and signs burn intents. Use
 * `scripts/generate-solana-keypair.ts` to bootstrap one.
 */

import { randomBytes } from "crypto";
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import {
  getAssociatedTokenAddress,
  getAccount,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import {
  Layout,
  blob,
  offset,
  struct,
  u32be,
} from "@solana/buffer-layout";
import nacl from "tweetnacl";
import bs58 from "bs58";
import type { Hex } from "viem";
import { pad } from "viem";

export const SOLANA_DOMAIN = 5;
export const SOLANA_NETWORK = "devnet" as const;
export const SOLANA_RPC_ENDPOINT =
  process.env.SOLANA_RPC_ENDPOINT || "https://api.devnet.solana.com";

export const SOLANA_GATEWAY_WALLET_ADDRESS =
  "GATEwdfmYNELfp5wDmmR6noSr2vHnAfBPMm2PvCzX5vu";
export const SOLANA_GATEWAY_MINTER_ADDRESS =
  "GATEmKK2ECL1brEngQZWCgMWPbvrEYqsV6u29dAaHavr";
export const SOLANA_USDC_MINT = "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU";
export const SOLANA_ZERO_ADDRESS = "11111111111111111111111111111111";

const TRANSFER_SPEC_MAGIC = 0xca85def7;
const BURN_INTENT_MAGIC = 0x070afbc2;
const MAX_UINT64 = 2n ** 64n - 1n;

let cachedConnection: Connection | null = null;
export function getSolanaConnection(): Connection {
  if (!cachedConnection) {
    cachedConnection = new Connection(SOLANA_RPC_ENDPOINT, "confirmed");
  }
  return cachedConnection;
}

let cachedSignerKeypair: Keypair | null = null;
export function getSolanaSignerKeypair(): Keypair {
  if (cachedSignerKeypair) return cachedSignerKeypair;
  const raw = process.env.SOLANA_GATEWAY_PRIVATE_KEY;
  if (!raw) {
    throw new Error(
      "SOLANA_GATEWAY_PRIVATE_KEY env var not set. Run `npx tsx scripts/generate-solana-keypair.ts` to create one."
    );
  }
  let secretKey: Uint8Array;
  try {
    secretKey = bs58.decode(raw.trim());
  } catch {
    throw new Error("SOLANA_GATEWAY_PRIVATE_KEY must be bs58-encoded");
  }
  if (secretKey.length !== 64) {
    throw new Error(
      `SOLANA_GATEWAY_PRIVATE_KEY decodes to ${secretKey.length} bytes; expected 64`
    );
  }
  cachedSignerKeypair = Keypair.fromSecretKey(secretKey);
  return cachedSignerKeypair;
}

export function getSolanaSignerAddress(): string {
  return getSolanaSignerKeypair().publicKey.toBase58();
}

class PublicKeyLayout extends Layout<PublicKey> {
  constructor(property: string) {
    super(32, property);
  }
  decode(buffer: Buffer, byteOffset = 0): PublicKey {
    return new PublicKey(buffer.subarray(byteOffset, byteOffset + 32));
  }
  encode(source: PublicKey, buffer: Buffer, byteOffset = 0): number {
    source.toBuffer().copy(buffer, byteOffset);
    return 32;
  }
}

class UInt256BELayout extends Layout<bigint> {
  constructor(property: string) {
    super(32, property);
  }
  decode(buffer: Buffer, byteOffset = 0): bigint {
    return buffer.subarray(byteOffset, byteOffset + 32).readBigUInt64BE(24);
  }
  encode(source: bigint, buffer: Buffer, byteOffset = 0): number {
    const valueBuffer = Buffer.alloc(32);
    valueBuffer.writeBigUInt64BE(source, 24);
    valueBuffer.copy(buffer, byteOffset);
    return 32;
  }
}

const publicKey = (property: string) => new PublicKeyLayout(property);
const uint256be = (property: string) => new UInt256BELayout(property);

const BurnIntentLayout = struct([
  u32be("magic"),
  uint256be("maxBlockHeight"),
  uint256be("maxFee"),
  u32be("transferSpecLength"),
  struct(
    [
      u32be("magic"),
      u32be("version"),
      u32be("sourceDomain"),
      u32be("destinationDomain"),
      publicKey("sourceContract"),
      publicKey("destinationContract"),
      publicKey("sourceToken"),
      publicKey("destinationToken"),
      publicKey("sourceDepositor"),
      publicKey("destinationRecipient"),
      publicKey("sourceSigner"),
      publicKey("destinationCaller"),
      uint256be("value"),
      blob(32, "salt"),
      u32be("hookDataLength"),
      blob(offset(u32be(), -4), "hookData"),
    ] as any,
    "spec"
  ),
] as any);

export interface SolanaBurnIntentSpec {
  version: number;
  sourceDomain: number;
  destinationDomain: number;
  sourceContract: Hex;
  destinationContract: Hex;
  sourceToken: Hex;
  destinationToken: Hex;
  sourceDepositor: Hex;
  destinationRecipient: Hex;
  sourceSigner: Hex;
  destinationCaller: Hex;
  value: bigint;
  salt: Hex;
  hookData: Hex;
}

export interface SolanaBurnIntent {
  maxBlockHeight: bigint;
  maxFee: bigint;
  spec: SolanaBurnIntentSpec;
}

function hexToPublicKey(address: Hex): PublicKey {
  return new PublicKey(Buffer.from(address.slice(2), "hex"));
}

export function solanaAddressToBytes32(address: string): Hex {
  return `0x${new PublicKey(address).toBuffer().toString("hex")}` as Hex;
}

export function evmAddressToBytes32(address: Hex): Hex {
  return pad(address.toLowerCase() as Hex, { size: 32 });
}

export function encodeSolanaBurnIntent(intent: SolanaBurnIntent): Buffer {
  const hookData = Buffer.from(intent.spec.hookData.slice(2), "hex");
  const prepared = {
    magic: BURN_INTENT_MAGIC,
    maxBlockHeight: intent.maxBlockHeight,
    maxFee: intent.maxFee,
    transferSpecLength: 340 + hookData.length,
    spec: {
      magic: TRANSFER_SPEC_MAGIC,
      version: intent.spec.version,
      sourceDomain: intent.spec.sourceDomain,
      destinationDomain: intent.spec.destinationDomain,
      sourceContract: hexToPublicKey(intent.spec.sourceContract),
      destinationContract: hexToPublicKey(intent.spec.destinationContract),
      sourceToken: hexToPublicKey(intent.spec.sourceToken),
      destinationToken: hexToPublicKey(intent.spec.destinationToken),
      sourceDepositor: hexToPublicKey(intent.spec.sourceDepositor),
      destinationRecipient: hexToPublicKey(intent.spec.destinationRecipient),
      sourceSigner: hexToPublicKey(intent.spec.sourceSigner),
      destinationCaller: hexToPublicKey(intent.spec.destinationCaller),
      value: intent.spec.value,
      salt: Buffer.from(intent.spec.salt.slice(2), "hex"),
      hookDataLength: hookData.length,
      hookData,
    },
  };
  const out = Buffer.alloc(72 + 340 + hookData.length);
  const bytesWritten = BurnIntentLayout.encode(prepared, out);
  return out.subarray(0, bytesWritten);
}

export function signSolanaBurnIntent(
  encoded: Buffer,
  keypair: Keypair = getSolanaSignerKeypair()
): Hex {
  const prefixed = new Uint8Array(16 + encoded.length);
  prefixed.set([0xff], 0);
  prefixed.set(encoded, 16);
  const signature = nacl.sign.detached(prefixed, keypair.secretKey);
  return `0x${Buffer.from(signature).toString("hex")}` as Hex;
}

export async function getSolanaUsdcBalance(
  ownerAddress: string
): Promise<bigint> {
  const connection = getSolanaConnection();
  const owner = new PublicKey(ownerAddress);
  const usdcMint = new PublicKey(SOLANA_USDC_MINT);
  const ata = await getAssociatedTokenAddress(usdcMint, owner);
  try {
    const account = await getAccount(connection, ata);
    return account.amount;
  } catch (err: any) {
    // TokenAccountNotFoundError → zero balance
    if (
      err?.name === "TokenAccountNotFoundError" ||
      err?.message?.includes("could not find account")
    ) {
      return 0n;
    }
    throw err;
  }
}

export async function getSolanaSolBalance(ownerAddress: string): Promise<number> {
  const connection = getSolanaConnection();
  const lamports = await connection.getBalance(new PublicKey(ownerAddress));
  return lamports / LAMPORTS_PER_SOL;
}

export interface BuildSolanaSourceBurnIntentArgs {
  amount: bigint;
  destinationDomain: number;
  destinationContractEvm: Hex;
  destinationTokenEvm: Hex;
  destinationRecipientEvm: Hex;
  maxFee?: bigint;
}

export function buildSolanaSourceBurnIntent(
  args: BuildSolanaSourceBurnIntentArgs
): SolanaBurnIntent {
  const signerPubkey = getSolanaSignerAddress();
  return {
    maxBlockHeight: MAX_UINT64,
    maxFee: args.maxFee ?? 2_010_000n,
    spec: {
      version: 1,
      sourceDomain: SOLANA_DOMAIN,
      destinationDomain: args.destinationDomain,
      sourceContract: solanaAddressToBytes32(SOLANA_GATEWAY_WALLET_ADDRESS),
      destinationContract: evmAddressToBytes32(args.destinationContractEvm),
      sourceToken: solanaAddressToBytes32(SOLANA_USDC_MINT),
      destinationToken: evmAddressToBytes32(args.destinationTokenEvm),
      sourceDepositor: solanaAddressToBytes32(signerPubkey),
      destinationRecipient: evmAddressToBytes32(args.destinationRecipientEvm),
      sourceSigner: solanaAddressToBytes32(signerPubkey),
      destinationCaller: evmAddressToBytes32(
        "0x0000000000000000000000000000000000000000" as Hex
      ),
      value: args.amount,
      salt: `0x${randomBytes(32).toString("hex")}` as Hex,
      hookData: "0x" as Hex,
    },
  };
}

export async function submitSolanaBurnIntent(
  intent: SolanaBurnIntent,
  signature: Hex
): Promise<{
  attestation: Hex;
  attestationSignature: Hex;
  transferId: string;
}> {
  const body = JSON.stringify(
    [{ burnIntent: intent, signature }],
    (_k, v) => (typeof v === "bigint" ? v.toString() : v)
  );
  const response = await fetch(
    "https://gateway-api-testnet.circle.com/v1/transfer",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
    }
  );
  if (!response.ok) {
    throw new Error(
      `Gateway API error (Solana): ${response.status} ${await response.text()}`
    );
  }
  const data = await response.json();
  const result = Array.isArray(data) ? data[0] : data;
  return {
    attestation: result.attestation as Hex,
    attestationSignature: result.signature as Hex,
    transferId: result.transferId,
  };
}

export async function signAndSubmitSolanaSourceBurnIntent(
  args: BuildSolanaSourceBurnIntentArgs
): Promise<{
  transferId: string;
  attestation: Hex;
  attestationSignature: Hex;
}> {
  const intent = buildSolanaSourceBurnIntent(args);
  const encoded = encodeSolanaBurnIntent(intent);
  const signature = signSolanaBurnIntent(encoded);
  console.log(
    `[gateway-solana] Signed burn intent from Solana depositor ${getSolanaSignerAddress()} to domain ${args.destinationDomain}`
  );
  const { transferId, attestation, attestationSignature } =
    await submitSolanaBurnIntent(intent, signature);

  if (!attestation || !attestationSignature) {
    throw new Error(
      `Solana burn intent submitted (id=${transferId}) but attestation not returned synchronously — Gateway API changed behavior`
    );
  }
  return { transferId, attestation, attestationSignature };
}
