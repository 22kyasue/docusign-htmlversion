// Recipient resolution for the completion email — the single choke point that
// decides EXACTLY who a completion email may be sent to. Pure (no I/O), so every
// edge case below is one unit-test row.
//
// HARD GUARANTEES enforced here, mirrored from the Manager's mint-signing-link.js
// (the prior art for this canonicalization + ban):
//   - Recipients are ONLY the signer + the archive address. Never a third party.
//   - An absolute ban on keibeauty88@gmail.com (canonicalized): if it appears as
//     EITHER the signer OR the archive, the WHOLE send is refused (fail-closed,
//     not "drop one leg"). A partial send — archive notified, signer silently
//     gets nothing — is a worse state than refusing atomically.
//   - CRLF / header-injection and list-smuggling ("a@x, b@y") are rejected on
//     BOTH inputs, regardless of provenance. "Operator-controlled" ≠ "trusted".
//   - The result is RAW addresses (length 1 or 2). Canonical form is a comparison
//     key ONLY and must NEVER appear in a `to:` field (it strips dots/+tags and
//     could rewrite or break delivery).

// Standing hard ban — never email this address. Stored canonical; compared via
// canonicalEmail(). Same list + form as mint-signing-link.js.
export const BANNED_RECIPIENTS = ["keibeauty88@gmail.com"];

export const DEFAULT_ARCHIVE_EMAIL = "kotaro@tobira.studio";

// Thrown on any refusal — the caller maps this to a fail-closed, fail-LOUD record
// (no email sent at all). Carries a machine-readable reason for the audit log.
export class RecipientRefusedError extends Error {
  readonly reason: string;
  constructor(reason: string) {
    super(reason);
    this.name = "RecipientRefusedError";
    this.reason = reason;
  }
}

// Reject CR/LF in any value that could land in (or be derived into) a header line.
// Mirrors mint-signing-link.js assertHeaderSafe — closes the
// "victim@x\r\nBcc: <banned>" smuggle even though Resend takes structured JSON.
function assertHeaderSafe(label: string, value: string): void {
  if (/[\r\n]/.test(value)) {
    throw new RecipientRefusedError(`illegal CR/LF in ${label} (header injection rejected)`);
  }
}

// Pull the raw mailbox addresses out of a recipient string. Split a possible list
// and grab each mailbox's address; the caller then enforces "exactly one". For
// each comma-separated entry the address is the LAST <...> if any angle brackets
// exist, else the bare token. Exactly one "@" is required (rejects "a@b@c" and
// address-less junk). Verbatim behavior from mint-signing-link.js.
function extractMailboxes(raw: string): string[] {
  const s = String(raw || "").trim();
  if (!s) return [];
  return s
    .split(",")
    .map((e) => e.trim())
    .filter(Boolean)
    .map((entry) => {
      const brackets = entry.match(/<([^<>]*)>/g);
      const addr = (brackets ? brackets[brackets.length - 1].slice(1, -1) : entry).trim();
      if ((addr.match(/@/g) || []).length !== 1) {
        throw new RecipientRefusedError(
          `cannot parse a single email address from: ${JSON.stringify(entry)}`,
        );
      }
      return addr;
    });
}

// Canonicalize ONE bare address for the ban check / dedup: lowercase, strip a
// trailing dot on the domain, fold googlemail.com → gmail.com, drop a "+tag", and
// strip dots in the local part FOR GMAIL ONLY (foo.bar@gmail == foobar@gmail).
// Comparison + dedup keys are on this form. Verbatim from mint-signing-link.js.
export function canonicalEmail(addr: string): string {
  const a = String(addr || "").trim().toLowerCase();
  const at = a.indexOf("@");
  if (at < 0) return a;
  let local = a.slice(0, at);
  let domain = a.slice(at + 1).replace(/\.+$/, "");
  if (domain === "googlemail.com") domain = "gmail.com";
  local = local.split("+")[0];
  if (domain === "gmail.com") local = local.replace(/\./g, "");
  return local + "@" + domain;
}

function assertNotBanned(canonical: string, raw: string): void {
  if (BANNED_RECIPIENTS.includes(canonical)) {
    throw new RecipientRefusedError(`refusing to email banned recipient: ${raw}`);
  }
}

// Resolve ONE input string to exactly one raw mailbox, ban-checking every @-token
// (belt-and-suspenders: a banned address hidden in a display phrase must never
// even appear). Throws RecipientRefusedError on CRLF, on a list (!= 1 mailbox), or
// on any banned token. Returns { raw, canonical }.
function resolveSingle(label: string, input: string): { raw: string; canonical: string } {
  assertHeaderSafe(label, input);
  // Ban-check EVERY @-bearing token in the raw input, not just the deliverable
  // address — a banned address in a display phrase must never appear.
  for (const tok of String(input || "")
    .split(/[\s<>,;"]+/)
    .filter((t) => t.includes("@"))) {
    assertNotBanned(canonicalEmail(tok), input);
  }
  const mailboxes = extractMailboxes(input);
  if (mailboxes.length !== 1) {
    throw new RecipientRefusedError(
      `${label} must be exactly one address; got ${mailboxes.length}: ${JSON.stringify(input)}`,
    );
  }
  const raw = mailboxes[0];
  const canonical = canonicalEmail(raw);
  assertNotBanned(canonical, input);
  return { raw, canonical };
}

// THE choke point. Returns the RAW addresses to put in Resend `to` — length 1
// (when signer and archive are the same inbox) or 2. Throws RecipientRefusedError
// on any refusal (banned / CRLF / list / unparseable on EITHER input), so the
// caller fails the whole send closed + loud. The signer is null only for legacy
// operator drafts with no assigned signer — then archive-only is correct (the
// archive still wants the record), and that single recipient still runs the full
// gate.
export function resolveCompletionRecipients(
  signerEmail: string | null | undefined,
  archiveEmailRaw: string | null | undefined,
): string[] {
  // Resolve + validate the archive AFTER default-substitution — validate the
  // value we will actually use, never the unset env.
  const archiveInput = (archiveEmailRaw ?? "").trim() || DEFAULT_ARCHIVE_EMAIL;
  const archive = resolveSingle("SIGN_ARCHIVE_EMAIL", archiveInput);

  if (signerEmail == null || String(signerEmail).trim() === "") {
    // No signer (legacy operator draft) — archive-only, already gated above.
    return [archive.raw];
  }

  const signer = resolveSingle("signer email", String(signerEmail));

  // Dedup on CANONICAL (same inbox via dot/+tag for gmail). Ship the signer's RAW
  // form when collapsed — the signer is the human who needs the confirmation.
  if (signer.canonical === archive.canonical) {
    return [signer.raw];
  }
  return [signer.raw, archive.raw];
}
