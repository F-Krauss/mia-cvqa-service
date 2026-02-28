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
exports.AiUsageService = void 0;
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("../prisma/prisma.service");
let AiUsageService = class AiUsageService {
    prisma;
    constructor(prisma) {
        this.prisma = prisma;
    }
    async getUsage(filters) {
        const { organizationId, start, end, search, page = 1, limit = 20 } = filters;
        if (end < start) {
            throw new common_1.BadRequestException('end must be after start');
        }
        let candidateUserIds;
        if (search && search.trim().length > 0) {
            const users = await this.prisma.user.findMany({
                where: {
                    organizationId,
                    OR: [
                        { email: { contains: search, mode: 'insensitive' } },
                        { firstName: { contains: search, mode: 'insensitive' } },
                        { lastName: { contains: search, mode: 'insensitive' } },
                    ],
                },
                select: { id: true },
            });
            candidateUserIds = users.map((u) => u.id);
            if (candidateUserIds.length === 0) {
                return {
                    data: [],
                    summary: {
                        totalTokens: 0,
                        totalUsers: 0,
                        rangeStart: start.toISOString(),
                        rangeEnd: end.toISOString(),
                    },
                };
            }
        }
        const usageGroups = await this.prisma.aiUsageStat.groupBy({
            by: ['userId'],
            where: {
                organizationId,
                date: { gte: start, lte: end },
                ...(candidateUserIds ? { userId: { in: candidateUserIds } } : {}),
            },
            _sum: { tokens: true },
            _max: { lastQueryAt: true },
        });
        const totalUsers = usageGroups.length;
        const totalTokens = usageGroups.reduce((sum, item) => sum + (item._sum.tokens || 0), 0);
        const sorted = usageGroups.sort((a, b) => (b._sum.tokens || 0) - (a._sum.tokens || 0));
        const startIndex = Math.max(0, (page - 1) * limit);
        const paged = sorted.slice(startIndex, startIndex + limit);
        const userIds = paged.map((item) => item.userId);
        const [users, activeBlocks] = await Promise.all([
            this.prisma.user.findMany({
                where: { id: { in: userIds } },
                select: { id: true, email: true, firstName: true, lastName: true },
            }),
            this.prisma.aiUserBlock.findMany({
                where: {
                    organizationId,
                    userId: { in: userIds },
                    start: { lte: new Date() },
                    OR: [{ end: null }, { end: { gte: new Date() } }],
                },
                orderBy: { start: 'desc' },
            }),
        ]);
        const userMap = new Map(users.map((u) => [u.id, u]));
        const blockMap = new Map();
        activeBlocks.forEach((block) => {
            if (!blockMap.has(block.userId)) {
                blockMap.set(block.userId, block);
            }
        });
        const data = paged.map((item) => {
            const user = userMap.get(item.userId);
            const block = blockMap.get(item.userId);
            return {
                userId: item.userId,
                email: user?.email || 'Unknown',
                name: [user?.firstName, user?.lastName].filter(Boolean).join(' ') || undefined,
                tokens: item._sum.tokens || 0,
                lastQueryAt: item._max.lastQueryAt?.toISOString(),
                blocked: !!block,
                blockReason: block?.reason,
                blockStart: block?.start?.toISOString() || null,
                blockEnd: block?.end?.toISOString() || null,
            };
        });
        return {
            data,
            summary: {
                totalTokens,
                totalUsers,
                rangeStart: start.toISOString(),
                rangeEnd: end.toISOString(),
            },
        };
    }
    async blockUser(request) {
        const { organizationId, userId, start, end, reason } = request;
        await this.prisma.aiUserBlock.updateMany({
            where: {
                organizationId,
                userId,
                start: { lte: new Date() },
                OR: [{ end: null }, { end: { gte: new Date() } }],
            },
            data: { end: new Date() },
        });
        await this.prisma.aiUserBlock.create({
            data: { organizationId, userId, start, end, reason },
        });
    }
    async unblockUser(params) {
        const { organizationId, userId } = params;
        await this.prisma.aiUserBlock.updateMany({
            where: {
                organizationId,
                userId,
                start: { lte: new Date() },
                OR: [{ end: null }, { end: { gte: new Date() } }],
            },
            data: { end: new Date() },
        });
    }
    async ensureNotBlocked(userId, organizationId) {
        if (!userId || !organizationId)
            return null;
        const block = await this.prisma.aiUserBlock.findFirst({
            where: {
                userId,
                organizationId,
                start: { lte: new Date() },
                OR: [{ end: null }, { end: { gte: new Date() } }],
            },
            orderBy: { start: 'desc' },
        });
        if (block) {
            throw new common_1.BadRequestException(block.reason || 'AI usage is temporarily blocked for this user.');
        }
        return null;
    }
    async recordUsage(params) {
        const { userId, organizationId, tokens, occurredAt = new Date() } = params;
        if (!userId || !organizationId)
            return;
        const userExists = await this.prisma.user.findUnique({ where: { id: userId } });
        if (!userExists) {
            console.warn(`[AiUsageService] Skipping usage record: User ${userId} not found in DB`);
            return;
        }
        const dayStart = new Date(Date.UTC(occurredAt.getUTCFullYear(), occurredAt.getUTCMonth(), occurredAt.getUTCDate(), 0, 0, 0, 0));
        await this.prisma.aiUsageStat.upsert({
            where: { userId_date: { userId, date: dayStart } },
            create: {
                userId,
                organizationId,
                date: dayStart,
                tokens,
                lastQueryAt: occurredAt,
            },
            update: {
                tokens: { increment: tokens },
                lastQueryAt: occurredAt,
            },
        });
    }
};
exports.AiUsageService = AiUsageService;
exports.AiUsageService = AiUsageService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService])
], AiUsageService);
//# sourceMappingURL=ai-usage.service.js.map