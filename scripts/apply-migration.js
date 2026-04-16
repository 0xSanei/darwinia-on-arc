/**
 * Apply Supabase migration via direct PG connection.
 * Usage:
 *   node scripts/apply-migration.js <DATABASE_URL>
 *
 * DATABASE_URL from: Supabase Dashboard → Settings → Database → Connection string (URI)
 * Example:
 *   node scripts/apply-migration.js "postgresql://postgres.usvdvmtwagfvgxpqgxce:YOUR_DB_PASS@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres"
 */

'use strict';

const { Client } = require('pg');
const fs = require('fs');
const path = require('path');

const dbUrl = process.argv[2];
if (!dbUrl) {
  console.error('Usage: node scripts/apply-migration.js <DATABASE_URL>');
  console.error('Get DATABASE_URL from: Supabase Dashboard → Settings → Database → URI');
  process.exit(1);
}

const sqlFile = path.join(__dirname, '..', 'supabase', 'migrations', '20260415120000_create_darwinia_tables.sql');
const sql = fs.readFileSync(sqlFile, 'utf8');

async function run() {
  const client = new Client({
    connectionString: dbUrl,
    ssl: { rejectUnauthorized: false },
  });

  try {
    console.log('Connecting to Supabase...');
    await client.connect();
    console.log('Connected ✓');

    console.log('Applying migration...');
    await client.query(sql);
    console.log('Migration applied ✓');

    // Verify tables were created
    const { rows } = await client.query(`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name LIKE 'darwinia_%'
      ORDER BY table_name;
    `);
    console.log('\nTables created:');
    rows.forEach(r => console.log(' -', r.table_name));

    // Verify seed agent
    const agents = await client.query('SELECT id, name, wallet_address FROM public.darwinia_agents LIMIT 5;');
    console.log('\nAgents seeded:');
    agents.rows.forEach(r => console.log(` - ${r.name} (${r.wallet_address})`));

    console.log('\n✅ Setup complete! Run: npm run dev');
  } catch (err) {
    console.error('Migration failed:', err.message);
    process.exit(1);
  } finally {
    await client.end();
  }
}

run();
