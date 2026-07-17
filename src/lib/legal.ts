// Legal documents (AZ) served as static PDFs from /public/legal, plus the
// version strings we persist alongside each recorded consent. Bump the version
// here whenever a document's text changes so stored consents stay auditable.
//
// Versions match the "Sənədin versiyası" printed inside each PDF (all 1.0). The
// consent UI links to these URLs; the register/book handlers stamp the matching
// version on the stored consent.

export const LEGAL_DOCS = {
  /** Customer consent forms (data processing + marketing). */
  clientConsents: "/legal/musteri-raziliqlari.pdf",
  /** Partner-salon user agreement / public offer (the salon's ToS). */
  salonOffer: "/legal/salon-istifadeci-razilashmasi.pdf",
  /** Partner-salon consent forms (data processing + marketing). */
  salonConsents: "/legal/salon-raziliqlari.pdf",
} as const;

export const LEGAL_VERSIONS = {
  clientConsent: "1.0",
  salonOffer: "1.0",
  salonConsent: "1.0",
} as const;
