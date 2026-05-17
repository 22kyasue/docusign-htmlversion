export type SignatureField = {
  page: number;
  xRatio: number;
  yRatio: number;
  widthRatio: number;
  heightRatio: number;
};

export type AuditEntry = {
  at: string;
  action: "uploaded" | "signed" | "downloaded";
  actor?: string;
  ip?: string;
  userAgent?: string;
  originalSha256?: string;
  signedSha256?: string;
};

export type DocumentStatus = "draft" | "signed";

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
  audit: AuditEntry[];
};
