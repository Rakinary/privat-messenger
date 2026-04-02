import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../prisma/prisma.service';
import { CreateUserDto } from './dto/create-user.dto';

type PresenceSnapshot = {
  id: string;
  lastSeenAt: Date | null;
};

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateUserDto) {
    const email = dto.email.toLowerCase().trim();
    const username = dto.username.trim();

    const existing = await this.prisma.user.findFirst({
      where: {
        OR: [{ email }, { username }],
      },
    });

    if (existing) {
      throw new ConflictException('User with this email or username already exists');
    }

    const passwordHash = await bcrypt.hash(dto.password, 10);

    return this.prisma.user.create({
      data: {
        email,
        username,
        passwordHash,
      },
      select: {
        id: true,
        email: true,
        username: true,
        createdAt: true,
      },
    });
  }

 async list(currentUserId?: string, query?: string) {
  const normalizedQuery = query?.trim();

  return this.prisma.user.findMany({
    where: {
      ...(currentUserId ? { id: { not: currentUserId } } : {}),
      ...(normalizedQuery
        ? {
            username: {
              contains: normalizedQuery,
              mode: 'insensitive',
            },
          }
        : {}),
    },
    select: {
      id: true,
      email: true,
      username: true,
      createdAt: true,
    },
    orderBy: {
      username: 'asc',
    },
    take: 20,
  });
}

  async findByIdOrThrow(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        username: true,
        createdAt: true,
        lastSeenAt: true,
      },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    return user;
  }

  async savePushToken(userId: string, expoPushToken?: string) {
    return this.prisma.user.update({
      where: { id: userId },
      data: { expoPushToken: expoPushToken || null },
      select: {
        id: true,
        username: true,
        expoPushToken: true,
      },
    });
  }

  async getUserPushTokens(userIds: string[]) {
    if (userIds.length === 0) {
      return [];
    }

    return this.prisma.user.findMany({
      where: {
        id: { in: userIds },
        expoPushToken: { not: null },
      },
      select: {
        id: true,
        username: true,
        expoPushToken: true,
      },
    });
  }

  async touchLastSeen(userId: string, at = new Date()): Promise<void> {
    await this.prisma.$executeRaw`
      UPDATE "User"
      SET "lastSeenAt" = ${at}
      WHERE "id" = ${userId}
    `;
  }

  async getPresenceSnapshot(userId: string): Promise<PresenceSnapshot | null> {
    const rows = await this.prisma.$queryRaw<PresenceSnapshot[]>`
      SELECT "id", "lastSeenAt"
      FROM "User"
      WHERE "id" = ${userId}
      LIMIT 1
    `;

    return rows[0] ?? null;
  }
}

