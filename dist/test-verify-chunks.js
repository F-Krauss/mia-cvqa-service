"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const core_1 = require("@nestjs/core");
const app_module_1 = require("./src/app.module");
const prisma_service_1 = require("./src/prisma/prisma.service");
const common_1 = require("@nestjs/common");
async function bootstrap() {
    const logger = new common_1.Logger('VerifyChunks');
    const app = await core_1.NestFactory.createApplicationContext(app_module_1.AppModule);
    try {
        const prisma = app.get(prisma_service_1.PrismaService);
        const chunks = await prisma.documentChunk.findMany({
            where: { documentId: 'cmlrscd1r00021os634hxdn77' },
            select: { id: true, text: true }
        });
        logger.log(`Found ${chunks.length} chunks for document.`);
        if (chunks.length > 0) {
            console.log("\n------------------------");
            console.log("Sample Chunk 0 Content:\n------------------------");
            console.log(chunks[0].text);
            console.log("------------------------");
        }
    }
    catch (e) {
        logger.error(e);
    }
    finally {
        await app.close();
    }
}
bootstrap().catch(console.error);
//# sourceMappingURL=test-verify-chunks.js.map