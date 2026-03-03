import { ExecutionContext, Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { isAuthDisabled } from '../auth.utils';

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  canActivate(context: ExecutionContext) {
    if (isAuthDisabled()) {
      const req = context.switchToHttp().getRequest();
      if (!req.user) {
        req.user = {
          id: 'local-dev-user',
          sub: 'local-dev-user',
          email: 'local@dev.local',
          firstName: 'Local',
          lastName: 'Dev',
          roles: ['Admin'],
          permissions: ['*'],
        };
      }
      return true;
    }
    return super.canActivate(context);
  }
}
