import { NestFactory } from '@nestjs/core';
import { AppModule } from './src/app.module';
import { PrismaService } from './src/prisma/prisma.service';
import { Logger } from '@nestjs/common';

async function bootstrap() {
    const logger = new Logger('VerifyChunks');
    const app = await NestFactory.createApplicationContext(AppModule);

    try {
        const prisma = app.get(PrismaService);
        const chunks = await prisma.documentChunk.findMany({
            where: { documentId: 'cmlrscd1r00021os634hxdn77' }, // Using the CUID logged in Cloud Run
            select: { id: true, text: true }
        });

        logger.log(`Found ${chunks.length} chunks for document.`);
        if (chunks.length > 0) {
            console.log("\n------------------------");
            console.log("Sample Chunk 0 Content:\n------------------------");
            console.log(chunks[0].text);
            console.log("------------------------");
        }
    } catch (e) {
        logger.error(e);
    } finally {
        await app.close();
    }
}

bootstrap().catch(console.error);
