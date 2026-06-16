"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import SignaturePad from "react-signature-canvas";
import type { SignatureField } from "@/lib/types";

interface SignClientProps {
  docId: string;
  token: string;
  signerName: string;
  alreadySigned: boolean;
  fields: SignatureField[];
  pdfUrl: string;
}

interface RenderedPage {
  pageNumber: number;
  width: number;
  height: number;
}

export default function SignClient({
  docId,
  token,
  signerName,
  alreadySigned,
  fields,
  pdfUrl,
}: SignClientProps) {
  const router = useRouter();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const padWrapRef = useRef<HTMLDivElement | null>(null);
  const padRef = useRef<SignaturePad | null>(null);
  // Width the canvas was last sized to. Mobile browsers fire `resize` on every
  // scroll (URL bar collapses, changing only height) — re-sizing then would wipe
  // a half-drawn signature. We only re-fit when the WIDTH actually changes.
  const lastWidthRef = useRef<number>(0);
  const [pages, setPages] = useState<RenderedPage[]>([]);
  const [busy, setBusy] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [hasStroke, setHasStroke] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Render the PDF and draw the PRE-PLACED signature field box(es) over the
  // correct page. The signer does NOT place fields — the box shows exactly where
  // their signature will land, fixed by the document.
  useEffect(() => {
    let cancelled = false;
    async function render() {
      try {
        const pdfjs = await import("pdfjs-dist");
        pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";

        const buf = await fetch(pdfUrl, { cache: "no-store" }).then((r) => {
          if (!r.ok) throw new Error(`PDF ${r.status}`);
          return r.arrayBuffer();
        });
        const task = pdfjs.getDocument({ data: new Uint8Array(buf) });
        const pdf = await task.promise;
        if (cancelled) return;

        const container = containerRef.current;
        if (!container) return;
        container.innerHTML = "";
        const rendered: RenderedPage[] = [];

        for (let i = 1; i <= pdf.numPages; i++) {
          const page = await pdf.getPage(i);
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

          // Draw the fixed field box(es) for this page so the signer sees where
          // their mark goes. Highlighted, not interactive.
          for (const f of fields.filter((fl) => fl.page === i - 1)) {
            const box = document.createElement("div");
            box.className =
              "pointer-events-none absolute rounded border-2 border-emerald-500 bg-emerald-200/30";
            box.style.left = `${f.xRatio * 100}%`;
            box.style.top = `${f.yRatio * 100}%`;
            box.style.width = `${f.widthRatio * 100}%`;
            box.style.height = `${f.heightRatio * 100}%`;
            const label = document.createElement("span");
            label.className =
              "absolute -top-5 left-0 whitespace-nowrap rounded bg-emerald-600 px-1.5 py-0.5 text-[10px] font-medium text-white";
            label.textContent = "ご署名はこちらに入ります";
            box.appendChild(label);
            wrap.appendChild(box);
          }

          container.appendChild(wrap);
          const ctx = canvas.getContext("2d");
          if (!ctx) continue;
          await page.render({ canvasContext: ctx, viewport, canvas }).promise;
          rendered.push({ pageNumber: i, width: viewport.width, height: viewport.height });
        }
        if (!cancelled) setPages(rendered);
      } catch (err: unknown) {
        if (!cancelled) setLoadError(err instanceof Error ? err.message : "PDFの表示に失敗しました");
      }
    }
    render();
    return () => {
      cancelled = true;
    };
  }, [pdfUrl, fields]);

  // Own all resize handling so a mobile scroll (height-only resize) can't wipe
  // the mark. Only re-fit, and therefore only clear, on a genuine WIDTH change.
  const resizePad = useCallback(() => {
    const wrap = padWrapRef.current;
    const pad = padRef.current;
    if (!wrap || !pad) return;
    const width = wrap.clientWidth;
    if (width === lastWidthRef.current) return; // height-only resize → ignore
    const isFirstFit = lastWidthRef.current === 0;
    lastWidthRef.current = width;

    const canvas = pad.getCanvas();
    const ratio = Math.max(window.devicePixelRatio || 1, 1);
    const height = 200;
    canvas.width = width * ratio; // setting width/height clears the bitmap
    canvas.height = height * ratio;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    const ctx = canvas.getContext("2d");
    ctx?.scale(ratio, ratio);
    pad.clear();
    if (!isFirstFit) setHasStroke(false);
  }, []);

  useEffect(() => {
    if (alreadySigned) return;
    resizePad();
    window.addEventListener("resize", resizePad);
    window.addEventListener("orientationchange", resizePad);
    return () => {
      window.removeEventListener("resize", resizePad);
      window.removeEventListener("orientationchange", resizePad);
    };
  }, [resizePad, alreadySigned]);

  function clearPad() {
    padRef.current?.clear();
    setHasStroke(false);
    setError(null);
  }

  async function applySignature() {
    setError(null);
    if (!confirmed) {
      setError("「書類の内容を確認し、同意します」にチェックを入れてください。");
      return;
    }
    const pad = padRef.current;
    if (!pad || pad.isEmpty()) {
      setError("枠内にご署名（サイン）を描いてから「同意して署名する」を押してください。");
      return;
    }
    const dataUrl = pad.getCanvas().toDataURL("image/png");
    setBusy(true);
    try {
      const res = await fetch(`/api/documents/${docId}/sign`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token, signaturePngDataUrl: dataUrl }),
      });
      const json = (await res.json()) as { error?: string };
      if (!res.ok) {
        setError(toJaError(json.error));
        return;
      }
      router.refresh();
      router.push(`/sign/${docId}?t=${encodeURIComponent(token)}`);
    } catch {
      setError("通信エラーが発生しました。電波状況をご確認のうえ、もう一度お試しください。");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-5 lg:flex-row">
      <div className="flex-1">
        <div ref={containerRef} className="flex flex-col items-center gap-4" />
        {loadError && <p className="mt-3 text-sm text-rose-600">PDFの読み込みエラー: {loadError}</p>}
        {!alreadySigned && pages.length > 0 && (
          <p className="mt-3 text-center text-xs text-zinc-500">
            緑色の枠が、お客様のご署名が入る位置です。
          </p>
        )}
      </div>

      {!alreadySigned && (
        <aside className="flex h-fit w-full flex-col gap-5 rounded-2xl border-2 border-emerald-400 bg-emerald-50/60 p-5 shadow-sm sm:p-6 lg:w-96">
          <div>
            <h2 className="text-base font-semibold text-zinc-900">こちらにご署名ください</h2>
            <p className="mt-1 text-sm text-zinc-600">甲（委託者）　{signerName} 様</p>
          </div>

          <ol className="flex flex-col gap-1.5 text-sm text-zinc-700">
            <li>1. 左の書類の内容をご確認ください。</li>
            <li>2. 下の白い枠内に、指またはマウスでご署名（サイン）をお描きください。</li>
            <li>3. 同意のチェックを入れ、「同意して署名する」を押してください。</li>
          </ol>

          <div className="flex flex-col gap-2">
            <div ref={padWrapRef} className="relative w-full rounded-xl border border-zinc-300 bg-white">
              <SignaturePad
                ref={padRef}
                penColor="#0a0a0a"
                backgroundColor="#ffffff"
                clearOnResize={false}
                onEnd={() => setHasStroke(true)}
                canvasProps={{ className: "block w-full touch-none rounded-xl" }}
              />
              {!hasStroke && (
                <span className="pointer-events-none absolute inset-0 flex items-center justify-center text-sm text-zinc-300">
                  ここに署名
                </span>
              )}
            </div>
            <div className="flex items-center justify-between">
              <button
                type="button"
                onClick={clearPad}
                className="rounded-md px-2 py-1 text-sm text-zinc-500 hover:bg-zinc-100 hover:underline"
              >
                書き直す
              </button>
              <span className="text-xs text-zinc-400">枠内に手書きでご署名ください</span>
            </div>
          </div>

          <label className="flex items-start gap-2.5 rounded-lg bg-white/70 p-3 text-sm leading-relaxed text-zinc-700">
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(e) => setConfirmed(e.target.checked)}
              className="mt-0.5 h-4 w-4 shrink-0 accent-emerald-600"
            />
            <span>
              上記の書類の内容を確認し、これに同意します。署名と同時に、署名日時および接続元情報が
              監査記録として保存されることに同意します。
            </span>
          </label>

          <button
            type="button"
            disabled={busy}
            onClick={applySignature}
            className="w-full rounded-xl bg-emerald-600 px-5 py-3.5 text-base font-semibold text-white shadow-sm transition hover:bg-emerald-500 disabled:opacity-50"
          >
            {busy ? "署名を処理しています…" : "同意して署名する"}
          </button>

          {error && <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>}

          <p className="text-xs leading-relaxed text-zinc-500">
            ご署名後、署名済みの書類に改ざん検知（SHA-256）付きの記録が保存されます。
          </p>
        </aside>
      )}
    </div>
  );
}

// Map server error strings to polite Japanese for the signer.
function toJaError(code: string | undefined): string {
  switch (code) {
    case "token expired":
      return "署名用リンクの有効期限が切れています。新しいリンクの発行をご依頼ください。";
    case "invalid signing token":
      return "署名用リンクが無効です。メールのリンクから、もう一度お開きください。";
    case "already signed":
      return "このご署名はすでに受け付けております。";
    case "document has no signer":
      return "この書類には署名者が設定されていません。送信元にお問い合わせください。";
    case "signature must be a valid, non-empty PNG image":
      return "ご署名が正しく読み取れませんでした。枠内にもう一度ご署名ください。";
    case "invalid body":
      return "送信内容に問題がありました。ページを再読み込みのうえ、もう一度ご署名ください。";
    case "not found":
      return "対象の書類が見つかりませんでした。お手数ですが、送信元にお問い合わせください。";
    default:
      return "署名を完了できませんでした。お手数ですが、もう一度お試しください。";
  }
}
