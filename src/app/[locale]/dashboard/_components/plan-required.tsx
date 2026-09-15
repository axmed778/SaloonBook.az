import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";

/**
 * Shown to a login that holds a permission its salon's plan does not include,
 * and that cannot change the plan itself. The owner gets an upgrade card or
 * Billing instead; this only says who can.
 */
export async function PlanRequired() {
  const t = await getTranslations("PlanRequired");
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center text-center">
      <h1 className="text-xl font-semibold text-foreground">{t("title")}</h1>
      <p className="mt-2 max-w-sm text-sm text-faint-foreground">{t("body")}</p>
      <Link
        href="/dashboard"
        className="mt-5 inline-flex items-center rounded-lg border border-border px-4 py-2 text-sm font-medium text-secondary-foreground transition hover:bg-hover"
      >
        {t("back")}
      </Link>
    </div>
  );
}
