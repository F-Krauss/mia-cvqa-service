import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const pendingDocs = await prisma.documentFile.findMany({
    where: { aiProcessingStatus: 'pending' },
    select: { id: true, originalName: true, aiProcessingStatus: true, createdAt: true }
  });
  console.log('Pending docs:', pendingDocs);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
