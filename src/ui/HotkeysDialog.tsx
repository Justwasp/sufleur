import { X } from 'lucide-react';
import { useEffect, useRef } from 'react';

interface HotkeysDialogProps {
  open: boolean;
  onClose: () => void;
}

const SHORTCUTS: Array<{ keys: string; desc: string }> = [
  { keys: 'Space', desc: 'Start / Pause voice tracking or auto-scroll' },
  { keys: '↑ / PageUp', desc: 'Step backward (presenter remote compatible)' },
  { keys: '↓ / PageDown', desc: 'Step forward (presenter remote compatible)' },
  { keys: 'M', desc: 'Toggle Horizontal Mirror (beam-splitter glass)' },
  { keys: 'V', desc: 'Toggle Vertical Mirror' },
  { keys: 'F', desc: 'Toggle Stage / Fullscreen mode' },
  { keys: 'R', desc: 'Reset prompter to beginning of script' },
  { keys: '+ / -', desc: 'Increase / decrease font size' },
  { keys: 'Click any word', desc: 'Immediately jump cursor to that word' },
  { keys: 'Esc', desc: 'Exit Stage / Fullscreen mode' },
];

/**
 * Native modal <dialog> with closedby="any" light-dismiss and Safari pointer-coordinate fallback.
 */
export function HotkeysDialog({ open, onClose }: HotkeysDialogProps) {
  const dialogRef = useRef<HTMLDialogElement | null>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (open && !dialog.open) {
      dialog.showModal();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  // Fallback light-dismiss for browsers without native HTMLDialogElement.prototype.closedBy
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if ('closedBy' in HTMLDialogElement.prototype) return;

    const handleClick = (event: MouseEvent) => {
      if (event.target !== dialog) return;
      const rect = dialog.getBoundingClientRect();
      const inside =
        rect.top <= event.clientY &&
        event.clientY <= rect.top + rect.height &&
        rect.left <= event.clientX &&
        event.clientX <= rect.left + rect.width;
      if (!inside) {
        dialog.close();
      }
    };

    dialog.addEventListener('click', handleClick);
    return () => dialog.removeEventListener('click', handleClick);
  }, []);

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby="hotkeys-dialog-title"
      {...({ closedby: 'any' } as Record<string, string>)}
      onClose={() => {
        if (dialogRef.current) {
          dialogRef.current.returnValue = '';
        }
        onClose();
      }}
    >
      <div className="dialog-head">
        <h1 id="hotkeys-dialog-title">Keyboard &amp; Presenter Remote Shortcuts</h1>
        <form method="dialog">
          <button
            type="submit"
            className="btn btn-ghost btn-icon"
            aria-label="Close shortcuts dialog"
            autoFocus
          >
            <X size={18} />
          </button>
        </form>
      </div>
      <div className="dialog-body">
        {SHORTCUTS.map((item) => (
          <div className="hotkey-row" key={item.keys}>
            <span>{item.desc}</span>
            <kbd>{item.keys}</kbd>
          </div>
        ))}
      </div>
    </dialog>
  );
}
