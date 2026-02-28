"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
require("reflect-metadata");
const path = __importStar(require("node:path"));
const dotenv = __importStar(require("dotenv"));
const core_1 = require("@nestjs/core");
const app_module_1 = require("../src/app.module");
const ai_service_1 = require("../src/ai/ai.service");
const toBoolean = (value) => ['1', 'true', 'yes', 'y', 'on'].includes(value.trim().toLowerCase());
const parseArgs = () => {
    let limit = 100;
    let force = false;
    for (const arg of process.argv.slice(2)) {
        if (!arg.startsWith('--'))
            continue;
        const [rawKey, rawValue = ''] = arg.slice(2).split('=', 2);
        const key = rawKey.trim().toLowerCase();
        const value = rawValue.trim();
        if (key === 'limit') {
            const parsed = Number(value);
            if (Number.isFinite(parsed)) {
                limit = Math.max(1, Math.min(500, Math.round(parsed)));
            }
            continue;
        }
        if (key === 'force') {
            force = toBoolean(value || 'true');
        }
    }
    return { limit, force };
};
async function main() {
    dotenv.config({ path: path.resolve(process.cwd(), '.env') });
    dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });
    const args = parseArgs();
    const app = await core_1.NestFactory.createApplicationContext(app_module_1.AppModule, {
        logger: ['error', 'warn', 'log'],
    });
    try {
        const aiService = app.get(ai_service_1.AiService);
        const result = await aiService.backfillClosedWorkOrderReferences({
            limit: args.limit,
            force: args.force,
        });
        console.log(JSON.stringify({
            command: 'backfill-work-order-references',
            ...args,
            ...result,
        }, null, 2));
    }
    finally {
        await app.close();
    }
}
main().catch((error) => {
    console.error('[backfill-work-order-references] fatal:', error?.message || error);
    process.exit(1);
});
//# sourceMappingURL=backfill-work-order-references.js.map