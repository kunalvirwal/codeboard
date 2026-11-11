import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { db, type Board, type Card } from './db';
import { languageLabel } from './lib/code';

interface Result {
  key: string;
  boardId: string;
  cardId: string | null;
  kind: string;
  title: string;
  snippet: string;
  board: string;
}

function searchableText(card: Card): { title: string; body: string } {
  switch (card.type) {
    case 'note':
      return { title: card.data.text.split('\n')[0], body: card.data.text };
    case 'code':
      return {
        title: card.data.title ?? `${languageLabel(card.data.language)} snippet`,
        body: `${card.data.title ?? ''}\n${card.data.code}`,
      };
    case 'link': {
      const p = card.data.preview;
      return {
        title: p?.title ?? card.data.url,
        body: [card.data.url, p?.title, p?.description, p?.siteName].filter(Boolean).join('\n'),
      };
    }
    case 'image':
      return { title: card.data.name ?? 'Image', body: card.data.name ?? '' };
    case 'frame':
      return { title: card.data.title, body: card.data.title };
  }
}

function snippetAround(text: string, query: string) {
  const flat = text.replace(/\s+/g, ' ').trim();
  if (!query) return flat.slice(0, 120);
  const i = flat.toLowerCase().indexOf(query);
  if (i < 0) return flat.slice(0, 120);
  const start = Math.max(0, i - 40);
  return (start > 0 ? '…' : '') + flat.slice(start, i + query.length + 80);
}

function Highlight({ text, query }: { text: string; query: string }): ReactNode {
  if (!query) return text;
  const i = text.toLowerCase().indexOf(query);
  if (i < 0) return text;
  return (
    <>
      {text.slice(0, i)}
      <mark>{text.slice(i, i + query.length)}</mark>
      {text.slice(i + query.length)}
    </>
  );
}

const KIND_LABEL: Record<string, string> = { note: 'Note', code: 'Code', link: 'Link', image: 'Image', frame: 'Box', board: 'Board' };

export function SearchPalette(props: {
  boards: Board[];
  onClose: () => void;
  onPick: (boardId: string, cardId: string | null) => void;
}) {
  const { boards, onClose, onPick } = props;
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const cards = useLiveQuery(() => db.cards.toArray(), []);
  const q = query.trim().toLowerCase();

  const results = useMemo<Result[]>(() => {
    const boardName = new Map(boards.map((b) => [b.id, b.name]));
    const out: Result[] = [];
    for (const b of boards) {
      if (q && b.name.toLowerCase().includes(q)) {
        out.push({ key: `b:${b.id}`, boardId: b.id, cardId: null, kind: 'board', title: b.name, snippet: '', board: '' });
      }
    }
    const pool = [...(cards ?? [])].sort((a, b) => b.updatedAt - a.updatedAt);
    for (const card of pool) {
      if (!boardName.has(card.boardId)) continue; // board hidden (e.g. tour boards turned off)
      const { title, body } = searchableText(card);
      if (q && !body.toLowerCase().includes(q)) continue;
      out.push({
        key: card.id,
        boardId: card.boardId,
        cardId: card.id,
        kind: card.type,
        title: title.slice(0, 90) || 'Untitled',
        snippet: snippetAround(body, q),
        board: boardName.get(card.boardId) ?? '',
      });
      if (out.length >= 60) break;
    }
    return out;
  }, [boards, cards, q]);

  useEffect(() => setActive(0), [q]);
  useEffect(() => {
    listRef.current?.querySelector('.result.active')?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  const pick = (r: Result | undefined) => {
    if (!r) return;
    onPick(r.boardId, r.cardId);
    onClose();
  };

  return (
    <div className="palette-backdrop" onMouseDown={onClose}>
      <div className="palette" onMouseDown={(e) => e.stopPropagation()}>
        <input
          autoFocus
          className="palette-input"
          placeholder="Search notes, code, links and boards…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setActive((a) => Math.min(a + 1, results.length - 1));
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setActive((a) => Math.max(a - 1, 0));
            } else if (e.key === 'Enter') {
              pick(results[active]);
            } else if (e.key === 'Escape') {
              onClose();
            }
          }}
        />
        <div className="palette-results" ref={listRef}>
          {!q && results.length > 0 && <div className="palette-heading">Recently edited</div>}
          {results.map((r, i) => (
            <div
              key={r.key}
              className={`result${i === active ? ' active' : ''}`}
              onMouseEnter={() => setActive(i)}
              onClick={() => pick(r)}
            >
              <span className={`result-kind kind-${r.kind}`}>{KIND_LABEL[r.kind]}</span>
              <div className="result-main">
                <div className="result-title">
                  <Highlight text={r.title} query={q} />
                </div>
                {r.snippet && r.snippet !== r.title && (
                  <div className="result-snippet">
                    <Highlight text={r.snippet} query={q} />
                  </div>
                )}
              </div>
              {r.board && <span className="result-board">{r.board}</span>}
            </div>
          ))}
          {results.length === 0 && <div className="palette-empty">{q ? 'No matches' : 'Nothing here yet'}</div>}
        </div>
      </div>
    </div>
  );
}
