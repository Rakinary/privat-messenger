import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class AdminSecretGuard implements CanActivate {
  constructor(private readonly configService: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const adminSecret = request.headers['x-admin-secret'];
    const expectedSecret = this.configService.get<string>('ADMIN_SECRET');

    if (!expectedSecret) {
      throw new ForbiddenException('ADMIN_SECRET is not configured');
    }

    if (adminSecret !== expectedSecret) {
      throw new ForbiddenException('Invalid admin secret');
    }

    return true;
  }
}
