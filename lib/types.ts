export type SignatureField = {
  page: number;
  xRatio: number;
  yRatio: number;
  widthRatio: number;
  heightRatio: number;
};

export type AuditEntry = {
  at: string;
  action:
    | "created"
    | "uploaded"
    | "sent_for_signature"
    | "signed"
    | "downloaded"
    | "seal_failed"
    | "webhook_delivered"
    | "webhook_failed"
    | "email_sent"
    | "email_failed"
    | "email_refused_banned";
  actor?: string;
  ip?: string;
  userAgent?: string;
  originalSha256?: string;
  signedSha256?: string;
  // Set when a webhook event is recorded.
  detail?: string;
};

export type DocumentStatus = "draft" | "signed";

// One signer (甲 only — the 乙/studio side is already executed in the uploaded
// PDF). Single-party by design; see the build decision log. If a counter-signature
// is ever needed this becomes an array, which is a deliberate schema migration.
export type DocumentSigner = {
  name: string;
  email: string;
  // Magic-link token. 192-bit, URL-safe, single-use until signedAt is set.
  token: string;
  tokenExpiresAt: string;
  signedAt?: string;
  ip?: string;
  userAgent?: string;
  // PNG bytes (data-URL stripped) of the rendered signature, written at sign time.
  signatureImageFile?: string;
};

export type DocumentRecord = {
  id: string;
  name: string;
  status: DocumentStatus;
  createdAt: string;
  updatedAt: string;
  originalFile: string;
  signedFile?: string;
  originalSha256: string;
  signedSha256?: string;
  // HMAC(signedSha256hex, SERVER_SECRET). Lets a verifier detect a disk edit
  // that re-hashed the file, because re-forging this anchor needs the secret.
  // Stored here AND in a sidecar file next to the signed PDF.
  signedHmac?: string;
  // The signer (甲). Token-gated, single-use. Absent only on legacy/operator
  // draft uploads that have not yet been assigned a signer.
  signer?: DocumentSigner;
  // Pre-placed signature field(s), set at creation. The sign route stamps at
  // THESE coordinates — it never trusts field positions from the client.
  fields: SignatureField[];
  // Completion-webhook delivery state. Lets a reconciler re-fire a dropped
  // webhook and makes "did the completion fire?" answerable from one field.
  webhookDelivered?: boolean;
  webhookAttempts?: number;
  webhookLastError?: string;
  // Completion-email delivery state. Mirrors the webhook fields: lets a reconciler
  // re-fire a dropped email and makes "did the completion email send?" answerable
  // from one field. Set true ONLY after a confirmed Resend 2xx (idempotent).
  completionEmailSent?: boolean;
  completionEmailAttempts?: number;
  completionEmailLastError?: string;
  // Optional cockpit-side linkage echoed back on the completion webhook.
  externalRef?: {
    system: string;
    leadId?: string;
    note?: string;
  };
  audit: AuditEntry[];
};
