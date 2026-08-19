"use client";

import { useEffect, useState } from "react";
import { Button, Card, Input } from "@/components/ui/primitives";
import { OpsNav } from "@/components/ops/ops-nav";

type Batch = { id: string; createdAt: string; count: number; remaining: number };
type Operator = { id: string; name: string; active: boolean; assignedCount?: number; batches?: Batch[] };

export default function AdminAssignPage() {
  const [operators, setOperators] = useState<Operator[]>([]);
  const [operatorId, setOperatorId] = useState("");
  const [count, setCount] = useState("50");
  const [preview, setPreview] = useState<{ available: number; requested: number; willAssign: number } | null>(null);
  const [result, setResult] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [resetting, setResetting] = useState("");

  async function loadOperators() {
    const res = await fetch("/api/ops/operators");
    const d = await res.json();
    setOperators((d.operators || []).filter((o: Operator) => o.active));
  }

  useEffect(() => {
    void loadOperators();
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

  const selected = operators.find((o) => o.id === operatorId);

  async function resetBatch(body: Record<string, unknown>, key: string, confirmText: string) {
    if (!confirm(confirmText)) return;
    setResetting(key);
    setError("");
    setResult("");
    try {
      const res = await fetch("/api/ops/leads/reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (data.error) setError(data.error);
      else {
        setResult(
          `Reset ${data.reset} lead${data.reset === 1 ? "" : "s"}. They stay in the master pool and can be assigned again.`
        );
        await Promise.all([refreshPreview(), loadOperators()]);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setResetting("");
    }
  }

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
        await Promise.all([refreshPreview(), loadOperators()]);
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
        New batches take leads that are not currently allocated. Reset a previous batch below to put those leads back in the pool.
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

      {selected ? (
        <Card className="mt-4 max-w-xl space-y-3 p-5">
          <h2 className="font-medium">Previous batches · {selected.name}</h2>
          <p className="text-sm text-muted-foreground">
            Reset one batch to return those leads to the master pool. Activity stays, marked Reset.
          </p>
          <Button
            size="sm"
            variant="danger"
            disabled={!!resetting || !selected.assignedCount}
            onClick={() => void resetBatch({ operatorId: selected.id, allForOperator: true }, `${selected.id}-all`, `Reset all leads currently assigned to ${selected.name}?`)}
          >
            {resetting === `${selected.id}-all` ? "Resetting…" : "Reset all assigned"}
          </Button>
          <ul className="space-y-2">
            {(selected.batches || []).map((b) => (
              <li key={b.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border px-3 py-2 text-sm">
                <div>
                  <div>
                    {b.count} assigned · {b.remaining} still active
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {new Date(b.createdAt).toLocaleString()} · {b.id}
                  </div>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={!!resetting || b.remaining === 0}
                  onClick={() =>
                    void resetBatch(
                      { operatorId: selected.id, batchId: b.id },
                      b.id,
                      `Reset this batch for ${selected.name} (${b.remaining} active of ${b.count})?`
                    )
                  }
                >
                  {resetting === b.id ? "Resetting…" : b.remaining === 0 ? "Already reset" : "Reset this batch"}
                </Button>
              </li>
            ))}
            {!(selected.batches || []).length ? <li className="text-sm text-muted-foreground">No batches yet.</li> : null}
          </ul>
        </Card>
      ) : null}
    </div>
  );
}
