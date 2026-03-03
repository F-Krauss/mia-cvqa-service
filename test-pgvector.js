const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function test() {
  try {
    console.log('Testing pgvector extension...\n');

    // Check if pgvector extension exists
    const ext = await prisma.$queryRaw`
      SELECT extname, extversion 
      FROM pg_extension 
      WHERE extname = 'vector'
    `;
    
    if (ext && ext.length > 0) {
      console.log('✅ pgvector extension is ENABLED');
      console.log('   Version:', ext[0].extversion);
    } else {
      console.log('❌ pgvector extension is NOT installed');
      console.log('\nAttempting to enable pgvector...');
      try {
        await prisma.$executeRaw`CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA public`;
        console.log('✅ pgvector extension enabled successfully');
      } catch (err) {
        console.log('⚠️  Could not enable pgvector:', err.message);
      }
    }
    
    // Test cosine operator
    console.log('\nTesting cosine operator (<=>)...');
    try {
      const result = await prisma.$queryRaw`
        SELECT '[1,2,3]'::vector <=> '[1,2,3]'::vector as distance
      `;
      console.log('✅ pgvector cosine operator: WORKING');
      console.log('   Test result:', result[0]);
    } catch (err) {
      console.log('❌ pgvector cosine operator: FAILED');
      console.log('   Error:', err.message);
    }

    // Test Euclidean operator
    console.log('\nTesting Euclidean operator (<->)...');
    try {
      const result = await prisma.$queryRaw`
        SELECT '[1,2,3]'::vector <-> '[1,2,3]'::vector as distance
      `;
      console.log('✅ pgvector Euclidean operator: WORKING');
      console.log('   Test result:', result[0]);
    } catch (err) {
      console.log('❌ pgvector Euclidean operator: FAILED');
      console.log('   Error:', err.message);
    }

  } catch (error) {
    console.error('Fatal error:', error.message);
  } finally {
    await prisma.$disconnect();
  }
}

test();
