"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export default function UploadForm() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const form = e.currentTarget;
    const fd = new FormData(form);
    setBusy(true);
    try {
      const res = await fetch("/api/documents", { method: "POST", body: fd });
      const json = (await res.json()) as { document?: { id: string }; error?: string };
      if (!res.ok || !json.document) {
        setError(json.error ?? "upload failed");
        return;
      }
      router.push(`/sign/${json.document.id}`);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "network error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3 sm:flex-row sm:items-center">
      <input
        type="file"
        name="file"
        accept="application/pdf"
        required
        className="block w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm file:mr-3 file:rounded-md file:border-0 file:bg-zinc-900 file:px-3 file:py-1.5 file:text-white dark:border-zinc-700"
      />
      <button
        type="submit"
        disabled={busy}
        className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
      >
        {busy ? "Uploading…" : "Upload"}
      </button>
      {error && <span className="text-sm text-red-500">{error}</span>}
    </form>
  );
}
