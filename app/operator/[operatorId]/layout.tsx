import type { ReactNode } from "react";
import { OperatorLock } from "@/components/ops/operator-lock";

export default function OperatorLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-5xl px-4 py-6 md:px-6">
        <OperatorLock>{children}</OperatorLock>
      </div>
    </div>
  );
}
