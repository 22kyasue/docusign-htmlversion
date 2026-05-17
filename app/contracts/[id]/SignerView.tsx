"use client";

import { useRef, useState } from "react";
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
  const padRef = useRef<SignaturePad | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState(false);

  async function applySignature() {
    setError(null);
    if (!confirmed) {
      setError("契約内容を確認しました、にチェックを入れてください。");
      return;
    }
    const pad = padRef.current;
    if (!pad || pad.isEmpty()) {
      setError("サインを描いてから「署名する」を押してください。");
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
        setError(json.error ?? "署名に失敗しました。");
        return;
      }
      router.refresh();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "ネットワークエラー");
    } finally {
      setBusy(false);
    }
  }

  const roleJa = signerRole === "studio" ? "甲（受託者）" : "乙（委託者）";

  return (
    <section className="no-print rounded-2xl border border-emerald-300 bg-emerald-50 p-6 shadow-sm dark:border-emerald-800 dark:bg-emerald-950/30">
      <h2 className="text-lg font-semibold">あなたの署名</h2>
      <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-300">
        {roleJa} {signerName} 様としてこの契約に署名します。
      </p>

      <div className="mt-4 flex flex-col gap-4 sm:flex-row sm:items-start">
        <div className="flex flex-col gap-2">
          <div className="rounded-lg border border-zinc-300 bg-white dark:border-zinc-700">
            <SignaturePad
              ref={padRef}
              penColor="black"
              backgroundColor="white"
              canvasProps={{
                width: 320,
                height: 150,
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
              クリア
            </button>
            <span className="text-xs text-zinc-400">手書きで枠内にサイン</span>
          </div>
        </div>

        <div className="flex flex-1 flex-col gap-3">
          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(e) => setConfirmed(e.target.checked)}
              className="mt-1"
            />
            <span>
              上記契約内容を確認し、これに同意します。署名と同時に IP アドレス
              および日時が監査ログに記録されます。
            </span>
          </label>
          <button
            type="button"
            disabled={busy}
            onClick={applySignature}
            className="rounded-lg bg-emerald-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
          >
            {busy ? "署名処理中…" : "署名する"}
          </button>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <p className="text-xs text-zinc-500">
            署名後、ページが更新されて契約書にサインが描画されます。
            両者の署名がそろった時点で、HTML スナップショットが保存され、
            SHA-256 で改ざん検知される正本となります。
          </p>
        </div>
      </div>
    </section>
  );
}
