import { notFound } from "next/navigation";
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

type TokenStatus =
  | "valid"
  | "already_signed"
  | "expired"
  | "invalid"
  | "no_token";

export default async function ContractPage({ params, searchParams }: PageProps) {
  const { id } = await params;
  const { t: token } = await searchParams;

  const c = await getContract(id);
  if (!c) notFound();

  const activeSigner = token ? c.signers.find((s) => s.token === token) : undefined;
  const tokenStatus: TokenStatus = activeSigner
    ? isTokenExpired(activeSigner.tokenExpiresAt)
      ? "expired"
      : activeSigner.signedAt
        ? "already_signed"
        : "valid"
    : token
      ? "invalid"
      : "no_token";

  const isCompleted = c.status === "completed";

  // Authz: the contract body contains the full commercial terms (parties,
  // legal names, price, payment, IP addresses in the audit trail). Show it only
  // to someone who arrived with a valid/already-signed magic link, or for a
  // completed contract (the signed receipt). A bare contract id is NOT enough.
  const mayViewBody =
    tokenStatus === "valid" ||
    tokenStatus === "already_signed" ||
    isCompleted;

  if (!mayViewBody) {
    return (
      <main className="mx-auto flex min-h-screen max-w-lg flex-col justify-center gap-6 px-5 py-12">
        <Brand />
        <div className="rounded-2xl border border-zinc-200 bg-white p-7 text-center shadow-sm">
          <h1 className="text-lg font-semibold text-zinc-900">
            署名用リンクが必要です
          </h1>
          <p className="mt-3 text-sm leading-relaxed text-zinc-600">
            {tokenStatus === "expired"
              ? "このリンクは有効期限が切れています。お手数ですが、新しい署名用リンクの発行をご依頼ください。"
              : tokenStatus === "invalid"
                ? "このリンクは無効です。メールに記載された正しい署名用リンクから、もう一度お開きください。"
                : "この契約書をご覧いただくには、メールでお送りした署名用リンクからアクセスしてください。"}
          </p>
        </div>
        <p className="text-center text-xs text-zinc-400">
          リンクに心当たりがない場合は、送信元にお問い合わせください。
        </p>
      </main>
    );
  }

  // Render the body with each signed party's stroke inlined.
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
  const totalCount = c.signers.length;

  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-5 px-4 py-6 sm:px-6 sm:py-10">
      <Brand />

      <header className="flex flex-col gap-3 rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-xs font-medium uppercase tracking-wider text-zinc-400">
            電子署名のお願い
          </span>
          <StatusPill status={c.status} />
        </div>
        <h1 className="text-lg font-semibold leading-snug text-zinc-900 sm:text-xl">
          {c.variables.projectName}
        </h1>
        <Progress signed={signedCount} total={totalCount} />
      </header>

      {tokenStatus === "already_signed" && (
        <Banner tone="ok">
          ご署名ありがとうございました。お客様のご署名は受け付けております。
          {activeSigner?.signedAt && (
            <span className="mt-1 block font-mono text-xs opacity-80">
              署名日時 {fmtJa(activeSigner.signedAt)}
            </span>
          )}
        </Banner>
      )}

      {isCompleted && (
        <Banner tone="ok">
          両者のご署名がそろい、本契約は締結されました。下記が署名済みの契約書です。
        </Banner>
      )}

      <style dangerouslySetInnerHTML={{ __html: CONTRACT_CSS }} />

      <article
        className="overflow-hidden rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm sm:p-8"
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

      {isCompleted && (
        <a
          href={`/api/contracts/${c.id}/snapshot`}
          target="_blank"
          rel="noreferrer"
          className="self-center rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50"
        >
          署名済み契約書を別タブで開く
        </a>
      )}

      <footer className="mt-2 border-t border-zinc-200 pt-4 text-center text-xs leading-relaxed text-zinc-400">
        本ページは Tobira Studio の電子契約システムにより安全に配信されています。
        <br className="hidden sm:block" />
        ご署名内容は SHA-256 により改ざん検知され、監査記録として保存されます。
      </footer>
    </main>
  );
}

function Brand() {
  return (
    <div className="flex items-center justify-center gap-2 text-zinc-500">
      <span className="inline-block h-2 w-2 rounded-full bg-emerald-500" aria-hidden />
      <span className="text-sm font-semibold tracking-tight text-zinc-700">
        Tobira Studio
      </span>
    </div>
  );
}

function Progress({ signed, total }: { signed: number; total: number }) {
  return (
    <div className="flex items-center gap-3">
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-zinc-100">
        <div
          className="h-full rounded-full bg-emerald-500 transition-all"
          style={{ width: `${total > 0 ? (signed / total) * 100 : 0}%` }}
        />
      </div>
      <span className="shrink-0 text-xs font-medium text-zinc-500">
        署名 {signed} / {total}
      </span>
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  const map: Record<string, { label: string; cls: string }> = {
    completed: {
      label: "締結済み",
      cls: "bg-emerald-100 text-emerald-800",
    },
    pending_signatures: {
      label: "署名待ち",
      cls: "bg-amber-100 text-amber-800",
    },
    voided: { label: "無効", cls: "bg-rose-100 text-rose-800" },
    draft: { label: "下書き", cls: "bg-zinc-200 text-zinc-700" },
  };
  const { label, cls } = map[status] ?? map.draft;
  return (
    <span className={`rounded-full px-3 py-1 text-xs font-medium ${cls}`}>
      {label}
    </span>
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
      ? "border-emerald-300 bg-emerald-50 text-emerald-900"
      : "border-rose-300 bg-rose-50 text-rose-900";
  return (
    <div className={`rounded-xl border px-4 py-3 text-sm leading-relaxed ${cls}`}>
      {children}
    </div>
  );
}

function fmtJa(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日 ${p(
    d.getHours(),
  )}:${p(d.getMinutes())}`;
}
