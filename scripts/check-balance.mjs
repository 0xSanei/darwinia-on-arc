// Quick balance check for Arc Testnet wallets
import { createPublicClient, http, formatUnits } from 'viem';
import fs from 'fs';
import path from 'path';

// Load .env.local
const envPath = path.join(process.cwd(), '.env.local');
fs.readFileSync(envPath, 'utf8').split('\n').forEach((line) => {
  const m = line.match(/^([^#=\s][^=]*)=(.+)$/);
  if (m) process.env[m[1].trim()] = m[2].trim();
});

const arcTestnet = {
  id: 5042002,
  name: 'Arc Testnet',
  nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 18 },
  rpcUrls: { default: { http: ['https://rpc.testnet.arc.network'] } },
};

const USDC = '0x3600000000000000000000000000000000000000';
const USDC_ABI = [
  { name: 'balanceOf', type: 'function', inputs: [{ name: 'a', type: 'address' }], outputs: [{ type: 'uint256' }], stateMutability: 'view' },
];

const client = createPublicClient({ chain: arcTestnet, transport: http() });

const wallets = {
  CLIENT: process.env.ARC_CLIENT_ADDRESS,
  AGENT: process.env.ARC_AGENT_ADDRESS,
};

console.log('Arc Testnet wallet balances:\n');
for (const [label, addr] of Object.entries(wallets)) {
  try {
    const native = await client.getBalance({ address: addr });
    const usdc = await client.readContract({ address: USDC, abi: USDC_ABI, functionName: 'balanceOf', args: [addr] });
    console.log(`  ${label} (${addr})`);
    console.log(`    native: ${formatUnits(native, 18)}`);
    console.log(`    USDC:   ${formatUnits(usdc, 6)}`);
  } catch (e) {
    console.log(`  ${label}: ERROR ${e.message}`);
  }
}

const need = 0.06; // 60 × 0.001 USDC
console.log(`\nNeeded for 60-tx demo: ${need} USDC client → agent (plus gas)`);
