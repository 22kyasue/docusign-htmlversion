import Link from "next/link";
import { listContracts } from "@/lib/contract-storage";

export const dynamic = "force-dynamic";

function statusPill(status: string) {
  const base = "rounded-full px-2 py-1 text-xs font-medium";
  switch (status) {
    case "completed":
      return `${base} bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200`;
    case "pending_signatures":
      return `${base} bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200`;
    case "voided":
      return `${base} bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-200`;
    default:
      return `${base} bg-zinc-200 text-zinc-700 dark:bg-zinc-700 dark:text-zinc-200`;
  }
}

export default async function ContractsPage() {
  const rows = await listContracts();

  return (
    <main className="mx-auto flex max-w-4xl flex-col gap-8 px-6 py-12">
      <header className="flex items-baseline justify-between border-b border-zinc-200 pb-4 dark:border-zinc-800">
        <div>
          <Link href="/" className="text-xs text-zinc-500 hover:underline">
            ← Sovereign Sign
          </Link>
          <h1 className="text-3xl font-semibold tracking-tight">Contracts</h1>
          <p className="text-sm text-zinc-500">
            HTML-native contracts. Build once, sign in the browser, snapshot at completion.
          </p>
        </div>
        <Link
          href="/contracts/new"
          className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500"
        >
          + New contract
        </Link>
      </header>

      <section>
        {rows.length === 0 ? (
          <p className="text-sm text-zinc-500">
            No contracts yet. <Link className="underline" href="/contracts/new">Create one</Link> to get started.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {rows.map((c) => {
              const signedCount = c.signers.filter((s) => s.signedAt).length;
              return (
                <li
                  key={c.id}
                  className="flex items-center justify-between rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900"
                >
                  <div className="flex flex-col">
                    <span className="font-medium">{c.variables.projectName}</span>
                    <span className="text-xs text-zinc-500">
                      {c.variables.clientCompany} · ¥{c.variables.priceJpy.toLocaleString("ja-JP")} tax-excl.
                    </span>
                    <span className="font-mono text-[10px] text-zinc-400">
                      {c.id} · updated {new Date(c.updatedAt).toLocaleString()}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-zinc-500">
                      {signedCount}/{c.signers.length} signed
                    </span>
                    <span className={statusPill(c.status)}>{c.status}</span>
                    <Link
                      href={`/contracts/${c.id}`}
                      className="rounded-lg bg-zinc-900 px-3 py-1.5 text-sm text-white hover:bg-zinc-700 dark:bg-white dark:text-zinc-900 dark:hover:bg-zinc-200"
                    >
                      Open
                    </Link>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </main>
  );
}
