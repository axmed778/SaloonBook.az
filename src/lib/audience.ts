// Gender audience shared between salon, employee and service.
// MALE/FEMALE for gendered, ALL = "anyone / unisex".

export type Audience = "MALE" | "FEMALE" | "ALL";

export const AUDIENCE_LABEL: Record<Audience, string> = {
  MALE: "Kişi",
  FEMALE: "Qadın",
  ALL: "Hamı",
};

// Order shown in pickers.
export const AUDIENCE_OPTIONS: { value: Audience; label: string }[] = [
  { value: "ALL", label: "Hamı" },
  { value: "MALE", label: "Kişi" },
  { value: "FEMALE", label: "Qadın" },
];

/** Does an item with `audience` apply to a client of gender `clientGender`? */
export function matchesClientGender(
  audience: Audience,
  clientGender: "MALE" | "FEMALE",
): boolean {
  return audience === "ALL" || audience === clientGender;
}
