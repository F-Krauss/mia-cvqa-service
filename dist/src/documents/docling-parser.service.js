"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var DoclingParserService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.DoclingParserService = void 0;
const common_1 = require("@nestjs/common");
let DoclingParserService = DoclingParserService_1 = class DoclingParserService {
    logger = new common_1.Logger(DoclingParserService_1.name);
    serviceUrl;
    apiKey;
    timeoutMs;
    constructor() {
        const raw = process.env.DOCLING_SERVICE_URL || '';
        this.serviceUrl = raw.trim() || null;
        this.apiKey = process.env.DOCLING_API_KEY || '';
        this.timeoutMs = Math.max(1000, Number(process.env.DOCLING_TIMEOUT_MS || 600_000));
        if (this.serviceUrl) {
            this.logger.log(`[Docling] Enabled → ${this.serviceUrl}`);
        }
        else {
            this.logger.log('[Docling] DOCLING_SERVICE_URL not set — Docling parsing disabled, fallback active');
        }
    }
    get isEnabled() {
        return !!this.serviceUrl;
    }
    async parseGcsDocument(gcsBucket, gcsPath) {
        if (!this.serviceUrl) {
            throw new Error('Docling service URL not configured');
        }
        const url = `${this.serviceUrl}/parse`.replace(/\/\//g, '/').replace('http:/', 'http://').replace('https:/', 'https://');
        this.logger.log(`[Docling] Requesting parse: gs://${gcsBucket}/${gcsPath}`);
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
        try {
            const response = await fetch(url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    ...(this.apiKey ? { 'x-api-key': this.apiKey } : {}),
                },
                body: JSON.stringify({ gcs_bucket: gcsBucket, gcs_path: gcsPath }),
                signal: controller.signal,
            });
            if (!response.ok) {
                const body = await response.text().catch(() => '');
                throw new Error(`Docling service returned ${response.status}: ${body}`);
            }
            const data = await response.json();
            this.logger.log(`[Docling] Parsed ${gcsPath}: ${data.page_count} pages, ${data.markdown?.length ?? 0} chars in ${data.parse_ms}ms`);
            return data.markdown ?? '';
        }
        catch (err) {
            if (err.name === 'AbortError') {
                throw new Error(`Docling parse timeout after ${this.timeoutMs}ms for ${gcsPath}`);
            }
            throw err;
        }
        finally {
            clearTimeout(timeout);
        }
    }
    async parsePdf(gcsBucket, gcsPath) {
        return this.parseGcsDocument(gcsBucket, gcsPath);
    }
};
exports.DoclingParserService = DoclingParserService;
exports.DoclingParserService = DoclingParserService = DoclingParserService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [])
], DoclingParserService);
//# sourceMappingURL=docling-parser.service.js.map