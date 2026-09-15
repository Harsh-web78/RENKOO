import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";

export function ApplyConfirmModal({
  open,
  onClose,
  onConfirm,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  return (
    <Modal open={open} onClose={onClose} title="You've made this change?">
      <p className="text-body text-ink-muted">
        RENKO will use the current metrics as the baseline and check for a meaningful change after the
        measurement window.
      </p>
      <div className="mt-6 flex gap-3">
        <Button variant="primary" type="button" onClick={onConfirm}>
          Confirm — I&apos;ve made this change
        </Button>
        <Button variant="secondary" type="button" onClick={onClose}>
          Cancel
        </Button>
      </div>
    </Modal>
  );
}
