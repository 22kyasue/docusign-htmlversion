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
| "sign this PDF" / "I have a PDF that needs a signature" (legacy PDF flow) | `http://localhost:<port>/` → "Legacy: PDF documents" section |
| "draft a contract" / "send an agreement" / "I need an SOW" | `http://localhost:<port>/contracts/new` |
| "show me what I've signed" / "list my contracts" | `http://localhost:<port>/contracts` |
| Specific contract id | `http://localhost:<port>/contracts/<id>` |
| **Send a contract to a counterparty to sign** | the per-signer magic link returned by create: `http://localhost:<port>/contracts/<id>?t=<token>` |

> NOTE — two separate flows: `/contracts/...` is the HTML-contract flow (template +
> magic-link signing, the one you send to clients). `/sign/<id>` is the **legacy
> PDF-upload** flow and only resolves a `documents` record — do NOT point a contract
> signer there; their link is `/contracts/<id>?t=<token>`.

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
| `GET`  | `/api/documents` | list documents (signer tokens stripped) |
| `POST` | `/api/documents` | **create** a token-gated signing job. HMAC-authenticated (cockpit/Manager path). JSON body `{ name, pdfBase64 \| pdfPath, signer:{name,email}, fields:[{page,xRatio,yRatio,widthRatio,heightRatio}], externalRef? }`. Returns `{ documentId, token, signUrl, expiresAt }`. Requires a valid HMAC when `DOCUSIGN_API_SECRET` is set; otherwise rejected unless `ALLOW_UNAUTHENTICATED_DOCUMENTS=1` |
| `POST` | `/api/documents/upload` | operator browser upload (multipart, field `file`). Operator-gated (`x-operator-secret` == `DOCUSIGN_API_SECRET`, or open when no secret set). Returns `{ document:{id}, token, signPath }` |
| `GET`  | `/api/documents/[id]` | fetch metadata (signer token stripped) |
| `GET`  | `/api/documents/[id]/file?variant=signed\|original` | stream the PDF. **Access-controlled**: requires the signer token (`?t=` / `x-signer-token`) or the operator secret (`x-operator-secret`). A bare id → 401 |
| `POST` | `/api/documents/[id]/sign` | record the signer's signature. Body `{ token, signaturePngDataUrl }` (NO fields — the field is server-stored). 401 invalid/expired token, 409 already-signed, 400 invalid/blank PNG. Stamps at the pre-placed field, appends audit page, writes HMAC anchor, seals read-only, fires the completion webhook |
| `GET`  | `/api/contracts` | list HTML contracts (signer tokens stripped) |
| `POST` | `/api/contracts` | create a contract from template + variables; returns per-signer tokens + magic-link paths. Requires HMAC auth when `DOCUSIGN_API_SECRET` is set; otherwise rejected unless `ALLOW_UNAUTHENTICATED_CONTRACTS=1` |
| `GET`  | `/api/contracts/[id]` | fetch contract (signer tokens stripped) |
| `POST` | `/api/contracts/[id]/sign` | record a signer's signature. Token goes in the **JSON body** (`{ token, signaturePngDataUrl }`), not the query string. The `?t=` is only on the signer *page* URL |
| `GET`  | `/api/contracts/[id]/snapshot` | stream the frozen signed **HTML** snapshot (created automatically when the last signer signs). Responds with `x-content-sha256` so callers can verify the bytes. There is no PDF export for contracts yet — the canonical artifact is this HTML snapshot |
