"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.QueueModule = void 0;
const common_1 = require("@nestjs/common");
const cloud_tasks_service_1 = require("./cloud-tasks.service");
const task_queue_controller_1 = require("./task-queue.controller");
const documents_module_1 = require("../documents/documents.module");
const ai_module_1 = require("../ai/ai.module");
const prisma_module_1 = require("../prisma/prisma.module");
const pubsub_worker_service_1 = require("./pubsub-worker.service");
const ai_pubsub_service_1 = require("./ai-pubsub.service");
let QueueModule = class QueueModule {
};
exports.QueueModule = QueueModule;
exports.QueueModule = QueueModule = __decorate([
    (0, common_1.Module)({
        imports: [(0, common_1.forwardRef)(() => documents_module_1.DocumentsModule), prisma_module_1.PrismaModule, (0, common_1.forwardRef)(() => ai_module_1.AiModule)],
        providers: [cloud_tasks_service_1.CloudTasksService, pubsub_worker_service_1.PubSubWorkerService, ai_pubsub_service_1.AiPubSubService],
        exports: [cloud_tasks_service_1.CloudTasksService, pubsub_worker_service_1.PubSubWorkerService, ai_pubsub_service_1.AiPubSubService],
        controllers: [task_queue_controller_1.TaskQueueController],
    })
], QueueModule);
//# sourceMappingURL=queue.module.js.map