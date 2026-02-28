import { OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { AsyncLocalStorage } from 'async_hooks';
export declare const requestContext: AsyncLocalStorage<{
    organizationId?: string;
}>;
export declare class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
    private readonly pool;
    constructor();
    onModuleInit(): Promise<void>;
    onModuleDestroy(): Promise<void>;
}
