"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type SignerLink = {
  signerId: string;
  role: "studio" | "client";
  email: string;
  path: string;
};

export default function NewContractForm() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{
    contractId: string;
    links: SignerLink[];
  } | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    const fd = new FormData(e.currentTarget);
    const get = (k: string) => (fd.get(k)?.toString() ?? "").trim();

    const deliverables = get("deliverables")
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);
    const languagePairs = get("languagePairs")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

    const payload = {
      variables: {
        studioCompany: get("studioCompany"),
        studioLegalName: get("studioLegalName") || undefined,
        studioAddress: get("studioAddress") || undefined,
        studioRepresentative: get("studioRepresentative"),
        clientCompany: get("clientCompany"),
        clientLegalName: get("clientLegalName") || undefined,
        clientAddress: get("clientAddress") || undefined,
        clientRepresentative: get("clientRepresentative"),
        projectName: get("projectName"),
        deliverables,
        languagePairs,
        scopeNotes: get("scopeNotes") || undefined,
        outOfScopeNotes: get("outOfScopeNotes") || undefined,
        priceJpy: Number(get("priceJpy") || 0),
        taxRatePercent: Number(get("taxRatePercent") || 10),
        paymentSchedule: get("paymentSchedule"),
        paymentMethod: get("paymentMethod"),
        kickoffDate: get("kickoffDate"),
        deliveryDeadline: get("deliveryDeadline"),
        revisionRounds: Number(get("revisionRounds") || 0),
        governingLaw: get("governingLaw") || "日本国法",
        jurisdiction: get("jurisdiction") || "東京地方裁判所",
      },
      signers: [
        {
          role: "studio" as const,
          name: get("studioRepresentative"),
          email: get("studioEmail"),
        },
        {
          role: "client" as const,
          name: get("clientRepresentative"),
          email: get("clientEmail"),
        },
      ],
    };

    try {
      const res = await fetch("/api/contracts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = (await res.json()) as {
        contract?: { id: string };
        signerLinks?: SignerLink[];
        error?: string;
      };
      if (!res.ok || !json.contract || !json.signerLinks) {
        setError(json.error ?? "create failed");
        return;
      }
      setResult({ contractId: json.contract.id, links: json.signerLinks });
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "network error");
    } finally {
      setBusy(false);
    }
  }

  if (result) {
    return (
      <div className="flex flex-col gap-4 rounded-2xl border border-emerald-300 bg-emerald-50 p-6 dark:border-emerald-800 dark:bg-emerald-950/30">
        <h2 className="text-lg font-medium">Contract created.</h2>
        <p className="text-sm text-zinc-600 dark:text-zinc-300">
          Send each party their magic-link URL. Tokens expire in 30 days.
        </p>
        <div className="flex flex-col gap-2">
          {result.links.map((l) => {
            const url = `${typeof window !== "undefined" ? window.location.origin : ""}${l.path}`;
            return (
              <div
                key={l.signerId}
                className="rounded-lg bg-white p-3 text-sm shadow-sm dark:bg-zinc-900"
              >
                <div className="font-medium">
                  {l.role === "studio" ? "甲 (studio)" : "乙 (client)"} —{" "}
                  <span className="font-normal text-zinc-500">{l.email}</span>
                </div>
                <input
                  readOnly
                  value={url}
                  className="mt-1 w-full rounded border border-zinc-300 bg-zinc-50 px-2 py-1 font-mono text-xs dark:border-zinc-700 dark:bg-zinc-800"
                  onClick={(e) => (e.currentTarget as HTMLInputElement).select()}
                />
              </div>
            );
          })}
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => router.push(`/contracts/${result.contractId}`)}
            className="rounded-lg bg-zinc-900 px-4 py-2 text-sm text-white hover:bg-zinc-700 dark:bg-white dark:text-zinc-900"
          >
            Open contract
          </button>
          <button
            type="button"
            onClick={() => router.push("/contracts")}
            className="rounded-lg border border-zinc-300 px-4 py-2 text-sm hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
          >
            Back to list
          </button>
        </div>
      </div>
    );
  }

  return (
    <form
      onSubmit={onSubmit}
      className="flex flex-col gap-6 rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900"
    >
      <Fieldset title="プロジェクト">
        <Input name="projectName" label="案件名" required defaultValue="" placeholder="例：民宿○○ 新サイト構築 + JA/EN/ZH" />
        <Textarea
          name="deliverables"
          label="納品物（1行に1項目）"
          required
          defaultValue="バイリンガル対応ウェブサイト構築（JA/EN/ZH）\nレスポンシブデザイン（PC・スマホ）\n基本コピーライティング（多言語）\nGoogle Analytics 設置\n納品後ドキュメント"
          rows={6}
        />
        <Input
          name="languagePairs"
          label="提供言語（カンマ区切り）"
          required
          defaultValue="JA, EN, ZH-Hans"
        />
        <Textarea name="scopeNotes" label="補足（任意）" />
        <Textarea name="outOfScopeNotes" label="対象外（任意）" />
      </Fieldset>

      <Fieldset title="金額・支払">
        <div className="grid grid-cols-2 gap-3">
          <Input name="priceJpy" label="契約金額（税抜・円）" type="number" required defaultValue="380000" />
          <Input name="taxRatePercent" label="消費税率（%）" type="number" defaultValue="10" />
        </div>
        <Input name="paymentSchedule" label="支払スケジュール" required defaultValue="着手金50% / 納品時50%" />
        <Input name="paymentMethod" label="支払方法" required defaultValue="銀行振込（請求書発行）" />
      </Fieldset>

      <Fieldset title="スケジュール">
        <div className="grid grid-cols-2 gap-3">
          <Input name="kickoffDate" label="着手日" type="date" required />
          <Input name="deliveryDeadline" label="納品期限" type="date" required />
        </div>
        <Input name="revisionRounds" label="修正対応回数" type="number" defaultValue="2" />
      </Fieldset>

      <Fieldset title="甲（受託者）">
        <Input name="studioCompany" label="表示名" required defaultValue="Tobira Studio" />
        <Input name="studioLegalName" label="法人名（任意）" />
        <Input name="studioAddress" label="所在地（任意）" />
        <div className="grid grid-cols-2 gap-3">
          <Input name="studioRepresentative" label="代表者名" required />
          <Input name="studioEmail" label="代表者メール" type="email" required />
        </div>
      </Fieldset>

      <Fieldset title="乙（委託者）">
        <Input name="clientCompany" label="表示名" required />
        <Input name="clientLegalName" label="法人名（任意）" />
        <Input name="clientAddress" label="所在地（任意）" />
        <div className="grid grid-cols-2 gap-3">
          <Input name="clientRepresentative" label="代表者名" required />
          <Input name="clientEmail" label="代表者メール" type="email" required />
        </div>
      </Fieldset>

      <Fieldset title="準拠法・管轄">
        <div className="grid grid-cols-2 gap-3">
          <Input name="governingLaw" label="準拠法" defaultValue="日本国法" />
          <Input name="jurisdiction" label="管轄裁判所" defaultValue="東京地方裁判所" />
        </div>
      </Fieldset>

      <div className="flex items-center justify-end gap-3">
        {error && <span className="text-sm text-red-500">{error}</span>}
        <button
          type="submit"
          disabled={busy}
          className="rounded-lg bg-emerald-600 px-5 py-2 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
        >
          {busy ? "Creating…" : "Create & generate signing links"}
        </button>
      </div>
    </form>
  );
}

function Fieldset({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="text-sm font-semibold text-zinc-700 dark:text-zinc-200">
        {title}
      </legend>
      {children}
    </fieldset>
  );
}

function Input(props: {
  name: string;
  label: string;
  type?: string;
  required?: boolean;
  defaultValue?: string;
  placeholder?: string;
}) {
  return (
    <label className="flex flex-col text-sm">
      <span className="mb-1 text-zinc-600 dark:text-zinc-400">{props.label}</span>
      <input
        name={props.name}
        type={props.type ?? "text"}
        required={props.required}
        defaultValue={props.defaultValue}
        placeholder={props.placeholder}
        className="rounded-lg border border-zinc-300 px-3 py-2 dark:border-zinc-700 dark:bg-zinc-800"
      />
    </label>
  );
}

function Textarea(props: {
  name: string;
  label: string;
  required?: boolean;
  defaultValue?: string;
  rows?: number;
}) {
  return (
    <label className="flex flex-col text-sm">
      <span className="mb-1 text-zinc-600 dark:text-zinc-400">{props.label}</span>
      <textarea
        name={props.name}
        required={props.required}
        defaultValue={props.defaultValue?.replace(/\\n/g, "\n")}
        rows={props.rows ?? 3}
        className="rounded-lg border border-zinc-300 px-3 py-2 dark:border-zinc-700 dark:bg-zinc-800"
      />
    </label>
  );
}
