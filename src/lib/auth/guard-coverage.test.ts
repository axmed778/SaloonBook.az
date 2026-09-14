import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { sectionPermission } from "./permissions";

// Static checks over the source tree, for the ways an authorization rule gets
// lost without any other test noticing. Each one is a bug this codebase has
// actually had.

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const DASHBOARD = join(ROOT, "src", "app", "[locale]", "dashboard");

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

describe("role names in app code", () => {
  // Checks ask for a permission. A comparison against a role name anywhere but
  // permissions.ts is a rule the permission table does not know about — which is
  // how the "not a master, so the owner" checks came to fail open for any role
  // added after them.
  const ROLE_COMPARISON =
    /\b(?:role|appRole)\s*[!=]==?\s*["'`]|[!=]==?\s*["'`](?:OWNER|STAFF|ADMIN|FINANCE|MASTER)["'`]|\bisStaff\b/;

  // Allowed, each for a reason:
  //   permissions.ts           the one place roles are mapped to permissions;
  //   the platform admin panel shows which membership is an account's owner —
  //                            display, gated by isPlatformAdmin, not by role.
  const allowed = (path: string) =>
    path === "src/lib/auth/permissions.ts" ||
    path.startsWith("src/app/[locale]/dashboard/admin/");

  it("appear in comparisons only inside permissions.ts", () => {
    const files = [
      ...filesUnder(join(ROOT, "src"), (p) => /\.tsx?$/.test(p) && !isTest(p)),
      ...filesUnder(join(ROOT, "worker"), (p) => /\.ts$/.test(p)),
    ];
    const offenders = files
      .filter((file) => !allowed(rel(file)))
      .flatMap((file) =>
        read(file)
          .split(/\r?\n/)
          .map((line, i) => ({ line, at: `${rel(file)}:${i + 1}` }))
          // Comments may describe the old rules; only code is held to this.
          .filter(({ line }) => !/^\s*(?:\/\/|\*|\/\*)/.test(line) && ROLE_COMPARISON.test(line))
          .map(({ line, at }) => `${at}  ${line.trim()}`),
      );
    expect(offenders).toEqual([]);
  });
});

describe("dashboard server actions", () => {
  // A server action is a POST endpoint of its own: the page that renders its
  // button protects nothing. Every exported action has to open with a guard —
  // updateSlug did not, and a master's login could rename the salon's link.
  const GUARD = /\brequire[A-Z]\w*\(|\bhasPermission\(|\bspansAllBranches\(/;
  const files = filesUnder(DASHBOARD, (p) => /[\\/]actions\.ts$/.test(p));

  it("finds the action files, so the check below is not vacuous", () => {
    expect(files.map(rel)).toEqual(
      expect.arrayContaining([
        "src/app/[locale]/dashboard/actions.ts",
        "src/app/[locale]/dashboard/clients/actions.ts",
        "src/app/[locale]/dashboard/settings/actions.ts",
        "src/app/[locale]/dashboard/workers/actions.ts",
      ]),
    );
  });

  it("each open with a guard", () => {
    const unguarded = files.flatMap((file) => {
      const lines = read(file).split(/\r?\n/);
      return lines.flatMap((line, start) => {
        const name = /^export async function (\w+)/.exec(line)?.[1];
        if (!name) return [];
        // The body runs to the next top-level declaration or comment.
        let end = start + 1;
        while (
          end < lines.length &&
          !/^(?:export |async function |function |const |let |type |interface |\/\/|\/\*)/.test(
            lines[end],
          )
        ) {
          end += 1;
        }
        return GUARD.test(lines.slice(start, end).join("\n")) ? [] : [`${rel(file)}: ${name}`];
      });
    });
    expect(unguarded).toEqual([]);
  });
});

describe("dashboard pages", () => {
  // A page is a GET anyone signed in can type into the address bar. The client
  // profile had no role check of its own, so a master — whose bookings carry
  // each customer's id — could open a customer's phone and history directly.
  const pages = filesUnder(DASHBOARD, (p) => /[\\/]page\.tsx$/.test(p)).map(rel);
  // Today is where a refused role is sent, so it cannot refuse anyone (it narrows
  // by scope instead); the platform admin panel checks its own flag.
  const EXEMPT = [
    "src/app/[locale]/dashboard/page.tsx",
    "src/app/[locale]/dashboard/admin/page.tsx",
  ];

  it("finds the pages, so the check below is not vacuous", () => {
    expect(pages).toEqual(
      expect.arrayContaining([...EXEMPT, "src/app/[locale]/dashboard/clients/[id]/page.tsx"]),
    );
  });

  it.each(pages.filter((page) => !EXEMPT.includes(page)))(
    "%s gates on its section's permission",
    (page) => {
      const route = page.replace("src/app/[locale]", "").replace(/\/page\.tsx$/, "");
      const needed = sectionPermission(route);
      const source = read(join(ROOT, page));
      if (needed) expect(source).toContain(`requirePagePermission("${needed}")`);
      else expect(source).toMatch(/requirePagePermission\("[\w.]+"\)/);
    },
  );
});

describe("dashboard API routes", () => {
  const routes = filesUnder(join(ROOT, "src", "app", "api", "dashboard"), (p) =>
    /[\\/]route\.ts$/.test(p),
  );

  it("check a permission before answering", () => {
    expect(routes.length).toBeGreaterThan(0);
    for (const route of routes) expect(read(route), rel(route)).toMatch(/\bhasPermission\(/);
  });
});
