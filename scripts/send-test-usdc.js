// End-to-end USDC transfer test: old wallet → agent wallet on Arc testnet.
// Uses viem with raw ERC-20 transfer (not x402 yet — that comes later).
// Verifies: private key, Arc RPC, USDC contract, gas all work.
//
// Usage: node scripts/send-test-usdc.js [amount_usdc]
// Default: 0.1 USDC

const fs = require('fs');
const path = require('path');

// Load .env.local
const env = {};
fs.readFileSync(path.join(__dirname, '..', '.env.local'), 'utf8')
  .split('\n')
  .forEach((line) => {
    const m = line.match(/^([^#=\s][^=]*)=(.+)$/);
    if (m) env[m[1].trim()] = m[2].trim();
  });

const {
  createWalletClient, createPublicClient, http, parseUnits, formatUnits, parseAbi
} = require('viem');
const { privateKeyToAccount } = require('viem/accounts');

const arcTestnet = {
  id: Number(env.ARC_CHAIN_ID),
  name: 'Arc Testnet',
  nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 18 },
  rpcUrls: { default: { http: [env.ARC_RPC_URL] } },
};

const USDC = env.ARC_USDC_CONTRACT;
const AMOUNT = process.argv[2] || '0.1';
const TO = env.ARC_AGENT_ADDRESS;

const ABI = parseAbi([
  'function transfer(address to, uint256 amount) returns (bool)',
  'function balanceOf(address) view returns (uint256)',
]);

async function main() {
  const privateKey = env.ARC_CLIENT_PRIVATE_KEY.startsWith('0x')
    ? env.ARC_CLIENT_PRIVATE_KEY
    : '0x' + env.ARC_CLIENT_PRIVATE_KEY;

  const account = privateKeyToAccount(privateKey);
  console.log('From:', account.address);
  console.log('To:  ', TO);
  console.log('Amount:', AMOUNT, 'USDC');

  const publicClient = createPublicClient({ chain: arcTestnet, transport: http() });
  const walletClient = createWalletClient({ account, chain: arcTestnet, transport: http() });

  // Check balance before
  const balBefore = await publicClient.readContract({
    address: USDC, abi: ABI, functionName: 'balanceOf', args: [account.address],
  });
  console.log('\nBalance before:', formatUnits(balBefore, 6), 'USDC');

  if (balBefore === 0n) {
    console.error('ERROR: client wallet has no USDC');
    process.exit(1);
  }

  // Send transfer
  console.log('\nSending transaction...');
  const hash = await walletClient.writeContract({
    address: USDC,
    abi: ABI,
    functionName: 'transfer',
    args: [TO, parseUnits(AMOUNT, 6)],
  });
  console.log('txHash:', hash);
  console.log('Explorer: https://explorer.testnet.arc.network/tx/' + hash);

  // Wait for receipt
  console.log('\nWaiting for confirmation...');
  const receipt = await publicClient.waitForTransactionReceipt({ hash, timeout: 60_000 });
  console.log('Status:', receipt.status === 'success' ? '✅ SUCCESS' : '❌ FAILED');
  console.log('Block:', receipt.blockNumber.toString());

  // Check balance after
  const balAfter = await publicClient.readContract({
    address: USDC, abi: ABI, functionName: 'balanceOf', args: [account.address],
  });
  console.log('\nBalance after:', formatUnits(balAfter, 6), 'USDC');
  console.log('Sent:', formatUnits(balBefore - balAfter, 6), 'USDC');
}

main().catch((err) => { console.error(err.message); process.exit(1); });
