import { useEffect, useRef, type ReactNode } from "react";

export function ExportDialog({
  open,
  onClose,
  children,
}: {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
}) {
  const closeButton = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    closeButton.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose, open]);

  if (!open) return null;
  return (
    <div
      className="export-dialog-backdrop"
      onMouseDown={(event) => {
        if (event.currentTarget === event.target) onClose();
      }}
    >
      <div className="export-dialog" role="dialog" aria-modal="true" aria-label="Export playlists">
        <header className="export-dialog-header">
          <div>
            <p className="eyebrow">Preview is unchanged</p>
            <h2>Export playlists</h2>
            <p>Choose a destination. Source playlists remain read-only.</p>
          </div>
          <button ref={closeButton} type="button" className="export-dialog-close" onClick={onClose}>
            <span aria-hidden="true">×</span>
            <span className="sr-only">Close export destinations</span>
          </button>
        </header>
        <div className="export-dialog-scroll">{children}</div>
      </div>
    </div>
  );
}
