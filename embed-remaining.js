// Direct embedder for stalled chunks — runs locally against Vertex AI and writes to DB
// Usage: node embed-remaining.js
const { Client } = require('pg');
const { PredictionServiceClient, helpers } = require('@google-cloud/aiplatform');

const DB_URL = 'postgresql://postgres.ajxahzbpuczxpjfgwqpr:vuvkis-pUbse7-siptan@aws-0-us-west-2.pooler.supabase.com:6543/postgres?sslmode=no-verify';
const PROJECT = 'mia-test-ocr';
const LOCATION = 'us-central1';
const MODEL = `projects/${PROJECT}/locations/${LOCATION}/publishers/google/models/text-embedding-004`;
const BATCH = 5;

async function embedTexts(client, texts, taskType = 'RETRIEVAL_DOCUMENT') {
    const instances = texts.map(text => helpers.toValue({ content: text, taskType }));
    const [resp] = await client.predict({ endpoint: MODEL, instances, parameters: helpers.toValue({ outputDimensionality: 768 }) });
    return resp.predictions.map(p => {
        const vals = p.structValue.fields.embeddings.structValue.fields.values.listValue.values;
        return vals.map(v => v.numberValue);
    });
}

async function main() {
    const db = new Client({ connectionString: DB_URL });
    await db.connect();
    console.log('Connected to DB');

    const vertexClient = new PredictionServiceClient({ apiEndpoint: `${LOCATION}-aiplatform.googleapis.com` });

    // Fetch all remaining un-embedded chunks
    const { rows } = await db.query(`
    SELECT document_id, chunk_index, text
    FROM "mia-docs-vectors"."document_chunk_vectors"
    WHERE embedding IS NULL
    ORDER BY chunk_index
  `);

    if (rows.length === 0) { console.log('No pending chunks!'); await db.end(); return; }
    console.log(`Embedding ${rows.length} chunks in batches of ${BATCH}...`);

    let done = 0;
    for (let i = 0; i < rows.length; i += BATCH) {
        const batch = rows.slice(i, i + BATCH);
        const texts = batch.map(r => r.text);
        try {
            const embeddings = await embedTexts(vertexClient, texts);
            for (let j = 0; j < batch.length; j++) {
                const vec = '[' + embeddings[j].join(',') + ']';
                await db.query(
                    `UPDATE "mia-docs-vectors"."document_chunk_vectors" SET embedding = $1::public.vector WHERE document_id = $2 AND chunk_index = $3`,
                    [vec, batch[j].document_id, batch[j].chunk_index]
                );
                done++;
                console.log(`  ✅ chunk ${batch[j].chunk_index} embedded (${done}/${rows.length})`);
            }
        } catch (err) {
            console.error(`  ❌ Batch ${i}-${i + batch.length - 1} failed:`, err.message);
        }
        // Small pause between batches
        await new Promise(r => setTimeout(r, 1000));
    }

    // Mark document as completed if all done
    const { rows: remaining } = await db.query(`SELECT 1 FROM "mia-docs-vectors"."document_chunk_vectors" WHERE embedding IS NULL LIMIT 1`);
    if (remaining.length === 0) {
        await db.query(`UPDATE "mia-test"."DocumentFile" SET "embeddingStatus" = 'completed', "embeddingProcessedAt" = NOW() WHERE "embeddingStatus" IN ('pending', 'processing')`);
        console.log('✅ All chunks embedded, document marked as completed.');
    } else {
        console.log(`⚠️ Still ${remaining.length} chunk(s) missing.`);
    }

    await db.end();
    console.log('Done.');
}
main().catch(console.error);
