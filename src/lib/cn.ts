/** Join truthy class names. Tiny stand-in for clsx — no merge logic needed. */
export function cn(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(" ");
}
