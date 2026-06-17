import { notFound } from "next/navigation";
import { getDocument } from "@/lib/storage";
import { isTokenExpired } from "@/lib/tokens";
import SignClient from "./SignClient";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ t?: string }>;
}

type TokenStatus = "valid" | "already_signed" | "expired" | "invalid" | "no_token";

export default async function SignPage({ params, searchParams }: PageProps) {
  const { id } = await params;
  const { t: token } = await searchParams;

  const doc = await getDocument(id);
  if (!doc) notFound();

  const signer = doc.signer;
  const matches = Boolean(token && signer && token === signer.token);
  const tokenStatus: TokenStatus = matches
    ? signer!.signedAt
      ? "already_signed"
      : isTokenExpired(signer!.tokenExpiresAt)
        ? "expired"
        : "valid"
    : token
      ? "invalid"
      : "no_token";

  const isSigned = doc.status === "signed";

  // Authz: the PDF carries the full commercial/legal content + signer identity.
  // Show it only to someone who arrived with a valid or already-signed magic
  // link. A bare document id is NOT enough.
  const mayView = tokenStatus === "valid" || tokenStatus === "already_signed";

  if (!mayView) {
    return (
      <main className="mx-auto flex min-h-screen max-w-lg flex-col justify-center gap-6 px-5 py-12">
        <Brand />
        <div className="rounded-2xl border border-zinc-200 bg-white p-7 text-center shadow-sm">
          <h1 className="text-lg font-semibold text-zinc-900">署名用リンクが必要です</h1>
          <p className="mt-3 text-sm leading-relaxed text-zinc-600">
            {tokenStatus === "expired"
              ? "このリンクは有効期限が切れています。お手数ですが、新しい署名用リンクの発行をご依頼ください。"
              : tokenStatus === "invalid"
                ? "このリンクは無効です。メールに記載された正しい署名用リンクから、もう一度お開きください。"
                : "この書類をご覧いただくには、メールでお送りした署名用リンクからアクセスしてください。"}
          </p>
        </div>
        <p className="text-center text-xs text-zinc-400">
          リンクに心当たりがない場合は、送信元にお問い合わせください。
        </p>
      </main>
    );
  }

  return (
    <main className="mx-auto flex max-w-5xl flex-col gap-5 px-4 py-6 sm:px-6 sm:py-10">
      <Brand />

      <header className="flex flex-col gap-3 rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-xs font-medium uppercase tracking-wider text-zinc-400">
            電子署名のお願い
          </span>
          <StatusPill signed={isSigned} />
        </div>
        <h1 className="text-lg font-semibold leading-snug text-zinc-900 sm:text-xl">{doc.name}</h1>
        <p className="font-mono text-xs text-zinc-400">
          {doc.id} · sha256 {doc.originalSha256.slice(0, 24)}…
        </p>
      </header>

      {tokenStatus === "already_signed" && (
        <div className="flex flex-col gap-3">
          <Banner>
            ご署名ありがとうございました。お客様のご署名は受け付けております。
            {signer?.signedAt && (
              <span className="mt-1 block font-mono text-xs opacity-80">
                署名日時 {fmtJa(signer.signedAt)}
              </span>
            )}
            <span className="mt-2 block text-xs opacity-90">
              署名済みの控えは、ご登録のメールアドレスにもお送りいたします。
            </span>
          </Banner>
          <a
            href={`/api/documents/${doc.id}/file?variant=signed&download=1&t=${encodeURIComponent(token!)}`}
            download
            className="flex items-center justify-center gap-2 rounded-xl bg-emerald-600 px-5 py-3.5 text-base font-semibold text-white shadow-sm transition hover:bg-emerald-500"
          >
            署名済みPDFをダウンロード
          </a>
        </div>
      )}

      <SignClient
        docId={doc.id}
        token={token!}
        signerName={signer!.name}
        alreadySigned={tokenStatus === "already_signed"}
        fields={doc.fields}
        pdfUrl={`/api/documents/${doc.id}/file?variant=${isSigned ? "signed" : "original"}&t=${encodeURIComponent(token!)}`}
      />

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
      <span className="text-sm font-semibold tracking-tight text-zinc-700">Tobira Studio</span>
    </div>
  );
}

function StatusPill({ signed }: { signed: boolean }) {
  return signed ? (
    <span className="rounded-full bg-emerald-100 px-3 py-1 text-xs font-medium text-emerald-800">
      署名済み
    </span>
  ) : (
    <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-medium text-amber-800">
      署名待ち
    </span>
  );
}

function Banner({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-emerald-300 bg-emerald-50 px-4 py-3 text-sm leading-relaxed text-emerald-900">
      {children}
    </div>
  );
}

function fmtJa(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日 ${p(d.getHours())}:${p(d.getMinutes())}`;
}
