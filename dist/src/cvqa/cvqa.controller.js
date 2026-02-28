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
Object.defineProperty(exports, "__esModule", { value: true });
exports.CvqaController = void 0;
const common_1 = require("@nestjs/common");
const swagger_1 = require("@nestjs/swagger");
const cvqa_service_1 = require("./cvqa.service");
const jwt_auth_guard_1 = require("../auth/guards/jwt-auth.guard");
const platform_express_1 = require("@nestjs/platform-express");
let CvqaController = class CvqaController {
    cvqaService;
    constructor(cvqaService) {
        this.cvqaService = cvqaService;
    }
    async compareVisionQuality(files, paramsString, req) {
        if (!files?.object_file?.[0] && !files?.manual?.[0]) {
            throw new common_1.BadRequestException('At least object_file or manual is required');
        }
        const user = req.user;
        const organizationId = req.organizationId || user?.organizationId;
        return this.cvqaService.compareVisionQuality(files, paramsString, user, organizationId);
    }
};
exports.CvqaController = CvqaController;
__decorate([
    (0, common_1.Post)('vision/compare'),
    (0, swagger_1.ApiOperation)({ summary: 'Compare vision quality using manual, object, and golden files' }),
    (0, swagger_1.ApiResponse)({ status: 200, description: 'Comparison complete' }),
    (0, common_1.UseInterceptors)((0, platform_express_1.FileFieldsInterceptor)([
        { name: 'manual', maxCount: 1 },
        { name: 'object_file', maxCount: 1 },
        { name: 'golden', maxCount: 1 },
    ])),
    __param(0, (0, common_1.UploadedFiles)()),
    __param(1, (0, common_1.Body)('params')),
    __param(2, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, Object]),
    __metadata("design:returntype", Promise)
], CvqaController.prototype, "compareVisionQuality", null);
exports.CvqaController = CvqaController = __decorate([
    (0, common_1.Controller)('ai'),
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard),
    __metadata("design:paramtypes", [cvqa_service_1.CvqaService])
], CvqaController);
//# sourceMappingURL=cvqa.controller.js.map