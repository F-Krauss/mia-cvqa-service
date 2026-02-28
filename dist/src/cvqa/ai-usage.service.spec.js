"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const common_1 = require("@nestjs/common");
const ai_usage_service_1 = require("./ai-usage.service");
describe('AiUsageService', () => {
    const now = new Date('2026-01-10T12:34:56Z');
    const makeService = () => {
        const state = {
            blocks: [],
            usageStats: new Map(),
            users: new Map(),
        };
        const prisma = {
            aiUserBlock: {
                findFirst: jest.fn(async (args) => {
                    const userId = args.where.userId;
                    const orgId = args.where.organizationId;
                    const startLte = args.where.start.lte;
                    const endCond = args.where.OR;
                    return state.blocks
                        .filter((b) => b.userId === userId && b.organizationId === orgId)
                        .find((b) => b.start <= startLte && (!b.end || b.end >= startLte)) || null;
                }),
                findMany: jest.fn(async (args) => {
                    const orgId = args.where.organizationId;
                    const userIds = args.where.userId.in;
                    const startLte = args.where.start.lte;
                    return state.blocks.filter((b) => b.organizationId === orgId && userIds.includes(b.userId) && b.start <= startLte && (!b.end || b.end >= startLte));
                }),
                updateMany: jest.fn(async (args) => {
                    const orgId = args.where.organizationId;
                    const userId = args.where.userId;
                    const startLte = args.where.start.lte;
                    state.blocks.forEach((b) => {
                        if (b.organizationId === orgId && b.userId === userId && b.start <= startLte && (!b.end || b.end >= startLte)) {
                            b.end = new Date();
                        }
                    });
                    return { count: 1 };
                }),
                create: jest.fn(async (args) => {
                    state.blocks.push({ id: 'blk1', ...args.data });
                    return args.data;
                }),
            },
            aiUsageStat: {
                groupBy: jest.fn(async (args) => {
                    const orgId = args.where.organizationId;
                    const dateGte = args.where.date.gte;
                    const dateLte = args.where.date.lte;
                    const byUserId = Array.from(state.usageStats.entries())
                        .filter(([key]) => key.startsWith(orgId + ':'))
                        .map(([key, val]) => ({ userId: key.split(':')[1], tokens: val.tokens, lastQueryAt: val.lastQueryAt }))
                        .filter((u) => dateGte <= (u.lastQueryAt || now) && (u.lastQueryAt || now) <= dateLte)
                        .map((u) => ({ userId: u.userId, _sum: { tokens: u.tokens }, _max: { lastQueryAt: u.lastQueryAt } }));
                    return byUserId;
                }),
                upsert: jest.fn(async (args) => {
                    const { userId, date } = args.where.userId_date;
                    const key = `${args.create.organizationId}:${userId}`;
                    const existing = state.usageStats.get(key) || { tokens: 0 };
                    const inc = args.update.tokens?.increment || args.create.tokens || 0;
                    const lastQueryAt = args.update.lastQueryAt || args.create.lastQueryAt;
                    state.usageStats.set(key, { tokens: existing.tokens + inc, lastQueryAt });
                    return {};
                }),
            },
            user: {
                findMany: jest.fn(async (args) => {
                    return args.where.id.in.map((id) => {
                        const u = state.users.get(id) || { id, email: `user-${id}@example.com`, firstName: 'Ana', lastName: 'Lopez' };
                        return u;
                    });
                }),
            },
        };
        const service = new ai_usage_service_1.AiUsageService(prisma);
        return { service, prisma, state };
    };
    it('ensureNotBlocked allows when no active block, throws when blocked', async () => {
        const { service, state } = makeService();
        await expect(service.ensureNotBlocked('u1', 'org1')).resolves.toBeNull();
        state.blocks.push({ userId: 'u1', organizationId: 'org1', start: new Date('2026-01-01T00:00:00Z'), end: null, reason: 'Limit' });
        await expect(service.ensureNotBlocked('u1', 'org1')).rejects.toBeInstanceOf(common_1.BadRequestException);
    });
    it('recordUsage aggregates per UTC day and increments tokens', async () => {
        const { service, prisma, state } = makeService();
        const occurredAt = new Date('2026-01-10T12:00:00Z');
        await service.recordUsage({ userId: 'u2', organizationId: 'org2', tokens: 10, occurredAt });
        await service.recordUsage({ userId: 'u2', organizationId: 'org2', tokens: 5, occurredAt });
        const key = 'org2:u2';
        expect(state.usageStats.get(key)?.tokens).toBe(15);
        expect(prisma.aiUsageStat.upsert).toHaveBeenCalled();
    });
    it('getUsage aggregates, paginates, and decorates block info', async () => {
        const { service, state } = makeService();
        state.users.set('uA', { id: 'uA', email: 'ana@example.com', firstName: 'Ana', lastName: 'Lopez' });
        state.users.set('uB', { id: 'uB', email: 'bruno@example.com', firstName: 'Bruno', lastName: 'Diaz' });
        state.usageStats.set('orgX:uA', { tokens: 120, lastQueryAt: new Date('2026-01-09T10:00:00Z') });
        state.usageStats.set('orgX:uB', { tokens: 30, lastQueryAt: new Date('2026-01-08T10:00:00Z') });
        state.blocks.push({ userId: 'uA', organizationId: 'orgX', start: new Date('2026-01-05T00:00:00Z'), end: null, reason: 'Budget' });
        const result = await service.getUsage({
            organizationId: 'orgX',
            start: new Date('2026-01-01T00:00:00Z'),
            end: new Date('2026-01-10T23:59:59Z'),
            page: 1,
            limit: 10,
        });
        expect(result.summary.totalUsers).toBe(2);
        expect(result.summary.totalTokens).toBe(150);
        const ana = result.data.find((d) => d.userId === 'uA');
        const bruno = result.data.find((d) => d.userId === 'uB');
        expect(ana?.blocked).toBe(true);
        expect(ana?.blockReason).toBe('Budget');
        expect(bruno?.blocked).toBe(false);
    });
});
//# sourceMappingURL=ai-usage.service.spec.js.map