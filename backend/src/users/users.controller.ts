import { Body, Controller, Get, Post, Query, UseGuards, UsePipes, ValidationPipe } from '@nestjs/common';
import { CurrentUser, JwtUser } from '../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { UsersService } from './users.service';
import { SavePushTokenDto } from './dto/save-push-token.dto';

@Controller('users')
@UseGuards(JwtAuthGuard)
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get()
  list(
    @CurrentUser() user: JwtUser,
    @Query('query') query?: string,
  ) {
    return this.usersService.list(user.sub, query);
  }

  @Post('push-token')
  @UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
  savePushToken(
    @CurrentUser() user: JwtUser,
    @Body() dto: SavePushTokenDto,
  ) {
    return this.usersService.savePushToken(user.sub, dto.expoPushToken);
  }
}

