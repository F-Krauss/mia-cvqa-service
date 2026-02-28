"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.CvqaModule = void 0;
const common_1 = require("@nestjs/common");
const documents_module_1 = require("../documents/documents.module");
const history_module_1 = require("../history/history.module");
const approvals_module_1 = require("../approvals/approvals.module");
const prisma_module_1 = require("../prisma/prisma.module");
const queue_module_1 = require("../queue/queue.module");
const cvqa_controller_1 = require("./cvqa.controller");
const ai_remote_service_1 = require("./ai-remote.service");
const cvqa_service_1 = require("./cvqa.service");
const ai_usage_service_1 = require("./ai-usage.service");
const cache_service_1 = require("../common/cache.service");
let CvqaModule = class CvqaModule {
};
exports.CvqaModule = CvqaModule;
exports.CvqaModule = CvqaModule = __decorate([
    (0, common_1.Module)({
        imports: [(0, common_1.forwardRef)(() => documents_module_1.DocumentsModule), history_module_1.HistoryModule, approvals_module_1.ApprovalsModule, prisma_module_1.PrismaModule, (0, common_1.forwardRef)(() => queue_module_1.QueueModule)],
        controllers: [cvqa_controller_1.CvqaController],
        providers: [
            ai_remote_service_1.AiRemoteService,
            cvqa_service_1.CvqaService,
            ai_usage_service_1.AiUsageService,
            cache_service_1.CacheService,
        ],
        exports: [cvqa_service_1.CvqaService, cache_service_1.CacheService],
    })
], CvqaModule);
//# sourceMappingURL=cvqa.module.js.map