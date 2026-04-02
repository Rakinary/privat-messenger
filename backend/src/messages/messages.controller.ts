import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { CurrentUser, JwtUser } from '../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { CreateMessageDto } from './dto/create-message.dto';
import { MessagesService } from './messages.service';

@Controller('messages')
@UseGuards(JwtAuthGuard)
export class MessagesController {
  constructor(
    private readonly messagesService: MessagesService,
    private readonly realtimeGateway: RealtimeGateway,
  ) {}

  @Post()
  async create(@CurrentUser() user: JwtUser, @Body() dto: CreateMessageDto) {
    const message = await this.messagesService.create(user.sub, dto);
    await this.realtimeGateway.broadcastNewMessage(message.chatId, message);
    return message;
  }
}
