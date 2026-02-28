const { Client } = require('pg');

const client = new Client({
  connectionString: 'postgresql://postgres:vuvkis-pUbse7-siptan@db.ajxahzbpuczxpjfgwqpr.supabase.co:5432/postgres',
  ssl: { rejectUnauthorized: false }
});

async function main() {
  await client.connect();
  const res = await client.query(`
    set search_path to "mia-test";
    SELECT id, left("originalName", 20) as name, "aiProcessingStatus", "embeddingStatus", "ragEnabled", "createdAt"
    FROM "DocumentFile"
    ORDER BY "createdAt" DESC
    LIMIT 10;
  `);
  console.log('Result:', res[1] ? res[1].rows : res.rows);
  await client.end();
}

main().catch(console.error);
