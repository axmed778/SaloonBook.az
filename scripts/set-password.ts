// One-off admin utility: set a user's password by email.
// Usage (run against whichever DB DATABASE_URL points at):
//   export DATABASE_URL="postgresql://...neon.../db?sslmode=require"
//   npx tsx scripts/set-password.ts <email> '<newPassword>'
//
// The new password must satisfy the same policy as signup (8+ chars, upper,
// lower, digit, special). Quote the password so the shell doesn't eat symbols.
import { PrismaClient } from "@prisma/client";
import { hashPassword, passwordIssues } from "../src/lib/auth/password";

const prisma = new PrismaClient();

async function main() {
  const [, , emailArg, password] = process.argv;
  if (!emailArg || !password) {
    console.error("Usage: npx tsx scripts/set-password.ts <email> '<newPassword>'");
    process.exitCode = 1;
    return;
  }

  const email = emailArg.trim().toLowerCase();

  const issues = passwordIssues(password);
  if (issues.length > 0) {
    console.error(`Password rejected for '${email}':`);
    for (const i of issues) console.error(`  - ${i}`);
    process.exitCode = 1;
    return;
  }

  const user = await prisma.user.findUnique({ where: { email }, select: { id: true } });
  if (!user) {
    console.error(`No user found with email '${email}'.`);
    process.exitCode = 1;
    return;
  }

  await prisma.user.update({
    where: { id: user.id },
    data: { passwordHash: hashPassword(password) },
  });
  console.log(`✓ Password updated for '${email}'.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
