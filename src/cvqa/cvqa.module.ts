import { Module } from '@nestjs/common';
import { CvqaController } from './cvqa.controller';
import { CvqaService } from './cvqa.service';
import { CacheService } from '../common/cache.service';

@Module({
  controllers: [CvqaController],
  providers: [
    CvqaService,
    CacheService,
  ],
  exports: [CvqaService, CacheService],
})
export class CvqaModule { }
