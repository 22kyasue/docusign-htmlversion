import { notFound } from "next/navigation";
import Link from "next/link";
import { getContract } from "@/lib/contract-storage";
import {
  CONTRACT_CSS,
  injectSignatureImage,
  renderContractBody,
} from "@/lib/contract-template";
import { readFileBytes } from "@/lib/storage";
import { isTokenExpired } from "@/lib/tokens";
import SignerView from "./SignerView";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ t?: string }>;
}

export default async function ContractPage({ params, searchParams }: PageProps) {
  const { id } = await params;
  const { t: token } = await searchParams;

  const c = await getContract(id);
  if (!c) notFound();

  // Match the token (if any) to a signer.
  const activeSigner = token ? c.signers.find((s) => s.token === token) : undefined;
  const tokenStatus = activeSigner
    ? isTokenExpired(activeSigner.tokenExpiresAt)
      ? "expired"
      : activeSigner.signedAt
        ? "already_signed"
        : "valid"
    : token
      ? "invalid"
      : "no_token";

  // Render the contract body. For signed signers, inline their PNG so the
  // page shows the actual stroke they drew.
  let body = renderContractBody(c);
  for (const s of c.signers) {
    if (!s.signedAt || !s.signatureImageFile) continue;
    try {
      const buf = await readFileBytes(s.signatureImageFile);
      const dataUrl = `data:image/png;base64,${Buffer.from(buf).toString("base64")}`;
      body = injectSignatureImage(body, s.id, dataUrl);
    } catch {
      // signature file missing — leave the slot empty
    }
  }

  const signedCount = c.signers.filter((s) => s.signedAt).length;
  const isCompleted = c.status === "completed";

  return (
    <main className="mx-auto flex max-w-4xl flex-col gap-6 px-4 py-8 sm:px-6">
      <header className="flex flex-col gap-2 border-b border-zinc-200 pb-4 dark:border-zinc-800 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <Link href="/contracts" className="text-xs text-zinc-500 hover:underline">
            ← Contracts
          </Link>
          <h1 className="text-xl font-semibold">{c.variables.projectName}</h1>
          <p className="font-mono text-xs text-zinc-500">
            {c.id} · {signedCount}/{c.signers.length} signed
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span
            className={
              isCompleted
                ? "rounded-full bg-emerald-100 px-3 py-1 text-xs font-medium text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200"
                : c.status === "voided"
                  ? "rounded-full bg-rose-100 px-3 py-1 text-xs font-medium text-rose-800 dark:bg-rose-900/40 dark:text-rose-200"
                  : "rounded-full bg-amber-100 px-3 py-1 text-xs font-medium text-amber-800 dark:bg-amber-900/40 dark:text-amber-200"
            }
          >
            {c.status}
          </span>
          {isCompleted && (
            <a
              href={`/api/contracts/${c.id}/snapshot`}
              target="_blank"
              rel="noreferrer"
              className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
            >
              View signed snapshot
            </a>
          )}
        </div>
      </header>

      {tokenStatus === "invalid" && (
        <Banner tone="error">
          このリンクは無効です。署名用の正しいリンクをご確認ください。
        </Banner>
      )}
      {tokenStatus === "expired" && (
        <Banner tone="error">
          このリンクは有効期限が切れています。新しい署名リンクの発行をご依頼ください。
        </Banner>
      )}
      {tokenStatus === "already_signed" && (
        <Banner tone="ok">
          署名済みです。署名日時:{" "}
          <span className="font-mono">{activeSigner?.signedAt}</span>
        </Banner>
      )}

      <style dangerouslySetInnerHTML={{ __html: CONTRACT_CSS }} />

      <article
        className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900 sm:p-10"
        dangerouslySetInnerHTML={{ __html: body }}
      />

      {tokenStatus === "valid" && activeSigner && (
        <SignerView
          contractId={c.id}
          token={token!}
          signerName={activeSigner.name}
          signerRole={activeSigner.role}
        />
      )}

      <section className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">
          Audit trail
        </h2>
        <ul className="mt-3 flex flex-col gap-1.5 text-sm">
          {c.audit.map((e, i) => (
            <li key={i} className="flex flex-wrap gap-x-3 gap-y-1 font-mono text-xs">
              <span className="text-zinc-400">{e.at}</span>
              <span className="font-medium">{e.action}</span>
              {e.actor && <span className="text-zinc-500">by {e.actor}</span>}
              {e.ip && <span className="text-zinc-400">ip {e.ip}</span>}
              {e.htmlSnapshotSha256 && (
                <span className="text-zinc-400">sha256 {e.htmlSnapshotSha256.slice(0, 16)}…</span>
              )}
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}

function Banner({
  tone,
  children,
}: {
  tone: "ok" | "error";
  children: React.ReactNode;
}) {
  const cls =
    tone === "ok"
      ? "border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-200"
      : "border-rose-300 bg-rose-50 text-rose-800 dark:border-rose-800 dark:bg-rose-950/30 dark:text-rose-200";
  return (
    <div className={`rounded-lg border px-4 py-3 text-sm ${cls}`}>{children}</div>
  );
}
