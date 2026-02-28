const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function checkChunks() {
    const chunks = await prisma.documentChunk.findMany({
        where: { documentId: 'cmlrscd1r00021os634hxdn77' }, // Using the CUID logged in Cloud Run
        select: { id: true, content: true }
    });
    console.log(`Found ${chunks.length} chunks for document.`);
    if (chunks.length > 0) {
        console.log("------------------------");
        console.log("Sample Chunk 0 Content:");
        console.log("------------------------");
        console.log(chunks[0].content);
    }
}

checkChunks().catch(console.error).finally(() => prisma.$disconnect());
