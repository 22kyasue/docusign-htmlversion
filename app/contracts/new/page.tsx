import Link from "next/link";
import NewContractForm from "./NewContractForm";

export const dynamic = "force-dynamic";

export default function NewContractPage() {
  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-6 px-6 py-12">
      <header className="border-b border-zinc-200 pb-4 dark:border-zinc-800">
        <Link href="/contracts" className="text-xs text-zinc-500 hover:underline">
          ← Contracts
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight">New contract</h1>
        <p className="text-sm text-zinc-500">
          Fill the Launch tier template. Both parties get a magic-link URL to sign in the browser.
        </p>
      </header>
      <NewContractForm />
    </main>
  );
}
