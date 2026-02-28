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
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
var _a;
Object.defineProperty(exports, "__esModule", { value: true });
exports.CvqaController = void 0;
const common_1 = require("@nestjs/common");
const swagger_1 = require("@nestjs/swagger");
const cvqa_service_1 = require("./cvqa.service");
const jwt_auth_guard_1 = require("../auth/guards/jwt-auth.guard");
const ai_usage_service_1 = require("./ai-usage.service");
const ai_remote_service_1 = require("./ai-remote.service");
let CvqaController = class CvqaController {
    cvqaService;
    aiUsageService;
    aiRemoteService;
    constructor(cvqaService, aiUsageService, aiRemoteService) {
        this.cvqaService = cvqaService;
        this.aiUsageService = aiUsageService;
        this.aiRemoteService = aiRemoteService;
    }
    async verifyWorkInstructionStep(payload, req) {
        if (!payload?.goldenSampleUrl || !payload?.validationImageUrl) {
            throw new common_1.BadRequestException('goldenSampleUrl and validationImageUrl are required');
        }
        if (this.aiRemoteService.enabled) {
            return this.aiRemoteService.forward(req, payload);
        }
        const user = req.user;
        const organizationId = req.organizationId || user?.organizationId;
        return this.cvqaService.verifyWorkInstructionStep(payload, user, organizationId);
    }
};
exports.CvqaController = CvqaController;
__decorate([
    (0, common_1.Post)('verify-step'),
    (0, swagger_1.ApiOperation)({ summary: 'Verifies a work instruction step using Computer Vision QA' }),
    (0, swagger_1.ApiResponse)({ status: 200, description: 'Step verification complete' }),
    __param(0, (0, common_1.Body)()),
    __param(1, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], CvqaController.prototype, "verifyWorkInstructionStep", null);
exports.CvqaController = CvqaController = __decorate([
    (0, common_1.Controller)('ai'),
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard),
    __metadata("design:paramtypes", [typeof (_a = typeof cvqa_service_1.CvqaService !== "undefined" && cvqa_service_1.CvqaService) === "function" ? _a : Object, ai_usage_service_1.AiUsageService,
        ai_remote_service_1.AiRemoteService])
], CvqaController);
//# sourceMappingURL=cvqa.controller.js.map