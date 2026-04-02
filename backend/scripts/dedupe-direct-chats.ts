import { ChatType, PrismaClient } from '@prisma/client';

type DirectChatSnapshot = {
  id: string;
  createdAt: Date;
  members: { userId: string }[];
  messages: { createdAt: Date }[];
};

function getPairKey(userA: string, userB: string) {
  return [userA, userB].sort().join(':');
}

function getActivityTimestamp(chat: DirectChatSnapshot) {
  const lastMessageAt = chat.messages[0]?.createdAt?.getTime() ?? 0;
  const createdAt = chat.createdAt.getTime();
  return Math.max(lastMessageAt, createdAt);
}

async function main() {
  const prisma = new PrismaClient();

  try {
    const directChats = await prisma.chat.findMany({
      where: { type: ChatType.DIRECT },
      include: {
        members: {
          select: { userId: true },
        },
        messages: {
          select: { createdAt: true },
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
      },
    });

    const grouped = new Map<string, DirectChatSnapshot[]>();

    for (const chat of directChats as DirectChatSnapshot[]) {
      if (chat.members.length !== 2) {
        continue;
      }

      const [memberA, memberB] = chat.members;
      const key = getPairKey(memberA.userId, memberB.userId);
      const group = grouped.get(key) ?? [];
      group.push(chat);
      grouped.set(key, group);
    }

    let removedChats = 0;
    let movedMessages = 0;

    for (const chats of grouped.values()) {
      if (chats.length <= 1) {
        continue;
      }

      const [keeper, ...duplicates] = chats.sort(
        (left, right) => getActivityTimestamp(right) - getActivityTimestamp(left),
      );

      for (const duplicate of duplicates) {
        await prisma.$transaction(async (tx) => {
          const moved = await tx.message.updateMany({
            where: { chatId: duplicate.id },
            data: { chatId: keeper.id },
          });

          await tx.chat.delete({
            where: { id: duplicate.id },
          });

          movedMessages += moved.count;
          removedChats += 1;
        });
      }
    }

    console.log('Direct chat dedupe complete.');
    console.log(`Removed chats: ${removedChats}`);
    console.log(`Moved messages: ${movedMessages}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
