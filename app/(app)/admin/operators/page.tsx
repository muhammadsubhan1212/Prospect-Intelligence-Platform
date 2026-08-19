"use client";

import { useEffect, useState } from "react";
import { Button, Card, Input } from "@/components/ui/primitives";
import { OpsNav } from "@/components/ops/ops-nav";

type Batch = { id: string; createdAt: string; count: number; remaining: number };

type Operator = {
  id: string;
  name: string;
  email?: string;
  phone?: string;
  active: boolean;
  assignedCount: number;
  allocatedCount: number;
  url: string;
  batches?: Batch[];
};

export default function AdminOperatorsPage() {
  const [operators, setOperators] = useState<Operator[]>([]);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [error, setError] = useState("");
  const [result, setResult] = useState("");
  const [copied, setCopied] = useState("");
  const [openId, setOpenId] = useState("");
  const [resetting, setResetting] = useState("");

  async function load() {
    const res = await fetch("/api/ops/operators");
    const data = await res.json();
    setOperators(data.operators || []);
  }

  useEffect(() => {
    void load();
  }, []);

  async function create() {
    setError("");
    const res = await fetch("/api/ops/operators", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, email, phone }),
    });
    const data = await res.json();
    if (data.error) setError(data.error);
    else {
      setName("");
      setEmail("");
      setPhone("");
      await load();
    }
  }

  async function toggle(op: Operator) {
    await fetch(`/api/ops/operators/${op.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ active: !op.active }),
    });
    await load();
  }

  function copyUrl(op: Operator) {
    const url = `${window.location.origin}${op.url}`;
    void navigator.clipboard.writeText(url);
    setCopied(op.id);
    window.setTimeout(() => setCopied(""), 1500);
  }

  async function resetOp(body: Record<string, unknown>, confirmText: string, key: string) {
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
          `Reset ${data.reset} lead${data.reset === 1 ? "" : "s"}. They stay in the master pool and can be assigned again. Activity is marked Reset.`
        );
        await load();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setResetting("");
    }
  }

  return (
    <div>
      <OpsNav />
      <h1 className="text-2xl font-semibold tracking-tight">Operators</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Create a person, send their desk URL, and reset a previous assignment batch without deleting master leads.
      </p>
      {error ? <p className="mt-3 text-sm text-danger">{error}</p> : null}
      {result ? <p className="mt-3 text-sm text-success">{result}</p> : null}
      <Card className="mt-4 grid gap-3 p-5 sm:grid-cols-4">
        <Input placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} />
        <Input placeholder="Email (optional)" value={email} onChange={(e) => setEmail(e.target.value)} />
        <Input placeholder="Phone (optional)" value={phone} onChange={(e) => setPhone(e.target.value)} />
        <Button onClick={() => void create()} disabled={!name.trim()}>
          Create operator
        </Button>
      </Card>
      <div className="mt-4 space-y-3">
        {operators.map((op) => (
          <Card key={op.id} className="p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="font-medium">
                  {op.name}{" "}
                  <span className="text-xs text-muted-foreground">{op.active ? "active" : "inactive"}</span>
                </div>
                <div className="text-sm text-muted-foreground">
                  {op.id} · {op.assignedCount} assigned · {op.allocatedCount} currently allocated
                </div>
                <div className="mt-1 font-mono text-xs">{op.url}</div>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" onClick={() => copyUrl(op)}>
                  {copied === op.id ? "Copied" : "Copy URL"}
                </Button>
                <Button variant="outline" onClick={() => window.open(op.url, "_blank")}>
                  Open desk
                </Button>
                <Button variant="outline" onClick={() => setOpenId(openId === op.id ? "" : op.id)}>
                  {openId === op.id ? "Hide batches" : "Reset batches"}
                </Button>
                <Button variant="ghost" onClick={() => void toggle(op)}>
                  {op.active ? "Deactivate" : "Activate"}
                </Button>
              </div>
            </div>
            {openId === op.id ? (
              <div className="mt-4 border-t border-border pt-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm text-muted-foreground">Previous assignment batches for {op.name}</p>
                  <Button
                    size="sm"
                    variant="danger"
                    disabled={!!resetting || !op.assignedCount}
                    onClick={() =>
                      void resetOp(
                        { operatorId: op.id, allForOperator: true },
                        `Reset all leads currently assigned to ${op.name}?\n\nContacts stay in the master pool. This operator’s desk goes to 0. Activity stays, marked Reset.`,
                        `${op.id}-all`
                      )
                    }
                  >
                    {resetting === `${op.id}-all` ? "Resetting…" : "Reset all assigned"}
                  </Button>
                </div>
                <ul className="mt-3 space-y-2">
                  {(op.batches || []).map((b) => (
                    <li key={b.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border px-3 py-2 text-sm">
                      <div>
                        <div className="font-medium">
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
                          void resetOp(
                            { operatorId: op.id, batchId: b.id },
                            `Reset this batch for ${op.name} (${b.remaining} active of ${b.count})?\n\nThose leads return to the master pool and can be assigned again. Activity stays, marked Reset.`,
                            b.id
                          )
                        }
                      >
                        {resetting === b.id ? "Resetting…" : b.remaining === 0 ? "Already reset" : "Reset this batch"}
                      </Button>
                    </li>
                  ))}
                  {!(op.batches || []).length ? (
                    <li className="text-sm text-muted-foreground">No assignment batches yet.</li>
                  ) : null}
                </ul>
              </div>
            ) : null}
          </Card>
        ))}
        {!operators.length ? <p className="text-sm text-muted-foreground">No operators yet.</p> : null}
      </div>
    </div>
  );
}
