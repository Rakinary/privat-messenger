import { Module } from '@nestjs/common';
import { AdminController } from './admin.controller';
import { AdminSecretGuard } from '../common/guards/admin-secret.guard';
import { UsersModule } from '../users/users.module';

@Module({
  imports: [UsersModule],
  controllers: [AdminController],
  providers: [AdminSecretGuard],
})
export class AdminModule {}
