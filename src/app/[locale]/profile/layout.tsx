import { getClientSession } from "@/lib/auth/client-session";
import { ConsentGate } from "@/components/legal/consent-gate";
import { gateDocs, staleClientDocs } from "@/lib/legal-consent";
import { acceptLegalConsents } from "./actions";

export const dynamic = "force-dynamic";

// Hosts the client area's re-consent gate: when the data-processing consent a
// client accepted has since been revised, the area is covered by a blocking
// dialog until they accept the current revision or sign out.
//
// Route protection stays on the pages themselves (each redirects to
// /profile/sign-in), so this layout only gates a session that already exists —
// /profile/sign-in renders untouched for signed-out visitors.
export default async function ProfileLayout({ children }: { children: React.ReactNode }) {
  const session = await getClientSession();
  const stale = session ? staleClientDocs(session.consentVersion) : [];

  return (
    <>
      {children}
      {stale.length > 0 && (
        <ConsentGate
          docs={gateDocs(stale)}
          logoutPath="/api/client/logout"
          logoutHref="/"
          accept={acceptLegalConsents}
        />
      )}
    </>
  );
}
