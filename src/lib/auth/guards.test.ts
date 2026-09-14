import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Plan } from "@prisma/client";
import { buildSession, type Session, type SessionSource } from "./session-state";

// The page and action guards, run against real sessions built by buildSession().
// Only what reaches outside the process is replaced: the session read (cookies +
// database), next-intl, and redirect() — which here throws a Redirect naming its
// target, the way the real one throws to stop rendering.

const { getSession, Redirect } = vi.hoisted(() => {
  class Redirect extends Error {
    href: string;
    constructor(href: string) {
      super(`redirect to ${href}`);
      this.href = href;
    }
  }
  return { getSession: vi.fn(), Redirect };
});

vi.mock("./session", () => ({ getSession }));
vi.mock("next-intl/server", () => ({
  getLocale: async () => "az",
  getTranslations: async () => (key: string) => key,
}));
vi.mock("@/i18n/navigation", () => ({
  redirect: ({ href }: { href: string }) => {
    throw new Redirect(href);
  },
}));

import {
  ACCESS_CLOSED_PATH,
  requirePageAccess,
  requirePagePermission,
  requirePermission,
} from "./guards";

const HOME = { id: "salon-1", name: "Salon", address: null };

/** A session as getSession() would return it for this membership. */
function sessionFor(
  role: string,
  plan: Plan,
  membership: Partial<NonNullable<SessionSource["membership"]>> = {},
): Session {
  return buildSession({
    user: { id: "user-1", email: "someone@example.com", fullName: null, isPlatformAdmin: false },
    membership: {
      role,
      salonId: HOME.id,
      accountId: "account-1",
      employeeId: null,
      disabledAt: null,
      employee: null,
      account: {
        offerVersion: null,
        privacyVersion: null,
        subscription: { extraBranches: 0 },
        salons: [HOME],
      },
      ...membership,
    },
    plan,
    branchCookie: undefined,
  }).session;
}

const master = { employeeId: "emp-1", employee: { isActive: true } };

/** Where a guard went: the redirect it threw, or the value it returned. */
async function outcome<T>(run: Promise<T>): Promise<{ redirect: string } | { value: T }> {
  try {
    return { value: await run };
  } catch (e) {
    if (e instanceof Redirect) return { redirect: e.href };
    throw e;
  }
}

beforeEach(() => getSession.mockReset());

describe("page guards and a closed login", () => {
  const closed: [label: string, Session, reason: string][] = [
    ["reception on a lapsed plan", sessionFor("ADMIN", "FREE"), "plan"],
    ["finance on a plan without finance logins", sessionFor("FINANCE", "BASIC"), "plan"],
    ["reception whose branch was suspended", sessionFor("ADMIN", "PRO", { salonId: "salon-suspended" }), "branch"],
    ["a master whose branch was suspended", sessionFor("STAFF", "PRO", { ...master, salonId: "salon-suspended" }), "branch"],
    ["reception switched off by the owner", sessionFor("ADMIN", "PRO", { disabledAt: new Date() }), "inactive"],
    ["a login with an unknown role", sessionFor("RECEPTION", "PRO"), "role"],
  ];

  it.each(closed)("requirePageAccess refuses %s, without a session", async (_label, session, reason) => {
    getSession.mockResolvedValue(session);
    const result = await outcome(requirePageAccess("clients.read"));
    expect(result).toEqual({ value: { granted: false, reason: "blocked", blocked: reason } });
  });

  it.each(closed)("requirePagePermission sends %s to the access-closed screen", async (_label, session) => {
    getSession.mockResolvedValue(session);
    expect(await outcome(requirePagePermission("clients.read"))).toEqual({ redirect: ACCESS_CLOSED_PATH });
  });

  it("sends a closed login to the access-closed screen from Today too, not back to Today", async () => {
    getSession.mockResolvedValue(sessionFor("ADMIN", "FREE"));
    expect(await outcome(requirePagePermission("bookings.read"))).toEqual({ redirect: ACCESS_CLOSED_PATH });
  });

  it("refuses a closed login's server actions", async () => {
    getSession.mockResolvedValue(sessionFor("STAFF", "PRO", { ...master, salonId: "salon-suspended" }));
    await expect(requirePermission("bookings.read")).rejects.toThrow("noSalon");
  });
});

describe("page guards otherwise", () => {
  it("sends a request without a session to the login page", async () => {
    getSession.mockResolvedValue(null);
    expect(await outcome(requirePageAccess("bookings.read"))).toEqual({ redirect: "/login" });
  });

  it("sends a role without the permission back to Today", async () => {
    getSession.mockResolvedValue(sessionFor("STAFF", "PRO", master));
    expect(await outcome(requirePagePermission("clients.read"))).toEqual({ redirect: "/dashboard" });
  });

  it("sends the owner to Billing when the plan lacks the page", async () => {
    getSession.mockResolvedValue(sessionFor("OWNER", "BASIC"));
    expect(await outcome(requirePagePermission("payroll.manage"))).toEqual({ redirect: "/dashboard/billing" });
    expect(await outcome(requirePageAccess("payroll.manage"))).toEqual({
      value: { granted: false, reason: "plan", canUpgrade: true },
    });
  });

  it("sends anyone else whose plan lacks the page to the plan-required screen", async () => {
    // Reception closes the shift, a Salon-plan feature; on Start its login works but the page does not.
    getSession.mockResolvedValue(sessionFor("ADMIN", "START"));
    expect(await outcome(requirePagePermission("shift.close"))).toEqual({
      redirect: "/dashboard/plan-required",
    });
  });

  it("hands a cleared login its session", async () => {
    const session = sessionFor("OWNER", "PRO");
    getSession.mockResolvedValue(session);
    expect(await outcome(requirePagePermission("payroll.manage"))).toEqual({ value: session });
  });

  it("lets a platform admin through with no salon", async () => {
    const admin = buildSession({
      user: { id: "admin-1", email: "admin@example.com", fullName: null, isPlatformAdmin: true },
      membership: null,
      plan: "FREE",
      branchCookie: undefined,
    }).session;
    getSession.mockResolvedValue(admin);
    expect(await outcome(requirePageAccess("clients.read"))).toEqual({
      value: { granted: true, session: admin },
    });
  });
});
