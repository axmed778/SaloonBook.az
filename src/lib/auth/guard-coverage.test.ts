import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { PERMISSION_PLAN_FEATURE, ROLE_PLAN_FEATURE, sectionPermission } from "./permissions";

// Static checks over the source tree, for the ways an authorization rule gets
// lost without any other test noticing. Each one is a bug this codebase has
// actually had.

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const SRC = join(ROOT, "src");
const DASHBOARD = join(SRC, "app", "[locale]", "dashboard");

function filesUnder(dir: string, keep: (path: string) => boolean): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return filesUnder(path, keep);
    return keep(path) ? [path] : [];
  });
}

/** Repo-relative, forward slashes: the same on Windows and in CI. */
function rel(path: string): string {
  return relative(ROOT, path).split(sep).join("/");
}

const read = (path: string) => readFileSync(path, "utf8");
const isTest = (path: string) => /\.test\.tsx?$/.test(path);
const isComment = (line: string) => /^\s*(?:\/\/|\*|\/\*)/.test(line);

describe("role names in app code", () => {
  // Checks ask for a permission. A comparison against a role name anywhere but
  // permissions.ts is a rule the permission table does not know about — which is
  // how the "not a master, so the owner" checks came to fail open for any role
  // added after them. Every shape such a check takes is listed.
  const NAME = String.raw`["'\x60](?:OWNER|STAFF|ADMIN|FINANCE|MASTER)["'\x60]`;
  const ROLE_CHECK = new RegExp(
    [
      String.raw`\b(?:role|appRole)\s*[!=]==?\s*["'\x60]`, // role === "…"
      String.raw`[!=]==?\s*${NAME}`, //                          … === "OWNER"
      String.raw`\bcase\s+${NAME}`, //                            case "OWNER":
      String.raw`\.includes\(\s*${NAME}`, //                      roles.includes("OWNER")
      String.raw`\bisStaff\b`,
    ].join("|"),
  );

  it("catches each shape of role check, and not the database filters that merely name a role", () => {
    const checks = [
      'if (session.role === "OWNER") {',
      "if (appRole !== 'ADMIN') return;",
      'const owner = membership.role == "OWNER";',
      '    case "FINANCE":',
      'if (["OWNER", "ADMIN"].includes("OWNER")) {',
      "if (session.isStaff) {",
    ];
    const notChecks = [
      'where: { salonId: id, role: "STAFF" },',
      'const branchLogins = { salonId: id, role: { not: "OWNER" as const } };',
      '  OWNER: "roleOwner",',
      '    case "plan":',
      "role: { in: [...TEAM_ROLES] },",
    ];
    for (const line of checks) expect(ROLE_CHECK.test(line), line).toBe(true);
    for (const line of notChecks) expect(ROLE_CHECK.test(line), line).toBe(false);
  });

  // Allowed, each for a reason:
  //   permissions.ts           the one place roles are mapped to permissions;
  //   the platform admin panel shows which membership is an account's owner —
  //                            display, gated by isPlatformAdmin, not by role.
  const allowed = (path: string) =>
    path === "src/lib/auth/permissions.ts" ||
    path.startsWith("src/app/[locale]/dashboard/admin/");

  it("appear in checks only inside permissions.ts", () => {
    const files = [
      ...filesUnder(SRC, (p) => /\.tsx?$/.test(p) && !isTest(p)),
      ...filesUnder(join(ROOT, "worker"), (p) => /\.ts$/.test(p)),
    ];
    const offenders = files
      .filter((file) => !allowed(rel(file)))
      .flatMap((file) =>
        read(file)
          .split(/\r?\n/)
          .map((line, i) => ({ line, at: `${rel(file)}:${i + 1}` }))
          // Comments may describe the old rules; only code is held to this.
          .filter(({ line }) => !isComment(line) && ROLE_CHECK.test(line))
          .map(({ line, at }) => `${at}  ${line.trim()}`),
      );
    expect(offenders).toEqual([]);
  });
});

describe("plan checks", () => {
  // The rule written at the top of permissions.ts: a plan feature that gates a
  // permission or a role is read there and nowhere else, so every such check
  // goes through roleOnPlan() or accessRefusal()/can(). Features that gate
  // neither (multiBranch, ownWhatsappNumber, …) may be read anywhere.
  const gated = [
    ...new Set([
      ...Object.values(PERMISSION_PLAN_FEATURE),
      ...Object.values(ROLE_PLAN_FEATURE).filter((f) => f !== null),
    ]),
  ];
  const DIRECT_READ = new RegExp(
    String.raw`(?:featuresFor\([^;\n]*?\)|PLAN_FEATURES(?:\[[^\]]*\]|\.[A-Z]+)|\bfeatures)\.(?:${gated.join("|")})\b`,
  );

  it("catches a direct read of a gated feature, and not of an ungated one", () => {
    const reads = [
      "if (!featuresFor(plan).payroll) {",
      "const canExport = featuresFor(effectivePlan(sub)).exports;",
      "if (PLAN_FEATURES.FREE.staffRoles) {",
      "staffRolesEnabled: features.staffRoles,",
      "return PLAN_FEATURES[plan].financeLogins;",
    ];
    const notReads = [
      "const multiBranch = featuresFor(plan).multiBranch;",
      "ownNumberEligible: featuresFor(effective).ownWhatsappNumber,",
    ];
    for (const line of reads) expect(DIRECT_READ.test(line), line).toBe(true);
    for (const line of notReads) expect(DIRECT_READ.test(line), line).toBe(false);
  });

  it("reads features that gate a permission or a role only in permissions.ts", () => {
    const allowed = new Set(["src/lib/auth/permissions.ts", "src/lib/plans.ts"]);
    const files = [
      ...filesUnder(SRC, (p) => /\.tsx?$/.test(p) && !isTest(p)),
      ...filesUnder(join(ROOT, "worker"), (p) => /\.ts$/.test(p)),
    ];
    const offenders = files
      .filter((file) => !allowed.has(rel(file)))
      .flatMap((file) =>
        read(file)
          .split(/\r?\n/)
          .map((line, i) => ({ line, at: `${rel(file)}:${i + 1}` }))
          .filter(({ line }) => !isComment(line) && DIRECT_READ.test(line))
          .map(({ line, at }) => `${at}  ${line.trim()}`),
      );
    expect(offenders).toEqual([]);
  });
});

describe("server actions", () => {
  // A server action is a POST endpoint of its own: the page that renders its
  // button protects nothing. So every exported action opens with its guard, as
  // its FIRST statement — anything before it, even parsing input or loading
  // translations, runs for a caller nobody has checked. updateSlug had no guard
  // at all, and a master's login could rename the salon's link.
  //
  // Every "use server" file under src is held to this, not just the dashboard's:
  // the client profile and the PWA prompt are POST endpoints too.
  // Line by line rather than one regex over the file: a pattern that skips any
  // number of leading block comments backtracks exponentially on long files.
  function isActionFile(text: string): boolean {
    const lines = text.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (line === "" || line.startsWith("//")) continue;
      if (line.startsWith("/*")) {
        while (i < lines.length && !lines[i].includes("*/")) i += 1;
        continue;
      }
      return /^["']use server["'];?$/.test(line);
    }
    return false;
  }
  const files = filesUnder(SRC, (p) => /\.tsx?$/.test(p) && !isTest(p) && isActionFile(read(p)));

  // `const x = await requireFoo(…)` or `await requireFoo(…)`. getClientSession is
  // the client area's guard: it returns the verified customer or nothing.
  const GUARD_FIRST = /^(?:(?:const|let)\s+[^=]+=\s*)?await\s+(?:require[A-Z]\w*|getClientSession)\(/;

  // Actions with no caller to check, each with the reason.
  const NO_CALLER: Record<string, string> = {
    "src/components/pwa/actions.ts: dismissInstallPrompt":
      "sets the install-prompt cookie on the caller's own browser and reads or writes nothing else",
  };

  /** Each exported action and the first statement of its body. */
  function exportedActions(file: string): { id: string; first: string }[] {
    const lines = read(file).split(/\r?\n/);
    return lines.flatMap((line, start) => {
      const name = /^export async function (\w+)/.exec(line)?.[1];
      if (!name) return [];
      // The signature may wrap; the body opens on the first line ending in "{".
      let open = start;
      while (open < lines.length && !/\{\s*$/.test(lines[open])) open += 1;
      let body = open + 1;
      while (body < lines.length && (lines[body].trim() === "" || isComment(lines[body]))) {
        body += 1;
      }
      return [{ id: `${rel(file)}: ${name}`, first: (lines[body] ?? "").trim() }];
    });
  }

  const actions = files.flatMap(exportedActions);

  it("finds the action files and their actions, so the checks below are not vacuous", () => {
    expect(files.map(rel)).toEqual(
      expect.arrayContaining([
        "src/app/[locale]/dashboard/actions.ts",
        "src/app/[locale]/dashboard/admin/actions.ts",
        "src/app/[locale]/dashboard/clients/actions.ts",
        "src/app/[locale]/dashboard/payroll/actions.ts",
        "src/app/[locale]/dashboard/services/actions.ts",
        "src/app/[locale]/dashboard/settings/actions.ts",
        "src/app/[locale]/dashboard/workers/actions.ts",
        "src/app/[locale]/profile/actions.ts",
        "src/components/pwa/actions.ts",
      ]),
    );
    expect(actions.length).toBeGreaterThan(40);
  });

  it("each open with a guard as their first statement", () => {
    const unguarded = actions
      .filter(({ id, first }) => !(id in NO_CALLER) && !GUARD_FIRST.test(first))
      .map(({ id, first }) => `${id}  — starts with: ${first}`);
    expect(unguarded).toEqual([]);
  });

  it("lists only exemptions that still exist", () => {
    const ids = new Set(actions.map((a) => a.id));
    for (const id of Object.keys(NO_CALLER)) expect(ids.has(id), id).toBe(true);
  });
});

describe("dashboard pages", () => {
  // A page is a GET anyone signed in can type into the address bar. The client
  // profile had no role check of its own, so a master — whose bookings carry
  // each customer's id — could open a customer's phone and history directly.
  const pages = filesUnder(DASHBOARD, (p) => /[\\/]page\.tsx$/.test(p)).map(rel);
  // Platform-admin pages check their own flag.
  const EXEMPT = [
    "src/app/[locale]/dashboard/admin/page.tsx",
    "src/app/[locale]/dashboard/ig-digest/page.tsx",
  ];

  it("finds the pages, so the check below is not vacuous", () => {
    expect(pages).toEqual(
      expect.arrayContaining([
        ...EXEMPT,
        "src/app/[locale]/dashboard/page.tsx",
        "src/app/[locale]/dashboard/clients/[id]/page.tsx",
        "src/app/[locale]/dashboard/time-off/page.tsx",
      ]),
    );
  });

  it.each(pages.filter((page) => !EXEMPT.includes(page)))(
    "%s gates on its section's permission",
    (page) => {
      const route = page.replace("src/app/[locale]", "").replace(/\/page\.tsx$/, "");
      const needed = sectionPermission(route);
      const source = read(join(ROOT, page));
      const gate = String.raw`requirePage(?:Permission|Access)\("`;
      if (needed) expect(source).toMatch(new RegExp(`${gate}${needed.replace(".", "\\.")}"\\)`));
      else expect(source).toMatch(new RegExp(`${gate}[\\w.]+"\\)`));
    },
  );
});

describe("dashboard API routes", () => {
  const routes = filesUnder(join(SRC, "app", "api", "dashboard"), (p) => /[\\/]route\.ts$/.test(p));

  it("ask the role and the plan together before answering", () => {
    expect(routes.length).toBeGreaterThan(0);
    for (const route of routes) expect(read(route), rel(route)).toMatch(/\baccessRefusal\(/);
  });
});

describe("payment data on a booking surface", () => {
  // A master must see no money at all, and the way that holds is that the page
  // never asks for it: bookingSelectForViewer(viewer, { payments }) decides
  // whether the rows are READ, and the serializer whether the key EXISTS. Both
  // default to false, so forgetting is safe — but a new surface that hardcodes
  // `payments: true` would hand every role the money, and the unit tests would
  // not notice, because they call the serializer directly with their own flag.
  //
  // So the flag has to come from canSeePayments(session), and that is checked
  // here, on the real call sites, rather than in a test that supplies its own.
  const HARDCODED = /payments:\s*(?:true|false)\b/;

  const surfaces = filesUnder(
    SRC,
    (p) =>
      /\.tsx?$/.test(p) &&
      !isTest(p) &&
      /\b(?:bookingSelectForViewer|serializeBookings?ForViewer)\(/.test(read(p)),
  );

  it("finds the surfaces that read bookings, so the checks below are not vacuous", () => {
    expect(surfaces.map(rel)).toEqual(
      expect.arrayContaining([
        "src/app/[locale]/dashboard/page.tsx",
        "src/app/[locale]/dashboard/calendar/page.tsx",
        "src/app/api/dashboard/export/appointments/route.ts",
      ]),
    );
  });

  it("never hardcodes the payments flag", () => {
    const offenders = surfaces.filter((f) => HARDCODED.test(read(f))).map(rel);
    expect(offenders).toEqual([]);
  });

  it("takes the flag from canSeePayments() wherever it asks for payments", () => {
    const asking = surfaces.filter((f) => /payments:/.test(read(f)));
    // Today: Today and the calendar ask; the CSV export deliberately does not
    // (phase 6 adds the finance exports).
    expect(asking.length).toBeGreaterThan(0);
    for (const file of asking) {
      expect(read(file), rel(file)).toMatch(/\bcanSeePayments\(/);
    }
  });

  it("catches the shapes that would slip money to a master", () => {
    expect(HARDCODED.test("select: bookingSelectForViewer(viewer, { payments: true })")).toBe(true);
    expect(HARDCODED.test("{ payments: false }")).toBe(true);
    expect(HARDCODED.test("{ payments: showPayments }")).toBe(false);
    expect(HARDCODED.test("{ payments: canSeePayments(session) }")).toBe(false);
  });
});
