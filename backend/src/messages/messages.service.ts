import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { MessageType } from '@prisma/client';
import { ChatsService } from '../chats/chats.service';
import { PrismaService } from '../prisma/prisma.service';
import { CreateMessageDto } from './dto/create-message.dto';

@Injectable()
export class MessagesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly chatsService: ChatsService,
  ) {}

  async create(currentUserId: string, dto: CreateMessageDto) {
    await this.chatsService.ensureUserIsChatMember(dto.chatId, currentUserId);

    const messageType = this.normalizeMessageType(dto.type);
    const hasText = !!dto.text?.trim();
    const hasAttachment = !!dto.attachmentId;

    if (!hasText && !hasAttachment && messageType !== MessageType.SYSTEM) {
      throw new BadRequestException('Message must contain text or attachment');
    }

    if (dto.attachmentId) {
      const attachment = await this.prisma.attachment.findUnique({
        where: { id: dto.attachmentId },
      });

      if (!attachment) {
        throw new NotFoundException('Attachment not found');
      }
    }

    const message = await this.prisma.message.create({
      data: {
        chatId: dto.chatId,
        senderId: currentUserId,
        text: dto.text?.trim(),
        attachmentId: dto.attachmentId,
        type: messageType,
      },
      include: {
        sender: {
          select: {
            id: true,
            username: true,
          },
        },
        attachment: true,
      },
    });

    return message;
  }

  private normalizeMessageType(type?: string): MessageType {
    switch ((type ?? 'text').toLowerCase()) {
      case 'image':
        return MessageType.IMAGE;
      case 'video':
        return MessageType.VIDEO;
      case 'gif':
        return MessageType.GIF;
      case 'file':
        return MessageType.FILE;
      case 'system':
        return MessageType.SYSTEM;
      case 'text':
      default:
        return MessageType.TEXT;
    }
  }
}
