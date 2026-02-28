import { PrismaService } from '../prisma/prisma.service';
export type AiUsageFilters = {
    organizationId: string;
    start: Date;
    end: Date;
    search?: string;
    page?: number;
    limit?: number;
};
export type AiBlockRequest = {
    organizationId: string;
    userId: string;
    start: Date;
    end?: Date;
    reason?: string;
};
export declare class AiUsageService {
    private readonly prisma;
    constructor(prisma: PrismaService);
    getUsage(filters: AiUsageFilters): Promise<{
        data: {
            userId: string;
            email: string;
            name: string | undefined;
            tokens: number;
            lastQueryAt: string | undefined;
            blocked: boolean;
            blockReason: string | null | undefined;
            blockStart: string | null;
            blockEnd: string | null;
        }[];
        summary: {
            totalTokens: number;
            totalUsers: number;
            rangeStart: string;
            rangeEnd: string;
        };
    }>;
    blockUser(request: AiBlockRequest): Promise<void>;
    unblockUser(params: {
        organizationId: string;
        userId: string;
    }): Promise<void>;
    ensureNotBlocked(userId: string | undefined, organizationId: string | undefined): Promise<null>;
    recordUsage(params: {
        userId?: string;
        organizationId?: string;
        tokens: number;
        occurredAt?: Date;
    }): Promise<void>;
}
