import { PrismaClient } from "@prisma/client";
import { TRIAL_MONTHS } from "../src/lib/plans";
import { hashPassword, passwordIssues } from "../src/lib/auth/password";
import { addMonths, bakuToday, bakuWallClockToUtc } from "../src/lib/time";

const prisma = new PrismaClient();

// Create one appointment on a given Baku day/time. endsAt = start + duration + buffer
// (the same window the booking engine blocks). Non-overlapping per employee so the
// no-double-booking EXCLUDE constraint is satisfied.
async function seedAppointment(opts: {
  salonId: string;
  employeeId: string;
  serviceId: string;
  customerId: string;
  day: string;
  startMin: number;
  durationMin: number;
  bufferMin: number;
  priceMinor: number;
}) {
  const startsAt = bakuWallClockToUtc(opts.day, opts.startMin);
  const endsAt = new Date(
    startsAt.getTime() + (opts.durationMin + opts.bufferMin) * 60_000,
  );
  await prisma.appointment.create({
    data: {
      salonId: opts.salonId,
      employeeId: opts.employeeId,
      serviceId: opts.serviceId,
      customerId: opts.customerId,
      startsAt,
      endsAt,
      status: "CONFIRMED",
      priceMinor: opts.priceMinor,
      source: "DASHBOARD",
    },
  });
}

// Seed the two login accounts: a platform admin (the owner) and one salon owner.
// Idempotent — skips whichever email already exists.
async function seedAuthAccounts() {
  const adminEmail = "almadatov22@gmail.com";
  const salonOwnerEmail = "saloon@book.az";

  const existingAdmin = await prisma.user.findUnique({ where: { email: adminEmail } });
  if (existingAdmin) {
    console.log(`seed: admin '${adminEmail}' already exists — skipping.`);
  } else {
    // Never commit a real admin password. It must be supplied at seed time via
    // SEED_ADMIN_PASSWORD and satisfy the same policy as signup. On existing
    // deployments the admin already exists, so this branch (and the env
    // requirement) is skipped.
    const adminPassword = process.env.SEED_ADMIN_PASSWORD;
    const issues = adminPassword ? passwordIssues(adminPassword) : ["not set"];
    if (!adminPassword || issues.length > 0) {
      throw new Error(
        `seed: SEED_ADMIN_PASSWORD is required to create platform admin '${adminEmail}' ` +
          `and must satisfy the password policy (${issues.join(", ")}). ` +
          `Set it to a strong value in the environment (do not commit it).`,
      );
    }
    await prisma.user.create({
      data: {
        email: adminEmail,
        fullName: "Platform Admin",
        isPlatformAdmin: true,
        passwordHash: hashPassword(adminPassword),
      },
    });
    console.log(`seed: created platform admin '${adminEmail}'.`);
  }

  const existingOwner = await prisma.user.findUnique({ where: { email: salonOwnerEmail } });
  if (existingOwner) {
    console.log(`seed: salon owner '${salonOwnerEmail}' already exists — skipping.`);
    return;
  }

  const trialEndsAt = addMonths(new Date(), TRIAL_MONTHS);

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

  // Populate the owner's salon so the calendar has real data on first login.
  const [nigar, resad] = await Promise.all([
    prisma.employee.create({
      data: { salonId: salon.id, name: "Nigar", position: "Bərbər" },
    }),
    prisma.employee.create({
      data: { salonId: salon.id, name: "Rəşad", position: "Bərbər" },
    }),
  ]);

  const haircut = await prisma.service.create({
    data: { salonId: salon.id, name: "Saç kəsimi", priceMinor: 2000, durationMin: 45, bufferMin: 10 },
  });
  const beard = await prisma.service.create({
    data: { salonId: salon.id, name: "Saqqal düzəltmə", priceMinor: 1500, durationMin: 30, bufferMin: 5 },
  });

  // Both barbers can do both services.
  await prisma.serviceEmployee.createMany({
    data: [
      { serviceId: haircut.id, employeeId: nigar.id },
      { serviceId: beard.id, employeeId: nigar.id },
      { serviceId: haircut.id, employeeId: resad.id },
      { serviceId: beard.id, employeeId: resad.id },
    ],
  });

  // Working hours: Mon–Sat (1..6), 10:00–19:00.
  await prisma.workingHour.createMany({
    data: [nigar.id, resad.id].flatMap((employeeId) =>
      [1, 2, 3, 4, 5, 6].map((weekday) => ({ employeeId, weekday, startMin: 600, endMin: 1140 })),
    ),
  });

  const customerNames = ["Elvin", "Murad", "Kənan", "Tural", "Anar"];
  const customers = await Promise.all(
    customerNames.map((name, i) =>
      prisma.customer.create({
        data: { salonId: salon.id, name, phone: `+9945000001${String(i).padStart(2, "0")}` },
      }),
    ),
  );

  // A handful of appointments on today's Baku date so the calendar looks live.
  const today = bakuToday();
  await seedAppointment({ salonId: salon.id, employeeId: nigar.id, serviceId: haircut.id, customerId: customers[0].id, day: today, startMin: 600, durationMin: 45, bufferMin: 10, priceMinor: 2000 });
  await seedAppointment({ salonId: salon.id, employeeId: nigar.id, serviceId: beard.id, customerId: customers[1].id, day: today, startMin: 750, durationMin: 30, bufferMin: 5, priceMinor: 1500 });
  await seedAppointment({ salonId: salon.id, employeeId: nigar.id, serviceId: haircut.id, customerId: customers[2].id, day: today, startMin: 900, durationMin: 45, bufferMin: 10, priceMinor: 2000 });
  await seedAppointment({ salonId: salon.id, employeeId: resad.id, serviceId: haircut.id, customerId: customers[3].id, day: today, startMin: 660, durationMin: 45, bufferMin: 10, priceMinor: 2000 });
  await seedAppointment({ salonId: salon.id, employeeId: resad.id, serviceId: beard.id, customerId: customers[4].id, day: today, startMin: 810, durationMin: 30, bufferMin: 5, priceMinor: 1500 });

  console.log(`seed: created salon owner '${salonOwnerEmail}', salon /${salon.slug} with 2 barbers, 2 services, 5 appointments today.`);
}

async function main() {
  await seedAuthAccounts();

  const existing = await prisma.salon.findUnique({ where: { slug: "demostudio" } });
  if (existing) {
    console.log("seed: 'demostudio' already exists — skipping.");
    return;
  }

  const trialEndsAt = addMonths(new Date(), TRIAL_MONTHS);

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
