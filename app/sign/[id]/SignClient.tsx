"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import SignaturePad from "react-signature-canvas";
import type { SignatureField } from "@/lib/types";

interface SignClientProps {
  docId: string;
  alreadySigned: boolean;
  pdfUrl: string;
}

interface PlacedField extends SignatureField {
  id: string;
}

interface RenderedPage {
  pageNumber: number;
  width: number;
  height: number;
}

const FIELD_WIDTH_RATIO = 0.22;
const FIELD_HEIGHT_RATIO = 0.07;

export default function SignClient({ docId, alreadySigned, pdfUrl }: SignClientProps) {
  const router = useRouter();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const padRef = useRef<SignaturePad | null>(null);
  const [pages, setPages] = useState<RenderedPage[]>([]);
  const [fields, setFields] = useState<PlacedField[]>([]);
  const [actor, setActor] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function render() {
      try {
        const pdfjs = await import("pdfjs-dist");
        pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";

        const buf = await fetch(pdfUrl, { cache: "no-store" }).then((r) => r.arrayBuffer());
        const task = pdfjs.getDocument({ data: new Uint8Array(buf) });
        const doc = await task.promise;
        if (cancelled) return;

        const container = containerRef.current;
        if (!container) return;
        container.innerHTML = "";
        const rendered: RenderedPage[] = [];

        for (let i = 1; i <= doc.numPages; i++) {
          const page = await doc.getPage(i);
          const viewport = page.getViewport({ scale: 1.5 });
          const wrap = document.createElement("div");
          wrap.className = "relative inline-block";
          wrap.style.width = `${viewport.width}px`;
          wrap.style.height = `${viewport.height}px`;
          wrap.dataset.pageIndex = String(i - 1);

          const canvas = document.createElement("canvas");
          canvas.width = viewport.width;
          canvas.height = viewport.height;
          canvas.className = "block border border-zinc-300 shadow-sm";
          wrap.appendChild(canvas);
          container.appendChild(wrap);

          const ctx = canvas.getContext("2d");
          if (!ctx) continue;
          await page.render({ canvasContext: ctx, viewport, canvas }).promise;
          rendered.push({ pageNumber: i, width: viewport.width, height: viewport.height });
        }

        if (!cancelled) setPages(rendered);
      } catch (err: unknown) {
        if (!cancelled) {
          setLoadError(err instanceof Error ? err.message : "failed to render PDF");
        }
      }
    }
    render();
    return () => {
      cancelled = true;
    };
  }, [pdfUrl]);

  function handlePageClick(e: React.MouseEvent<HTMLDivElement>) {
    if (alreadySigned) return;
    const wrap = (e.target as HTMLElement).closest("[data-page-index]") as HTMLElement | null;
    if (!wrap) return;
    const pageIndex = Number(wrap.dataset.pageIndex);
    const rect = wrap.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const xRatio = x / rect.width;
    const yRatio = y / rect.height;
    const id = `${pageIndex}-${Date.now()}`;
    setFields((prev) => [
      ...prev,
      {
        id,
        page: pageIndex,
        xRatio: Math.max(0, Math.min(1 - FIELD_WIDTH_RATIO, xRatio - FIELD_WIDTH_RATIO / 2)),
        yRatio: Math.max(0, Math.min(1 - FIELD_HEIGHT_RATIO, yRatio - FIELD_HEIGHT_RATIO / 2)),
        widthRatio: FIELD_WIDTH_RATIO,
        heightRatio: FIELD_HEIGHT_RATIO,
      },
    ]);
  }

  function removeField(id: string) {
    setFields((prev) => prev.filter((f) => f.id !== id));
  }

  const fieldsByPage = useMemo(() => {
    const map = new Map<number, PlacedField[]>();
    for (const f of fields) {
      const arr = map.get(f.page) ?? [];
      arr.push(f);
      map.set(f.page, arr);
    }
    return map;
  }, [fields]);

  async function applySignature() {
    setError(null);
    if (fields.length === 0) {
      setError("Tap the PDF to place at least one signature field.");
      return;
    }
    const pad = padRef.current;
    if (!pad || pad.isEmpty()) {
      setError("Draw your signature first.");
      return;
    }
    const dataUrl = pad.getCanvas().toDataURL("image/png");
    setBusy(true);
    try {
      const res = await fetch(`/api/documents/${docId}/sign`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          signaturePngDataUrl: dataUrl,
          fields: fields.map(({ id: _id, ...rest }) => rest),
          actor: actor || undefined,
        }),
      });
      const json = (await res.json()) as { error?: string };
      if (!res.ok) {
        setError(json.error ?? "signing failed");
        return;
      }
      router.refresh();
      router.push(`/?signed=${docId}`);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "network error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-4 lg:flex-row">
      <div className="flex-1">
        <div
          ref={containerRef}
          onClick={handlePageClick}
          className={`flex flex-col items-center gap-4 ${alreadySigned ? "" : "cursor-crosshair"}`}
        />
        {loadError && <p className="mt-3 text-sm text-red-500">PDF load error: {loadError}</p>}
        {!alreadySigned && pages.length > 0 && (
          <p className="mt-3 text-xs text-zinc-500">
            Tap anywhere on a page to drop a signature field. Tap a field to remove it.
          </p>
        )}
        {pages.map((p) => {
          const placed = fieldsByPage.get(p.pageNumber - 1) ?? [];
          if (placed.length === 0) return null;
          return (
            <FieldOverlay
              key={p.pageNumber}
              pageIndex={p.pageNumber - 1}
              fields={placed}
              onRemove={removeField}
            />
          );
        })}
      </div>

      {!alreadySigned && (
        <aside className="flex h-fit w-full flex-col gap-3 rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900 lg:w-80">
          <h2 className="text-lg font-medium">Your signature</h2>
          <div className="rounded-lg border border-zinc-300 bg-white dark:border-zinc-700">
            <SignaturePad
              ref={padRef}
              penColor="black"
              backgroundColor="white"
              canvasProps={{
                width: 280,
                height: 140,
                className: "rounded-lg",
              }}
            />
          </div>
          <div className="flex justify-between">
            <button
              type="button"
              onClick={() => padRef.current?.clear()}
              className="text-sm text-zinc-500 hover:underline"
            >
              Clear pad
            </button>
            <span className="text-xs text-zinc-400">{fields.length} field(s)</span>
          </div>

          <label className="flex flex-col text-sm">
            Signer name (optional)
            <input
              type="text"
              value={actor}
              onChange={(e) => setActor(e.target.value)}
              className="mt-1 rounded-lg border border-zinc-300 px-3 py-2 dark:border-zinc-700 dark:bg-zinc-800"
            />
          </label>

          <button
            type="button"
            disabled={busy}
            onClick={applySignature}
            className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
          >
            {busy ? "Stamping…" : "Sign & seal"}
          </button>
          {error && <p className="text-sm text-red-500">{error}</p>}
          <p className="text-xs text-zinc-500">
            Stamping draws the signature into the PDF, appends an audit page, and re-hashes the result. Nothing leaves this machine.
          </p>
        </aside>
      )}
    </div>
  );
}

interface FieldOverlayProps {
  pageIndex: number;
  fields: PlacedField[];
  onRemove: (id: string) => void;
}

function FieldOverlay({ pageIndex, fields, onRemove }: FieldOverlayProps) {
  useEffect(() => {
    const host = document.querySelector(`[data-page-index="${pageIndex}"]`);
    if (!host) return;
    const overlayId = `overlay-${pageIndex}`;
    let overlay = host.querySelector<HTMLDivElement>(`#${overlayId}`);
    if (!overlay) {
      overlay = document.createElement("div");
      overlay.id = overlayId;
      overlay.className = "pointer-events-none absolute inset-0";
      host.appendChild(overlay);
    }
    overlay.innerHTML = "";
    for (const f of fields) {
      const box = document.createElement("button");
      box.type = "button";
      box.className =
        "pointer-events-auto absolute rounded border-2 border-dashed border-emerald-500 bg-emerald-200/40 text-xs font-medium text-emerald-800 hover:bg-emerald-200/70";
      box.style.left = `${f.xRatio * 100}%`;
      box.style.top = `${f.yRatio * 100}%`;
      box.style.width = `${f.widthRatio * 100}%`;
      box.style.height = `${f.heightRatio * 100}%`;
      box.textContent = "✕ signature";
      box.addEventListener("click", (ev) => {
        ev.stopPropagation();
        onRemove(f.id);
      });
      overlay.appendChild(box);
    }
  }, [pageIndex, fields, onRemove]);

  return null;
}
