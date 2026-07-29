import { getTranslations } from "next-intl/server";
import { ButtonLink } from "@/components/ui";
import { getClientSession } from "@/lib/auth/client-session";

// Client-facing account entry point for public pages (salon page, discovery).
// Shows "Мой кабинет" when a client session exists, otherwise "Войти". Distinct
// from the owner login (/login) — this is the phone-OTP client area.
export async function ClientAccountLink({
  size = "sm",
}: {
  size?: "sm" | "md" | "lg";
}) {
  const session = await getClientSession();
  const t = await getTranslations("ClientAuth");
  return (
    <ButtonLink href={session ? "/profile" : "/profile/sign-in"} variant="ghost" size={size}>
      {session ? t("accountTitle") : t("title")}
    </ButtonLink>
  );
}
