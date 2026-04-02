import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { CurrentUser, JwtUser } from '../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { CreateMessageDto } from './dto/create-message.dto';
import { SetReactionDto } from './dto/set-reaction.dto';
import { UpdateMessageDto } from './dto/update-message.dto';
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

  @Post(':id/like')
  async toggleLike(@CurrentUser() user: JwtUser, @Param('id') messageId: string) {
    const result = await this.messagesService.setReaction(user.sub, messageId, '❤️');
    await this.realtimeGateway.broadcastMessageUpdated(result.message);
    return result;
  }

  @Post(':id/reaction')
  async setReaction(
    @CurrentUser() user: JwtUser,
    @Param('id') messageId: string,
    @Body() dto: SetReactionDto,
  ) {
    const result = await this.messagesService.setReaction(user.sub, messageId, dto.emoji ?? '❤️');
    await this.realtimeGateway.broadcastMessageUpdated(result.message);
    return result;
  }

  @Patch(':id')
  async update(
    @CurrentUser() user: JwtUser,
    @Param('id') messageId: string,
    @Body() dto: UpdateMessageDto,
  ) {
    const message = await this.messagesService.updateMessage(user.sub, messageId, dto.text);
    await this.realtimeGateway.broadcastMessageUpdated(message);
    return message;
  }

  @Delete(':id')
  async remove(@CurrentUser() user: JwtUser, @Param('id') messageId: string) {
    const message = await this.messagesService.deleteMessage(user.sub, messageId);
    await this.realtimeGateway.broadcastMessageUpdated(message);
    return message;
  }

  @Get(':id/likes')
  async getLikes(@Param('id') messageId: string) {
    return this.messagesService.getMessageReactions(messageId);
  }
}
