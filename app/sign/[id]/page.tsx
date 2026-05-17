import { notFound } from "next/navigation";
import Link from "next/link";
import { getDocument } from "@/lib/storage";
import SignClient from "./SignClient";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function SignPage({ params }: PageProps) {
  const { id } = await params;
  const doc = await getDocument(id);
  if (!doc) notFound();

  return (
    <main className="mx-auto flex max-w-5xl flex-col gap-4 px-4 py-8">
      <header className="flex items-center justify-between">
        <div>
          <Link href="/" className="text-sm text-zinc-500 hover:underline">
            ← back
          </Link>
          <h1 className="text-2xl font-semibold">{doc.name}</h1>
          <p className="text-xs text-zinc-500 font-mono">
            {doc.id} · sha256 {doc.originalSha256.slice(0, 24)}…
          </p>
        </div>
        <span
          className={
            doc.status === "signed"
              ? "rounded-full bg-emerald-100 px-3 py-1 text-xs font-medium text-emerald-800"
              : "rounded-full bg-amber-100 px-3 py-1 text-xs font-medium text-amber-800"
          }
        >
          {doc.status}
        </span>
      </header>

      <SignClient
        docId={doc.id}
        alreadySigned={doc.status === "signed"}
        pdfUrl={`/api/documents/${doc.id}/file?variant=${doc.status === "signed" ? "signed" : "original"}`}
      />
    </main>
  );
}
