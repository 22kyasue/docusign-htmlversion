# PICKUP — Tobira Studio signing service

**Date:** 2026-06-23
**Owner:** Kotaro
**Status:** Decided. Ready to deploy. Awaiting 3 inputs (see [Open decisions](#open-decisions)).

> Pick this up on the OpenClaw box (the one with access to the Hetzner cockpit + the live
> domain). Everything you need to stand up the service is in this repo.

---

## TL;DR

**We are NOT hosting Sovereign Sign. We are adopting [DocuSeal](https://github.com/docusealco/docuseal) (self-hosted) on the Hetzner box.**

Sovereign Sign stays what it was built to be: a **localhost-only personal signer** (the
Claude Code skill still works). It is the wrong tool for a public, always-on studio
signing service — see why below.

Deploy artifacts are in [`deploy/docuseal/`](deploy/docuseal). On the box:

```bash
cd deploy/docuseal
cp .env.example .env      # fill HOST + POSTGRES_PASSWORD
docker compose up -d
```

---

## The decision and why

Goal changed: from "sovereign / nothing leaves my machine" → **"available 24/7 at a Tobira
Studio domain, simple, just works."** The moment it's public-hosted, the only edge Sovereign
Sign had (local-only) is gone — and on the hosted playing field, DocuSeal/Documenso win on
every capability that matters.

A 4-agent comparison workflow (ours vs DocuSeal vs Documenso) reached this verdict
**decisively**. Key findings:

- **No differentiator survives hosting.** The HTML-native contract idea was the one novel
  angle, but its "tamper evidence" is a SHA-256 *we* compute and print into the doc
  ourselves — no third-party timestamp, no X.509 seal. DocuSeal/Documenso produce
  **PAdES-sealed PDFs with RFC 3161 trusted timestamps**, i.e. the *more* legally defensible
  artifact. Hosting ours would ship the weaker one.
- **Ours cannot go public as-is — 3 Critical blockers** (the workflow read the actual code):
  1. **Data loss.** JSON-on-disk, no locking. Two signers at once race on
     read-modify-write-whole-file → silently dropped signature or corrupted file. The signed
     doc *is* the product.
  2. **Wide open.** UI + most API routes are unauthenticated. Anyone hitting the domain can
     list every contract, download signed PDFs, and self-sign uploads.
  3. **No email.** No send-for-signature pipeline; magic links are hand-copied. A public
     signing service that can't email the counterparty isn't one.
- Closing those + reaching parity = weeks-to-months rebuilding the exact "tricky" stack
  (real DB, object storage, accounts, SMTP, crypto sealing, timestamps, audit certs,
  backups, rate limiting) that DocuSeal already ships — ending with **no** differentiator.

**Why DocuSeal over Documenso for *this* ask:** you want adopt-and-host, not hack-on-code.
DocuSeal = single container, fastest to live, best template builder. (Documenso would only
win if we wanted to fork and keep coding in our own TS stack — explicitly not the goal.)

The 業務委託契約書 is **not lost**: rebuild it in DocuSeal's template builder (~5 min) with
`{{甲_署名}}`-style field tags. It becomes a reusable, multi-party template instead of
hardcoded HTML.

---

## What we're deploying

| Piece | Choice |
|---|---|
| Platform | DocuSeal (`docuseal/docuseal:latest`), AGPLv3 self-host |
| Host | Tobira Studio Hetzner box (via OpenClaw / Hetzner cockpit) |
| Domain | **TBD** — e.g. `sign.tobirastudio.com` (needs an A record → box IP) |
| TLS | DocuSeal's built-in Caddy, auto Let's Encrypt (triggered by `HOST`) |
| DB | PostgreSQL 16 (durable, concurrency-safe — fixes ours' Critical #1) |
| Email | Existing Tobira SMTP creds, set in DocuSeal Settings → Email (or `SMTP_*` env) |
| Persistence | Docker volumes `docuseal_data` (files) + `pg_data` (DB) |
| Backups | cron `pg_dump` + push `docuseal_data` off-box (S3/Backblaze) |

**License note (AGPLv3):** fine for internal studio use. If we ever *modify DocuSeal's source*
and offer it to third parties over the network, we'd owe those changes back and must keep the
DocuSeal attribution visible. We're not modifying source, so this is a non-issue for now.

---

## Deploy steps

1. **DNS** — add an A record for the chosen subdomain → the Hetzner box public IP. Let it
   propagate before step 3 (Caddy needs it resolving to issue the cert).
2. **Config** — `cd deploy/docuseal && cp .env.example .env`, then fill `HOST` (the subdomain)
   and `POSTGRES_PASSWORD` (`openssl rand -hex 24`).
3. **Up** — `docker compose up -d`. Ports 80/443 must be free + open in the firewall. Caddy
   provisions TLS automatically once `HOST` resolves to this box.
4. **First-boot admin** — open `https://<subdomain>`, create the admin account immediately
   (the first account claims the instance).
5. **SMTP** — Settings → Email: paste the Tobira SMTP host/port/user/pass/from. Send a test.
   (Or uncomment the `SMTP_*` lines in `.env` and re-up.)
6. **Template** — rebuild the 業務委託契約書 as a DocuSeal template: upload the shell PDF/DOCX,
   drop signature/name/date fields for 甲 (studio) and 乙 (client), save as reusable.
7. **Backups** — add a cron: nightly `pg_dump` of the `docuseal` DB + sync the `docuseal_data`
   volume to off-box storage. Test a restore once.
8. **Smoke test** — send one real contract end-to-end to a throwaway address, sign as 乙,
   confirm the completed PDF + certificate of signature land and the audit trail is right.

> The compose was written against DocuSeal's self-host docs (2026-06-23). If the image
> entrypoint/env changed, cross-check the current docs: https://www.docuseal.com/docs and
> https://github.com/docusealco/docuseal — the canonical `docker-compose.yml` lives in that repo.

---

## Open decisions

Fill these in before/at deploy:

1. **Subdomain** — `sign.tobirastudio.com`? `contracts.`? Pick one, add the A record.
2. **Who runs the deploy** — OpenClaw box drives it directly (it has cockpit access), or run
   the commands by hand.
3. **SMTP creds** — provider + host / port / user / pass / from-address. Keep secrets on the
   box (in `.env` or DocuSeal settings), not in git.

---

## Sovereign Sign — what happens to it

Keep the repo as the **localhost personal signer** it was designed to be. The skill
(`/sovereign-sign`) still works for signing your own docs locally, where the "nothing leaves
your machine" pitch genuinely holds. No further work needed; do **not** expose it publicly
(see the 3 Criticals above).

---

## Capability snapshot (ours vs the two, hosted-service lens)

| Capability | Sovereign Sign | DocuSeal | Documenso |
|---|---|---|---|
| 24/7 deploy story | none (localhost) | Docker + Caddy TLS | Docker/Compose/K8s |
| Concurrency-safe storage | JSON, races → data loss | Postgres/MySQL/SQLite | Postgres + Prisma |
| Accounts / auth | none (open UI) | Devise + 2FA + API keys | OAuth + passkeys + SSO |
| Email send-for-sign | none (manual links) | SMTP invites | SMTP invites + reminders |
| Field builder | signature box only | WYSIWYG, 12 types + tags | drag-drop, ~10 types |
| Multi-signer ordering | parallel, 2 hardcoded | sequential/parallel | sequential/parallel + roles |
| Cryptographic PDF seal | none (flattened image) | embedded PDF sig | @documenso/pdf-sign, PAdES |
| Trusted timestamp | none | RFC 3161 (configurable) | RFC 3161, PAdES-LTA |
| Audit certificate | self-hashed, mutable | certificate PDF | sealed cert of completion |
| Legal posture | SES, self-asserted | ESIGN/UETA/eIDAS, PAdES | ESIGN/UETA/eIDAS, PAdES |
