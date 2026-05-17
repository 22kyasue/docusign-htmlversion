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

## Run it

```bash
npm install
npm run dev
# → http://localhost:3000
```

The `postinstall` script copies the pdfjs worker into `public/` so the renderer
can find it offline.

For a production build:

```bash
npm run build
npm run start
```

## Flow

1. Drop a PDF on the home page.
2. You're sent to `/sign/<id>`. Tap anywhere on the rendered PDF to place a
   signature field. Tap a field to remove it.
3. Draw your signature on the pad on the right, optionally type a signer name,
   hit **Sign & seal**.
4. The server stamps the signature image into the PDF at each field, appends an
   audit page with the original/signed SHA-256 and event history, re-hashes the
   final output, and stores both files plus the metadata record.
5. The home page now shows a **Download** button that streams the signed PDF.

## Data layout

```
data/
├── documents.json        # metadata DB (one row per document)
└── files/                # original and signed PDFs
```

Both directories are git-ignored. Back them up — they ARE the product.

## Why this isn't snake oil

- Visual signatures on PDFs are accepted under eIDAS SES, ESIGN, and Japan's
  電子署名法 for most personal use cases. This tool produces exactly that, plus a
  cryptographic audit trail.
- Tamper evidence is the SHA-256 chain in the audit log. If the file is altered
  after signing, the recorded hash no longer matches.
- For stronger guarantees (PAdES, RFC 3161 timestamps, OpenTimestamps anchoring
  to Bitcoin), see the roadmap below. The hooks are in place — extend
  `lib/pdf.ts` and `lib/crypto.ts`.

## Roadmap

- [ ] Multi-party signing via tokenized magic links
- [ ] PAdES-LTV signing with a self-signed cert (`node-signpdf`)
- [ ] RFC 3161 trusted timestamping
- [ ] OpenTimestamps anchor (Bitcoin proof, free)
- [ ] Replace JSON DB with SQLite when document count justifies it

## License

Personal use. Build on it, fork it, do whatever — just don't sell it back to me
as a SaaS.
