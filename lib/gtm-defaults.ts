/**
 * Go-to-market defaults — edit this one file for niche / offers / Rule of 100.
 * Used by New Report ICP panel and dashboard copy.
 */

export const PRODUCT = {
  /** UI brand (folder can stay prospect-platform). */
  name: "Outreach Action",
  shortName: "Outreach",
  tagline: "CSV → Instantly-ready CONTACT list",
  promise:
    "Upload a lead CSV → get who to SKIP vs CONTACT → Instantly-ready subject + body → track replies and meetings.",
} as const;

export const GTM = {
  nicheLabel: "UK property / professional services SMBs",

  defaultIcp: {
    targetIndustries: [
      "real estate",
      "property",
      "estate agents",
      "commercial property",
      "property services",
    ],
    minEmployees: 2,
    maxEmployees: 50,
    geographies: ["United Kingdom", "UK", "England"],
    techMustHave: [] as string[],
    techMustNotHave: [] as string[],
  },

  /** Max selectable offerFocus (engine soft-boost). Keep ≤ 3 this quarter. */
  maxOfferFocus: 3,

  /** Only offers this business actually sells right now. */
  primaryOffers: [
    { id: "followup_automation", label: "Automated Lead Follow-up" },
    { id: "landing_cro", label: "Landing Page & CRO" },
    { id: "appointment_booking", label: "AI Appointment Booking" },
  ] as const,

  ruleOf100Target: 100,
  /** Soft daily send cap (calendar day, local timezone). */
  dailySendCap: 100,
  /** Allow finishing already-opened Gmail drafts up to cap + this many. */
  dailySendCapSoftExtra: 5,
  /** Rough minutes per lead for Analyze 50/100 warnings (UI only). */
  analyzeMinutesPerLead: 1.5,
} as const;

/** Form-shaped ICP for New Report first load. */
export function gtmIcpFormDefaults(): {
  targetIndustries: string;
  minEmployees: string;
  maxEmployees: string;
  geographies: string;
  techMustHave: string;
  techMustNotHave: string;
  offerFocus: string[];
} {
  return {
    targetIndustries: GTM.defaultIcp.targetIndustries.join(", "),
    minEmployees: String(GTM.defaultIcp.minEmployees),
    maxEmployees: String(GTM.defaultIcp.maxEmployees),
    geographies: GTM.defaultIcp.geographies.join(", "),
    techMustHave: GTM.defaultIcp.techMustHave.join(", "),
    techMustNotHave: GTM.defaultIcp.techMustNotHave.join(", "),
    offerFocus: GTM.primaryOffers.map((o) => o.id),
  };
}
