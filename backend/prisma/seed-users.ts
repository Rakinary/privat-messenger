import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

async function upsertUser(email: string, username: string, password: string) {
  const passwordHash = await bcrypt.hash(password, 10);

  const user = await prisma.user.upsert({
    where: { email },
    update: {
      username,
      passwordHash,
    },
    create: {
      email,
      username,
      passwordHash,
    },
  });

  console.log(`Seeded user: ${user.email}`);
}

async function main() {
  await upsertUser('admin@example.com', 'admin', 'admin123');
  await upsertUser('max@example.com', 'max', 'max123');
  await upsertUser('alice@example.com', 'alice', 'alice123');
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
