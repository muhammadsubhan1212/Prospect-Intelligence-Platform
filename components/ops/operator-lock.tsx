"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { Card } from "@/components/ui/primitives";

export function OperatorLock({ children }: { children: React.ReactNode }) {
  const params = useParams<{ operatorId: string }>();
  const [state, setState] = useState<"loading" | "ok" | "locked" | "missing">("loading");

  useEffect(() => {
    fetch(`/api/ops/operators/${params.operatorId}`)
      .then((r) => r.json())
      .then((d) => {
        if (d.error || !d.operator) setState("missing");
        else if (!d.operator.active) setState("locked");
        else setState("ok");
      })
      .catch(() => setState("missing"));
  }, [params.operatorId]);

  if (state === "loading") {
    return <p className="text-sm text-muted-foreground">Checking desk access…</p>;
  }
  if (state === "missing") {
    return (
      <Card className="p-8 text-center">
        <h1 className="text-xl font-semibold">Desk not found</h1>
        <p className="mt-2 text-sm text-muted-foreground">This operator URL is invalid.</p>
      </Card>
    );
  }
  if (state === "locked") {
    return (
      <Card className="p-8 text-center">
        <h1 className="text-xl font-semibold">Desk locked</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          This operator has been deactivated. Email, call, status, research, and audit are blocked until an admin
          reactivates the account.
        </p>
      </Card>
    );
  }
  return <>{children}</>;
}
