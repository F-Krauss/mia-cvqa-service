import { OnModuleDestroy, OnModuleInit } from '@nestjs/common';
declare const PrismaService_base: any;
export declare class PrismaService extends PrismaService_base implements OnModuleInit, OnModuleDestroy {
    private readonly pool;
    constructor();
    onModuleInit(): Promise<void>;
    onModuleDestroy(): Promise<void>;
}
export {};
