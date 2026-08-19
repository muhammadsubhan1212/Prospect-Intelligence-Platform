"use client";

import { useEffect, useState } from "react";
import { Button, Card, Input } from "@/components/ui/primitives";
import { OpsNav } from "@/components/ops/ops-nav";

type Brand = {
  companyName: string;
  tagline: string;
  website: string;
  email: string;
  phone: string;
  address: string;
  preparedBy: string;
  themeId: string;
  colors: { accent: string; accentSoft: string; ink: string; muted: string; paper: string; headerBg: string };
  logoDataUrl?: string;
};

type Operator = { id: string; name: string; active: boolean };

const THEMES = [
  { id: "teal", label: "Teal" },
  { id: "navy", label: "Navy" },
  { id: "forest", label: "Forest" },
  { id: "burgundy", label: "Burgundy" },
  { id: "charcoal", label: "Charcoal" },
  { id: "gold", label: "Gold" },
];

export default function AdminBrandPage() {
  const [brand, setBrand] = useState<Brand | null>(null);
  const [operators, setOperators] = useState<Operator[]>([]);
  const [scopeId, setScopeId] = useState("");
  const [scope, setScope] = useState<"default" | "operator">("default");
  const [customIds, setCustomIds] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState("");
  const [saving, setSaving] = useState(false);

  async function load(operatorId = scopeId) {
    const qs = operatorId ? `?operatorId=${encodeURIComponent(operatorId)}` : "";
    const [brandRes, opRes] = await Promise.all([fetch(`/api/ops/brand${qs}`), fetch("/api/ops/operators")]);
    const brandData = await brandRes.json();
    const opData = await opRes.json();
    if (brandData.error) setError(brandData.error);
    else {
      setBrand(brandData.brand);
      setScope(brandData.scope === "operator" ? "operator" : "default");
      setCustomIds(brandData.customOperatorIds || []);
    }
    setOperators(opData.operators || []);
  }

  useEffect(() => {
    void load("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function changeScope(id: string) {
    setScopeId(id);
    setError("");
    setSaved("");
    await load(id);
  }

  async function save() {
    if (!brand) return;
    setSaving(true);
    setError("");
    setSaved("");
    try {
      const res = await fetch("/api/ops/brand", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...brand, operatorId: scopeId || null }),
      });
      const data = await res.json();
      if (data.error) setError(data.error);
      else {
        setBrand(data.brand);
        setScope(data.scope === "operator" ? "operator" : "default");
        if (scopeId && !customIds.includes(scopeId)) setCustomIds([...customIds, scopeId]);
        setSaved(
          scopeId
            ? "Saved as this operator’s template. Their audits will use this letterhead."
            : "Saved as company default. Operators without their own template use this."
        );
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setSaving(false);
    }
  }

  async function revertOperator() {
    if (!scopeId) return;
    if (!confirm("Remove this operator’s template and fall back to the company default?")) return;
    const res = await fetch(`/api/ops/brand?operatorId=${encodeURIComponent(scopeId)}`, { method: "DELETE" });
    const data = await res.json();
    if (data.error) setError(data.error);
    else {
      setBrand(data.brand);
      setScope("default");
      setCustomIds(customIds.filter((id) => id !== scopeId));
      setSaved("Operator template removed. This operator now uses the company default.");
    }
  }

  function onLogo(file: File | null) {
    if (!file || !brand) return;
    if (file.size > 900_000) {
      setError("Logo must be under 900KB. Use a PNG or JPG.");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => setBrand({ ...brand, logoDataUrl: String(reader.result || "") });
    reader.readAsDataURL(file);
  }

  const selectedOp = operators.find((o) => o.id === scopeId);

  if (!brand) return <p className="text-sm text-muted-foreground">Loading brand…</p>;

  return (
    <div>
      <OpsNav />
      <h1 className="text-2xl font-semibold tracking-tight">Pitching company</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Save a company default, or a separate letterhead template for each operator.
      </p>
      {error ? <p className="mt-3 text-sm text-danger">{error}</p> : null}
      {saved ? <p className="mt-3 text-sm text-success">{saved}</p> : null}

      <Card className="mt-4 flex flex-wrap items-end gap-3 p-4">
        <label className="text-sm">
          Template for
          <select
            className="mt-1 block h-10 min-w-64 rounded-lg border border-border bg-card px-3 text-sm"
            value={scopeId}
            onChange={(e) => void changeScope(e.target.value)}
          >
            <option value="">Company default</option>
            {operators.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name} {customIds.includes(o.id) ? "· own template" : ""}
                {!o.active ? " (inactive)" : ""}
              </option>
            ))}
          </select>
        </label>
        <div className="text-sm text-muted-foreground pb-2">
          {scopeId
            ? scope === "operator"
              ? `${selectedOp?.name || "This operator"} has a saved template.`
              : `${selectedOp?.name || "This operator"} currently uses the company default. Save to create theirs.`
            : "Company default is used when an operator has no template of their own."}
        </div>
      </Card>

      <div className="mt-5 grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
        <Card className="grid gap-3 p-5 sm:grid-cols-2">
          <label className="sm:col-span-2 text-sm">
            Company name
            <Input className="mt-1" value={brand.companyName} onChange={(e) => setBrand({ ...brand, companyName: e.target.value })} />
          </label>
          <label className="sm:col-span-2 text-sm">
            Tagline
            <Input className="mt-1" value={brand.tagline} onChange={(e) => setBrand({ ...brand, tagline: e.target.value })} />
          </label>
          <label className="text-sm">
            Website
            <Input className="mt-1" value={brand.website} onChange={(e) => setBrand({ ...brand, website: e.target.value })} />
          </label>
          <label className="text-sm">
            Email
            <Input className="mt-1" value={brand.email} onChange={(e) => setBrand({ ...brand, email: e.target.value })} />
          </label>
          <label className="text-sm">
            Phone
            <Input className="mt-1" value={brand.phone} onChange={(e) => setBrand({ ...brand, phone: e.target.value })} />
          </label>
          <label className="text-sm">
            Prepared by
            <Input className="mt-1" value={brand.preparedBy} onChange={(e) => setBrand({ ...brand, preparedBy: e.target.value })} />
          </label>
          <label className="sm:col-span-2 text-sm">
            Address
            <Input className="mt-1" value={brand.address} onChange={(e) => setBrand({ ...brand, address: e.target.value })} />
          </label>
          <div className="sm:col-span-2">
            <div className="text-sm font-medium">Logo</div>
            <input className="mt-2 text-sm" type="file" accept="image/png,image/jpeg,image/gif" onChange={(e) => onLogo(e.target.files?.[0] || null)} />
            {brand.logoDataUrl ? (
              <div className="mt-3 flex items-center gap-3">
                <img src={brand.logoDataUrl} alt="Logo" className="h-12 max-w-[180px] object-contain rounded border border-border bg-white p-1" />
                <Button type="button" variant="ghost" size="sm" onClick={() => setBrand({ ...brand, logoDataUrl: "" })}>
                  Remove
                </Button>
              </div>
            ) : null}
          </div>
          <div className="sm:col-span-2">
            <div className="text-sm font-medium">Colour theme</div>
            <div className="mt-2 flex flex-wrap gap-2">
              {THEMES.map((t) => (
                <Button
                  key={t.id}
                  type="button"
                  size="sm"
                  variant={brand.themeId === t.id ? "default" : "outline"}
                  onClick={() => setBrand({ ...brand, themeId: t.id })}
                >
                  {t.label}
                </Button>
              ))}
            </div>
          </div>
          <div className="sm:col-span-2 flex flex-wrap gap-2">
            <Button type="button" onClick={() => void save()} disabled={saving}>
              {saving ? "Saving…" : scopeId ? `Save ${selectedOp?.name || "operator"} template` : "Save company default"}
            </Button>
            {scopeId && scope === "operator" ? (
              <Button type="button" variant="outline" onClick={() => void revertOperator()}>
                Use company default
              </Button>
            ) : null}
          </div>
        </Card>

        <Card className="overflow-hidden p-0">
          <div className="px-5 py-4 text-white" style={{ background: brand.colors.headerBg }}>
            <div className="flex items-center justify-between gap-3">
              {brand.logoDataUrl ? (
                <img src={brand.logoDataUrl} alt="" className="h-10 max-w-[140px] rounded bg-white object-contain p-1" />
              ) : (
                <div className="font-semibold">{brand.companyName || "Your firm"}</div>
              )}
              <div className="text-right text-xs opacity-80">
                <div>{brand.companyName}</div>
                <div>{brand.tagline}</div>
              </div>
            </div>
          </div>
          <div className="h-1.5" style={{ background: brand.colors.accent }} />
          <div className="p-5 text-sm">
            <div className="text-[11px] uppercase tracking-widest" style={{ color: brand.colors.accent }}>
              {scopeId ? `${selectedOp?.name || "Operator"} template` : "Company default"}
            </div>
            <div className="mt-2 text-lg font-semibold">Website & conversion review — Sample Co</div>
            <p className="mt-3 text-muted-foreground">
              Audits created by this operator use this letterhead. Others keep the company default unless they have their own template.
            </p>
          </div>
        </Card>
      </div>
    </div>
  );
}
