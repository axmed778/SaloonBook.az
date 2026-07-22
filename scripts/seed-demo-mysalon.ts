/**
 * Demo data for the /mysalon salon: several masters with DIFFERENT capabilities,
 * plus a realistic spread of appointments over the past week and the next 2 weeks.
 *
 * Safe to re-run:
 *   - employees / services / customers are find-or-created (never duplicated);
 *   - appointments that would overlap an existing one (the EXCLUDE constraint)
 *     are skipped, so a second run just fills gaps instead of erroring out.
 *
 * Run against whatever DATABASE_URL is set, e.g. (PowerShell):
 *   $env:DATABASE_URL="<prod-neon-url>"; npx tsx scripts/seed-demo-mysalon.ts
 */
import { PrismaClient, Audience, AppointmentStatus } from "@prisma/client";
import {
  bakuWallClockToUtc,
  bakuToday,
  bakuMinutesOfDay,
} from "../src/lib/time";

const prisma = new PrismaClient();

const SALON_SLUG = "mysalon";
const DAYS_BACK = 7; // completed history so the calendar/analytics look alive
const DAYS_FWD = 14; // "2 weeks ahead"

const pick = <T>(a: T[]): T => a[Math.floor(Math.random() * a.length)];
const chance = (p: number) => Math.random() < p;

// --- catalog -------------------------------------------------------------
// name -> { priceMinor (qəpik), durationMin, bufferMin, audience }
const SERVICES = {
  kishiKesim: { name: "Kişi saç kəsimi", priceMinor: 1500, durationMin: 30, bufferMin: 10, audience: Audience.MALE },
  saqqal:     { name: "Saqqal düzəltmə", priceMinor: 1000, durationMin: 20, bufferMin: 5,  audience: Audience.MALE },
  ushaqKesim: { name: "Uşaq saç kəsimi", priceMinor: 1000, durationMin: 30, bufferMin: 10, audience: Audience.ALL },
  qadinKesim: { name: "Qadın saç kəsimi", priceMinor: 2500, durationMin: 45, bufferMin: 15, audience: Audience.FEMALE },
  boyama:     { name: "Saç boyama", priceMinor: 6000, durationMin: 120, bufferMin: 20, audience: Audience.FEMALE },
  fen:        { name: "Saç düzümü (fen)", priceMinor: 2000, durationMin: 40, bufferMin: 10, audience: Audience.FEMALE },
  manikur:    { name: "Manikür", priceMinor: 2500, durationMin: 60, bufferMin: 10, audience: Audience.FEMALE },
  pedikur:    { name: "Pedikür", priceMinor: 3000, durationMin: 60, bufferMin: 10, audience: Audience.FEMALE },
  kash:       { name: "Kaş korreksiyası", priceMinor: 1200, durationMin: 20, bufferMin: 5, audience: Audience.FEMALE },
  kirpik:     { name: "Kirpik uzatma (2D)", priceMinor: 5000, durationMin: 90, bufferMin: 15, audience: Audience.FEMALE },
} as const;
type ServiceKey = keyof typeof SERVICES;

// masters — deliberately different skill sets ("capabilities")
const EMPLOYEES: {
  name: string;
  position: string;
  audience: Audience;
  services: ServiceKey[];
  workdays: number[]; // 0=Sun..6=Sat
  startMin: number;
  endMin: number;
}[] = [
  { name: "Rəşad Məmmədov", position: "Bərbər", audience: Audience.MALE,
    services: ["kishiKesim", "saqqal", "ushaqKesim"], workdays: [1, 2, 3, 4, 5, 6], startMin: 600, endMin: 1200 },
  { name: "Elvin Qasımov", position: "Bərbər", audience: Audience.MALE,
    services: ["kishiKesim", "saqqal"], workdays: [1, 2, 3, 4, 5, 6], startMin: 600, endMin: 1200 },
  { name: "Nigar Əliyeva", position: "Stilist", audience: Audience.FEMALE,
    services: ["qadinKesim", "boyama", "fen"], workdays: [2, 3, 4, 5, 6, 0], startMin: 600, endMin: 1200 },
  { name: "Aysel Hüseynova", position: "Manikür ustası", audience: Audience.FEMALE,
    services: ["manikur", "pedikur"], workdays: [2, 3, 4, 5, 6], startMin: 660, endMin: 1200 },
  { name: "Günel Rəhimova", position: "Kaş & Kirpik ustası", audience: Audience.FEMALE,
    services: ["kash", "kirpik"], workdays: [3, 4, 5, 6, 0], startMin: 660, endMin: 1140 },
];

const MALE_NAMES = ["Elvin", "Murad", "Kənan", "Tural", "Anar", "Orxan", "Ramil", "Elçin", "Fərid", "Rüstəm", "Ceyhun", "Vüsal"];
const FEMALE_NAMES = ["Aysu", "Nərmin", "Leyla", "Sevda", "Gülnar", "Aytən", "Zərifə", "Ülviyyə", "Xatirə", "Səbinə", "Nigar", "Röya"];

function ymdOffset(baseYmd: string, deltaDays: number): { ymd: string; weekday: number } {
  const [y, m, d] = baseYmd.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + deltaDays);
  const ymd = dt.toISOString().slice(0, 10);
  return { ymd, weekday: dt.getUTCDay() };
}

async function main() {
  const salon = await prisma.salon.findUnique({ where: { slug: SALON_SLUG } });
  if (!salon) throw new Error(`salon /${SALON_SLUG} not found in this database`);
  const salonId = salon.id;
  console.log(`Seeding /${SALON_SLUG} (salon ${salonId})`);

  // Clean up the original prisma/seed.ts demo artifacts on /mysalon so the
  // roster is exactly the 5 curated masters below (no duplicate "Nigar"/"Rəşad").
  // Opt out with KEEP_DEFAULTS=1.
  if (process.env.KEEP_DEFAULTS !== "1") {
    const stale = await prisma.employee.findMany({
      where: { salonId, name: { in: ["Nigar", "Rəşad"] } },
      select: { id: true },
    });
    const staleIds = stale.map((e) => e.id);
    if (staleIds.length) {
      await prisma.appointment.deleteMany({ where: { employeeId: { in: staleIds } } });
      await prisma.payout.deleteMany({ where: { employeeId: { in: staleIds } } });
      await prisma.serviceEmployee.deleteMany({ where: { employeeId: { in: staleIds } } });
      await prisma.workingHour.deleteMany({ where: { employeeId: { in: staleIds } } });
      await prisma.timeOff.deleteMany({ where: { employeeId: { in: staleIds } } });
      await prisma.employee.deleteMany({ where: { id: { in: staleIds } } });
      console.log(`  removed ${staleIds.length} default seed master(s)`);
    }
    // Deactivate the two generic seed services (kept for any historical rows).
    await prisma.service.updateMany({
      where: { salonId, name: { in: ["Saç kəsimi", "Saqqal düzəltmə"] } },
      data: { isActive: false },
    });
  }

  // Display business hours on the public page: Mon–Sat 10:00–20:00.
  await prisma.salon.update({
    where: { id: salonId },
    data: {
      audience: Audience.ALL,
      businessHours: [1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, openMin: 600, closeMin: 1200 })),
    },
  });

  // --- services (find-or-create by name) ---------------------------------
  const svcId: Record<string, string> = {};
  for (const [key, s] of Object.entries(SERVICES)) {
    const existing = await prisma.service.findFirst({ where: { salonId, name: s.name } });
    const rec = existing
      ? await prisma.service.update({ where: { id: existing.id }, data: { ...s, isActive: true } })
      : await prisma.service.create({ data: { salonId, ...s } });
    svcId[key] = rec.id;
  }
  console.log(`  services: ${Object.keys(svcId).length}`);

  // --- employees (find-or-create by name) + capabilities -----------------
  const emps: { id: string; def: (typeof EMPLOYEES)[number] }[] = [];
  for (const def of EMPLOYEES) {
    const existing = await prisma.employee.findFirst({ where: { salonId, name: def.name } });
    const rec = existing
      ? await prisma.employee.update({
          where: { id: existing.id },
          data: { position: def.position, audience: def.audience, isActive: true },
        })
      : await prisma.employee.create({
          data: { salonId, name: def.name, position: def.position, audience: def.audience },
        });

    // capabilities
    for (const key of def.services) {
      await prisma.serviceEmployee.upsert({
        where: { serviceId_employeeId: { serviceId: svcId[key], employeeId: rec.id } },
        create: { serviceId: svcId[key], employeeId: rec.id },
        update: {},
      });
    }
    // working hours — reset to the defined schedule
    await prisma.workingHour.deleteMany({ where: { employeeId: rec.id } });
    await prisma.workingHour.createMany({
      data: def.workdays.map((weekday) => ({ employeeId: rec.id, weekday, startMin: def.startMin, endMin: def.endMin })),
    });
    emps.push({ id: rec.id, def });
  }
  console.log(`  employees: ${emps.length}`);

  // --- customers (find-or-create by phone) -------------------------------
  const mkCustomers = async (names: string[], base: number) => {
    const out: { id: string; name: string }[] = [];
    for (let i = 0; i < names.length; i++) {
      const phone = `+99450${String(base + i).padStart(7, "0")}`;
      const rec = await prisma.customer.upsert({
        where: { salonId_phone: { salonId, phone } },
        create: { salonId, name: names[i], phone, waOptIn: true },
        update: { name: names[i] },
      });
      out.push({ id: rec.id, name: rec.name });
    }
    return out;
  };
  const maleCustomers = await mkCustomers(MALE_NAMES, 1010000);
  const femaleCustomers = await mkCustomers(FEMALE_NAMES, 2010000);
  console.log(`  customers: ${maleCustomers.length + femaleCustomers.length}`);

  // --- appointments ------------------------------------------------------
  const today = bakuToday();
  const nowMin = bakuMinutesOfDay(new Date());
  let created = 0;
  let skipped = 0;
  const visitBump = new Map<string, Date>(); // customerId -> last completed instant

  for (let delta = -DAYS_BACK; delta <= DAYS_FWD; delta++) {
    const { ymd, weekday } = ymdOffset(today, delta);
    const isPast = delta < 0;
    const isToday = delta === 0;
    const weekend = weekday === 5 || weekday === 6; // Fri/Sat busier
    const busyP = weekend ? 0.72 : 0.5;

    for (const { id: employeeId, def } of emps) {
      if (!def.workdays.includes(weekday)) continue;
      const pool = def.audience === Audience.MALE ? maleCustomers : femaleCustomers;

      let cursor = def.startMin;
      while (cursor < def.endMin - 30) {
        // lunch-ish gap around 13:00–14:00
        if (cursor >= 780 && cursor < 840) { cursor = 840; continue; }
        if (!chance(busyP)) { cursor += 30; continue; }

        const key = pick(def.services);
        const s = SERVICES[key];
        const end = cursor + s.durationMin + s.bufferMin;
        if (end > def.endMin) break;

        // status
        let status: AppointmentStatus = AppointmentStatus.CONFIRMED;
        if (isPast) {
          status = chance(0.08) ? AppointmentStatus.NO_SHOW
            : chance(0.06) ? AppointmentStatus.CANCELLED
            : AppointmentStatus.COMPLETED;
        } else if (isToday && cursor < nowMin) {
          status = AppointmentStatus.COMPLETED;
        }

        const customer = pick(pool);
        const startsAt = bakuWallClockToUtc(ymd, cursor);
        const endsAt = new Date(startsAt.getTime() + (s.durationMin + s.bufferMin) * 60_000);
        try {
          await prisma.appointment.create({
            data: {
              salonId, employeeId, serviceId: svcId[key], customerId: customer.id,
              startsAt, endsAt, status, priceMinor: s.priceMinor, source: "DASHBOARD",
            },
          });
          created++;
          if (status === AppointmentStatus.COMPLETED) {
            const prev = visitBump.get(customer.id);
            if (!prev || startsAt > prev) visitBump.set(customer.id, startsAt);
          }
        } catch {
          skipped++; // overlaps an existing appointment — fine on re-runs
        }
        cursor = end + pick([0, 0, 15, 30]);
      }
    }
  }
  console.log(`  appointments: ${created} created, ${skipped} skipped (overlap)`);

  // --- refresh customer visit stats from COMPLETED history ---------------
  for (const [customerId, lastVisitAt] of visitBump) {
    const totalVisits = await prisma.appointment.count({
      where: { customerId, status: AppointmentStatus.COMPLETED },
    });
    await prisma.customer.update({ where: { id: customerId }, data: { totalVisits, lastVisitAt } });
  }

  console.log("Done.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
