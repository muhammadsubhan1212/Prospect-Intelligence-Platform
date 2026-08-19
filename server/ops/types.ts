export const LEAD_STATUSES = [
  "not_contacted",
  "sent",
  "called",
  "replied",
  "meeting",
  "not_interested",
  "bounced",
  "skipped",
] as const;

export type LeadStatus = (typeof LEAD_STATUSES)[number];

export const ACTIVITY_TYPES = [
  "lead_imported",
  "lead_assigned",
  "lead_reassigned",
  "lead_opened",
  "email_opened",
  "email_sent",
  "email_failed",
  "call_clicked",
  "call_no_answer",
  "called",
  "called_cleared",
  "replied",
  "replied_cleared",
  "meeting",
  "meeting_cleared",
  "not_interested",
  "not_interested_cleared",
  "bounced",
  "bounced_cleared",
  "skipped",
  "skipped_cleared",
  "audit_created",
  "audit_downloaded",
  "research_generated",
  "lead_reset",
] as const;

export type ActivityType = (typeof ACTIVITY_TYPES)[number];

export type MasterLead = {
  id: string;
  name: string;
  firstName?: string;
  lastName?: string;
  company: string;
  title?: string;
  email?: string;
  phone?: string;
  website?: string;
  linkedin?: string;
  location?: string;
  city?: string;
  state?: string;
  country?: string;
  industry?: string;
  source?: string;
  importId?: string;
  status: LeadStatus;
  /** All outcomes the operator has marked (Sent + Called, etc.). */
  statuses?: LeadStatus[];
  assignedTo?: string | null;
  assignedAt?: string | null;
  assignedBatchId?: string | null;
  lastAction?: string;
  lastActionAt?: string;
  nextAction?: string;
  reportId?: string | null;
  researchPath?: string | null;
  lastDisclosure?: {
    at: string;
    operatorId: string;
    action: string;
    note?: string;
    message?: { to?: string; subject?: string; body?: string };
  };
  createdAt: string;
  updatedAt: string;
};

export type Operator = {
  id: string;
  name: string;
  email?: string;
  phone?: string;
  active: boolean;
  createdAt: string;
};

export type AllocationRecord = {
  id: string;
  leadId: string;
  userId: string;
  allocatedAt: string;
  allocationBatchId: string;
  purpose: "sales_outreach";
  /** Original owner — kept even if the lead is later reassigned. */
  originalUserId: string;
  currentUserId: string;
  /** Set when admin resets this assignment so the lead can be allocated again. */
  resetAt?: string;
};

export type AllocationBatch = {
  id: string;
  userId: string;
  userName: string;
  count: number;
  createdAt: string;
  dailyTarget?: number;
};

export type Activity = {
  id: string;
  leadId?: string;
  userId?: string;
  type: ActivityType | string;
  timestamp: string;
  metadata?: Record<string, unknown>;
};

export type ImportRecord = {
  id: string;
  filename: string;
  createdAt: string;
  totalRows: number;
  newLeads: number;
  alreadyExisting: number;
  invalidRows: number;
  storedPath?: string;
};

export type FreeAudit = {
  id: string;
  leadId: string;
  operatorId?: string;
  company: string;
  website?: string;
  createdAt: string;
  title: string;
  htmlPath: string;
  jsonPath: string;
};

export type AuditDocument = {
  id: string;
  company: string;
  website?: string;
  preparedFor?: string;
  date: string;
  title: string;
  brand?: {
    companyName: string;
    tagline: string;
    website: string;
    email: string;
    phone: string;
    address: string;
    preparedBy: string;
    themeId: string;
    colors: {
      accent: string;
      accentSoft: string;
      ink: string;
      muted: string;
      paper: string;
      headerBg: string;
    };
    logoDataUrl?: string;
  };
  executiveSummary: string;
  hookQuestion?: string;
  visitorStory?: string;
  uncomfortableQuestions?: string[];
  whatsWorking?: string[];
  conversion: { heading: string; body: string }[];
  followUp: string[];
  booking: string[];
  technical: string[];
  priorities: { finding: string; impact: string; urgency: string; evidence?: string }[];
  recommendedActions: string[];
  thirtyDayPlan?: string[];
  conversationAngle?: string;
  commercialCost?: string;
  ifNothingChanges?: string;
  nextStep: { offer: string; why: string };
  notObserved: string[];
};
