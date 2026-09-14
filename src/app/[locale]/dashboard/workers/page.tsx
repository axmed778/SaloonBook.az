import { getTranslations, getLocale } from "next-intl/server";
import { requirePagePermission } from "@/lib/auth/guards";
import {
  appRoleOf,
  canAssignRole,
  hasPermission,
  isEmployeeLogin,
  isTeamRole,
  spansAllBranches,
  TEAM_ROLES,
} from "@/lib/auth/permissions";
import { prisma } from "@/lib/prisma";
import { intlLocale } from "@/i18n/format";
import { timeOffRows } from "../_components/time-off-rows";
import { WorkersManager } from "./workers-manager";
import type { TeamLoginRow } from "./team-logins";

export const dynamic = "force-dynamic";

// Staff management: phones, working hours, services, and every login the salon
// hands out. staff.manage, not schedule.read — reception plans time off on
// /dashboard/time-off, which shows none of this.
export default async function WorkersPage() {
  const session = await requirePagePermission("staff.manage");
  if (!session.salonId) {
    const t = await getTranslations("Dashboard");
    return <p className="text-sm text-muted-foreground">{t("noSalonLinked")}</p>;
  }
  const salonId = session.salonId;
  const accountId = session.accountId;
  const df = intlLocale(await getLocale());
  // The role, not the plan: an owner whose plan lapsed still sees their team
  // logins, so they can switch them off. Creating one is checked per role below.
  const showTeam = accountId !== null && hasPermission(session, "roles.assign");

  const [employees, services, team] = await Promise.all([
    prisma.employee.findMany({
      where: { salonId },
      orderBy: [{ isActive: "desc" }, { createdAt: "asc" }],
      select: {
        id: true,
        name: true,
        position: true,
        phone: true,
        isActive: true,
        audience: true,
        // The login linked to this employee: the master's own, or a reception or
        // finance login linked for their payout statement.
        membership: { select: { role: true, user: { select: { email: true } } } },
        services: { select: { serviceId: true } },
        workingHours: { select: { weekday: true, startMin: true, endMin: true } },
        // Current + upcoming time off (past entries don't matter for planning).
        timeOff: {
          where: { endsAt: { gt: new Date() } },
          orderBy: { startsAt: "asc" },
          select: { id: true, startsAt: true, endsAt: true, reason: true },
        },
      },
    }),
    prisma.service.findMany({
      where: { salonId },
      orderBy: { name: "asc" },
      select: { id: true, name: true, isActive: true },
    }),
    showTeam && accountId
      ? prisma.membership.findMany({
          where: { accountId, role: { in: [...TEAM_ROLES] } },
          orderBy: { user: { createdAt: "asc" } },
          select: {
            id: true,
            role: true,
            disabledAt: true,
            salon: { select: { name: true } },
            employee: { select: { name: true } },
            user: { select: { email: true, fullName: true } },
          },
        })
      : Promise.resolve([]),
  ]);

  const employeeRows = employees.map((e) => {
    const linkedRole = e.membership ? appRoleOf(e.membership.role) : null;
    return {
      id: e.id,
      name: e.name,
      position: e.position,
      phone: e.phone,
      isActive: e.isActive,
      audience: e.audience,
      // Only the master's own login is this row's "access"; a team login linked
      // to the employee is listed with the team logins instead.
      access:
        e.membership && linkedRole && isEmployeeLogin(linkedRole)
          ? { email: e.membership.user.email }
          : null,
      serviceIds: e.services.map((s) => s.serviceId),
      hours: e.workingHours.map((h) => ({
        weekday: h.weekday,
        startMin: h.startMin,
        endMin: h.endMin,
      })),
      timeOff: timeOffRows(e.timeOff, df),
    };
  });

  const teamLogins: TeamLoginRow[] = team.flatMap((m) => {
    const role = appRoleOf(m.role);
    if (!role || !isTeamRole(role)) return [];
    return [
      {
        id: m.id,
        role,
        name: m.user.fullName?.trim() || m.user.email,
        email: m.user.email,
        active: m.disabledAt === null,
        branch: spansAllBranches(role) ? null : (m.salon?.name ?? null),
        employeeName: m.employee?.name ?? null,
      },
    ];
  });

  return (
    <WorkersManager
      employees={employeeRows}
      services={services}
      // Staff logins are a paid feature; the actions re-check it server-side.
      staffLoginsEnabled={canAssignRole(session, "MASTER")}
      team={
        showTeam
          ? {
              logins: teamLogins,
              assignable: { ADMIN: canAssignRole(session, "ADMIN"), FINANCE: canAssignRole(session, "FINANCE") },
              // Active employees of this branch with no login of any kind yet.
              linkable: employees
                .filter((e) => e.isActive && !e.membership)
                .map((e) => ({ id: e.id, name: e.name })),
              multiBranch: session.multiBranch,
            }
          : null
      }
    />
  );
}
