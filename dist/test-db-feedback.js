"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const client_1 = require("@prisma/client");
const prisma = new client_1.PrismaClient();
async function main() {
    const result = await prisma.aIFeedback.create({
        data: {
            userId: 'test_tech_001',
            organizationId: 'org_test_123',
            query: '[Bomba Centrifuga Alta Presion P-101] La bomba vibra excesivamente',
            response: 'Alinear el cople del motor/bomba - Se midió y estaba fuera de tolerancia',
            rating: 1,
            documentIds: []
        }
    });
    console.log('Record created:', result);
    const count = await prisma.aIFeedback.count();
    console.log('Total AIFeedback records: ', count);
}
main().catch(console.error).finally(() => prisma.$disconnect());
//# sourceMappingURL=test-db-feedback.js.map