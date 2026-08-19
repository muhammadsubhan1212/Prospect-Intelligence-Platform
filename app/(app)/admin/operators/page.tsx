"use client";

import { useEffect, useState } from "react";
import { Button, Card, Input } from "@/components/ui/primitives";
import { OpsNav } from "@/components/ops/ops-nav";

type Operator = {
  id: string;
  name: string;
  email?: string;
  phone?: string;
  active: boolean;
  assignedCount: number;
  allocatedCount: number;
  url: string;
};

export default function AdminOperatorsPage() {
  const [operators, setOperators] = useState<Operator[]>([]);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [error, setError] = useState("");
  const [copied, setCopied] = useState("");

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

  return (
    <div>
      <OpsNav />
      <h1 className="text-2xl font-semibold tracking-tight">Operators</h1>
      <p className="mt-1 text-sm text-muted-foreground">Create a person, then send them their unique desk URL. No password.</p>
      {error ? <p className="mt-3 text-sm text-danger">{error}</p> : null}
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
          <Card key={op.id} className="flex flex-wrap items-center justify-between gap-3 p-4">
            <div>
              <div className="font-medium">
                {op.name}{" "}
                <span className="text-xs text-muted-foreground">{op.active ? "active" : "inactive"}</span>
              </div>
              <div className="text-sm text-muted-foreground">
                {op.id} · {op.assignedCount} assigned · {op.allocatedCount} ever allocated
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
              <Button variant="ghost" onClick={() => void toggle(op)}>
                {op.active ? "Deactivate" : "Activate"}
              </Button>
            </div>
          </Card>
        ))}
        {!operators.length ? <p className="text-sm text-muted-foreground">No operators yet.</p> : null}
      </div>
    </div>
  );
}
