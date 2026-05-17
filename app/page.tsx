import Link from "next/link";
import { listDocuments } from "@/lib/storage";
import { listContracts } from "@/lib/contract-storage";
import UploadForm from "./_components/UploadForm";

export const dynamic = "force-dynamic";

export default async function Home() {
  const [contracts, docs] = await Promise.all([listContracts(), listDocuments()]);
  return (
    <main className="mx-auto flex max-w-4xl flex-col gap-10 px-6 py-12">
      <header className="flex items-baseline justify-between border-b border-zinc-200 pb-4 dark:border-zinc-800">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Sovereign Sign</h1>
          <p className="text-sm text-zinc-500">
            Own your signatures. No SaaS in the middle.
          </p>
        </div>
        <span className="rounded-full bg-emerald-100 px-3 py-1 text-xs font-medium text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200">
          local-first
        </span>
      </header>

      <section className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
        <div className="flex items-baseline justify-between">
          <div>
            <h2 className="text-lg font-medium">Contracts</h2>
            <p className="text-sm text-zinc-500">
              HTML-native. Build once, sign in the browser, snapshot on completion.
            </p>
          </div>
          <Link
            href="/contracts/new"
            className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500"
          >
            + New contract
          </Link>
        </div>

        {contracts.length === 0 ? (
          <p className="mt-4 text-sm text-zinc-500">
            まだ契約はありません。「+ New contract」から作成してください。
          </p>
        ) : (
          <ul className="mt-4 flex flex-col gap-2">
            {contracts.slice(0, 5).map((c) => {
              const signed = c.signers.filter((s) => s.signedAt).length;
              return (
                <li
                  key={c.id}
                  className="flex items-center justify-between rounded-xl border border-zinc-200 p-3 dark:border-zinc-800"
                >
                  <div className="flex flex-col">
                    <span className="font-medium">{c.variables.projectName}</span>
                    <span className="text-xs text-zinc-500">
                      {c.variables.clientCompany} · {signed}/{c.signers.length} signed
                    </span>
                  </div>
                  <Link
                    href={`/contracts/${c.id}`}
                    className="rounded-lg bg-zinc-900 px-3 py-1.5 text-sm text-white hover:bg-zinc-700 dark:bg-white dark:text-zinc-900 dark:hover:bg-zinc-200"
                  >
                    Open
                  </Link>
                </li>
              );
            })}
            {contracts.length > 5 && (
              <li>
                <Link href="/contracts" className="text-sm text-emerald-700 hover:underline dark:text-emerald-300">
                  See all {contracts.length} contracts →
                </Link>
              </li>
            )}
          </ul>
        )}
      </section>

      <details className="group rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
        <summary className="cursor-pointer list-none">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="inline text-lg font-medium">Legacy: PDF documents</h2>
              <p className="text-sm text-zinc-500">
                既存 PDF をアップロードして自分でサインを焼き込むモード。
                新しい契約は上の Contracts を使ってください。
              </p>
            </div>
            <span className="rounded-full bg-zinc-200 px-2 py-1 text-xs text-zinc-700 group-open:hidden dark:bg-zinc-700 dark:text-zinc-200">
              {docs.length} PDF
            </span>
          </div>
        </summary>

        <div className="mt-4 flex flex-col gap-4">
          <UploadForm />

          {docs.length === 0 ? (
            <p className="text-sm text-zinc-500">PDF はまだありません。</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {docs.map((d) => (
                <li
                  key={d.id}
                  className="flex items-center justify-between rounded-xl border border-zinc-200 p-3 dark:border-zinc-800"
                >
                  <div className="flex flex-col">
                    <span className="font-medium">{d.name}</span>
                    <span className="text-xs text-zinc-500">
                      {d.id} · {new Date(d.updatedAt).toLocaleString()}
                    </span>
                    <span className="font-mono text-[10px] text-zinc-400">
                      sha256 {d.originalSha256.slice(0, 16)}…
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span
                      className={
                        d.status === "signed"
                          ? "rounded-full bg-emerald-100 px-2 py-1 text-xs font-medium text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200"
                          : "rounded-full bg-amber-100 px-2 py-1 text-xs font-medium text-amber-800 dark:bg-amber-900/40 dark:text-amber-200"
                      }
                    >
                      {d.status}
                    </span>
                    <Link
                      href={`/sign/${d.id}`}
                      className="rounded-lg bg-zinc-900 px-3 py-1.5 text-sm text-white hover:bg-zinc-700 dark:bg-white dark:text-zinc-900 dark:hover:bg-zinc-200"
                    >
                      {d.status === "signed" ? "View" : "Sign"}
                    </Link>
                    {d.status === "signed" && (
                      <a
                        href={`/api/documents/${d.id}/file?variant=signed`}
                        className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
                      >
                        Download
                      </a>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </details>
    </main>
  );
}
