import { prisma } from "@/lib/prisma";
import { LEGAL_DOC_VERSION, isConsentCurrent, legalDocUrl, type LegalDoc } from "@/lib/legal";

// Re-consent: which documents a signed-in party must have accepted AT THE
// CURRENT VERSION to keep using their area, and how an acceptance is recorded.
//
// Recording is append-then-mirror in one transaction: a LegalConsent row is
// inserted (never updated — the journal is the audit trail) and the party's
// mirror column is set to the new version so the gate check stays a plain field
// comparison. Losing the mirror is recoverable from the journal; losing the
// journal is not, which is why the insert is not conditional on the mirror.

/** Documents gating the public client area (/profile). */
export const CLIENT_GATED_DOCS = ["clientConsents"] as const satisfies readonly LegalDoc[];
export type ClientGatedDoc = (typeof CLIENT_GATED_DOCS)[number];

/** Documents gating the partner dashboard (/dashboard). */
export const SALON_GATED_DOCS = [
  "salonOffer",
  "salonConsents",
] as const satisfies readonly LegalDoc[];
export type SalonGatedDoc = (typeof SALON_GATED_DOCS)[number];

/** Mirror column on Account per gated document. */
const SALON_MIRROR = {
  salonOffer: "offerVersion",
  salonConsents: "privacyVersion",
} as const satisfies Record<SalonGatedDoc, keyof SalonLegalVersions>;

export type SalonLegalVersions = {
  offerVersion: string | null;
  privacyVersion: string | null;
};

/** Gated client documents whose accepted version is missing or superseded. */
export function staleClientDocs(consentVersion: string | null): ClientGatedDoc[] {
  return CLIENT_GATED_DOCS.filter((doc) => !isConsentCurrent(doc, consentVersion));
}

/** Gated salon documents whose accepted version is missing or superseded. */
export function staleSalonDocs(legal: SalonLegalVersions): SalonGatedDoc[] {
  return SALON_GATED_DOCS.filter(
    (doc) => !isConsentCurrent(doc, legal[SALON_MIRROR[doc]]),
  );
}

/**
 * Records the client's acceptance of every gated client document at the version
 * in force. The caller passes only the client id — which documents are stale is
 * re-derived here from the database, so a tampered request cannot mark a
 * document accepted that the gate never showed.
 *
 * No-op when nothing is stale, so a double-submit does not add a duplicate
 * journal entry for the same version.
 */
export async function acceptClientConsents(clientId: string): Promise<void> {
  const client = await prisma.client.findUnique({
    where: { id: clientId },
    select: { consentVersion: true },
  });
  if (!client) return;

  const stale = staleClientDocs(client.consentVersion);
  if (stale.length === 0) return;

  const now = new Date();
  await prisma.$transaction([
    prisma.legalConsent.createMany({
      data: stale.map((doc) => ({
        clientId,
        doc,
        version: LEGAL_DOC_VERSION[doc],
        acceptedAt: now,
      })),
    }),
    prisma.client.update({
      where: { id: clientId },
      data: { consentVersion: LEGAL_DOC_VERSION.clientConsents, consentAt: now },
    }),
  ]);
}

/**
 * Records the account's acceptance of every gated salon document at the version
 * in force. Only the stale documents are journalled and mirrored: when the offer
 * is unchanged and just the consents were revised, offerVersion keeps its
 * earlier value rather than being restamped with a version nobody re-read.
 */
export async function acceptSalonConsents(accountId: string): Promise<void> {
  const account = await prisma.account.findUnique({
    where: { id: accountId },
    select: { offerVersion: true, privacyVersion: true },
  });
  if (!account) return;

  const stale = staleSalonDocs(account);
  if (stale.length === 0) return;

  const now = new Date();
  const mirror: Partial<Record<keyof SalonLegalVersions, string>> & { legalAcceptedAt: Date } = {
    legalAcceptedAt: now,
  };
  for (const doc of stale) mirror[SALON_MIRROR[doc]] = LEGAL_DOC_VERSION[doc];

  await prisma.$transaction([
    prisma.legalConsent.createMany({
      data: stale.map((doc) => ({
        accountId,
        doc,
        version: LEGAL_DOC_VERSION[doc],
        acceptedAt: now,
      })),
    }),
    prisma.account.update({ where: { id: accountId }, data: mirror }),
  ]);
}

/**
 * Shapes stale documents for the gate dialog: the key doubles as the i18n key,
 * and the URL points at the revision being accepted (never at a stale one).
 */
export function gateDocs(docs: LegalDoc[]): { key: LegalDoc; url: string; version: string }[] {
  return docs.map((doc) => ({
    key: doc,
    url: legalDocUrl(doc, LEGAL_DOC_VERSION[doc]),
    version: LEGAL_DOC_VERSION[doc],
  }));
}
