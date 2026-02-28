"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const document_ai_analyzer_service_1 = require("./document-ai-analyzer.service");
describe('DocumentAiAnalyzerService (image parsing)', () => {
    const originalVertexProjectId = process.env.VERTEX_PROJECT_ID;
    const originalFirebaseProjectId = process.env.FIREBASE_PROJECT_ID;
    beforeEach(() => {
        delete process.env.VERTEX_PROJECT_ID;
        delete process.env.FIREBASE_PROJECT_ID;
    });
    afterAll(() => {
        if (originalVertexProjectId !== undefined) {
            process.env.VERTEX_PROJECT_ID = originalVertexProjectId;
        }
        if (originalFirebaseProjectId !== undefined) {
            process.env.FIREBASE_PROJECT_ID = originalFirebaseProjectId;
        }
    });
    const createService = (doclingOverrides) => {
        const prisma = {};
        const vectorStore = {};
        const doclingParser = {
            isEnabled: true,
            parseGcsDocument: jest.fn().mockResolvedValue('ocr-text'),
            ...doclingOverrides,
        };
        const service = new document_ai_analyzer_service_1.DocumentAiAnalyzerService(prisma, vectorStore, doclingParser);
        return { service, doclingParser };
    };
    it('routes supported image MIME types through Docling parser', async () => {
        const { service, doclingParser } = createService();
        const result = await service.extractText(Buffer.from('image-bytes'), 'image/jpeg', 'mia-docs-test', 'documents/sample.jpg');
        expect(doclingParser.parseGcsDocument).toHaveBeenCalledWith('mia-docs-test', 'documents/sample.jpg');
        expect(result).toBe('ocr-text');
    });
    it('throws retryable error when Docling image parsing fails', async () => {
        const { service } = createService({
            parseGcsDocument: jest.fn().mockRejectedValue(new Error('timeout')),
        });
        await expect(service.extractText(Buffer.from('image-bytes'), 'image/png', 'mia-docs-test', 'documents/sample.png')).rejects.toThrow('Docling image parse failed');
    });
    it('throws retryable error when image parsing lacks Docling configuration', async () => {
        const { service } = createService({ isEnabled: false });
        let caughtError;
        try {
            await service.extractText(Buffer.from('image-bytes'), 'image/webp', 'mia-docs-test', 'documents/sample.webp');
        }
        catch (error) {
            caughtError = error;
        }
        expect(caughtError?.doclingImageRetryable).toBe(true);
        expect(String(caughtError?.message || '')).toContain('Docling image parsing requires');
    });
});
//# sourceMappingURL=document-ai-analyzer.service.spec.js.map