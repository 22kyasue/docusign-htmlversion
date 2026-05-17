import Link from "next/link";
import { listDocuments } from "@/lib/storage";
import UploadForm from "./_components/UploadForm";

export const dynamic = "force-dynamic";

export default async function Home() {
  const docs = await listDocuments();
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
        <h2 className="text-lg font-medium">Upload a PDF</h2>
        <p className="mb-4 text-sm text-zinc-500">
          The file is stored on this machine in <code>./data/files</code>. SHA-256 is hashed on the way in.
        </p>
        <UploadForm />
      </section>

      <section>
        <h2 className="mb-3 text-lg font-medium">Documents ({docs.length})</h2>
        {docs.length === 0 ? (
          <p className="text-sm text-zinc-500">Nothing yet. Upload a PDF to get started.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {docs.map((d) => (
              <li
                key={d.id}
                className="flex items-center justify-between rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900"
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
      </section>
    </main>
  );
}
