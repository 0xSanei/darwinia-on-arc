/**
 * Apply Supabase migration via direct PG connection.
 * Usage:
 *   node scripts/apply-migration.js <DATABASE_URL> [migration-filename]
 *
 * DATABASE_URL from: Supabase Dashboard → Settings → Database → Connection string (URI)
 * If migration-filename is omitted, defaults to the original
 * 20260415120000_create_darwinia_tables.sql for backwards compat.
 *
 * Example:
 *   node scripts/apply-migration.js "postgresql://..." 20260418000000_add_onchain_agent_id.sql
 */

'use strict';

const { Client } = require('pg');
const fs = require('fs');
const path = require('path');

const dbUrl = process.argv[2];
const migrationName = process.argv[3] || '20260415120000_create_darwinia_tables.sql';
if (!dbUrl) {
  console.error('Usage: node scripts/apply-migration.js <DATABASE_URL> [migration-filename]');
  console.error('Get DATABASE_URL from: Supabase Dashboard → Settings → Database → URI');
  process.exit(1);
}

const sqlFile = path.join(__dirname, '..', 'supabase', 'migrations', migrationName);
if (!fs.existsSync(sqlFile)) {
  console.error(`Migration file not found: ${sqlFile}`);
  process.exit(1);
}
const sql = fs.readFileSync(sqlFile, 'utf8');
console.log(`Migration: ${migrationName}`);

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

    // Verify seed agent (include onchain_agent_id once column exists)
    const hasOnchain = (await client.query(`
      SELECT 1 FROM information_schema.columns
      WHERE table_schema='public' AND table_name='darwinia_agents' AND column_name='onchain_agent_id'
    `)).rowCount > 0;
    const agents = await client.query(
      `SELECT name, wallet_address${hasOnchain ? ', onchain_agent_id' : ''} FROM public.darwinia_agents LIMIT 5;`
    );
    console.log('\nAgents:');
    agents.rows.forEach(r => console.log(
      ` - ${r.name} (${r.wallet_address})${hasOnchain ? ` onchain_agent_id=${r.onchain_agent_id ?? 'null'}` : ''}`
    ));

    console.log('\n✅ Setup complete! Run: npm run dev');
  } catch (err) {
    console.error('Migration failed:', err.message);
    process.exit(1);
  } finally {
    await client.end();
  }
}

run();
