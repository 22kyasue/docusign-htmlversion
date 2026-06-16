# Sovereign Sign

A personal, self-hosted alternative to DocuSign. Built because paying banks to act
as middlemen for *your own* signatures on *your own* documents is ridiculous.

- Local-first: uploads land in `./data/files`, metadata in `./data/documents.json`.
- No external services required. Runs on your laptop or your home server.
- Every document is hashed (SHA-256) at upload, again after signing.
- Every signing event appends an audit page to the PDF with timestamps, IP, and user agent.

## Stack

- Next.js 16 (App Router) + React 19 + Tailwind v4
- `pdf-lib` for stamping signatures and writing the audit page
- `pdfjs-dist` for in-browser rendering
- `react-signature-canvas` for the signature pad
- JSON-on-disk for the metadata DB — keep it simple, keep it portable

## Install as a Claude Code skill

If you use [Claude Code](https://claude.com/claude-code), Sovereign Sign ships as
a one-command-installable skill. Anyone who clones this repo can wire it up to
their own Claude in two steps:

```powershell
# Windows
git clone https://github.com/22kyasue/docusign-htmlversion.git
cd docusign-htmlversion
./install.ps1
```

```bash
# macOS / Linux
git clone https://github.com/22kyasue/docusign-htmlversion.git
cd docusign-htmlversion
./install.sh
```

What the installer does:

1. Copies the skill manifest into `~/.claude/skills/sovereign-sign/SKILL.md`.
2. Writes `~/.claude/skills/sovereign-sign/config.json` with the absolute path
   of *your* clone and the port you want to use (defaults to `3789`).
3. Runs `npm install` so the local dev server is ready to go.

Then in any Claude Code session from any project:

```
/sovereign-sign
```

Claude will read the config, check whether the local server is up, start it if
it isn't, and tell you which URL to open.

Useful flags:

- `./install.ps1 -Port 4000` (or `--port 4000` on bash) to bind a different port
- `./install.ps1 -Force` to overwrite an existing install
- `./install.ps1 -SkipDeps` if you've already run `npm install`

## Run it manually (no skill required)

```bash
npm install
npm run dev          # → http://localhost:3000 (or whichever port you pass)
```

The `postinstall` script copies the pdfjs worker into `public/` so the renderer
can find it offline.

For a production build:

```bash
npm run build
npm run start
```

## Flow (PDF documents)

The PDF flow is now token-gated and DocuSign-style: the signature field is
**pre-placed** by whoever creates the document; the signer just draws once.

1. **Create** a document with a pre-positioned field, either via the operator
   upload form on the home page (multipart, operator-gated) or via
   `POST /api/documents` (HMAC-authenticated — this is the cockpit/Manager path).
   Creation mints a single-use, 30-day, 192-bit signer token and returns a
   `signUrl` of the form `/sign/<id>?t=<token>`.
2. The signer opens the `signUrl`. The page is **token-gated** — a bare id shows
   nothing. They see the rendered PDF with the field highlighted where their
   signature will land, a JP signing panel, and a consent checkbox.
3. They draw their signature and submit. The server validates the token (single
   use; 401 invalid/expired, 409 already-signed) and the PNG (rejects
   blank/header-only → 400), stamps the signature at the **server-stored** field
   coordinates (never client-supplied), appends an audit page, re-hashes,
   `fsync`s + atomically writes the signed file, writes the HMAC anchor, appends
   the audit-log line, commits, then seals the file read-only.
4. A completion webhook fires (after the response, with bounded retry) to the
   configured cockpit, idempotent on `${documentId}:${signedSha256}`.
5. The signed PDF is downloadable (token- or operator-gated).

## Data layout

```
data/
├── documents.json        # metadata DB (one row per document)
└── files/                # original and signed PDFs
```

Both directories are git-ignored. Back them up — they ARE the product.

## Tamper-evidence — what is and isn't guaranteed (read this honestly)

Visual signatures on PDFs are accepted under eIDAS SES, ESIGN, and Japan's
電子署名法 for most personal use cases. This tool produces exactly that, plus the
following integrity measures on the PDF-signing flow:

- **SHA-256 of the signed file** is recorded on the document and printed on the
  appended audit page.
- **HMAC anchor**: alongside each signed file sits a `<file>.anchor.json` holding
  `HMAC-SHA256(SERVER_SECRET, sha256hex)`. To forge a clean anchor for an altered
  file you need `SERVER_SECRET` — so a disk editor who lacks the secret **cannot**
  silently re-hash a tampered file past verification.
- **Append-only audit log** (`data/audit.log`): one JSON line per event, only ever
  appended by the app, line-tolerant on read. An independent record that survives
  a corrupted metadata DB.
- **Write-once + read-only**: the signed file is `fsync`'d via temp+rename and set
  read-only after commit.

What this does **NOT** claim — and we will not pretend otherwise:

- It is **not** "cryptographically tamper-proof". The anchor + audit log defend
  against a *motivated tamperer who does NOT hold `SERVER_SECRET`*. An attacker
  who holds the secret (e.g. root on the box, who can read the process env) can
  re-anchor any forgery. The OS read-only bit is accident-prevention, not an
  attacker control.
- It does **not** defend against deletion of the whole record (file + anchor + DB
  row + log line). That requires shipping the anchor + audit log **off-box,
  append-only** — see `scripts/backup-data.mjs` (local encrypted snapshots today;
  off-box push is a documented TODO pending deploy).
- It is **not** an externally-notarized timestamp. It proves the bytes are
  unchanged since *we* sealed them — not, to a third party, *when*.

For stronger guarantees (PAdES-LTV, RFC 3161 timestamps, OpenTimestamps Bitcoin
anchoring) see the roadmap. The hooks are in `lib/pdf.ts`, `lib/crypto.ts`,
`lib/anchor.ts`.

## Secrets / environment

| Var | Purpose |
|---|---|
| `DOCUSIGN_API_SECRET` | HMAC on the Manager→server API **and** the server→cockpit completion webhook (a wire key). When unset, create/upload is rejected unless `ALLOW_UNAUTHENTICATED_DOCUMENTS=1`. |
| `SERVER_SECRET` | Keys the signed-file HMAC anchor (a storage key). Kept **distinct** from the wire key so rotating one never breaks the other. |
| `SIGN_PUBLIC_BASE_URL` | Base for minted sign links (`http://localhost:3000` dev; `https://sign.tobira.studio` prod). |
| `COMPLETION_WEBHOOK_URL` | Cockpit endpoint the completion webhook POSTs to. Unset → webhook skipped (recorded, not an error). |
| `DOCUMENTS_PDF_ROOT` | Allowlisted root for the `pdfPath` create option (path-traversal guard). |
| `BACKUP_PASSPHRASE` | Passphrase for `scripts/backup-data.mjs` encrypted snapshots. |

## Roadmap

- [ ] Multi-party signing via tokenized magic links
- [ ] PAdES-LTV signing with a self-signed cert (`node-signpdf`)
- [ ] RFC 3161 trusted timestamping
- [ ] OpenTimestamps anchor (Bitcoin proof, free)
- [ ] Replace JSON DB with SQLite when document count justifies it

## License

Personal use. Build on it, fork it, do whatever — just don't sell it back to me
as a SaaS.
