"use client";

import { useEffect, useState } from "react";
import { Button, Card, Input } from "@/components/ui/primitives";
import { OpsNav } from "@/components/ops/ops-nav";

type Operator = { id: string; name: string; active: boolean };

export default function AdminAssignPage() {
  const [operators, setOperators] = useState<Operator[]>([]);
  const [operatorId, setOperatorId] = useState("");
  const [count, setCount] = useState("50");
  const [preview, setPreview] = useState<{ available: number; requested: number; willAssign: number } | null>(null);
  const [result, setResult] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch("/api/ops/operators")
      .then((r) => r.json())
      .then((d) => setOperators((d.operators || []).filter((o: Operator) => o.active)));
  }, []);

  async function refreshPreview() {
    const res = await fetch(`/api/ops/allocate?count=${encodeURIComponent(count || "0")}`);
    const data = await res.json();
    setPreview(data);
  }

  useEffect(() => {
    void refreshPreview();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [count]);

  async function assign() {
    setBusy(true);
    setError("");
    setResult("");
    try {
      const res = await fetch("/api/ops/allocate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ operatorId, count: Number(count) }),
      });
      const data = await res.json();
      if (data.error) setError(data.error);
      else {
        setResult(`Assigned ${data.count} leads in ${data.batchId} to ${data.operatorName}.`);
        await refreshPreview();
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <OpsNav />
      <h1 className="text-2xl font-semibold tracking-tight">Assign work</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Fresh batches only take leads that have never been allocated for outreach.
      </p>
      {error ? <p className="mt-3 text-sm text-danger">{error}</p> : null}
      {result ? <p className="mt-3 text-sm text-success">{result}</p> : null}
      <Card className="mt-4 max-w-xl space-y-4 p-5">
        <label className="block text-sm">
          Operator
          <select
            className="mt-1 h-10 w-full rounded-lg border border-border bg-card px-3 text-sm"
            value={operatorId}
            onChange={(e) => setOperatorId(e.target.value)}
          >
            <option value="">Select…</option>
            {operators.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-sm">
          How many leads
          <Input className="mt-1" type="number" min={1} value={count} onChange={(e) => setCount(e.target.value)} />
        </label>
        {preview ? (
          <p className="text-sm text-muted-foreground">
            Available for outreach: {preview.available}. This batch will take {preview.willAssign}.
          </p>
        ) : null}
        <Button onClick={() => void assign()} disabled={!operatorId || busy}>
          {busy ? "Assigning…" : "Assign unique leads"}
        </Button>
      </Card>
    </div>
  );
}
