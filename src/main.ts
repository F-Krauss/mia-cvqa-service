import path from 'node:path';
import dotenv from 'dotenv';
import { NestFactory } from '@nestjs/core';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import helmet from 'helmet';
import compression from 'compression';
import { json, urlencoded } from 'express';
import { AppModule } from './app.module';
import { ErrorLoggingInterceptor } from './common/interceptors/error-logging.interceptor';
import { GoogleAuth } from 'google-auth-library';

const envRoot = process.cwd();
dotenv.config({ path: path.resolve(envRoot, '.env') });

const isProductionEnv = process.env.NODE_ENV === 'production';

if (!isProductionEnv) {
  dotenv.config({ path: path.resolve(envRoot, '.env.local'), override: true });
}

if (isProductionEnv) {
  dotenv.config({ path: path.resolve(envRoot, '.env.production') });
  dotenv.config({
    path: path.resolve(envRoot, '.env.production.local'),
    override: true,
  });
}

if (process.env.NODE_ENV === 'test' || process.env.USE_TEST_ENV === 'true') {
  dotenv.config({ path: path.resolve(envRoot, '.env.test'), override: true });
}

async function logAdcIdentity() {
  if (process.env.LOG_ADC_IDENTITY === 'false') {
    return;
  }

  try {
    const auth = new GoogleAuth({
      scopes: ['https://www.googleapis.com/auth/cloud-platform'],
    });
    const creds = await auth.getCredentials();
    if (creds?.client_email) {
      console.log(`[GCP Auth] ADC client_email: ${creds.client_email}`);
    } else {
      console.warn('[GCP Auth] ADC client_email not available.');
    }
  } catch (error) {
    console.warn('[GCP Auth] Failed to resolve ADC identity:', error);
  }
}

async function bootstrap() {
  await logAdcIdentity();
  const app = await NestFactory.create(AppModule);
  app.enableShutdownHooks();
  app.useGlobalInterceptors(new ErrorLoggingInterceptor());
  const bodyLimit = process.env.REQUEST_BODY_LIMIT || '10mb';
  app.use(json({ limit: bodyLimit }));
  app.use(urlencoded({ extended: true, limit: bodyLimit }));

  const isProduction = process.env.NODE_ENV === 'production';

  if (process.env.TRUST_PROXY === 'true') {
    (app as any).set('trust proxy', 1);
  }

  app.use(
    helmet({
      contentSecurityPolicy: isProduction ? undefined : false,
    }),
  );
  app.use(compression());

  // Enable CORS with proper origin validation
  const allowedOriginsEnv = process.env.ALLOWED_ORIGINS;
  const allowedOrigins = allowedOriginsEnv
    ? allowedOriginsEnv
      .split(',')
      .map((origin) => origin.trim())
      .filter(Boolean)
    : [];

  if (!allowedOrigins.length && isProduction) {
    console.warn(
      '[CORS] ALLOWED_ORIGINS is not set in production; falling back to localhost defaults.',
    );
  }

  const corsOrigins = allowedOrigins.length
    ? allowedOrigins
    : [
      'http://localhost:5173',
      'http://localhost:3000',
      'http://localhost:3001',
    ];

  if (!isProduction) {
    console.log('[CORS] Allowed origins:', corsOrigins);
  }

  const hasWildcard = corsOrigins.some((origin) => origin.includes('*'));
  const allowAll = corsOrigins.includes('*');
  const exactOrigins = new Set(
    corsOrigins.filter((origin) => !origin.includes('*')),
  );
  const wildcardMatchers = corsOrigins
    .filter((origin) => origin.includes('*'))
    .map((origin) => {
      const escaped = origin.replace(/[.+?^${}()|[\]\\*]/g, '\\$&');
      const pattern = `^${escaped.replace(/\\\*/g, '.*')}$`;
      return new RegExp(pattern);
    });

  const isOriginAllowed = (origin?: string) => {
    if (!origin) return true;
    if (allowAll) return true;
    if (exactOrigins.has(origin)) return true;
    if (!hasWildcard) return false;
    return wildcardMatchers.some((matcher) => matcher.test(origin));
  };

  app.enableCors({
    origin: (origin, callback) => {
      if (isOriginAllowed(origin)) {
        callback(null, true);
        return;
      }
      callback(new Error('Not allowed by CORS'));
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
  });

  const enableSwagger = process.env.ENABLE_SWAGGER === 'true' || !isProduction;
  if (enableSwagger) {
    // Swagger Documentation
    const config = new DocumentBuilder()
      .setTitle('Intelligent Manufacturing Assistant API')
      .setDescription(
        'API for manufacturing operations, audits, and AI assistance',
      )
      .setVersion('1.0.0')
      .addBearerAuth(
        { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
        'access-token',
      )
      .addTag('Auth', 'Authentication endpoints')
      .addTag('Organizations', 'Organization management')
      .addTag('Users', 'User management')
      .addTag('Plants', 'Plant management')
      .addTag('Documents', 'Document management')
      .build();

    const document = SwaggerModule.createDocument(app, config);
    SwaggerModule.setup('api/docs', app, document);
  }

  // Global error handling
  const PORT = Number(process.env.PORT) || 8080;
  await app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Server running on port ${PORT}`);
    if (enableSwagger) {
      console.log(`📚 API docs available at http://localhost:${PORT}/api/docs`);
    }
  });
}

bootstrap().catch((err) => {
  console.error('❌ Bootstrap error:', err);
  process.exit(1);
});
