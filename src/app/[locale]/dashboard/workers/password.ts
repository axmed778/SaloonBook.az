// Passwords the owner generates for a login and reads out to its holder. Used by
// the master-login and team-login panels alike.

const PW_LOWER = "abcdefghijkmnopqrstuvwxyz"; // no l — it reads as 1 over the phone
const PW_UPPER = "ABCDEFGHJKLMNPQRSTUVWXYZ"; // no I, no O
const PW_DIGITS = "23456789"; // no 0/1
const PW_SPECIAL = "!@#$%*?";

function pick(set: string, n: number): string[] {
  const buf = new Uint32Array(n);
  crypto.getRandomValues(buf);
  return Array.from(buf, (v) => set[v % set.length]);
}

/**
 * A password that satisfies the server's policy by construction (lower, upper,
 * digit, special, 10 chars) out of characters that survive being read aloud.
 */
export function generatePassword(): string {
  const chars = [
    ...pick(PW_LOWER, 4),
    ...pick(PW_UPPER, 3),
    ...pick(PW_DIGITS, 2),
    ...pick(PW_SPECIAL, 1),
  ];
  // Shuffle, or the character classes would always land in the same positions.
  const order = new Uint32Array(chars.length);
  crypto.getRandomValues(order);
  for (let i = chars.length - 1; i > 0; i--) {
    const j = order[i] % (i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join("");
}
