const { Client } = require('pg');

const client = new Client({
  connectionString: 'postgresql://postgres:vuvkis-pUbse7-siptan@db.ajxahzbpuczxpjfgwqpr.supabase.co:5432/postgres',
  ssl: { rejectUnauthorized: false }
});

async function main() {
  await client.connect();
  const res = await client.query(`
    set search_path to "mia-test";
    UPDATE "DocumentFile"
    SET "aiProcessingStatus" = 'pending', "embeddingStatus" = 'pending'
    WHERE "ragEnabled" = true
      AND "createdAt" > NOW() - INTERVAL '1 day'
      AND "aiProcessingStatus" != 'completed';
  `);
  console.log('Updated documents:', res[1] ? res[1].rowCount : res.rowCount);
  await client.end();
}

main().catch(console.error);
