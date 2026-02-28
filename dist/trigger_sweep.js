"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const core_1 = require("@nestjs/core");
const app_module_1 = require("./src/app.module");
const vector_store_service_1 = require("./src/ai/vector-store.service");
async function bootstrap() {
    const app = await core_1.NestFactory.createApplicationContext(app_module_1.AppModule);
    const vectorStore = app.get(vector_store_service_1.VectorStoreService);
    console.log('Running processPendingEmbeddings...');
    const count = await vectorStore.processPendingEmbeddings(300);
    console.log(`Successfully generated embeddings for ${count} chunks.`);
    await app.close();
}
bootstrap().catch(console.error);
//# sourceMappingURL=trigger_sweep.js.map