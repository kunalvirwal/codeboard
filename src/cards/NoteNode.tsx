import type { Node, NodeProps } from '@xyflow/react';
import { AlignCenter, AlignLeft, AlignRight, Bold, Check, Copy, Pencil } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { deleteCards, NOTE_COLORS, NOTE_FONTS, NOTE_SIZES, patchCard, type NoteCard, type NoteData } from '../db';
import { autoGrow, CardFrame, focusWhenVisible, ToolbarButton, ToolbarDivider, useCopy } from './CardFrame';
import { autoEdit } from './create';
import { keys } from '../lib/keys';

export type NoteNodeType = Node<{ card: NoteCard }, 'note'>;

const FONT_LABEL: Record<string, string> = { sans: 'Sans', serif: 'Serif', mono: 'Mono', hand: 'Handwritten' };
const NEXT_ALIGN = { left: 'center', center: 'right', right: 'left' } as const;
const ALIGN_ICON = { left: <AlignLeft size={15} />, center: <AlignCenter size={15} />, right: <AlignRight size={15} /> };

function setNote(id: string, fn: (d: NoteData) => void) {
  void patchCard(id, (c) => {
    if (c.type === 'note') fn(c.data);
  });
}

export function NoteNode({ id, data, selected }: NodeProps<NoteNodeType>) {
  const { text: stored, color, font = 'sans', size = 'm', bold = false, align = 'left', localizeKeys } = data.card.data;
  // Tour notes are written with Mac keys and shown in this platform's form.
  const text = localizeKeys ? keys(stored) : stored;
  const [editing, setEditing] = useState(() => autoEdit.has(id));
  const ref = useRef<HTMLTextAreaElement>(null);
  const [copied, copy] = useCopy();

  useEffect(() => {
    autoEdit.delete(id);
  }, [id]);

  useEffect(() => {
    if (!editing) return;
    autoGrow(ref.current);
    return focusWhenVisible(ref.current);
  }, [editing]);

  const commit = (value: string) => {
    setEditing(false);
    if (!value.trim()) {
      void deleteCards([id]); // an emptied note is a deleted note
      return;
    }
    if (value !== text) setNote(id, (d) => (d.text = value));
  };

  const toolbar = (
    <>
      <div className="tb-colors">
        {NOTE_COLORS.map((c) => (
          <button
            key={c}
            type="button"
            title={c === 'none' ? 'No background (text)' : c}
            className={`tb-color swatch-${c}${c === color ? ' active' : ''}`}
            onClick={() => setNote(id, (d) => (d.color = c))}
          />
        ))}
      </div>
      <ToolbarDivider />
      <div className="tb-segment tb-fonts">
        {NOTE_FONTS.map((f) => (
          <button
            key={f}
            type="button"
            title={FONT_LABEL[f]}
            className={`font-${f}${f === font ? ' active' : ''}`}
            onClick={() => setNote(id, (d) => (d.font = f))}
          >
            Aa
          </button>
        ))}
      </div>
      <div className="tb-segment" title="Text size">
        {NOTE_SIZES.map((s) => (
          <button key={s} type="button" className={s === size ? 'active' : ''} onClick={() => setNote(id, (d) => (d.size = s))}>
            {s.toUpperCase()}
          </button>
        ))}
      </div>
      <ToolbarButton title="Bold" active={bold} onClick={() => setNote(id, (d) => (d.bold = !bold))}>
        <Bold size={15} />
      </ToolbarButton>
      <ToolbarButton title={`Align: ${align} (click to change)`} onClick={() => setNote(id, (d) => (d.align = NEXT_ALIGN[align]))}>
        {ALIGN_ICON[align]}
      </ToolbarButton>
      <ToolbarDivider />
      <ToolbarButton title="Edit" onClick={() => setEditing(true)}>
        <Pencil size={15} />
      </ToolbarButton>
      <ToolbarButton title="Copy text" onClick={() => copy(() => navigator.clipboard.writeText(text))}>
        {copied ? <Check size={15} /> : <Copy size={15} />}
      </ToolbarButton>
    </>
  );

  const typography = `font-${font} size-${size}${bold ? ' bold' : ''} align-${align}`;

  return (
    <CardFrame
      id={id}
      selected={selected}
      className={`note-card note-${color} ${typography}`}
      toolbar={toolbar}
      minHeight={32}
      onDoubleClick={() => setEditing(true)}
    >
      {editing ? (
        <textarea
          ref={ref}
          className="note-edit nodrag nowheel"
          defaultValue={text}
          placeholder={color === 'none' ? 'Type something…' : 'Type a note…'}
          onInput={(e) => autoGrow(e.currentTarget)}
          onBlur={(e) => commit(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape' || (e.key === 'Enter' && (e.metaKey || e.ctrlKey))) e.currentTarget.blur();
          }}
        />
      ) : (
        <div className="note-text">{text || <span className="placeholder">Empty note</span>}</div>
      )}
    </CardFrame>
  );
}
