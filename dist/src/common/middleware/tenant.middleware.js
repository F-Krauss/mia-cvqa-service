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
Object.defineProperty(exports, "__esModule", { value: true });
exports.TenantMiddleware = void 0;
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("../../prisma/prisma.service");
let TenantMiddleware = class TenantMiddleware {
    prisma;
    constructor(prisma) {
        this.prisma = prisma;
    }
    async use(req, res, next) {
        let organizationId = req.headers['x-organization-id'] ||
            req.query.organizationId ||
            req.user?.organizationId;
        if (!organizationId) {
            const defaultOrgId = process.env.DEFAULT_ORGANIZATION_ID;
            if (defaultOrgId) {
                const trimmed = defaultOrgId.trim();
                if (trimmed.length > 0 && trimmed.toUpperCase() !== 'NOT SET') {
                    organizationId = trimmed;
                }
            }
            if (!organizationId) {
                const firstOrg = await this.prisma.organization.findFirst({
                    where: { active: true },
                    select: { id: true },
                    orderBy: { createdAt: 'asc' },
                });
                if (firstOrg) {
                    organizationId = firstOrg.id;
                }
            }
        }
        if (!organizationId) {
            return prisma_service_1.requestContext.run({ organizationId: undefined }, () => next());
        }
        const organization = await this.prisma.organization.findFirst({
            where: {
                active: true,
                OR: [{ id: organizationId }, { name: organizationId }],
            },
            select: { id: true, active: true },
        });
        if (!organization || !organization.active) {
            throw new common_1.BadRequestException('Invalid or inactive organization');
        }
        req.organizationId = organization.id;
        req.organization = organization;
        prisma_service_1.requestContext.run({ organizationId: organization.id }, () => {
            next();
        });
    }
};
exports.TenantMiddleware = TenantMiddleware;
exports.TenantMiddleware = TenantMiddleware = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService])
], TenantMiddleware);
//# sourceMappingURL=tenant.middleware.js.map