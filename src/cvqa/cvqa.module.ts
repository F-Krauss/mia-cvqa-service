import { Module } from '@nestjs/common';
import { CvqaController } from './cvqa.controller';
import { CvqaService } from './cvqa.service';
import { CacheService } from '../common/cache.service';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  controllers: [CvqaController],
  imports: [PrismaModule],
  providers: [
    CvqaService,
    CacheService,
  ],
  exports: [CvqaService, CacheService],
})
export class CvqaModule { }
