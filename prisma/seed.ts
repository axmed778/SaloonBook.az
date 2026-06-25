import { PrismaClient } from "@prisma/client";
import { TRIAL_MONTHS } from "../src/lib/plans";
import { hashPassword } from "../src/lib/auth/password";

const prisma = new PrismaClient();

// Seed the two login accounts: a platform admin (the owner) and one salon owner.
// Idempotent — skips whichever email already exists.
async function seedAuthAccounts() {
  const adminEmail = "almadatov22@gmail.com";
  const salonOwnerEmail = "saloon@book.az";

  const existingAdmin = await prisma.user.findUnique({ where: { email: adminEmail } });
  if (existingAdmin) {
    console.log(`seed: admin '${adminEmail}' already exists — skipping.`);
  } else {
    await prisma.user.create({
      data: {
        email: adminEmail,
        fullName: "Platform Admin",
        isPlatformAdmin: true,
        // NOTE: temporary password shared in chat — owner must change after first login.
        passwordHash: hashPassword("Admin123!"),
      },
    });
    console.log(`seed: created platform admin '${adminEmail}'.`);
  }

  const existingOwner = await prisma.user.findUnique({ where: { email: salonOwnerEmail } });
  if (existingOwner) {
    console.log(`seed: salon owner '${salonOwnerEmail}' already exists — skipping.`);
    return;
  }

  const trialEndsAt = new Date();
  trialEndsAt.setMonth(trialEndsAt.getMonth() + TRIAL_MONTHS);

  const account = await prisma.account.create({
    data: {
      name: "My Salon",
      subscription: { create: { plan: "BASIC", status: "TRIALING", trialEndsAt } },
      salons: { create: { slug: "mysalon", name: "My Salon" } },
    },
    include: { salons: true },
  });
  const salon = account.salons[0];

  const owner = await prisma.user.create({
    data: {
      email: salonOwnerEmail,
      fullName: "Salon Owner",
      // Deliberately weak test password (Clerk would reject this).
      passwordHash: hashPassword("123456"),
    },
  });

  await prisma.membership.create({
    data: { userId: owner.id, accountId: account.id, role: "OWNER", salonId: salon.id },
  });

  console.log(`seed: created salon owner '${salonOwnerEmail}', salon /${salon.slug}.`);
}

async function main() {
  await seedAuthAccounts();

  const existing = await prisma.salon.findUnique({ where: { slug: "demostudio" } });
  if (existing) {
    console.log("seed: 'demostudio' already exists — skipping.");
    return;
  }

  const trialEndsAt = new Date();
  trialEndsAt.setMonth(trialEndsAt.getMonth() + TRIAL_MONTHS);

  const account = await prisma.account.create({
    data: {
      name: "Demo Beauty Studio",
      subscription: {
        create: { plan: "BASIC", status: "TRIALING", trialEndsAt },
      },
      salons: {
        create: {
          slug: "demostudio",
          name: "Demo Beauty Studio",
          description: "Nümunə salon — test üçün.",
          phone: "+994500000000",
        },
      },
    },
    include: { salons: true },
  });

  const salon = account.salons[0];

  const [ayan, leyla] = await Promise.all([
    prisma.employee.create({
      data: { salonId: salon.id, name: "Ayan", position: "Bərbər" },
    }),
    prisma.employee.create({
      data: { salonId: salon.id, name: "Leyla", position: "Manikür ustası" },
    }),
  ]);

  const haircut = await prisma.service.create({
    data: { salonId: salon.id, name: "Saç kəsimi", priceMinor: 2000, durationMin: 45, bufferMin: 10 },
  });
  const manicure = await prisma.service.create({
    data: { salonId: salon.id, name: "Manikür", priceMinor: 2500, durationMin: 60, bufferMin: 10 },
  });

  // Who can do what.
  await prisma.serviceEmployee.createMany({
    data: [
      { serviceId: haircut.id, employeeId: ayan.id },
      { serviceId: manicure.id, employeeId: leyla.id },
    ],
  });

  // Working hours: Mon–Sat (1..6), 10:00–19:00.
  const hours = [ayan.id, leyla.id].flatMap((employeeId) =>
    [1, 2, 3, 4, 5, 6].map((weekday) => ({ employeeId, weekday, startMin: 600, endMin: 1140 })),
  );
  await prisma.workingHour.createMany({ data: hours });

  // An invite code granting the 3-month Basic trial (max 50 uses).
  await prisma.invite.create({
    data: { code: "EARLYBIRD", grantsTrial: true, maxUses: 50, createdBy: "seed" },
  });

  console.log(`seed: created account ${account.id}, salon /${salon.slug}, 2 employees, 2 services.`);
  console.log("seed: invite code EARLYBIRD (50 uses).");
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
