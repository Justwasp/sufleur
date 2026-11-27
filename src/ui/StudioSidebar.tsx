import { Copy, FilePlus2, Trash2, Upload } from 'lucide-react';
import { useRef } from 'react';
import type { ScriptItem } from '../store/types';

interface StudioSidebarProps {
  scripts: ScriptItem[];
  activeScriptId: string;
  onSelectScript: (id: string) => void;
  onCreateScript: () => void;
  onDuplicateScript: (id: string) => void;
  onDeleteScript: (id: string) => void;
  onImportFiles: (files: FileList | File[]) => void;
}

function countWords(text: string): number {
  const trimmed = text.trim();
  return trimmed ? trimmed.split(/\s+/).length : 0;
}

export function StudioSidebar({
  scripts,
  activeScriptId,
  onSelectScript,
  onCreateScript,
  onDuplicateScript,
  onDeleteScript,
  onImportFiles,
}: StudioSidebarProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  return (
    <aside className="sidebar-panel" aria-label="Script Library">
      <div className="panel-header">
        <span className="panel-title">Script Library ({scripts.length})</span>
        <button
          type="button"
          className="btn btn-sm"
          onClick={onCreateScript}
          title="Create blank script"
        >
          <FilePlus2 size={13} />
          New
        </button>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept=".txt,.md,.markdown,.pdf,.doc,.docx,.rtf,.html,.htm,.srt,.vtt,.csv,.log,text/*,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        style={{ display: 'none' }}
        onChange={(e) => {
          if (e.target.files && e.target.files.length > 0) {
            onImportFiles(e.target.files);
            e.target.value = '';
          }
        }}
      />

      <button
        type="button"
        className="import-drop-btn"
        onClick={() => fileInputRef.current?.click()}
      >
        <Upload size={17} color="#f59e0b" />
        <strong style={{ fontSize: 12.5 }}>Import Document</strong>
        <small>PDF, DOCX, DOC, RTF, TXT, MD, HTML, SRT</small>
      </button>

      <div className="script-list">
        {scripts.map((script) => {
          const isActive = script.id === activeScriptId;
          const words = countWords(script.content);

          return (
            <div
              key={script.id}
              className={`script-card ${isActive ? 'active' : ''}`}
              role="button"
              tabIndex={0}
              onClick={() => onSelectScript(script.id)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  onSelectScript(script.id);
                }
              }}
            >
              <div className="script-card-top">
                <span className="script-card-title">{script.title || 'Untitled Script'}</span>
                <div className="script-card-actions" onClick={(e) => e.stopPropagation()}>
                  <button
                    type="button"
                    className="btn btn-ghost btn-icon"
                    style={{ width: 24, height: 24, padding: 3 }}
                    onClick={() => onDuplicateScript(script.id)}
                    title="Duplicate script"
                    aria-label={`Duplicate ${script.title}`}
                  >
                    <Copy size={12} />
                  </button>
                  {scripts.length > 1 && (
                    <button
                      type="button"
                      className="btn btn-ghost btn-icon"
                      style={{ width: 24, height: 24, padding: 3 }}
                      onClick={() => onDeleteScript(script.id)}
                      title="Delete script"
                      aria-label={`Delete ${script.title}`}
                    >
                      <Trash2 size={12} />
                    </button>
                  )}
                </div>
              </div>
              <div className="script-card-meta">
                <span className="format-pill">{script.sourceFormat}</span>
                <span>{words} words</span>
              </div>
            </div>
          );
        })}
      </div>
    </aside>
  );
}
