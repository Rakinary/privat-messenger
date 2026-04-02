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
        messages: {
          take: 1,
          orderBy: {
            createdAt: 'desc',
          },
          select: {
            createdAt: true,
          },
        },
      },
    });

    const existingCandidates = currentUserChats.filter((chat) => {
      const ids = chat.members.map((member) => member.userId).sort();
      return ids.length === 2 &&
        ids[0] === [currentUserId, dto.otherUserId].sort()[0] &&
        ids[1] === [currentUserId, dto.otherUserId].sort()[1];
    });

    const existing = existingCandidates.sort((left, right) => {
      const leftActivity = new Date(left.messages[0]?.createdAt ?? left.createdAt).getTime();
      const rightActivity = new Date(right.messages[0]?.createdAt ?? right.createdAt).getTime();
      return rightActivity - leftActivity;
    })[0];

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
    const chats = await this.prisma.chat.findMany({
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
                lastSeenAt: true,
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

    const directDeduped = new Map<string, (typeof chats)[number]>();
    const nonDirectChats: (typeof chats)[number][] = [];

    for (const chat of chats) {
      if (chat.type !== ChatType.DIRECT) {
        nonDirectChats.push(chat);
        continue;
      }

      const peer = chat.members.find((member) => member.userId !== currentUserId)?.userId;
      if (!peer) {
        nonDirectChats.push(chat);
        continue;
      }

      const existing = directDeduped.get(peer);
      if (!existing) {
        directDeduped.set(peer, chat);
        continue;
      }

      const existingActivity = new Date(
        existing.messages[0]?.createdAt ?? existing.createdAt,
      ).getTime();
      const currentActivity = new Date(chat.messages[0]?.createdAt ?? chat.createdAt).getTime();

      if (currentActivity > existingActivity) {
        directDeduped.set(peer, chat);
      }
    }

    const uniqueChats = [...nonDirectChats, ...Array.from(directDeduped.values())];

    const chatsWithUnread = await Promise.all(
      uniqueChats.map(async (chat) => {
        const membership = chat.members.find((member) => member.userId === currentUserId);
        const unreadCount = await this.prisma.message.count({
          where: {
            chatId: chat.id,
            senderId: {
              not: currentUserId,
            },
            createdAt: membership?.lastReadAt
              ? {
                  gt: membership.lastReadAt,
                }
              : undefined,
          },
        });

        return {
          ...chat,
          unreadCount,
        };
      }),
    );

    return chatsWithUnread.sort((left, right) => {
      const leftActivity = new Date(left.messages[0]?.createdAt ?? left.createdAt).getTime();
      const rightActivity = new Date(right.messages[0]?.createdAt ?? right.createdAt).getTime();
      return rightActivity - leftActivity;
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
                lastSeenAt: true,
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

  async markChatAsRead(chatId: string, currentUserId: string) {
    const membership = await this.ensureUserIsChatMember(chatId, currentUserId);
    const latestMessage = await this.prisma.message.findFirst({
      where: { chatId },
      orderBy: {
        createdAt: 'desc',
      },
      select: {
        createdAt: true,
      },
    });

    const lastReadAt = latestMessage?.createdAt ?? new Date();
    const lastDeliveredAt = membership.lastDeliveredAt && membership.lastDeliveredAt > lastReadAt
      ? membership.lastDeliveredAt
      : lastReadAt;

    if (
      membership.lastReadAt &&
      membership.lastReadAt >= lastReadAt &&
      membership.lastDeliveredAt &&
      membership.lastDeliveredAt >= lastDeliveredAt
    ) {
      return {
        ok: true,
        chatId,
        userId: currentUserId,
        lastDeliveredAt: membership.lastDeliveredAt,
        lastReadAt: membership.lastReadAt,
      };
    }

    await this.prisma.chatMember.update({
      where: {
        chatId_userId: {
          chatId,
          userId: currentUserId,
        },
      },
      data: {
        lastDeliveredAt,
        lastReadAt,
      },
    });

    return {
      ok: true,
      chatId,
      userId: currentUserId,
      lastDeliveredAt,
      lastReadAt,
    };
  }

  async markChatAsDelivered(chatId: string, currentUserId: string, deliveredAt?: Date) {
    const membership = await this.ensureUserIsChatMember(chatId, currentUserId);
    const latestMessage = await this.prisma.message.findFirst({
      where: { chatId },
      orderBy: {
        createdAt: 'desc',
      },
      select: {
        createdAt: true,
      },
    });

    const baseline = deliveredAt ?? latestMessage?.createdAt ?? new Date();
    const nextDeliveredAt = membership.lastReadAt && membership.lastReadAt > baseline
      ? membership.lastReadAt
      : baseline;

    if (membership.lastDeliveredAt && membership.lastDeliveredAt >= nextDeliveredAt) {
      return {
        ok: true,
        changed: false,
        chatId,
        userId: currentUserId,
        lastDeliveredAt: membership.lastDeliveredAt,
        lastReadAt: membership.lastReadAt,
      };
    }

    await this.prisma.chatMember.update({
      where: {
        chatId_userId: {
          chatId,
          userId: currentUserId,
        },
      },
      data: {
        lastDeliveredAt: nextDeliveredAt,
      },
    });

    return {
      ok: true,
      changed: true,
      chatId,
      userId: currentUserId,
      lastDeliveredAt: nextDeliveredAt,
      lastReadAt: membership.lastReadAt,
    };
  }

  async syncDeliveredChatsForUser(currentUserId: string) {
    const memberships = await this.prisma.chatMember.findMany({
      where: { userId: currentUserId },
      select: {
        chatId: true,
        userId: true,
        lastDeliveredAt: true,
        lastReadAt: true,
      },
    });

    const receipts = await Promise.all(
      memberships.map(async (membership) => {
        const latestMessage = await this.prisma.message.findFirst({
          where: { chatId: membership.chatId },
          orderBy: {
            createdAt: 'desc',
          },
          select: {
            createdAt: true,
          },
        });

        if (!latestMessage?.createdAt) {
          return null;
        }

        const targetDeliveredAt = membership.lastReadAt && membership.lastReadAt > latestMessage.createdAt
          ? membership.lastReadAt
          : latestMessage.createdAt;

        if (membership.lastDeliveredAt && membership.lastDeliveredAt >= targetDeliveredAt) {
          return null;
        }

        await this.prisma.chatMember.update({
          where: {
            chatId_userId: {
              chatId: membership.chatId,
              userId: currentUserId,
            },
          },
          data: {
            lastDeliveredAt: targetDeliveredAt,
          },
        });

        return {
          chatId: membership.chatId,
          userId: currentUserId,
          lastDeliveredAt: targetDeliveredAt,
          lastReadAt: membership.lastReadAt,
        };
      }),
    );

    return receipts.filter((receipt): receipt is NonNullable<typeof receipt> => !!receipt);
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
