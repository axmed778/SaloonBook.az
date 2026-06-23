// Quick demo: prints the seeded salon and live availability for a service.
import { prisma } from "../src/lib/prisma";
import { getAvailableSlots } from "../src/lib/availability";

async function main() {
  const salon = await prisma.salon.findUnique({
    where: { slug: "demostudio" },
    select: {
      id: true,
      name: true,
      services: { select: { id: true, name: true, priceMinor: true, durationMin: true } },
      employees: { select: { id: true, name: true } },
    },
  });
  if (!salon) throw new Error("seed not found");

  console.log(`Salon: ${salon.name} (/demostudio)`);
  console.log("Services:", salon.services.map((s) => `${s.name} ${s.priceMinor / 100}₼/${s.durationMin}m`));
  console.log("Staff:", salon.employees.map((e) => e.name));

  const service = salon.services.find((s) => s.name.includes("Saç"))!;
  // Ayan performs haircuts (per seed).
  const link = await prisma.serviceEmployee.findFirst({
    where: { serviceId: service.id },
    select: { employeeId: true, employee: { select: { name: true } } },
  });

  const day = "2026-06-24"; // a Wednesday — within Mon–Sat working hours
  const slots = await getAvailableSlots({
    serviceId: service.id,
    employeeId: link!.employeeId,
    dayYmd: day,
  });

  console.log(`\nAvailability for "${service.name}" with ${link!.employee.name} on ${day}:`);
  console.log(`  ${slots.length} slots — ${slots.slice(0, 8).map((s) => s.time).join(", ")} ...`);
  console.log(`  first slot UTC: ${slots[0]?.startUtc}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
