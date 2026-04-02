import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { MessageType } from '@prisma/client';
import { ChatsService } from '../chats/chats.service';
import { PrismaService } from '../prisma/prisma.service';
import { CreateMessageDto } from './dto/create-message.dto';

const messageInclude = {
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
} as const;

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

    return this.prisma.message.create({
      data: {
        chatId: dto.chatId,
        senderId: currentUserId,
        text: dto.text?.trim(),
        attachmentId: dto.attachmentId,
        replyToId: dto.replyToId,
        type: messageType,
      },
      include: messageInclude,
    });
  }

  async findOne(id: string) {
    return this.prisma.message.findUnique({
      where: { id },
      include: messageInclude,
    });
  }

  async setReaction(currentUserId: string, messageId: string, emoji = '❤️') {
    const message = await this.requireAccessibleMessage(messageId, currentUserId);

    if (message.deletedAt) {
      throw new BadRequestException('Cannot react to deleted message');
    }

    const existingLike = await this.prisma.messageLike.findUnique({
      where: {
        messageId_userId: {
          messageId,
          userId: currentUserId,
        },
      },
    });

    if (existingLike?.emoji === emoji) {
      await this.prisma.messageLike.delete({
        where: { id: existingLike.id },
      });

      return {
        removed: true,
        emoji: null,
        message: await this.findOne(messageId),
      };
    }

    if (existingLike) {
      await this.prisma.messageLike.update({
        where: { id: existingLike.id },
        data: { emoji },
      });
    } else {
      await this.prisma.messageLike.create({
        data: {
          messageId,
          userId: currentUserId,
          emoji,
        },
      });
    }

    return {
      removed: false,
      emoji,
      message: await this.findOne(messageId),
    };
  }

  async updateMessage(currentUserId: string, messageId: string, text: string) {
    const message = await this.requireOwnedEditableMessage(messageId, currentUserId);

    if (message.type === MessageType.SYSTEM) {
      throw new BadRequestException('System message cannot be edited');
    }

    const trimmedText = text.trim();
    if (!trimmedText) {
      throw new BadRequestException('Message text cannot be empty');
    }

    await this.prisma.message.update({
      where: { id: messageId },
      data: {
        text: trimmedText,
        editedAt: new Date(),
      },
    });

    return this.findOne(messageId);
  }

  async deleteMessage(currentUserId: string, messageId: string) {
    const message = await this.requireOwnedEditableMessage(messageId, currentUserId);

    if (message.deletedAt) {
      return this.findOne(messageId);
    }

    if (message.type === MessageType.SYSTEM) {
      throw new BadRequestException('System message cannot be deleted');
    }

    await this.prisma.message.update({
      where: { id: messageId },
      data: {
        text: null,
        attachmentId: null,
        deletedAt: new Date(),
      },
    });

    return this.findOne(messageId);
  }

  async getMessageReactions(messageId: string) {
    return this.prisma.messageLike.findMany({
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
  }

  private async requireAccessibleMessage(messageId: string, currentUserId: string) {
    const message = await this.prisma.message.findUnique({
      where: { id: messageId },
      include: { chat: { include: { members: true } } },
    });

    if (!message) {
      throw new NotFoundException('Message not found');
    }

    const isMember = message.chat.members.some((member) => member.userId === currentUserId);
    if (!isMember) {
      throw new BadRequestException('You are not a member of this chat');
    }

    return message;
  }

  private async requireOwnedEditableMessage(messageId: string, currentUserId: string) {
    const message = await this.prisma.message.findUnique({
      where: { id: messageId },
      select: {
        id: true,
        senderId: true,
        type: true,
        deletedAt: true,
      },
    });

    if (!message) {
      throw new NotFoundException('Message not found');
    }

    if (message.senderId !== currentUserId) {
      throw new ForbiddenException('You can modify only your own messages');
    }

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
