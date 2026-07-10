import { createNavigation } from "next-intl/navigation";
import { routing } from "./routing";

// Locale-aware wrappers around Next's navigation APIs. Use THESE (not next/link
// or next/navigation) everywhere inside the app: they auto-carry the active
// locale prefix on links/redirects, and usePathname() returns the path WITHOUT
// the locale prefix — so existing active-link checks (e.g. sidebar-nav) keep
// working unchanged.
export const { Link, redirect, usePathname, useRouter, getPathname } =
  createNavigation(routing);
