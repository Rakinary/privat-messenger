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

    // Validate replyToId if provided
    if (dto.replyToId) {
      const replyToMessage = await this.prisma.message.findUnique({
        where: { id: dto.replyToId },
      });

      if (!replyToMessage) {
        throw new NotFoundException('Reply-to message not found');
      }

      if (replyToMessage.chatId !== dto.chatId) {
        throw new BadRequestException('Reply-to message must be in the same chat');
      }
    }

    const message = await this.prisma.message.create({
      data: {
        chatId: dto.chatId,
        senderId: currentUserId,
        text: dto.text?.trim(),
        attachmentId: dto.attachmentId,
        replyToId: dto.replyToId,
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
        replyTo: {
          include: {
            sender: {
              select: {
                id: true,
                username: true,
              },
            },
          },
        },
        likes: {
          include: {
            user: {
              select: {
                id: true,
                username: true,
              },
            },
          },
        },
        _count: {
          select: {
            likes: true,
          },
        },
      },
    });

    return message;
  }

  async findOne(id: string) {
    return this.prisma.message.findUnique({
      where: { id },
      include: {
        sender: {
          select: {
            id: true,
            username: true,
          },
        },
        attachment: true,
        replyTo: {
          include: {
            sender: {
              select: {
                id: true,
                username: true,
              },
            },
          },
        },
        likes: {
          include: {
            user: {
              select: {
                id: true,
                username: true,
              },
            },
          },
        },
        _count: {
          select: {
            likes: true,
          },
        },
      },
    });
  }

  async toggleLike(currentUserId: string, messageId: string) {
    // Check if user can access the message
    const message = await this.prisma.message.findUnique({
      where: { id: messageId },
      include: { chat: { include: { members: true } } },
    });

    if (!message) {
      throw new NotFoundException('Message not found');
    }

    const isMember = message.chat.members.some(m => m.userId === currentUserId);
    if (!isMember) {
      throw new BadRequestException('You are not a member of this chat');
    }

    // Check if like already exists
    const existingLike = await this.prisma.messageLike.findUnique({
      where: {
        messageId_userId: {
          messageId,
          userId: currentUserId,
        },
      },
    });

    if (existingLike) {
      // Remove like
      await this.prisma.messageLike.delete({
        where: { id: existingLike.id },
      });
      return { liked: false };
    } else {
      // Add like
      await this.prisma.messageLike.create({
        data: {
          messageId,
          userId: currentUserId,
        },
      });
      return { liked: true };
    }
  }

  async getMessageLikes(messageId: string) {
    const likes = await this.prisma.messageLike.findMany({
      where: { messageId },
      include: {
        user: {
          select: {
            id: true,
            username: true,
          },
        },
      },
      orderBy: { createdAt: 'asc' },
    });

    return likes;
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
