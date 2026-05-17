// Contract domain — HTML-first signing.
//
// A Contract is the legally binding agreement between Tobira Studio (or any
// studio operator) and one client. It is rendered to HTML, signed in the
// browser by one or more parties, and optionally exported to PDF as a printable
// receipt. The HTML snapshot at completion is the canonical source of truth;
// the PDF is a convenience copy.

export type SignerRole = "studio" | "client";

export type Signer = {
  id: string;
  role: SignerRole;
  name: string;
  email: string;
  // Magic-link token. Long, URL-safe, single-use until signed.
  token: string;
  tokenExpiresAt: string;
  signedAt?: string;
  // PNG bytes (base64 data URL stripped) of the rendered signature image.
  // Stored as a filename in data/files, written at sign time.
  signatureImageFile?: string;
  ip?: string;
  userAgent?: string;
};

export type ContractStatus =
  | "draft"
  | "pending_signatures"
  | "completed"
  | "voided";

// Variables interpolated into the contract template. JA-first phrasing.
// The Launch tier is currently the only template; the template id is kept
// here so we can add more (Enterprise, Localization-only, etc.) without
// changing the schema.
export type ContractTemplateId = "launch_tier_v1";

export type ContractVariables = {
  studioCompany: string;          // e.g. "Tobira Studio"
  studioLegalName?: string;       // e.g. "合同会社トビラ" if registered
  studioAddress?: string;
  studioRepresentative: string;   // name of signing principal on studio side

  clientCompany: string;          // 屋号 or 法人名 as the client wants displayed
  clientLegalName?: string;
  clientAddress?: string;
  clientRepresentative: string;

  projectName: string;            // e.g. "民宿○○ 新サイト構築 + JA/EN/ZH"
  deliverables: string[];         // bullet list, JA
  languagePairs: string[];        // e.g. ["JA", "EN", "ZH-Hans"]
  scopeNotes?: string;            // free-form additional scope detail
  outOfScopeNotes?: string;       // explicit exclusions

  priceJpy: number;               // total contract value in JPY, tax-exclusive
  taxRatePercent: number;         // e.g. 10 for 10% 消費税
  paymentSchedule: string;        // e.g. "着手金50% / 納品時50%"
  paymentMethod: string;          // e.g. "銀行振込（請求書発行）"

  kickoffDate: string;            // ISO date
  deliveryDeadline: string;       // ISO date
  revisionRounds: number;         // included revision rounds

  governingLaw: string;           // default "日本国法"
  jurisdiction: string;           // default "東京地方裁判所"
};

export type ContractAuditAction =
  | "created"
  | "sent_for_signature"
  | "viewed"
  | "signed"
  | "completed"
  | "voided"
  | "pdf_exported";

export type ContractAuditEntry = {
  at: string;
  action: ContractAuditAction;
  actor?: string;                 // signer name or "studio operator"
  signerId?: string;
  ip?: string;
  userAgent?: string;
  // Set on "signed" / "completed" entries.
  htmlSnapshotSha256?: string;
};

export type Contract = {
  id: string;
  template: ContractTemplateId;
  status: ContractStatus;
  createdAt: string;
  updatedAt: string;

  variables: ContractVariables;

  signers: Signer[];

  // Captured HTML at completion. Stored in data/files as well; this field
  // holds the SHA-256 hex digest of the captured bytes for tamper evidence.
  htmlSnapshotFile?: string;
  htmlSnapshotSha256?: string;

  // Convenience PDF export of the same content, generated on demand.
  pdfExportFile?: string;
  pdfExportSha256?: string;

  // Optional cockpit-side linkage. When the contract was created via the
  // HMAC-authenticated API, the cockpit can stash its own lead id here so the
  // completion webhook can be matched on the other side.
  externalRef?: {
    system: string;               // e.g. "tobira-cockpit"
    leadId?: string;
    note?: string;
  };

  audit: ContractAuditEntry[];
};
