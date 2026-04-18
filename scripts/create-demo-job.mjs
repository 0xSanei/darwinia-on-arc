// Create a 60-generation demo job via Supabase REST (service role)
import fs from 'fs';
import path from 'path';

fs.readFileSync(path.join(process.cwd(), '.env.local'), 'utf8').split('\n').forEach((line) => {
  const m = line.match(/^([^#=\s][^=]*)=(.+)$/);
  if (m) process.env[m[1].trim()] = m[2].trim();
});

const URL_BASE = process.env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const headers = {
  apikey: KEY,
  Authorization: `Bearer ${KEY}`,
  'Content-Type': 'application/json',
  Prefer: 'return=representation',
};

// Find a user_id from existing jobs (or first auth user)
let uid;
const exist = await fetch(`${URL_BASE}/rest/v1/darwinia_jobs?select=user_id&limit=1`, { headers }).then((r) => r.json());
if (exist.length) {
  uid = exist[0].user_id;
  console.log('using user_id from existing job:', uid);
} else {
  console.error('No existing jobs to derive user_id; pass UID via env USER_ID=');
  uid = process.env.USER_ID;
  if (!uid) process.exit(1);
}

const body = {
  user_id: uid,
  title: 'Hackathon 60-gen Demo',
  description: 'BTC/USDT strategy evolution — 60 generations for 50+ on-chain tx demo',
  target_symbol: 'BTC/USDT',
  max_generations: 60,
  population_size: 50,
  budget_usdc: 0.1,
  price_per_iteration_usdc: 0.001,
  client_wallet_id: 'eoa-old-wallet',
  client_wallet_address: process.env.ARC_CLIENT_ADDRESS,
};

const created = await fetch(`${URL_BASE}/rest/v1/darwinia_jobs`, {
  method: 'POST',
  headers,
  body: JSON.stringify(body),
}).then((r) => r.json());

console.log('created job:');
console.log(JSON.stringify(created, null, 2));
