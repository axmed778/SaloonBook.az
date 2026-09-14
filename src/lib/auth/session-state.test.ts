import { describe, it, expect } from "vitest";
import type { Plan } from "@prisma/client";
import { buildSession, type SessionSource } from "./session-state";
import { rolePermissions } from "./permissions";

// buildSession() is every rule getSession() applies after reading the cookie and
// the database: whether a login is closed, which salon it works in, what it may
// do. Pure, so each case is a row of data rather than a database fixture.

const PRIMARY = { id: "salon-primary", name: "Primary", address: null };
const SECOND = { id: "salon-second", name: "Second", address: null };
const USER = { id: "user-1", email: "someone@example.com", fullName: null, isPlatformAdmin: false };

type MembershipOverrides = Partial<NonNullable<SessionSource["membership"]>>;

function source(
  role: string,
  plan: Plan,
  membership: MembershipOverrides = {},
  branchCookie?: string,
): SessionSource {
  return {
    user: USER,
    membership: {
      role,
      salonId: PRIMARY.id,
      accountId: "account-1",
      employeeId: null,
      disabledAt: null,
      employee: null,
      account: {
        offerVersion: null,
        privacyVersion: null,
        subscription: { extraBranches: 0 },
        salons: [PRIMARY, SECOND],
      },
      ...membership,
    },
    plan,
    branchCookie,
  };
}

/** A master's login with a working employee behind it. */
const masterLogin = { employeeId: "emp-1", employee: { isActive: true } };

describe("a closed login", () => {
  const cases: [label: string, SessionSource, reason: "plan" | "inactive" | "role"][] = [
    ["a master's login on FREE", source("STAFF", "FREE", masterLogin), "plan"],
    ["a reception login on FREE", source("ADMIN", "FREE"), "plan"],
    ["a finance login on Salon, which lacks finance logins", source("FINANCE", "BASIC"), "plan"],
    ["a reception login the owner switched off", source("ADMIN", "PRO", { disabledAt: new Date() }), "inactive"],
    ["a finance login the owner switched off", source("FINANCE", "PRO", { disabledAt: new Date() }), "inactive"],
    ["a master's login after the master was deactivated", source("STAFF", "PRO", { employeeId: "emp-1", employee: { isActive: false } }), "inactive"],
    ["a master's login whose employee is gone", source("STAFF", "PRO", { employeeId: null, employee: null }), "inactive"],
    ["a login with a role this build does not know", source("RECEPTION", "PRO"), "role"],
  ];

  it.each(cases)("%s is blocked, with no permissions and no salon", (_label, src, reason) => {
    const { session } = buildSession(src);
    expect(session.staffBlocked).toBe(reason);
    expect(session.permissions).toEqual([]);
    expect(session.salonId).toBeNull();
  });

  it("stays closed whatever branch the cookie asks for", () => {
    const { session } = buildSession(
      source("FINANCE", "PRO", { disabledAt: new Date() }, SECOND.id),
    );
    expect(session.salonId).toBeNull();
  });

  it("reports an unknown role for the caller to log, and gives it no role", () => {
    const { session, unknownRole } = buildSession(source("RECEPTION", "PRO"));
    expect(unknownRole).toBe("RECEPTION");
    expect(session.appRole).toBeNull();
  });
});

describe("a working login", () => {
  it("leaves the owner open on FREE, with every permission", () => {
    const { session, unknownRole } = buildSession(source("OWNER", "FREE"));
    expect(session.staffBlocked).toBeNull();
    expect(session.permissions).toEqual(rolePermissions("OWNER"));
    expect(session.salonId).toBe(PRIMARY.id);
    expect(unknownRole).toBeNull();
  });

  it("gives reception its own permissions at its home branch", () => {
    const { session } = buildSession(source("ADMIN", "START", { salonId: SECOND.id }));
    expect(session.appRole).toBe("ADMIN");
    expect(session.permissions).toEqual(rolePermissions("ADMIN"));
    expect(session.salonId).toBe(SECOND.id);
  });

  it("starts finance, which has no home branch, at the account's primary salon", () => {
    const { session } = buildSession(source("FINANCE", "PRO", { salonId: null }));
    expect(session.staffBlocked).toBeNull();
    expect(session.salonId).toBe(PRIMARY.id);
  });

  it("keeps a reception login open when the employee it is linked to is deactivated", () => {
    const { session } = buildSession(
      source("ADMIN", "PRO", { employeeId: "emp-7", employee: { isActive: false } }),
    );
    expect(session.staffBlocked).toBeNull();
    expect(session.employeeId).toBe("emp-7");
  });

  it("gives a platform admin, who has no membership, no salon and no permissions but no block", () => {
    const { session, unknownRole } = buildSession({
      user: { ...USER, isPlatformAdmin: true },
      membership: null,
      plan: "FREE",
      branchCookie: SECOND.id,
    });
    expect(session.isAdmin).toBe(true);
    expect(session.appRole).toBeNull();
    expect(session.staffBlocked).toBeNull();
    expect(session.permissions).toEqual([]);
    expect(session.salonId).toBeNull();
    expect(unknownRole).toBeNull();
  });
});

describe("the branch cookie", () => {
  it.each(["OWNER", "FINANCE"])("moves %s, which spans the account, to the picked branch", (role) => {
    const { session } = buildSession(source(role, "PRO", {}, SECOND.id));
    expect(session.salonId).toBe(SECOND.id);
  });

  it("does not move reception, which is pinned to its branch", () => {
    const { session } = buildSession(source("ADMIN", "PRO", {}, SECOND.id));
    expect(session.salonId).toBe(PRIMARY.id);
  });

  it("does not move a master, who is pinned to their branch", () => {
    const { session } = buildSession(source("STAFF", "PRO", masterLogin, SECOND.id));
    expect(session.salonId).toBe(PRIMARY.id);
  });

  it("is ignored on a plan without multi-branch", () => {
    const { session } = buildSession(source("OWNER", "BASIC", {}, SECOND.id));
    expect(session.salonId).toBe(PRIMARY.id);
  });

  it("is ignored when it names a salon that is not an active branch of the account", () => {
    const { session } = buildSession(source("OWNER", "PRO", {}, "salon-of-someone-else"));
    expect(session.salonId).toBe(PRIMARY.id);
  });
});

describe("branch limits", () => {
  it("counts paid extra branches only while the plan has multi-branch", () => {
    const extra = (plan: Plan) =>
      buildSession(
        source("OWNER", plan, {
          account: {
            offerVersion: null,
            privacyVersion: null,
            subscription: { extraBranches: 2 },
            salons: [PRIMARY],
          },
        }),
      ).session.maxBranches;
    expect(extra("PRO")).toBe(3 + 2);
    expect(extra("BASIC")).toBe(1);
  });
});
