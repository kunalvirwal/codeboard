import { NodeResizer, NodeToolbar, Position, useReactFlow, type Node, type NodeProps } from '@xyflow/react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Bookmark, GripHorizontal, Trash2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { db, deleteCards, FRAME_COLORS, patchCard, uid, updateMarkers, type FrameCard } from '../db';
import { ConnectHandles, focusWhenVisible, keepFocus, persistResize, ToolbarButton, ToolbarDivider } from './CardFrame';
import { autoEdit } from './create';
import { keys } from '../lib/keys';

export type FrameNodeType = Node<{ card: FrameCard }, 'frame'>;

/**
 * A translucent box. Its body lets clicks through to the canvas (so you can
 * box-select and double-click inside it); only the title bar grabs and drags it.
 * Cards fully inside move with it (see Canvas onNodeDrag*).
 */
export function FrameNode({ id, data, selected }: NodeProps<FrameNodeType>) {
  const { title, color } = data.card.data;
  const boardId = data.card.boardId;
  const rf = useReactFlow();
  const [editing, setEditing] = useState(() => autoEdit.has(id));
  const inputRef = useRef<HTMLInputElement>(null);
  const markers = useLiveQuery(async () => (await db.boards.get(boardId))?.markers ?? [], [boardId]);
  const marked = markers?.some((m) => m.cardId === id) ?? false;

  useEffect(() => {
    autoEdit.delete(id);
  }, [id]);
  useEffect(() => {
    if (editing) return focusWhenVisible(inputRef.current);
  }, [editing]);

  const select = () => rf.setNodes((ns) => ns.map((n) => ({ ...n, selected: n.id === id })));

  const commitTitle = (value: string) => {
    setEditing(false);
    // An empty title is allowed: the label disappears, leaving just a grip on hover.
    const next = value.trim();
    if (next !== title) {
      void patchCard(id, (c) => {
        if (c.type === 'frame') c.data.title = next;
      });
      void updateMarkers(boardId, (ms) => ms.map((m) => (m.cardId === id ? { ...m, name: next || 'Box' } : m)));
    }
  };

  const toggleMarker = () =>
    void updateMarkers(boardId, (ms) =>
      marked ? ms.filter((m) => m.cardId !== id) : [...ms, { id: uid(), name: title || 'Box', cardId: id, x: 0, y: 0, zoom: 1 }],
    );

  return (
    <>
      <NodeResizer
        isVisible={selected}
        minWidth={160}
        minHeight={100}
        lineClassName="card-resize-line"
        handleClassName="card-resize-handle"
        onResizeEnd={(_, p) => persistResize(id, p)}
      />
      <NodeToolbar isVisible={selected} position={Position.Top} offset={12} className="card-toolbar" onMouseDown={keepFocus}>
        <div className="tb-colors">
          {FRAME_COLORS.map((c) => (
            <button
              key={c}
              type="button"
              title={c}
              className={`tb-color frame-swatch-${c}${c === color ? ' active' : ''}`}
              onClick={() =>
                void patchCard(id, (card) => {
                  if (card.type === 'frame') card.data.color = c;
                })
              }
            />
          ))}
        </div>
        <ToolbarDivider />
        <ToolbarButton title={marked ? 'Remove marker' : keys('Add marker (⌘← / ⌘→ to jump)')} active={marked} onClick={toggleMarker}>
          <Bookmark size={15} fill={marked ? 'currentColor' : 'none'} />
        </ToolbarButton>
        <ToolbarDivider />
        <ToolbarButton danger title="Delete box (keeps its cards)" onClick={() => void deleteCards([id])}>
          <Trash2 size={15} />
        </ToolbarButton>
      </NodeToolbar>
      <ConnectHandles />
      <div className={`frame frame-${color}${selected ? ' selected' : ''}`}>
        {/* Thin grabbable rim so an untitled box can still be moved and selected. */}
        {(['t', 'r', 'b', 'l'] as const).map((side) => (
          <div key={side} className={`frame-rim frame-rim-${side} frame-drag`} onClick={select} onDoubleClick={() => setEditing(true)} />
        ))}
        <div
          className={`frame-title frame-drag${!title && !editing ? ' empty' : ''}`}
          title={title ? undefined : 'Drag to move · double-click to add a title'}
          onClick={select}
          onDoubleClick={(e) => {
            e.stopPropagation();
            setEditing(true);
          }}
        >
          {marked && <Bookmark size={12} fill="currentColor" className="frame-marker" />}
          {editing ? (
            <input
              ref={inputRef}
              className="frame-title-input nodrag"
              placeholder="Box title"
              defaultValue={title}
              onBlur={(e) => commitTitle(e.currentTarget.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === 'Escape') e.currentTarget.blur();
              }}
            />
          ) : title ? (
            <span>{title}</span>
          ) : (
            <GripHorizontal size={14} />
          )}
        </div>
      </div>
    </>
  );
}
