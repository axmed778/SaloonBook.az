import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { hashPassword, passwordIssues } from "@/lib/auth/password";
import { setSession } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

// Self-serve salon signup. Creates the whole tenant in one transaction:
// User (hashed) + Account + Subscription + Salon + OWNER Membership. Platform
// admins are seed-only — never self-registerable here.
const bodySchema = z
  .object({
    email: z.string().email().max(254),
    password: z.string().min(1).max(200),
    confirmPassword: z.string().min(1).max(200),
    salonName: z.string().min(2).max(120),
    audience: z.enum(["MALE", "FEMALE", "ALL"]).default("ALL"),
    fullName: z.string().max(120).optional(),
  })
  .refine((d) => d.password === d.confirmPassword, {
    message: "Şifrələr uyğun gəlmir.",
    path: ["confirmPassword"],
  });

/** Slugify a salon name into a URL-safe, lowercase, hyphenated string. */
function slugify(input: string): string {
  return input
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "") // strip diacritics
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

/** Returns a slug not already taken, appending -2, -3, ... if needed. */
async function uniqueSlug(base: string): Promise<string> {
  const root = base || "salon";
  let candidate = root;
  let n = 1;
  // Bounded loop; collisions are rare.
  while (await prisma.salon.findUnique({ where: { slug: candidate }, select: { id: true } })) {
    n += 1;
    candidate = `${root}-${n}`;
  }
  return candidate;
}

export async function POST(req: NextRequest) {
  const json = await req.json().catch(() => null);
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid body", issues: parsed.error.issues },
      { status: 400 },
    );
  }
  const { email, password, salonName, audience, fullName } = parsed.data;

  // Enforce password policy server-side (the client also shows the rules).
  const issues = passwordIssues(password);
  if (issues.length > 0) {
    return NextResponse.json({ error: "Şifrə tələblərə uyğun deyil.", issues }, { status: 400 });
  }

  const normalizedEmail = email.trim().toLowerCase();
  const existing = await prisma.user.findUnique({
    where: { email: normalizedEmail },
    select: { id: true },
  });
  if (existing) {
    return NextResponse.json({ error: "Bu e-poçt artıq qeydiyyatdadır." }, { status: 409 });
  }

  const slug = await uniqueSlug(slugify(salonName));
  const passwordHash = hashPassword(password);

  let userId: string;
  try {
    userId = await prisma.$transaction(async (tx) => {
      const account = await tx.account.create({
        data: {
          name: salonName,
          subscription: { create: { plan: "FREE", status: "TRIALING" } },
          salons: { create: { slug, name: salonName, audience } },
        },
        include: { salons: true },
      });
      const salon = account.salons[0];

      const user = await tx.user.create({
        data: {
          email: normalizedEmail,
          fullName: fullName?.trim() || null,
          passwordHash,
        },
        select: { id: true },
      });

      await tx.membership.create({
        data: {
          userId: user.id,
          accountId: account.id,
          role: "OWNER",
          salonId: salon.id,
        },
      });

      return user.id;
    });
  } catch (e) {
    // Unique-constraint race (email/slug) → conflict; everything else → 500.
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      return NextResponse.json({ error: "Bu e-poçt artıq qeydiyyatdadır." }, { status: 409 });
    }
    console.error("[auth/register] error", e);
    return NextResponse.json({ error: "Qeydiyyat alınmadı." }, { status: 500 });
  }

  await setSession(userId);
  return NextResponse.json({ ok: true });
}
