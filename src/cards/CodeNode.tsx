import type { Node, NodeProps } from '@xyflow/react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { patchCard, type CodeCard } from '../db';
import { detectLanguage, highlight, LANGUAGES } from '../lib/code';
import { Check, Copy, Pencil } from 'lucide-react';
import { CardFrame, focusWhenVisible, ToolbarButton, useCopy, useOverflow } from './CardFrame';
import { useNearView } from '../lib/loadZone';
import { autoEdit } from './create';

export type CodeNodeType = Node<{ card: CodeCard }, 'code'>;

export function CodeNode({ id, data, selected }: NodeProps<CodeNodeType>) {
  const { code, language, title } = data.card.data;
  const fixedHeight = data.card.height !== undefined;
  const [editing, setEditing] = useState(() => autoEdit.has(id));
  const [copied, copy] = useCopy();
  const editRef = useRef<HTMLTextAreaElement>(null);
  const viewRef = useRef<HTMLPreElement>(null);
  const lines = code ? code.split('\n').length : 0;
  const { near, height } = useNearView(id, data.card.height ?? Math.min(lines * 19.5 + 56, 476));
  const live = near || editing;
  // Syntax highlighting is the expensive part; skip it while the card is far away.
  const html = useMemo(() => (live ? highlight(code, language) : ''), [live, code, language]);
  const scrollable = useOverflow(viewRef, [html, editing]);
  const lineCount = code ? code.split('\n').length : 0;

  useEffect(() => {
    autoEdit.delete(id);
  }, [id]);

  useEffect(() => {
    if (editing) return focusWhenVisible(editRef.current);
  }, [editing]);

  const commit = (value: string) => {
    setEditing(false);
    if (value === code) return;
    void patchCard(id, (c) => {
      if (c.type !== 'code') return;
      // A brand-new empty card gets its language guessed on first save.
      if (!c.data.code && c.data.language === 'plaintext') c.data.language = detectLanguage(value);
      c.data.code = value;
    });
  };

  const doCopy = () => copy(() => navigator.clipboard.writeText(code));

  return (
    <CardFrame
      id={id}
      selected={selected}
      className={`code-card${fixedHeight ? ' fixed' : ''}`}
      minWidth={220}
      minHeight={80}
      toolbar={
        <>
          <ToolbarButton title="Edit" onClick={() => setEditing(true)}>
            <Pencil size={15} />
          </ToolbarButton>
          <ToolbarButton title="Copy code" onClick={doCopy}>
            {copied ? <Check size={15} /> : <Copy size={15} />}
          </ToolbarButton>
        </>
      }
    >
      {!live ? (
        <div className="card-lite" style={{ height }} />
      ) : (
      <>
      <div className="code-header">
        <select
          className="code-lang nodrag"
          value={language}
          onChange={(e) =>
            void patchCard(id, (c) => {
              if (c.type === 'code') c.data.language = e.target.value;
            })
          }
        >
          {LANGUAGES.map((l) => (
            <option key={l.id} value={l.id}>
              {l.label}
            </option>
          ))}
        </select>
        {title && <span className="code-title">{title}</span>}
        <span className="code-meta">
          {lineCount} {lineCount === 1 ? 'line' : 'lines'}
        </span>
        <button type="button" className="code-copy nodrag" onClick={doCopy}>
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      {editing ? (
        <textarea
          ref={editRef}
          className="code-edit nodrag nowheel"
          defaultValue={code}
          spellCheck={false}
          placeholder="Paste or type code…"
          onBlur={(e) => commit(e.currentTarget.value)}
          onKeyDown={(e) => {
            const el = e.currentTarget;
            if (e.key === 'Escape' || (e.key === 'Enter' && (e.metaKey || e.ctrlKey))) {
              el.blur();
            } else if (e.key === 'Tab') {
              e.preventDefault();
              el.setRangeText('  ', el.selectionStart, el.selectionEnd, 'end');
            }
          }}
        />
      ) : (
        <pre
          ref={viewRef}
          className={`code-view${scrollable ? ' nowheel' : ''}`}
          onDoubleClick={(e) => {
            e.stopPropagation();
            setEditing(true);
          }}
        >
          {code ? (
            <code className="hljs" dangerouslySetInnerHTML={{ __html: html }} />
          ) : (
            <span className="placeholder">Double-click to add code</span>
          )}
        </pre>
      )}
      </>
      )}
    </CardFrame>
  );
}
