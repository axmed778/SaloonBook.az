import { getLocale } from "next-intl/server";
import { redirect } from "@/i18n/navigation";
import { getClientSession } from "@/lib/auth/client-session";
import { SignInForm } from "./sign-in-form";

export const dynamic = "force-dynamic";

// Public client sign-in (phone + OTP). Already signed in -> straight to /profile.
export default async function ClientSignInPage() {
  const session = await getClientSession();
  if (session) {
    redirect({ href: "/profile", locale: await getLocale() });
    return null; // unreachable — redirect() throws
  }
  return <SignInForm />;
}
