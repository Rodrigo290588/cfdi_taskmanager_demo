const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function checkUser(email) {
  try {
    const user = await prisma.user.findUnique({
      where: { email: email.toLowerCase() },
      select: {
        id: true, email: true, name: true, systemRole: true,
      }
    });

    if (!user) {
      console.log('Usuario no encontrado');
      return;
    }

    console.log('Usuario:', user);

    const mems = await prisma.member.findMany({
      where: {
        userId: user.id,
        status: "APPROVED",
        organization: { onboardingCompleted: true },
      },
      select: { organizationId: true, role: true, organization: { select: { name: true, onboardingCompleted: true } } },
    });

    console.log('Membresías con onboardingCompleted: true ->', mems);

    const memsAll = await prisma.member.findMany({
      where: {
        userId: user.id,
        status: "APPROVED",
      },
      select: { organizationId: true, role: true, organization: { select: { name: true, onboardingCompleted: true } } },
    });

    console.log('Todas las Membresías ->', memsAll);

  } catch (e) {
    console.error(e);
  } finally {
    await prisma.$disconnect();
  }
}

checkUser('rtorreh@gmail.com');
