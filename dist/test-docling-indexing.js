"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const core_1 = require("@nestjs/core");
const app_module_1 = require("./src/app.module");
const document_indexing_service_1 = require("./src/documents/document-indexing.service");
const common_1 = require("@nestjs/common");
async function bootstrap() {
    const logger = new common_1.Logger('TestDocling');
    const app = await core_1.NestFactory.createApplicationContext(app_module_1.AppModule);
    try {
        const indexingService = app.get(document_indexing_service_1.DocumentIndexingService);
        logger.log('Triggering Document Indexing for test PDF...');
        const testDocId = '85e09f58-cabb-4ea0-aec6-cf4c7674edec';
        const testOrgId = 'org_2nSgUfB8s8mQ4N4X9x0gV2rE1kZ';
        await indexingService.handleIndexingTask(testDocId, testOrgId);
        logger.log('Started Successfully! Check the logs for chunking and embedding processing.');
    }
    catch (e) {
        logger.error(e);
    }
    finally {
        await new Promise(resolve => setTimeout(resolve, 80000));
        await app.close();
    }
}
bootstrap().catch(console.error);
//# sourceMappingURL=test-docling-indexing.js.map