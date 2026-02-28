import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { CvqaModule } from './cvqa/cvqa.module';

@Module({
  imports: [
    PrismaModule,
    AuthModule,
    CvqaModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule { }
