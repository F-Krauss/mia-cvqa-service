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
      UPDATE "DocumentFile"
      SET "aiProcessingStatus" = 'pending', "embeddingStatus" = 'pending'
      WHERE "ragEnabled" = true
        AND "createdAt" > NOW() - INTERVAL '1 day'
        AND "aiProcessingStatus" != 'completed';
    `);
    console.log('Updated documents:', res[1] ? res[1].rowCount : res.rowCount);
  } finally {
    await client.end();
  }
}

main().catch(console.error);
