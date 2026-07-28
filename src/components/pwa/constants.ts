// Shared between the client InstallPrompt, its server action, and the dashboard
// layout (which reads it to decide the prompt's initial visibility). Kept in its
// own module because a "use server" file may only export async functions.
export const A2HS_DISMISS_COOKIE = "sb_a2hs_dismissed";
