import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const email = process.env.LOCAL_USER_EMAIL || 'local@device';
  const user = await prisma.user.upsert({
    where: { email },
    update: {},
    create: { email, displayName: 'Local User' },
  });
  console.log(`Seeded local user: ${user.email} (${user.id})`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
