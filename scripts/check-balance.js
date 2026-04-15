// Check token balances on client + agent wallets.
// Uses Circle REST API directly (GET wallets/:id/balances).

const fs = require('fs');
const path = require('path');

const envPath = path.join(__dirname, '..', '.env.local');
const env = {};
fs.readFileSync(envPath, 'utf8')
  .split('\n')
  .forEach((line) => {
    if (line.startsWith('#') || !line.includes('=')) return;
    const [k, ...rest] = line.split('=');
    env[k.trim()] = rest.join('=').trim();
  });

const apiKey = env.CIRCLE_API_KEY;
const wallets = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'wallets.json'), 'utf8'));

const BASE = 'https://api.circle.com';
const headers = { Authorization: `Bearer ${apiKey}` };

async function getBalances(walletId) {
  const res = await fetch(`${BASE}/v1/w3s/wallets/${walletId}/balances`, { headers });
  if (!res.ok) throw new Error(`GET balances: ${res.status} ${await res.text()}`);
  return (await res.json()).data.tokenBalances || [];
}

async function main() {
  for (const role of ['client', 'agent']) {
    const w = wallets[role];
    console.log(`\n[${role}] ${w.address}`);
    const balances = await getBalances(w.id);
    if (balances.length === 0) {
      console.log('  (empty)');
      continue;
    }
    balances.forEach((b) => {
      console.log(`  ${b.amount} ${b.token.symbol} (${b.token.blockchain}${b.token.isNative ? ' native' : ''})`);
    });
  }
}

main().catch((err) => {
  console.error('Failed:', err.message);
  process.exit(1);
});
