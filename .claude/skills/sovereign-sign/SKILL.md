---
name: sovereign-sign
description: Sign PDFs and author HTML contracts using the user's local Sovereign Sign server. Use when the user wants to sign a document, draft an agreement, send a contract to a counterparty, or replace DocuSign/Adobe Sign for personal use. Runs entirely on localhost — nothing leaves the user's machine.
---

# Sovereign Sign — Claude Code skill

This skill drives the user's locally-installed [Sovereign Sign](https://github.com/22kyasue/docusign-htmlversion) instance. It is intentionally light: it points Claude at the project directory, makes sure the dev server is up, and tells the user where to click.

## Where the project lives

A file at `~/.claude/skills/sovereign-sign/config.json` records the path of the user's clone, e.g.:

```json
{
  "repoPath": "C:\\Users\\stake\\githubproject\\docusign",
  "port": 3789
}
```

If that file is missing, ask the user to run `install.ps1` (Windows) or `install.sh` (macOS/Linux) from the cloned repo.

## When the user invokes this skill

### Step 1 — load config

```
Read ~/.claude/skills/sovereign-sign/config.json
```

If the file does not exist, tell the user:

> Sovereign Sign isn't installed yet. Clone https://github.com/22kyasue/docusign-htmlversion and run `install.ps1` (Windows) or `install.sh` (Linux/macOS) from the repo root.

### Step 2 — make sure the server is up

Probe the configured port:

```bash
curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:<port>/
```

If the response is `200`, the server is already running. If it is anything else, start it from `repoPath`:

```powershell
# Windows
Start-Process -WorkingDirectory "<repoPath>" -FilePath "npm.cmd" -ArgumentList "run","dev","--","--port","<port>" -WindowStyle Hidden
```

```bash
# Linux / macOS
( cd "<repoPath>" && npm run dev -- --port <port> > /tmp/sovereign-sign.log 2>&1 & )
```

Wait ~5 seconds and probe again. If still not responding, surface the log to the user — do not loop forever.

### Step 3 — route to the right page

Pick the URL based on what the user asked for:

| User intent | URL |
|---|---|
| "sign this PDF" / "I have a PDF that needs a signature" | `http://localhost:<port>/` → upload section |
| "draft a contract" / "send an agreement" / "I need an SOW" | `http://localhost:<port>/contracts/new` |
| "show me what I've signed" / "list my documents" | `http://localhost:<port>/` |
| Specific contract id | `http://localhost:<port>/contracts/<id>` |

Tell the user the URL and what to do next. Do **not** try to drive the browser unless the user explicitly asks — local Playwright might not be authorized.

### Step 4 — if the user wants to upload a PDF programmatically

You can short-circuit the upload UI:

```bash
curl -s -F "file=@/path/to/contract.pdf" http://127.0.0.1:<port>/api/documents
```

The response includes `document.id`. Then point the user at `http://localhost:<port>/sign/<id>`.

### Step 5 — verifying a signed PDF later

Anyone can verify a downloaded `signed.pdf` by hashing it and comparing to the value printed on the audit page:

```powershell
certutil -hashfile signed.pdf SHA256
```

```bash
shasum -a 256 signed.pdf
```

If the printed digest matches the "Signed SHA-256" on the audit page, the PDF hasn't been tampered with.

## Things this skill should NOT do

- Do not upload PDFs to any external service. Sovereign Sign is local-first by design.
- Do not modify the user's signed files. Once signed, the file is the receipt.
- Do not start the server on a port other than the one in `config.json` without asking. The user may have other services bound to nearby ports.

## Troubleshooting

- **`EADDRINUSE` on start** — the server is already up. Skip to Step 3.
- **`pdf.worker.min.mjs` 404** — run `npm run postinstall` inside `repoPath`.
- **No `data/` directory** — that's fine; it is created on first upload.
- **Hashes don't match the audit page** — the file was modified after signing. Re-download from `http://localhost:<port>/api/documents/<id>/file?variant=signed`.

## API surface (for other skills / scripts)

| Method | Path | Purpose |
|---|---|---|
| `GET`  | `/api/documents` | list uploaded PDFs |
| `POST` | `/api/documents` | upload (multipart, field `file`) |
| `GET`  | `/api/documents/[id]` | fetch metadata |
| `GET`  | `/api/documents/[id]/file?variant=signed\|original` | stream the PDF |
| `POST` | `/api/documents/[id]/sign` | stamp signature image, append audit page |
| `GET`  | `/api/contracts` | list HTML contracts |
| `POST` | `/api/contracts` | create a new contract from template + variables |
| `GET`  | `/api/contracts/[id]` | fetch contract |
| `POST` | `/api/contracts/[id]/sign` | record a signer's signature (magic-link token in `?t=`) |
| `POST` | `/api/contracts/[id]/snapshot` | freeze the contract to PDF once all signers have signed |
