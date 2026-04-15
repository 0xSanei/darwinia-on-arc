// Create WalletSet + 2 wallets on Arc testnet.
// Uses raw Circle REST API (SDK has internal http client bug on GET publicKey).
//
// Output: wallet IDs + addresses, saved to wallets.json (gitignored).

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');

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
const entitySecret = env.CIRCLE_ENTITY_SECRET;

if (!apiKey || !entitySecret) {
  console.error('Missing CIRCLE_API_KEY or CIRCLE_ENTITY_SECRET in .env.local');
  process.exit(1);
}

const BASE = 'https://api.circle.com';
const headers = {
  Authorization: `Bearer ${apiKey}`,
  'Content-Type': 'application/json',
};

// Fetch Circle's RSA public key (cached for this run)
async function getPublicKey() {
  const res = await fetch(`${BASE}/v1/w3s/config/entity/publicKey`, { headers });
  if (!res.ok) throw new Error(`GET publicKey: ${res.status} ${await res.text()}`);
  const { data } = await res.json();
  return data.publicKey;
}

// Each Circle API call requiring entitySecret needs a FRESH ciphertext — cannot reuse.
function generateCiphertext(publicKey) {
  const encrypted = crypto.publicEncrypt(
    {
      key: publicKey,
      oaepHash: 'sha256',
      padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
    },
    Buffer.from(entitySecret, 'hex'),
  );
  return encrypted.toString('base64');
}

async function post(url, body) {
  const res = await fetch(`${BASE}${url}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`POST ${url}: ${res.status} ${text}`);
  return JSON.parse(text);
}

async function main() {
  console.log('Fetching Circle public key...');
  const publicKey = await getPublicKey();
  console.log('  ok');

  // 1. Create wallet set
  console.log('\nCreating wallet set "darwinia-main"...');
  const setRes = await post('/v1/w3s/developer/walletSets', {
    name: 'darwinia-main',
    idempotencyKey: randomUUID(),
    entitySecretCiphertext: generateCiphertext(publicKey),
  });
  const walletSetId = setRes.data.walletSet.id;
  console.log('  walletSetId:', walletSetId);

  // 2. Create 2 wallets on Arc testnet
  console.log('\nCreating 2 wallets on ARC-TESTNET...');
  const walletsRes = await post('/v1/w3s/developer/wallets', {
    blockchains: ['ARC-TESTNET'],
    count: 2,
    walletSetId,
    accountType: 'EOA',
    idempotencyKey: randomUUID(),
    entitySecretCiphertext: generateCiphertext(publicKey),
  });
  const wallets = walletsRes.data.wallets;

  console.log('\n=== Wallets Created ===');
  wallets.forEach((w, i) => {
    const role = i === 0 ? 'client' : 'agent';
    console.log(`[${role}] id=${w.id}  address=${w.address}`);
  });

  // 3. Save to wallets.json
  const walletsData = {
    walletSetId,
    client: { id: wallets[0].id, address: wallets[0].address },
    agent: { id: wallets[1].id, address: wallets[1].address },
    createdAt: new Date().toISOString(),
  };
  fs.writeFileSync(path.join(__dirname, '..', 'wallets.json'), JSON.stringify(walletsData, null, 2));
  console.log('\nSaved to wallets.json');

  console.log('\n=== NEXT STEP ===');
  console.log('Fund the CLIENT wallet with Arc testnet USDC:');
  console.log(`  address: ${wallets[0].address}`);
  console.log('  faucet:  https://faucet.circle.com  (select ARC testnet + USDC)');
}

main().catch((err) => {
  console.error('Failed:', err.message);
  process.exit(1);
});
