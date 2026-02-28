import {
  CallHandler,
  ExecutionContext,
  Injectable,
  Logger,
  NestInterceptor,
} from '@nestjs/common';
import { Observable, catchError, throwError } from 'rxjs';

@Injectable()
export class ErrorLoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger(ErrorLoggingInterceptor.name);

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest();
    const method = request?.method;
    const url = request?.originalUrl || request?.url;

    return next.handle().pipe(
      catchError((error) => {
        const status = error?.status ?? error?.statusCode ?? 500;
        const message = error?.message ?? 'Unhandled error';
        const route = method && url ? `${method} ${url}` : 'Unknown request';
        this.logger.error(`${route} -> ${status} ${message}`, error?.stack);
        return throwError(() => error);
      }),
    );
  }
}
