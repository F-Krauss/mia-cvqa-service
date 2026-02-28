"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const core_1 = require("@nestjs/core");
const app_module_1 = require("./src/app.module");
const vector_store_service_1 = require("./src/ai/vector-store.service");
const common_1 = require("@nestjs/common");
async function bootstrap() {
    const logger = new common_1.Logger('TestEmbeddings');
    try {
        const app = await core_1.NestFactory.createApplicationContext(app_module_1.AppModule);
        const vectorStore = app.get(vector_store_service_1.VectorStoreService);
        logger.log('Starting pending embeddings process');
        const count = await vectorStore.processPendingEmbeddings(300);
        logger.log(`Successfully embedded ${count} chunks`);
        await app.close();
    }
    catch (err) {
        logger.error('Error in bootstrap:', err);
    }
}
bootstrap().catch(console.error);
//# sourceMappingURL=test-embeddings.js.map