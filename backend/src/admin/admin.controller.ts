import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { AdminSecretGuard } from '../common/guards/admin-secret.guard';
import { CreateUserDto } from '../users/dto/create-user.dto';
import { UsersService } from '../users/users.service';

@Controller('admin')
@UseGuards(AdminSecretGuard)
export class AdminController {
  constructor(private readonly usersService: UsersService) {}

  @Post('users')
  createUser(@Body() dto: CreateUserDto) {
    return this.usersService.create(dto);
  }
}
