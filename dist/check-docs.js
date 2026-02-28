"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const client_1 = require("@prisma/client");
const prisma = new client_1.PrismaClient();
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
//# sourceMappingURL=check-docs.js.map