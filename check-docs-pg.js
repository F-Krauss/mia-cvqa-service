const { Client } = require('pg');

function getConnectionString() {
  return process.env.DATABASE_URL_DIRECT || process.env.DATABASE_URL;
}

function getSchema() {
  const schema = process.env.DATABASE_SCHEMA || 'mia-test';
  if (!/^[A-Za-z0-9_-]+$/.test(schema)) {
    throw new Error(`Invalid DATABASE_SCHEMA "${schema}"`);
  }
  return schema;
}

async function main() {
  const connectionString = getConnectionString();
  if (!connectionString) {
    throw new Error('Set DATABASE_URL or DATABASE_URL_DIRECT before running this script.');
  }

  const schema = getSchema();
  const client = new Client({
    connectionString,
    ssl: { rejectUnauthorized: false },
  });

  await client.connect();
  try {
    const res = await client.query(`
      set search_path to "${schema}";
      SELECT id, left("originalName", 20) as name, "aiProcessingStatus", "embeddingStatus", "ragEnabled", "createdAt"
      FROM "DocumentFile"
      ORDER BY "createdAt" DESC
      LIMIT 10;
    `);
    console.log('Result:', res[1] ? res[1].rows : res.rows);
  } finally {
    await client.end();
  }
}

main().catch(console.error);
