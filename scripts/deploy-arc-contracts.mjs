/**
 * Compile + deploy ERC-8004 IdentityRegistry and ERC-8183 AgenticCommerce
 * to Arc Testnet.
 *
 * Usage:
 *   node scripts/deploy-arc-contracts.mjs            # compile + deploy
 *   node scripts/deploy-arc-contracts.mjs --compile-only
 *
 * Reads:
 *   ARC_RPC_URL (or falls back to https://rpc.testnet.arc.network)
 *   ARC_CLIENT_PRIVATE_KEY (the deployer — funded EOA, hex with 0x prefix)
 *   ARC_USDC_CONTRACT      (ERC-20 used as Job payment token)
 *
 * Writes:
 *   deployments/arc-testnet.json   (addresses + abis + tx hashes + blockNumber)
 *   .env.local                     (appends ARC_IDENTITY_REGISTRY, ARC_AGENTIC_COMMERCE)
 */

import fs from "node:fs";
import path from "node:path";
import solc from "solc";
import { createPublicClient, createWalletClient, http, defineChain } from "viem";
import { privateKeyToAccount } from "viem/accounts";

// ───────────── env ─────────────

function loadEnvFile(file) {
  if (!fs.existsSync(file)) return;
  const src = fs.readFileSync(file, "utf8");
  for (const line of src.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (!m) continue;
    if (process.env[m[1]]) continue;
    let v = m[2];
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    process.env[m[1]] = v;
  }
}
loadEnvFile(path.resolve(process.cwd(), ".env.local"));
loadEnvFile(path.resolve(process.cwd(), ".env"));

const args = process.argv.slice(2);
const COMPILE_ONLY = args.includes("--compile-only");

const ARC_RPC_URL = process.env.ARC_RPC_URL || "https://rpc.testnet.arc.network";
const ARC_CHAIN_ID = Number(process.env.ARC_CHAIN_ID || 5042002);
const DEPLOYER_PK = process.env.ARC_CLIENT_PRIVATE_KEY;
const USDC_ADDRESS = process.env.ARC_USDC_CONTRACT || "0x3600000000000000000000000000000000000000";

if (!COMPILE_ONLY && !DEPLOYER_PK) {
  console.error("ARC_CLIENT_PRIVATE_KEY not set in .env.local");
  process.exit(1);
}

// ───────────── compile ─────────────

const CONTRACT_DIR = path.resolve(process.cwd(), "contracts");
function readContract(name) {
  return fs.readFileSync(path.join(CONTRACT_DIR, name), "utf8");
}

const solcInput = {
  language: "Solidity",
  sources: {
    "IdentityRegistry.sol": { content: readContract("IdentityRegistry.sol") },
    "AgenticCommerce.sol": { content: readContract("AgenticCommerce.sol") },
  },
  settings: {
    optimizer: { enabled: true, runs: 200 },
    evmVersion: "cancun",
    outputSelection: {
      "*": {
        "*": ["abi", "evm.bytecode.object", "evm.deployedBytecode.object"],
      },
    },
  },
};

console.log("=== Compiling with solc " + solc.version() + " ===\n");
const output = JSON.parse(solc.compile(JSON.stringify(solcInput)));

let hasError = false;
for (const err of output.errors ?? []) {
  if (err.severity === "error") hasError = true;
  console.log(`[${err.severity}] ${err.formattedMessage}`);
}
if (hasError) {
  console.error("\nCompilation failed.");
  process.exit(1);
}

function artifact(file, contract) {
  const c = output.contracts[file][contract];
  return {
    abi: c.abi,
    bytecode: `0x${c.evm.bytecode.object}`,
    deployedBytecode: `0x${c.evm.deployedBytecode.object}`,
  };
}

const identityArtifact = artifact("IdentityRegistry.sol", "IdentityRegistry");
const acArtifact = artifact("AgenticCommerce.sol", "AgenticCommerce");

console.log(`✅ IdentityRegistry bytecode:  ${(identityArtifact.bytecode.length - 2) / 2} bytes`);
console.log(`✅ AgenticCommerce bytecode:    ${(acArtifact.bytecode.length - 2) / 2} bytes`);

// Cache artifacts for the dApp to consume
const artifactsDir = path.resolve(process.cwd(), "contracts", "artifacts");
fs.mkdirSync(artifactsDir, { recursive: true });
fs.writeFileSync(path.join(artifactsDir, "IdentityRegistry.json"), JSON.stringify(identityArtifact, null, 2));
fs.writeFileSync(path.join(artifactsDir, "AgenticCommerce.json"), JSON.stringify(acArtifact, null, 2));
console.log(`✅ Artifacts cached to contracts/artifacts/`);

if (COMPILE_ONLY) {
  console.log("\n--compile-only: skipping deploy.");
  process.exit(0);
}

// ───────────── deploy ─────────────

const arcTestnet = defineChain({
  id: ARC_CHAIN_ID,
  name: "Arc Testnet",
  nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
  rpcUrls: {
    default: { http: [ARC_RPC_URL] },
    public: { http: [ARC_RPC_URL] },
  },
  testnet: true,
});

const account = privateKeyToAccount(DEPLOYER_PK.startsWith("0x") ? DEPLOYER_PK : `0x${DEPLOYER_PK}`);
const publicClient = createPublicClient({ chain: arcTestnet, transport: http(ARC_RPC_URL) });
const walletClient = createWalletClient({ account, chain: arcTestnet, transport: http(ARC_RPC_URL) });

console.log(`\n=== Deploying to Arc Testnet (chainId ${ARC_CHAIN_ID}) ===`);
console.log(`Deployer: ${account.address}`);
const balance = await publicClient.getBalance({ address: account.address });
console.log(`Deployer balance: ${Number(balance) / 1e18} (Arc USDC-as-gas, 18dp)`);
if (balance < 10n ** 15n) {
  console.error("Deployer has < 0.001 USDC gas; fund it first.");
  process.exit(1);
}

async function deploy(label, abi, bytecode, constructorArgs) {
  console.log(`\n>>> Deploying ${label} ...`);
  console.log(`    constructorArgs: ${JSON.stringify(constructorArgs, (_, v) => typeof v === "bigint" ? v.toString() : v)}`);
  const hash = await walletClient.deployContract({ abi, bytecode, args: constructorArgs });
  console.log(`    tx: ${hash}`);
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") {
    console.error(`    ❌ ${label} deploy reverted`);
    console.error(receipt);
    process.exit(1);
  }
  console.log(`    ✅ ${label} at ${receipt.contractAddress}`);
  console.log(`    gas used: ${receipt.gasUsed}  block: ${receipt.blockNumber}`);
  return { address: receipt.contractAddress, txHash: hash, blockNumber: Number(receipt.blockNumber), gasUsed: receipt.gasUsed.toString() };
}

const identityDeploy = await deploy(
  "IdentityRegistry",
  identityArtifact.abi,
  identityArtifact.bytecode,
  [account.address] // admin = deployer
);

const acDeploy = await deploy(
  "AgenticCommerce",
  acArtifact.abi,
  acArtifact.bytecode,
  [USDC_ADDRESS, identityDeploy.address, account.address] // paymentToken, identity, admin
);

// ───── Pre-register demo agent BEFORE handing admin to AgenticCommerce ─────
const DEMO_AGENT = process.env.ARC_AGENT_ADDRESS;
let demoAgentRegistration = null;
if (DEMO_AGENT && /^0x[0-9a-fA-F]{40}$/.test(DEMO_AGENT)) {
  console.log(`\n>>> Pre-registering demo agent ${DEMO_AGENT} ...`);
  try {
    const registerFor = await walletClient.writeContract({
      address: identityDeploy.address,
      abi: identityArtifact.abi,
      functionName: "registerFor",
      args: [DEMO_AGENT, "https://darwinia-on-arc.vercel.app/agents/darwinia-default.json"],
    });
    console.log(`    tx: ${registerFor}`);
    const r = await publicClient.waitForTransactionReceipt({ hash: registerFor });
    if (r.status === "success") {
      console.log(`    ✅ Demo agent registered (block ${r.blockNumber})`);
      demoAgentRegistration = { address: DEMO_AGENT, txHash: registerFor, blockNumber: Number(r.blockNumber) };
    } else {
      console.warn(`    ⚠️  registerFor reverted; agent NFT not minted`);
    }
  } catch (e) {
    console.warn(`    ⚠️  registerFor threw: ${e.shortMessage || e.message}`);
  }
} else {
  console.log("\n>>> Skipping demo-agent pre-register (ARC_AGENT_ADDRESS unset)");
}

console.log("\n>>> Granting AgenticCommerce admin role on IdentityRegistry ...");
const setAdminTxHash = await walletClient.writeContract({
  address: identityDeploy.address,
  abi: identityArtifact.abi,
  functionName: "setAdmin",
  args: [acDeploy.address],
});
console.log(`    tx: ${setAdminTxHash}`);
const setAdminReceipt = await publicClient.waitForTransactionReceipt({ hash: setAdminTxHash });
if (setAdminReceipt.status !== "success") {
  console.error("    ⚠️  setAdmin reverted — IdentityRegistry.admin still = deployer.");
  console.error("    AgenticCommerce.complete will silently skip reputation increment.");
  console.error("    Can be retried later.");
} else {
  console.log(`    ✅ IdentityRegistry.admin = AgenticCommerce (${acDeploy.address})`);
  console.log(`    NOTE: deployer can no longer call IdentityRegistry.registerFor or setAdmin`);
  console.log(`          directly. Use AgenticCommerce lifecycle or a new setAdmin via the`);
  console.log(`          AgenticCommerce owner path.`);
}

// ───────────── persist ─────────────

const deploymentsDir = path.resolve(process.cwd(), "deployments");
fs.mkdirSync(deploymentsDir, { recursive: true });
const out = {
  chainId: ARC_CHAIN_ID,
  network: "arc-testnet",
  deployedAt: new Date().toISOString(),
  deployer: account.address,
  usdc: USDC_ADDRESS,
  contracts: {
    IdentityRegistry: identityDeploy,
    AgenticCommerce: acDeploy,
  },
  demoAgentRegistration,
  adminGrant: {
    txHash: setAdminTxHash,
    status: setAdminReceipt.status,
  },
  abis: {
    IdentityRegistry: identityArtifact.abi,
    AgenticCommerce: acArtifact.abi,
  },
};
const outPath = path.join(deploymentsDir, "arc-testnet.json");
fs.writeFileSync(outPath, JSON.stringify(out, null, 2));
console.log(`\n✅ Wrote ${outPath}`);

// Append to .env.local (if not already present)
const envPath = path.resolve(process.cwd(), ".env.local");
let envBody = fs.existsSync(envPath) ? fs.readFileSync(envPath, "utf8") : "";
const upserts = [
  ["ARC_IDENTITY_REGISTRY", identityDeploy.address],
  ["NEXT_PUBLIC_ARC_IDENTITY_REGISTRY", identityDeploy.address],
  ["ARC_AGENTIC_COMMERCE", acDeploy.address],
  ["NEXT_PUBLIC_ARC_AGENTIC_COMMERCE", acDeploy.address],
];
for (const [k, v] of upserts) {
  const re = new RegExp(`^${k}=.*$`, "m");
  if (re.test(envBody)) {
    envBody = envBody.replace(re, `${k}=${v}`);
  } else {
    if (envBody.length && !envBody.endsWith("\n")) envBody += "\n";
    envBody += `${k}=${v}\n`;
  }
}
fs.writeFileSync(envPath, envBody);
console.log(`✅ Updated ${envPath} with ARC_IDENTITY_REGISTRY / ARC_AGENTIC_COMMERCE`);

console.log("\n=== Summary ===");
console.log(`IdentityRegistry:  ${identityDeploy.address}`);
console.log(`AgenticCommerce:   ${acDeploy.address}`);
console.log(`USDC (payment):    ${USDC_ADDRESS}`);
console.log(`Deployer:          ${account.address}`);
