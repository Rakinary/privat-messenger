import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';

function getArg(name: string): string | undefined {
  const index = process.argv.findIndex((arg) => arg === `--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function main() {
  const email = getArg('email');
  const username = getArg('username');
  const password = getArg('password');

  if (!email || !username || !password) {
    console.error('Usage: npm run create:user -- --email user@example.com --username user --password secret123');
    process.exit(1);
  }

  const prisma = new PrismaClient();
  const passwordHash = await bcrypt.hash(password, 10);

  const user = await prisma.user.create({
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

  console.log('User created:');
  console.log(user);

  await prisma.$disconnect();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
