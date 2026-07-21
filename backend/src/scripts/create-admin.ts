import 'dotenv/config';
import argon2 from 'argon2';
import { PrismaClient } from '@prisma/client';

const username = process.env.ADMIN_USERNAME;
const password = process.env.ADMIN_PASSWORD;
if (!username || !password) throw new Error('Set ADMIN_USERNAME and ADMIN_PASSWORD before running this command.');
if (password.length < 12) throw new Error('ADMIN_PASSWORD must be at least 12 characters.');

const prisma = new PrismaClient();
try {
  const user = await prisma.user.upsert({
    where: { username },
    update: { passwordHash: await argon2.hash(password), role: 'ADMIN', enabled: true },
    create: { username, passwordHash: await argon2.hash(password), role: 'ADMIN' }
  });
  console.log(`Admin ready: ${user.username}`);
} finally {
  await prisma.$disconnect();
}
