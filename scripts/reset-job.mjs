// Reset a job to 'pending' and delete its iterations.
import fs from 'fs';
import path from 'path';

fs.readFileSync(path.join(process.cwd(), '.env.local'), 'utf8').split('\n').forEach((line) => {
  const m = line.match(/^([^#=\s][^=]*)=(.+)$/);
  if (m) process.env[m[1].trim()] = m[2].trim();
});

const JOB_ID = process.env.JOB_ID;
if (!JOB_ID) { console.error('JOB_ID required'); process.exit(1); }

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const headers = { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' };

// Delete iterations
let r = await fetch(`${URL}/rest/v1/darwinia_iterations?job_id=eq.${JOB_ID}`, { method: 'DELETE', headers });
console.log('delete iterations:', r.status);

// Delete payments
r = await fetch(`${URL}/rest/v1/darwinia_payments?job_id=eq.${JOB_ID}`, { method: 'DELETE', headers });
console.log('delete payments:', r.status);

// Reset job
r = await fetch(`${URL}/rest/v1/darwinia_jobs?id=eq.${JOB_ID}`, {
  method: 'PATCH', headers,
  body: JSON.stringify({ status: 'pending', agent_id: null, completed_at: null }),
});
console.log('reset job:', r.status);
