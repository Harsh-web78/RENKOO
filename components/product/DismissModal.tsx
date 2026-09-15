"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { DismissReason, dismissReasons } from "@/lib/mock/types";

export function DismissModal({
  open,
  onClose,
  onConfirm,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: (reason: DismissReason) => void;
}) {
  const [reason, setReason] = useState<DismissReason | "">("");

  return (
    <Modal open={open} onClose={onClose} title="Mark as not relevant?">
      <p className="text-body text-ink-muted">This fix will not remain active. What&apos;s the reason?</p>

      <label className="mt-4 flex flex-col gap-1.5 text-body font-medium text-ink">
        Reason
        <select
          value={reason}
          onChange={(e) => setReason(e.target.value as DismissReason)}
          className="h-11 rounded-xs border border-line px-3 text-body text-ink focus-visible:border-brick focus-visible:ring-2 focus-visible:ring-brick"
        >
          <option value="" disabled>
            Choose a reason
          </option>
          {dismissReasons.map((r) => (
            <option key={r.value} value={r.value}>
              {r.label}
            </option>
          ))}
        </select>
      </label>

      <div className="mt-6 flex gap-3">
        <Button variant="primary" type="button" disabled={!reason} onClick={() => reason && onConfirm(reason)}>
          Confirm
        </Button>
        <Button variant="secondary" type="button" onClick={onClose}>
          Cancel
        </Button>
      </div>
    </Modal>
  );
}
