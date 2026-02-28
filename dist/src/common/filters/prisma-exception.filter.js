"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.PrismaExceptionFilter = void 0;
const common_1 = require("@nestjs/common");
const client_1 = require("@prisma/client");
let PrismaExceptionFilter = class PrismaExceptionFilter {
    catch(exception, host) {
        const ctx = host.switchToHttp();
        const response = ctx.getResponse();
        const request = ctx.getRequest();
        let status = common_1.HttpStatus.INTERNAL_SERVER_ERROR;
        let message = 'Database error';
        if (exception instanceof client_1.Prisma.PrismaClientKnownRequestError) {
            switch (exception.code) {
                case 'P2002':
                    status = common_1.HttpStatus.CONFLICT;
                    message = 'Duplicate record.';
                    break;
                case 'P2021':
                    status = common_1.HttpStatus.SERVICE_UNAVAILABLE;
                    message =
                        'Database schema is not initialized. Run `npx prisma db push` or `npx prisma migrate deploy`.';
                    break;
                case 'P2025':
                    status = common_1.HttpStatus.NOT_FOUND;
                    message = 'Record not found.';
                    break;
                default:
                    message = 'Database request failed.';
                    break;
            }
        }
        else if (exception instanceof client_1.Prisma.PrismaClientInitializationError) {
            status = common_1.HttpStatus.SERVICE_UNAVAILABLE;
            message = 'Database connection failed.';
        }
        else if (exception instanceof client_1.Prisma.PrismaClientRustPanicError) {
            status = common_1.HttpStatus.INTERNAL_SERVER_ERROR;
            message = 'Database engine panic.';
        }
        else if (exception instanceof client_1.Prisma.PrismaClientUnknownRequestError) {
            status = common_1.HttpStatus.INTERNAL_SERVER_ERROR;
            message = 'Unknown database error.';
        }
        response.status(status).json({
            statusCode: status,
            message,
            error: 'DatabaseError',
            path: request.url,
            timestamp: new Date().toISOString(),
        });
    }
};
exports.PrismaExceptionFilter = PrismaExceptionFilter;
exports.PrismaExceptionFilter = PrismaExceptionFilter = __decorate([
    (0, common_1.Catch)(client_1.Prisma.PrismaClientKnownRequestError, client_1.Prisma.PrismaClientInitializationError, client_1.Prisma.PrismaClientRustPanicError, client_1.Prisma.PrismaClientUnknownRequestError)
], PrismaExceptionFilter);
//# sourceMappingURL=prisma-exception.filter.js.map