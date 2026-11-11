import { useLiveQuery } from 'dexie-react-hooks';
import { PanelLeftOpen } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BoardCanvas } from './Canvas';
import { createBoard, db } from './db';
import { useSettings } from './lib/settings';
import { SearchPalette } from './SearchPalette';
import { Sidebar } from './Sidebar';
import { keys } from './lib/keys';

const ACTIVE_KEY = 'codeboard:active-board';
const SIDEBAR_KEY = 'codeboard:sidebar';

function readActive() {
  try {
    return localStorage.getItem(ACTIVE_KEY);
  } catch {
    return null;
  }
}

export function App() {
  const boards = useLiveQuery(() => db.boards.orderBy('createdAt').toArray(), []);
  const [activeId, setActiveId] = useState<string | null>(readActive);
  const [focusCardId, setFocusCardId] = useState<string | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [boardToast, setBoardToast] = useState<string | null>(null);
  const boardToastTimer = useRef<number | undefined>(undefined);
  const [sidebar, setSidebar] = useState(() => {
    try {
      return localStorage.getItem(SIDEBAR_KEY) !== '0';
    } catch {
      return true;
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(SIDEBAR_KEY, sidebar ? '1' : '0');
    } catch {
      /* storage unavailable */
    }
  }, [sidebar]);

  const { showTour } = useSettings();
  // Sidebar order: the tour (when shown), then your boards. Hidden tour boards
  // are skipped everywhere: board switching, search, and the fallback board.
  const visible = useMemo(
    () => (boards ? [...(showTour ? boards.filter((b) => b.tour) : []), ...boards.filter((b) => !b.tour)] : undefined),
    [boards, showTour],
  );
  const active = visible?.find((b) => b.id === activeId) ?? visible?.[0];

  useEffect(() => {
    if (!active) return;
    try {
      localStorage.setItem(ACTIVE_KEY, active.id);
    } catch {
      /* storage unavailable */
    }
  }, [active]);

  // Deleted the last board? Start a fresh Inbox.
  useEffect(() => {
    // Always keep at least one board of your own to paste into.
    if (boards && !boards.some((b) => !b.tour)) void createBoard('Inbox');
  }, [boards]);

  /** Step to the previous/next board in sidebar order (wrapping), and flash its name. */
  const stepBoard = useCallback(
    (dir: 1 | -1) => {
      if (!visible || visible.length < 2 || !active) return;
      const i = visible.findIndex((b) => b.id === active.id);
      const next = visible[(i + dir + visible.length) % visible.length];
      setActiveId(next.id);
      setBoardToast(next.name);
      window.clearTimeout(boardToastTimer.current);
      boardToastTimer.current = window.setTimeout(() => setBoardToast(null), 1300);
    },
    [visible, active],
  );

  useEffect(() => () => window.clearTimeout(boardToastTimer.current), []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // ⌘⇧↑ / ⌘⇧↓: previous / next board (text fields keep their own meaning).
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
        const t = e.target;
        const editing = t instanceof HTMLElement && (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName));
        if (editing) return;
        e.preventDefault();
        stepBoard(e.key === 'ArrowUp' ? -1 : 1);
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setSearchOpen((o) => !o);
      }
      if ((e.metaKey || e.ctrlKey) && e.key === '\\') {
        e.preventDefault();
        setSidebar((s) => !s);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [stepBoard]);

  const onFocusHandled = useCallback(() => setFocusCardId(null), []);

  if (!boards) return null;

  return (
    <div className={`app${sidebar ? ' with-sidebar' : ''}`}>
      <main className="main">
        {active && (
          <BoardCanvas key={active.id} board={active} focusCardId={focusCardId} onFocusHandled={onFocusHandled} />
        )}
      </main>
      {sidebar ? (
        <Sidebar
          boards={boards}
          activeId={active?.id}
          onSelect={setActiveId}
          onSearch={() => setSearchOpen(true)}
          onCollapse={() => setSidebar(false)}
        />
      ) : (
        <button type="button" className="sidebar-open glass" title={keys('Show sidebar (⌘\\)')} onClick={() => setSidebar(true)}>
          <PanelLeftOpen size={17} />
          <span>{active?.name}</span>
        </button>
      )}
      {boardToast && (
        <div className="board-toast glass" key={boardToast}>
          {boardToast}
        </div>
      )}
      {searchOpen && (
        <SearchPalette
          boards={visible ?? []}
          onClose={() => setSearchOpen(false)}
          onPick={(boardId, cardId) => {
            setActiveId(boardId);
            setFocusCardId(cardId);
          }}
        />
      )}
    </div>
  );
}
