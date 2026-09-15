// Turns the rows getSession() loaded into the Session every guard reads.
//
// PURE, like ./permissions and ./access: no cookies, no Prisma, no next/headers.
// getSession() reads the cookie and the database and hands the result here, so
// the rules that decide what a login may reach — blocked or not, which salon,
// which permissions — are tested without either (session-state.test.ts).

import type { Plan } from "@prisma/client";
import { featuresFor, limitsFor } from "../plans";
import { staffBlockedReason, type StaffBlockedReason } from "./access";
import {
  appRoleOf,
  isEmployeeLogin,
  rolePermissions,
  roleOnPlan,
  spansAllBranches,
  type AppRole,
  type Permission,
} from "./permissions";

export type { StaffBlockedReason };

export interface SessionBranch {
  id: string;
  name: string;
  address: string | null;
}

export interface Session {
  user: {
    id: string;
    email: string;
    fullName: string | null;
    isPlatformAdmin: boolean;
  };
  /**
   * The product role of the user's (single, MVP) membership: OWNER, ADMIN,
   * FINANCE or MASTER. Null without a membership, as for a platform admin, and
   * for a membership whose stored role this code does not know.
   */
  appRole: AppRole | null;
  /**
   * What that role may do in its salon, before the plan is considered (see
   * accessRefusal). Empty for a blocked login. Ask it with can() or the guards —
   * never by comparing appRole.
   */
  permissions: readonly Permission[];
  /**
   * Employee the membership is tied to. Always set for a master's login (that is
   * what makes it "this master's account"); optional for reception and finance,
   * who may be linked to see their own payout statement; null for the owner.
   */
  employeeId: string | null;
  /**
   * Why this login is currently denied its salon, or null when it is fine. When
   * set, `salonId` is deliberately null and `permissions` empty, so every guard
   * (`requirePermission`, `where: { salonId }`) fails closed without knowing
   * this rule exists; the dashboard layout reads the reason only to explain it.
   */
  staffBlocked: StaffBlockedReason | null;
  /**
   * The salon every dashboard page/action is scoped to. For a role that spans
   * the account on a multi-branch (Pro) plan this is the branch picked in the
   * switcher (sb_branch cookie); otherwise the membership's home salon.
   */
  salonId: string | null;
  /** Account behind the membership, if any. */
  accountId: string | null;
  /** Effective (time-aware) plan of the account — FREE when no membership. */
  plan: Plan;
  /** Whether the effective plan includes multi-branch support. */
  multiBranch: boolean;
  /**
   * How many branches the account may have in total: the plan's maxBranches
   * plus paid extra slots (Subscription.extraBranches, Pro only).
   */
  maxBranches: number;
  /** ACTIVE salons (branches) of the account, oldest (primary) first. */
  branches: SessionBranch[];
  /**
   * Legal-document versions the account last accepted. Compared against
   * LEGAL_DOC_VERSION by the dashboard's re-consent gate; null when the account
   * predates consent capture (also treated as stale).
   */
  legal: { offerVersion: string | null; privacyVersion: string | null };
  isAdmin: boolean;
}

/** What getSession() read: the user, their membership, and the request's cookie. */
export interface SessionSource {
  user: Session["user"];
  membership: {
    /** Membership.role as stored — a string, so an unknown value can be refused. */
    role: string;
    salonId: string | null;
    accountId: string;
    employeeId: string | null;
    disabledAt: Date | null;
    employee: { isActive: boolean } | null;
    account: {
      offerVersion: string | null;
      privacyVersion: string | null;
      subscription: { extraBranches: number } | null;
      /** ACTIVE salons, oldest first. */
      salons: SessionBranch[];
    };
  } | null;
  /** effectivePlan() of the membership's subscription; FREE without one. */
  plan: Plan;
  /** The sb_branch cookie as sent, not yet validated. */
  branchCookie: string | undefined;
}

export interface BuiltSession {
  session: Session;
  /** The stored role when it is one appRoleOf() does not know, for the caller to log. */
  unknownRole: string | null;
}

export function buildSession(source: SessionSource): BuiltSession {
  const { user, membership, plan } = source;
  const appRole = membership ? appRoleOf(membership.role) : null;
  const unknownRole = membership && appRole === null ? membership.role : null;
  const multiBranch = featuresFor(plan).multiBranch;

  // Is this login still entitled to its salon? Derived here, per request, from
  // the plan, the membership and the employee row — never from the cookie — so a
  // downgrade or a switch-off takes effect on the very next page load rather than
  // whenever the session happens to expire. An unknown role is blocked outright:
  // there is no row of the permission table to give it.
  let staffBlocked: StaffBlockedReason | null = null;
  if (membership && appRole === null) staffBlocked = "role";
  else if (membership && appRole !== null) {
    staffBlocked = staffBlockedReason({
      roleOnPlan: roleOnPlan(appRole, plan),
      // account.salons holds only ACTIVE branches. A pinned role whose home salon
      // is not among them — suspended, or missing altogether — has no branch to
      // work in. A role that spans the account is not tied to one.
      branchActive:
        spansAllBranches(appRole) ||
        (membership.salonId !== null &&
          membership.account.salons.some((s) => s.id === membership.salonId)),
      disabled: membership.disabledAt !== null,
      employeeLogin: isEmployeeLogin(appRole),
      employeeIsActive: membership.employee?.isActive,
    });
  }

  // Paid extra slots only count while the plan actually has multi-branch —
  // after a downgrade they lie dormant until the account is Pro again.
  const maxBranches =
    limitsFor(plan).maxBranches +
    (multiBranch ? (membership?.account.subscription?.extraBranches ?? 0) : 0);
  const branches = membership?.account.salons ?? [];

  // Default scope: the membership's home salon. A role that spans the account
  // may override it on a multi-branch (Pro) account via the switcher cookie —
  // but only to a salon that is still an ACTIVE member of THEIR account. Every
  // other role stays pinned to its own.
  let salonId = membership?.salonId ?? null;
  // Fail closed: a blocked login keeps a valid session (so the layout can say
  // why) but carries no salon and no permissions, which is what every dashboard
  // guard already refuses on. No other call site has to know this rule exists.
  if (staffBlocked) salonId = null;
  else if (appRole !== null && spansAllBranches(appRole)) {
    if (!salonId) salonId = branches[0]?.id ?? null;
    const picked = source.branchCookie;
    if (picked && multiBranch && branches.some((b) => b.id === picked)) {
      salonId = picked;
    }
  }

  return {
    unknownRole,
    session: {
      user,
      appRole,
      permissions: appRole === null || staffBlocked ? [] : rolePermissions(appRole),
      employeeId: membership?.employeeId ?? null,
      staffBlocked,
      salonId,
      accountId: membership?.accountId ?? null,
      plan,
      multiBranch,
      maxBranches,
      branches,
      legal: {
        offerVersion: membership?.account.offerVersion ?? null,
        privacyVersion: membership?.account.privacyVersion ?? null,
      },
      isAdmin: user.isPlatformAdmin,
    },
  };
}
