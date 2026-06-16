"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import SignaturePad from "react-signature-canvas";

interface SignerViewProps {
  contractId: string;
  token: string;
  signerName: string;
  signerRole: "studio" | "client";
}

export default function SignerView({
  contractId,
  token,
  signerName,
  signerRole,
}: SignerViewProps) {
  const router = useRouter();
  const padWrapRef = useRef<HTMLDivElement | null>(null);
  const padRef = useRef<SignaturePad | null>(null);
  // Width the canvas was last sized to. Mobile browsers fire `resize` on every
  // scroll (the URL bar collapses, changing only height) — re-sizing then would
  // wipe a half-drawn signature. We only re-fit when the WIDTH actually changes.
  const lastWidthRef = useRef<number>(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [hasStroke, setHasStroke] = useState(false);

  // Size the signature canvas to its container so it is comfortable to sign on
  // a phone. We OWN all resize handling here (the SignaturePad below sets
  // clearOnResize={false} so its built-in listener — which clears the canvas on
  // every resize, including height-only mobile URL-bar collapses — is disabled).
  //
  // We only re-fit, and therefore only clear, on a genuine WIDTH change (e.g.
  // device rotation). A height-only resize — which fires constantly while a
  // phone scrolls — is a no-op, so an in-progress signature is never wiped. We
  // do not try to replay strokes across a width change: signature_pad stores
  // absolute coordinates, so replaying them into a re-scaled canvas shifts/clips
  // the mark. On the rare rotation we clear and let the signer re-sign rather
  // than persist a distorted signature on a legal document.
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
    if (!isFirstFit) setHasStroke(false); // a real rotation cleared the mark
  }, []);

  useEffect(() => {
    resizePad();
    window.addEventListener("resize", resizePad);
    window.addEventListener("orientationchange", resizePad);
    return () => {
      window.removeEventListener("resize", resizePad);
      window.removeEventListener("orientationchange", resizePad);
    };
  }, [resizePad]);

  function clearPad() {
    padRef.current?.clear();
    setHasStroke(false);
    setError(null);
  }

  async function applySignature() {
    setError(null);
    if (!confirmed) {
      setError("「契約内容を確認し、同意します」にチェックを入れてください。");
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
      const res = await fetch(`/api/contracts/${contractId}/sign`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token, signaturePngDataUrl: dataUrl }),
      });
      const json = (await res.json()) as { error?: string; completed?: boolean };
      if (!res.ok) {
        setError(toJaError(json.error));
        return;
      }
      router.refresh();
    } catch {
      setError("通信エラーが発生しました。電波状況をご確認のうえ、もう一度お試しください。");
    } finally {
      setBusy(false);
    }
  }

  const roleJa = signerRole === "studio" ? "甲（受託者）" : "乙（委託者）";

  return (
    <section className="no-print flex flex-col gap-5 rounded-2xl border-2 border-emerald-400 bg-emerald-50/60 p-5 shadow-sm sm:p-6">
      <div>
        <h2 className="text-base font-semibold text-zinc-900">こちらにご署名ください</h2>
        <p className="mt-1 text-sm text-zinc-600">
          {roleJa}　{signerName} 様
        </p>
      </div>

      <ol className="flex flex-col gap-1.5 text-sm text-zinc-700">
        <li>1. 上記の契約内容をご確認ください。</li>
        <li>2. 下の白い枠内に、指またはマウスでご署名（サイン）をお描きください。</li>
        <li>3. 同意のチェックを入れ、「同意して署名する」を押してください。</li>
      </ol>

      <div className="flex flex-col gap-2">
        <div
          ref={padWrapRef}
          className="relative w-full rounded-xl border border-zinc-300 bg-white"
        >
          <SignaturePad
            ref={padRef}
            penColor="#0a0a0a"
            backgroundColor="#ffffff"
            // We own resize handling in resizePad; disable the library's built-in
            // listener so a mobile scroll (height-only resize) can't wipe the mark.
            clearOnResize={false}
            onEnd={() => setHasStroke(true)}
            canvasProps={{
              className: "block w-full touch-none rounded-xl",
            }}
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
          上記の契約内容を確認し、これに同意します。署名と同時に、署名日時および接続元情報が
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

      {error && (
        <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>
      )}

      <p className="text-xs leading-relaxed text-zinc-500">
        ご署名後、画面が更新され、契約書にサインが反映されます。両者のご署名がそろった時点で、
        改ざん検知（SHA-256）付きの契約書正本が保存されます。
      </p>
    </section>
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
    case "contract already completed":
      return "本契約はすでに締結済みです。";
    case "contract voided":
      return "本契約は無効化されています。送信元にお問い合わせください。";
    case "not found":
      return "対象の契約書が見つかりませんでした。お手数ですが、送信元にお問い合わせください。";
    case "signature must be a valid, non-empty PNG image":
      return "ご署名が正しく読み取れませんでした。枠内にもう一度ご署名ください。";
    case "invalid body":
      return "送信内容に問題がありました。ページを再読み込みのうえ、もう一度ご署名ください。";
    default:
      return "署名を完了できませんでした。お手数ですが、もう一度お試しください。";
  }
}
