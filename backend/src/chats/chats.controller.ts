import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser, JwtUser } from '../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { ChatsService } from './chats.service';
import { CreateDirectChatDto } from './dto/create-direct-chat.dto';
import { CreateGroupChatDto } from './dto/create-group-chat.dto';

@Controller('chats')
@UseGuards(JwtAuthGuard)
export class ChatsController {
  constructor(private readonly chatsService: ChatsService) {}

  @Post('direct')
  createDirect(@CurrentUser() user: JwtUser, @Body() dto: CreateDirectChatDto) {
    return this.chatsService.createDirectChat(user.sub, dto);
  }

  @Post('group')
  createGroup(@CurrentUser() user: JwtUser, @Body() dto: CreateGroupChatDto) {
    return this.chatsService.createGroupChat(user.sub, dto);
  }

  @Get()
  list(@CurrentUser() user: JwtUser) {
    return this.chatsService.listChatsForUser(user.sub);
  }

  @Get(':chatId/messages')
  listMessages(
    @CurrentUser() user: JwtUser,
    @Param('chatId') chatId: string,
    @Query('cursor') cursor?: string,
    @Query('take') take?: string,
  ) {
    return this.chatsService.listMessages(chatId, user.sub, cursor, take ? Number(take) : 50);
  }
}
