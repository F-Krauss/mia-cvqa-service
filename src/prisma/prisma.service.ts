import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';

// @ts-ignore
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends (PrismaClient as any) implements OnModuleInit, OnModuleDestroy {
  constructor() {
    super({
      datasources: {
        db: {
          url: process.env.DATABASE_URL_DIRECT || process.env.DATABASE_URL,
        },
      },
    });
  }

  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
