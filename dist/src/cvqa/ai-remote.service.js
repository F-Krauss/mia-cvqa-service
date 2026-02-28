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
var AiRemoteService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.AiRemoteService = void 0;
const common_1 = require("@nestjs/common");
let AiRemoteService = AiRemoteService_1 = class AiRemoteService {
    logger = new common_1.Logger(AiRemoteService_1.name);
    baseUrl;
    constructor() {
        const raw = process.env.AI_SERVICE_BASE_URL || '';
        this.baseUrl = raw.trim().replace(/\/+$/, '');
    }
    get enabled() {
        return this.baseUrl.length > 0;
    }
    async forward(req, body) {
        if (!this.enabled) {
            throw new Error('AI_SERVICE_BASE_URL is not configured.');
        }
        const originalUrl = req.originalUrl || req.url;
        const targetUrl = new URL(originalUrl, `${this.baseUrl}/`);
        const headers = new Headers();
        const authHeader = req.headers.authorization;
        if (authHeader) {
            headers.set('Authorization', Array.isArray(authHeader) ? authHeader[0] : authHeader);
        }
        const orgHeader = req.headers['x-organization-id'];
        const orgId = Array.isArray(orgHeader) ? orgHeader[0] : orgHeader;
        const fallbackOrgId = req.organizationId;
        const organizationId = orgId || fallbackOrgId;
        if (organizationId) {
            headers.set('x-organization-id', organizationId);
        }
        if (body !== undefined && !headers.has('Content-Type')) {
            headers.set('Content-Type', 'application/json');
        }
        const response = await fetch(targetUrl, {
            method: req.method,
            headers,
            body: body !== undefined ? JSON.stringify(body) : undefined,
        });
        const text = await response.text();
        if (!response.ok) {
            const message = this.extractErrorMessage(text) ||
                `AI service request failed (${response.status})`;
            this.logger.warn(`[AI Proxy] ${req.method} ${targetUrl.toString()} failed: ${message}`);
            throw new common_1.HttpException(message, response.status);
        }
        if (!text)
            return undefined;
        return JSON.parse(text);
    }
    extractErrorMessage(payload) {
        if (!payload)
            return undefined;
        try {
            const parsed = JSON.parse(payload);
            if (!parsed?.message)
                return payload;
            return Array.isArray(parsed.message)
                ? parsed.message.join(', ')
                : parsed.message;
        }
        catch {
            return payload;
        }
    }
};
exports.AiRemoteService = AiRemoteService;
exports.AiRemoteService = AiRemoteService = AiRemoteService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [])
], AiRemoteService);
//# sourceMappingURL=ai-remote.service.js.map