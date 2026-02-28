"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.DocumentsModule = void 0;
const common_1 = require("@nestjs/common");
const documents_controller_1 = require("./documents.controller");
const documents_service_1 = require("./documents.service");
const document_ai_analyzer_service_1 = require("./document-ai-analyzer.service");
const document_indexing_service_1 = require("./document-indexing.service");
const docling_parser_service_1 = require("./docling-parser.service");
const auth_module_1 = require("../auth/auth.module");
const queue_module_1 = require("../queue/queue.module");
const ai_module_1 = require("../ai/ai.module");
let DocumentsModule = class DocumentsModule {
};
exports.DocumentsModule = DocumentsModule;
exports.DocumentsModule = DocumentsModule = __decorate([
    (0, common_1.Module)({
        imports: [auth_module_1.AuthModule, (0, common_1.forwardRef)(() => queue_module_1.QueueModule), (0, common_1.forwardRef)(() => ai_module_1.AiModule)],
        controllers: [documents_controller_1.DocumentsController],
        providers: [
            documents_service_1.DocumentsService,
            document_ai_analyzer_service_1.DocumentAiAnalyzerService,
            document_indexing_service_1.DocumentIndexingService,
            docling_parser_service_1.DoclingParserService,
        ],
        exports: [
            documents_service_1.DocumentsService,
            document_ai_analyzer_service_1.DocumentAiAnalyzerService,
            document_indexing_service_1.DocumentIndexingService,
            docling_parser_service_1.DoclingParserService,
        ],
    })
], DocumentsModule);
//# sourceMappingURL=documents.module.js.map