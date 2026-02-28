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
Object.defineProperty(exports, "__esModule", { value: true });
exports.HistoryService = void 0;
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("../prisma/prisma.service");
let HistoryService = class HistoryService {
    prisma;
    constructor(prisma) {
        this.prisma = prisma;
    }
    asDate(value) {
        if (!value)
            return undefined;
        const date = new Date(value);
        return Number.isNaN(date.getTime()) ? undefined : date;
    }
    async list() {
        return this.prisma.historyEvent.findMany({
            orderBy: { timestamp: 'desc' },
        });
    }
    async create(payload) {
        return this.prisma.historyEvent.create({
            data: {
                eventType: payload.eventType,
                title: payload.title,
                user: payload.user,
                timestamp: this.asDate(payload.timestamp) ?? new Date(),
                criticality: payload.criticality,
                details: payload.details ?? {},
                hierarchy: payload.hierarchy,
            },
        });
    }
};
exports.HistoryService = HistoryService;
exports.HistoryService = HistoryService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService])
], HistoryService);
//# sourceMappingURL=history.service.js.map