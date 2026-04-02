import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ChatType, MemberRole, MessageType, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { UsersService } from '../users/users.service';
import { CreateDirectChatDto } from './dto/create-direct-chat.dto';
import { CreateGroupChatDto } from './dto/create-group-chat.dto';

@Injectable()
export class ChatsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly usersService: UsersService,
  ) {}

  async createDirectChat(currentUserId: string, dto: CreateDirectChatDto) {
    if (currentUserId === dto.otherUserId) {
      throw new BadRequestException('Cannot create a direct chat with yourself');
    }

    await this.usersService.findByIdOrThrow(dto.otherUserId);

    const currentUserChats = await this.prisma.chat.findMany({
      where: {
        type: ChatType.DIRECT,
        members: {
          some: { userId: currentUserId },
        },
      },
      include: {
        members: true,
      },
    });

    const existing = currentUserChats.find((chat) => {
      const ids = chat.members.map((member) => member.userId).sort();
      return ids.length === 2 &&
        ids[0] === [currentUserId, dto.otherUserId].sort()[0] &&
        ids[1] === [currentUserId, dto.otherUserId].sort()[1];
    });

    if (existing) {
      return this.getChatByIdForUser(existing.id, currentUserId);
    }

    const chat = await this.prisma.chat.create({
      data: {
        type: ChatType.DIRECT,
        members: {
          create: [
            {
              userId: currentUserId,
              role: MemberRole.OWNER,
            },
            {
              userId: dto.otherUserId,
              role: MemberRole.MEMBER,
            },
          ],
        },
      },
    });

    return this.getChatByIdForUser(chat.id, currentUserId);
  }

  async createGroupChat(currentUserId: string, dto: CreateGroupChatDto) {
    const uniqueMemberIds = Array.from(new Set(dto.memberIds)).filter(
      (memberId) => memberId !== currentUserId,
    );

    if (uniqueMemberIds.length === 0) {
      throw new BadRequestException('Group must include at least one other member');
    }

    await Promise.all(uniqueMemberIds.map((memberId) => this.usersService.findByIdOrThrow(memberId)));

    const chat = await this.prisma.chat.create({
      data: {
        type: ChatType.GROUP,
        title: dto.title.trim(),
        members: {
          create: [
            {
              userId: currentUserId,
              role: MemberRole.OWNER,
            },
            ...uniqueMemberIds.map((memberId) => ({
              userId: memberId,
              role: MemberRole.MEMBER,
            })),
          ],
        },
      },
    });

    await this.prisma.message.create({
      data: {
        chatId: chat.id,
        senderId: currentUserId,
        type: MessageType.SYSTEM,
        text: `Group "${dto.title.trim()}" created`,
      },
    });

    return this.getChatByIdForUser(chat.id, currentUserId);
  }

  async listChatsForUser(currentUserId: string) {
    return this.prisma.chat.findMany({
      where: {
        members: {
          some: {
            userId: currentUserId,
          },
        },
      },
      include: {
        members: {
          include: {
            user: {
              select: {
                id: true,
                email: true,
                username: true,
                createdAt: true,
              },
            },
          },
        },
        messages: {
          take: 1,
          orderBy: {
            createdAt: 'desc',
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
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
    });
  }

  async getChatByIdForUser(chatId: string, currentUserId: string) {
    await this.ensureUserIsChatMember(chatId, currentUserId);

    const chat = await this.prisma.chat.findUnique({
      where: { id: chatId },
      include: {
        members: {
          include: {
            user: {
              select: {
                id: true,
                email: true,
                username: true,
                createdAt: true,
              },
            },
          },
        },
        messages: {
          take: 1,
          orderBy: {
            createdAt: 'desc',
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
        },
      },
    });

    if (!chat) {
      throw new NotFoundException('Chat not found');
    }

    return chat;
  }

  async listMessages(chatId: string, currentUserId: string, cursor?: string, take = 50) {
    await this.ensureUserIsChatMember(chatId, currentUserId);

    const pagination: Prisma.MessageFindManyArgs = {
      where: { chatId },
      include: {
        sender: {
          select: {
            id: true,
            username: true,
          },
        },
        attachment: true,
      },
      orderBy: {
        createdAt: 'desc',
      },
      take,
    };

    if (cursor) {
      pagination.skip = 1;
      pagination.cursor = { id: cursor };
    }

    const messages = await this.prisma.message.findMany(pagination);

    return messages.reverse();
  }

  async ensureUserIsChatMember(chatId: string, userId: string) {
    const membership = await this.prisma.chatMember.findUnique({
      where: {
        chatId_userId: {
          chatId,
          userId,
        },
      },
    });

    if (!membership) {
      throw new ForbiddenException('You are not a member of this chat');
    }

    return membership;
  }

  async getChatMemberIds(chatId: string) {
    const members = await this.prisma.chatMember.findMany({
      where: { chatId },
      select: {
        userId: true,
      },
    });

    return members.map((member) => member.userId);
  }
}
