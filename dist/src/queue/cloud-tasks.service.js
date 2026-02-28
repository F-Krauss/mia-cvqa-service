"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var CloudTasksService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.CloudTasksService = void 0;
const common_1 = require("@nestjs/common");
const tasks_1 = require("@google-cloud/tasks");
let CloudTasksService = CloudTasksService_1 = class CloudTasksService {
    logger = new common_1.Logger(CloudTasksService_1.name);
    client = null;
    project = null;
    queue = null;
    location = null;
    taskApiUrl = null;
    constructor() {
        this.initializeClient();
    }
    initializeClient() {
        try {
            const projectId = process.env.GOOGLE_CLOUD_PROJECT || process.env.VERTEX_PROJECT_ID || process.env.FIREBASE_PROJECT_ID;
            const queueName = process.env.CLOUD_TASKS_QUEUE || 'document-indexing';
            const queueLocation = process.env.CLOUD_TASKS_LOCATION || 'us-central1';
            const apiUrl = process.env.CLOUD_TASKS_HANDLER_URL;
            if (!projectId) {
                this.logger.warn('GOOGLE_CLOUD_PROJECT not set. Cloud Tasks will be disabled.');
                return;
            }
            if (!apiUrl) {
                this.logger.warn('CLOUD_TASKS_HANDLER_URL not set. Cloud Tasks will be disabled.');
                return;
            }
            this.project = projectId;
            this.queue = queueName;
            this.location = queueLocation;
            this.taskApiUrl = apiUrl;
            this.client = new tasks_1.CloudTasksClient();
            this.logger.log(`Cloud Tasks initialized for project ${projectId}, queue ${queueName} in ${queueLocation}`);
        }
        catch (error) {
            this.logger.error(`Failed to initialize Cloud Tasks: ${error?.message || error}`);
        }
    }
    async queueDocumentIndexing(documentId, organizationId) {
        if (!this.client || !this.project || !this.queue || !this.location) {
            this.logger.warn(`Cloud Tasks not configured. Skipping queue for document ${documentId}`);
            return null;
        }
        try {
            const parent = this.client.queuePath(this.project, this.location, this.queue);
            const task = {
                httpRequest: {
                    headers: { 'Content-Type': 'application/json' },
                    body: Buffer.from(JSON.stringify({ documentId, organizationId })),
                    httpMethod: tasks_1.protos.google.cloud.tasks.v2.HttpMethod.POST,
                    url: `${this.taskApiUrl}/tasks/index-document`,
                    oidcToken: {
                        serviceAccountEmail: process.env.CLOUD_RUN_SERVICE_ACCOUNT || undefined,
                    },
                },
            };
            if (process.env.CLOUD_TASKS_SCHEDULE_DELAY_SECONDS) {
                const delaySeconds = parseInt(process.env.CLOUD_TASKS_SCHEDULE_DELAY_SECONDS, 10);
                const scheduleTime = new Date();
                scheduleTime.setSeconds(scheduleTime.getSeconds() + delaySeconds);
                task.scheduleTime = { seconds: Math.floor(scheduleTime.getTime() / 1000) };
            }
            const request = { parent, task };
            const [response] = await this.client.createTask(request);
            this.logger.log(`Document indexing task queued: ${response.name} for document ${documentId}`);
            return response.name || null;
        }
        catch (error) {
            this.logger.error(`Failed to queue document indexing task for ${documentId}: ${error?.message || error}`, error?.stack);
            return null;
        }
    }
    async queueWorkOrderIndexing(workOrderId, organizationId) {
        if (!this.client || !this.project || !this.queue || !this.location) {
            this.logger.warn(`Cloud Tasks not configured. Skipping queue for work order ${workOrderId}`);
            return null;
        }
        try {
            const parent = this.client.queuePath(this.project, this.location, this.queue);
            const task = {
                httpRequest: {
                    headers: { 'Content-Type': 'application/json' },
                    body: Buffer.from(JSON.stringify({ workOrderId, organizationId })),
                    httpMethod: tasks_1.protos.google.cloud.tasks.v2.HttpMethod.POST,
                    url: `${this.taskApiUrl}/tasks/index-work-order`,
                    oidcToken: {
                        serviceAccountEmail: process.env.CLOUD_RUN_SERVICE_ACCOUNT || undefined,
                    },
                },
            };
            if (process.env.CLOUD_TASKS_SCHEDULE_DELAY_SECONDS) {
                const delaySeconds = parseInt(process.env.CLOUD_TASKS_SCHEDULE_DELAY_SECONDS, 10);
                const scheduleTime = new Date();
                scheduleTime.setSeconds(scheduleTime.getSeconds() + delaySeconds);
                task.scheduleTime = { seconds: Math.floor(scheduleTime.getTime() / 1000) };
            }
            const request = { parent, task };
            const [response] = await this.client.createTask(request);
            this.logger.log(`Work order indexing task queued: ${response.name} for work order ${workOrderId}`);
            return response.name || null;
        }
        catch (error) {
            this.logger.error(`Failed to queue work order indexing task for ${workOrderId}: ${error?.message || error}`, error?.stack);
            return null;
        }
    }
    isAvailable() {
        return this.client !== null && this.project !== null;
    }
    getQueueInfo() {
        if (!this.project || !this.location || !this.queue) {
            return null;
        }
        return {
            project: this.project,
            location: this.location,
            queue: this.queue,
            url: this.taskApiUrl,
        };
    }
};
exports.CloudTasksService = CloudTasksService;
exports.CloudTasksService = CloudTasksService = CloudTasksService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [])
], CloudTasksService);
//# sourceMappingURL=cloud-tasks.service.js.map