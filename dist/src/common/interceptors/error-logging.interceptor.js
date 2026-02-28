"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var ErrorLoggingInterceptor_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.ErrorLoggingInterceptor = void 0;
const common_1 = require("@nestjs/common");
const rxjs_1 = require("rxjs");
let ErrorLoggingInterceptor = ErrorLoggingInterceptor_1 = class ErrorLoggingInterceptor {
    logger = new common_1.Logger(ErrorLoggingInterceptor_1.name);
    intercept(context, next) {
        const request = context.switchToHttp().getRequest();
        const method = request?.method;
        const url = request?.originalUrl || request?.url;
        return next.handle().pipe((0, rxjs_1.catchError)((error) => {
            const status = error?.status ?? error?.statusCode ?? 500;
            const message = error?.message ?? 'Unhandled error';
            const route = method && url ? `${method} ${url}` : 'Unknown request';
            this.logger.error(`${route} -> ${status} ${message}`, error?.stack);
            return (0, rxjs_1.throwError)(() => error);
        }));
    }
};
exports.ErrorLoggingInterceptor = ErrorLoggingInterceptor;
exports.ErrorLoggingInterceptor = ErrorLoggingInterceptor = ErrorLoggingInterceptor_1 = __decorate([
    (0, common_1.Injectable)()
], ErrorLoggingInterceptor);
//# sourceMappingURL=error-logging.interceptor.js.map