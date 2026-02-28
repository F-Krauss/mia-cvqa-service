"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_path_1 = __importDefault(require("node:path"));
const dotenv_1 = __importDefault(require("dotenv"));
const core_1 = require("@nestjs/core");
const swagger_1 = require("@nestjs/swagger");
const helmet_1 = __importDefault(require("helmet"));
const compression_1 = __importDefault(require("compression"));
const express_1 = require("express");
const app_module_1 = require("./app.module");
const prisma_exception_filter_1 = require("./common/filters/prisma-exception.filter");
const error_logging_interceptor_1 = require("./common/interceptors/error-logging.interceptor");
const google_auth_library_1 = require("google-auth-library");
const envRoot = process.cwd();
dotenv_1.default.config({ path: node_path_1.default.resolve(envRoot, '.env') });
const isProductionEnv = process.env.NODE_ENV === 'production';
if (!isProductionEnv) {
    dotenv_1.default.config({ path: node_path_1.default.resolve(envRoot, '.env.local'), override: true });
}
if (isProductionEnv) {
    dotenv_1.default.config({ path: node_path_1.default.resolve(envRoot, '.env.production') });
    dotenv_1.default.config({
        path: node_path_1.default.resolve(envRoot, '.env.production.local'),
        override: true,
    });
}
if (process.env.NODE_ENV === 'test' || process.env.USE_TEST_ENV === 'true') {
    dotenv_1.default.config({ path: node_path_1.default.resolve(envRoot, '.env.test'), override: true });
}
async function logAdcIdentity() {
    if (process.env.LOG_ADC_IDENTITY === 'false') {
        return;
    }
    try {
        const auth = new google_auth_library_1.GoogleAuth({
            scopes: ['https://www.googleapis.com/auth/cloud-platform'],
        });
        const creds = await auth.getCredentials();
        if (creds?.client_email) {
            console.log(`[GCP Auth] ADC client_email: ${creds.client_email}`);
        }
        else {
            console.warn('[GCP Auth] ADC client_email not available.');
        }
    }
    catch (error) {
        console.warn('[GCP Auth] Failed to resolve ADC identity:', error);
    }
}
async function bootstrap() {
    await logAdcIdentity();
    const app = await core_1.NestFactory.create(app_module_1.AppModule);
    app.enableShutdownHooks();
    app.useGlobalFilters(new prisma_exception_filter_1.PrismaExceptionFilter());
    app.useGlobalInterceptors(new error_logging_interceptor_1.ErrorLoggingInterceptor());
    const bodyLimit = process.env.REQUEST_BODY_LIMIT || '10mb';
    app.use((0, express_1.json)({ limit: bodyLimit }));
    app.use((0, express_1.urlencoded)({ extended: true, limit: bodyLimit }));
    const isProduction = process.env.NODE_ENV === 'production';
    if (process.env.TRUST_PROXY === 'true') {
        app.set('trust proxy', 1);
    }
    app.use((0, helmet_1.default)({
        contentSecurityPolicy: isProduction ? undefined : false,
    }));
    app.use((0, compression_1.default)());
    const allowedOriginsEnv = process.env.ALLOWED_ORIGINS;
    const allowedOrigins = allowedOriginsEnv
        ? allowedOriginsEnv
            .split(',')
            .map((origin) => origin.trim())
            .filter(Boolean)
        : [];
    if (!allowedOrigins.length && isProduction) {
        console.warn('[CORS] ALLOWED_ORIGINS is not set in production; falling back to localhost defaults.');
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
    const exactOrigins = new Set(corsOrigins.filter((origin) => !origin.includes('*')));
    const wildcardMatchers = corsOrigins
        .filter((origin) => origin.includes('*'))
        .map((origin) => {
        const escaped = origin.replace(/[.+?^${}()|[\]\\*]/g, '\\$&');
        const pattern = `^${escaped.replace(/\\\*/g, '.*')}$`;
        return new RegExp(pattern);
    });
    const isOriginAllowed = (origin) => {
        if (!origin)
            return true;
        if (allowAll)
            return true;
        if (exactOrigins.has(origin))
            return true;
        if (!hasWildcard)
            return false;
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
        const config = new swagger_1.DocumentBuilder()
            .setTitle('Intelligent Manufacturing Assistant API')
            .setDescription('API for manufacturing operations, audits, and AI assistance')
            .setVersion('1.0.0')
            .addBearerAuth({ type: 'http', scheme: 'bearer', bearerFormat: 'JWT' }, 'access-token')
            .addTag('Auth', 'Authentication endpoints')
            .addTag('Organizations', 'Organization management')
            .addTag('Users', 'User management')
            .addTag('Plants', 'Plant management')
            .addTag('Documents', 'Document management')
            .build();
        const document = swagger_1.SwaggerModule.createDocument(app, config);
        swagger_1.SwaggerModule.setup('api/docs', app, document);
    }
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
//# sourceMappingURL=main.js.map