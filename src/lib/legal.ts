// Legal documents (AZ) served as static PDFs from /public/legal, plus the
// version strings we persist alongside each recorded consent.
//
// Documents are append-only and versioned by folder: /public/legal/v<version>/.
// A stored consent keeps only its version string (Salon.offerVersion /
// privacyVersion, Appointment.consentVersion, Customer.consentVersion), so the
// PDF that version points at must stay reachable forever — never overwrite a
// file in place, never reuse a version number, never delete an old folder.
//
// To publish a new revision: drop the PDF into a new /public/legal/v<next>/,
// keep the archived copy in /docs/legal, bump the version inside the PDF
// ("Sənədin versiyası") and bump *only* the affected entry in LEGAL_VERSIONS.

/** Version currently in force for each document. Bump on any text change. */
export const LEGAL_VERSIONS = {
  clientConsent: "1.1",
  salonOffer: "1.0",
  salonConsent: "1.1",
} as const;

export type LegalDoc = "clientConsents" | "salonOffer" | "salonConsents";

const FILENAMES: Record<LegalDoc, string> = {
  /** Customer consent forms (data processing + marketing). */
  clientConsents: "musteri-raziliqlari.pdf",
  /** Partner-salon user agreement / public offer (the salon's ToS). */
  salonOffer: "salon-istifadeci-razilashmasi.pdf",
  /** Partner-salon consent forms (data processing + marketing). */
  salonConsents: "salon-raziliqlari.pdf",
};

const DOC_VERSIONS: Record<LegalDoc, string> = {
  clientConsents: LEGAL_VERSIONS.clientConsent,
  salonOffer: LEGAL_VERSIONS.salonOffer,
  salonConsents: LEGAL_VERSIONS.salonConsent,
};

/**
 * URL of a specific revision. Use with a version read back from the database to
 * show a user the exact document they accepted, not the current text.
 */
export function legalDocUrl(doc: LegalDoc, version: string): string {
  return `/legal/v${version}/${FILENAMES[doc]}`;
}

/** Version in force per document, keyed the same way as LEGAL_DOCS. */
export const LEGAL_DOC_VERSION: Readonly<Record<LegalDoc, string>> = DOC_VERSIONS;

/**
 * Whether a version recorded against a party (Account.offerVersion /
 * privacyVersion, Client.consentVersion) still matches the document in force.
 *
 * False for null — a party who never consented is treated the same as one whose
 * consent went stale, so the re-consent gate catches both. Appointment
 * .consentVersion is deliberately NOT checked this way: it records the consent
 * given for one past booking and is never re-asked.
 */
export function isConsentCurrent(doc: LegalDoc, version: string | null | undefined): boolean {
  return version === DOC_VERSIONS[doc];
}

/** URLs of the versions in force — what consent UIs link to today. */
export const LEGAL_DOCS = {
  clientConsents: legalDocUrl("clientConsents", DOC_VERSIONS.clientConsents),
  salonOffer: legalDocUrl("salonOffer", DOC_VERSIONS.salonOffer),
  salonConsents: legalDocUrl("salonConsents", DOC_VERSIONS.salonConsents),
} as const;
