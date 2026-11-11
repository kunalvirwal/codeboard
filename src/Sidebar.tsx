import { useLiveQuery } from 'dexie-react-hooks';
import { ChevronDown, ChevronRight, PanelLeftClose, Plus, RotateCcw, Search, X } from 'lucide-react';
import { useState } from 'react';
import { resolveColor } from './appearance';
import { createBoard, db, deleteBoard, refreshTourBoards, renameBoard, type Board } from './db';
import { updateSettings, useSettings, type Settings } from './lib/settings';
import { keys } from './lib/keys';

interface SidebarProps {
  boards: Board[];
  activeId: string | undefined;
  onSelect: (id: string) => void;
  onSearch: () => void;
  onCollapse: () => void;
}

const SHORTCUTS: { group: string; entries: [string, string][] }[] = [
  {
    group: 'Add',
    entries: [
      ['⌘V', 'Paste anything'],
      ['N  T  C', 'Note, text, code'],
      ['F  ⌘G', 'Box around selection'],
      ['Click', 'Wheel menu'],
    ],
  },
  {
    group: 'Edit',
    entries: [
      ['⌘C  ⌘X', 'Copy, cut cards'],
      ['⌘V', 'Paste cards'],
      ['⌫', 'Delete selection'],
      ['Esc', 'Exit field, mode, menu'],
    ],
  },
  {
    group: 'Move around',
    entries: [
      ['M', 'Mark this spot'],
      ['⌘←→', 'Next, previous marker'],
      ['⌘⇧↑↓', 'Switch board'],
      ['G', 'Glide (edge scrolling)'],
      ['⇧1', 'Zoom to fit'],
      ['⌘K', 'Search everything'],
      ['⌘\\', 'Toggle sidebar'],
    ],
  },
];

export function Sidebar({ boards, activeId, onSelect, onSearch, onCollapse }: SidebarProps) {
  const [renaming, setRenaming] = useState<string | null>(null);
  const [showKeys, setShowKeys] = useState(() => {
    try {
      return localStorage.getItem('codeboard:show-keys') === '1';
    } catch {
      return false;
    }
  });
  const toggleKeys = () =>
    setShowKeys((open) => {
      try {
        localStorage.setItem('codeboard:show-keys', open ? '0' : '1');
      } catch {
        /* storage unavailable */
      }
      return !open;
    });
  const [showSettings, setShowSettings] = useState(false);
  const settings = useSettings();
  const counts = useLiveQuery(async () => {
    const keys = await db.cards.orderBy('boardId').keys();
    const map = new Map<string, number>();
    for (const k of keys) map.set(String(k), (map.get(String(k)) ?? 0) + 1);
    return map;
  }, []);

  const add = async () => {
    const board = await createBoard('Untitled board');
    onSelect(board.id);
    setRenaming(board.id);
  };

  const remove = async (board: Board) => {
    const n = counts?.get(board.id) ?? 0;
    const what = n ? ` and its ${n} card${n === 1 ? '' : 's'}` : '';
    if (window.confirm(`Delete "${board.name}"${what}? This can't be undone.`)) await deleteBoard(board.id);
  };

  const commitRename = (board: Board, value: string) => {
    setRenaming(null);
    const name = value.trim();
    if (name && name !== board.name) void renameBoard(board.id, name);
  };

  // Your boards first, the built-in tour in its own section below.
  const mine = boards.filter((b) => !b.tour);
  const tours = boards.filter((b) => b.tour);
  const [tourOpen, setTourOpen] = useState(() => {
    try {
      return localStorage.getItem('codeboard:tour-open') !== '0';
    } catch {
      return true;
    }
  });
  const toggleTour = () =>
    setTourOpen((open) => {
      try {
        localStorage.setItem('codeboard:tour-open', open ? '0' : '1');
      } catch {
        /* storage unavailable */
      }
      return !open;
    });

  const refreshTour = async () => {
    const ok = window.confirm('Reset all tour boards to their original state? Changes you made to them are lost; your own boards are not touched.');
    if (!ok) return;
    const first = await refreshTourBoards();
    updateSettings({ showTour: true });
    onSelect(first);
  };

  const renderRow = (board: Board, label = board.name) => {
    const swatch = resolveColor(board.appearance?.color ?? 'auto');
    return (
      <div
        key={board.id}
        className={`board-item${board.id === activeId ? ' active' : ''}`}
        onClick={() => onSelect(board.id)}
        onDoubleClick={() => setRenaming(board.id)}
        title="Double-click to rename"
      >
        <span className="board-swatch" style={{ background: swatch.id === 'auto' ? undefined : swatch.bg }} />
        {renaming === board.id ? (
          <input
            className="board-rename"
            autoFocus
            defaultValue={board.name}
            onFocus={(e) => e.currentTarget.select()}
            onBlur={(e) => commitRename(board, e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') e.currentTarget.blur();
              if (e.key === 'Escape') setRenaming(null);
            }}
            onClick={(e) => e.stopPropagation()}
          />
        ) : (
          <>
            <span className="board-name">{label}</span>
            <span className="board-count">{counts?.get(board.id) ?? 0}</span>
            <button
              type="button"
              className="board-delete"
              title="Delete board"
              onClick={(e) => {
                e.stopPropagation();
                void remove(board);
              }}
            >
              <X size={13} />
            </button>
          </>
        )}
      </div>
    );
  };

  return (
    <aside className="sidebar glass">
      <div className="brand">
        <img src="/favicon.svg" alt="" width={24} height={24} />
        <span>CodeBoard</span>
        <button type="button" className="icon-btn" title={keys('Hide sidebar (⌘\\)')} onClick={onCollapse}>
          <PanelLeftClose size={16} />
        </button>
      </div>

      <button type="button" className="search-trigger" onClick={onSearch}>
        <Search size={14} />
        <span>Search</span>
        <kbd>{keys('⌘K')}</kbd>
      </button>


      <nav className="board-list">
        {/* The built-in tour first, then your own boards. */}
        {settings.showTour && tours.length > 0 && (
          <>
            <button type="button" className="sidebar-section tour-heading" onClick={toggleTour}>
              {tourOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
              <span>Tour</span>
            </button>
            {tourOpen && tours.map((board) => renderRow(board, board.name.replace(/^Tour\s+/, '')))}
          </>
        )}
        <div className={`sidebar-section${settings.showTour && tours.length > 0 ? ' boards-heading' : ''}`}>
          <span>Boards</span>
          <button type="button" className="icon-btn" title="New board" onClick={() => void add()}>
            <Plus size={15} />
          </button>
        </div>
        {mine.map((board) => renderRow(board))}
      </nav>

      <div className="sidebar-footer">
        <button type="button" className="keys-toggle" onClick={() => setShowSettings((s) => !s)}>
          Settings
          <span>{showSettings ? '−' : '+'}</span>
        </button>
        {showSettings && (
          <div className="settings">
            <label className="setting-row">
              <span>
                <strong>Load nearby only</strong>
                <small>Images, link previews and code load only near your view, and ahead of you while gliding. For very large boards.</small>
              </span>
              <input
                type="checkbox"
                className="switch"
                checked={settings.lazyLoad}
                onChange={(e) => updateSettings({ lazyLoad: e.target.checked })}
              />
            </label>
            <div className={`setting-row stacked${settings.lazyLoad ? '' : ' disabled'}`}>
              <strong>Preload distance</strong>
              <div className="tb-segment preload-segment">
                {(['near', 'medium', 'far'] as Settings['preload'][]).map((p) => (
                  <button
                    key={p}
                    type="button"
                    disabled={!settings.lazyLoad}
                    className={settings.preload === p ? 'active' : ''}
                    onClick={() => updateSettings({ preload: p })}
                  >
                    {p === 'near' ? '½ screen' : p === 'medium' ? '1 screen' : '2 screens'}
                  </button>
                ))}
              </div>
            </div>
            <label className="setting-row">
              <span>
                <strong>Show tour boards</strong>
                <small>The built-in tour, in its own section. Turning it off hides them; nothing is deleted.</small>
              </span>
              <input
                type="checkbox"
                className="switch"
                checked={settings.showTour}
                onChange={(e) => updateSettings({ showTour: e.target.checked })}
              />
            </label>
            <div className="setting-row">
              <span>
                <strong>Refresh tour boards</strong>
                <small>Reset all tour boards to their original state, and bring back any you deleted.</small>
              </span>
              <button type="button" className="setting-btn" title="Refresh tour boards" onClick={() => void refreshTour()}>
                <RotateCcw size={13} />
              </button>
            </div>
          </div>
        )}
        <button type="button" className="keys-toggle" onClick={toggleKeys}>
          Keyboard shortcuts
          <span>{showKeys ? '−' : '+'}</span>
        </button>
        {showKeys && (
          <div className="keys">
            {SHORTCUTS.map(({ group, entries }) => (
              <dl key={group}>
                <div className="keys-group">{group}</div>
                {entries.map(([k, label]) => (
                  <div key={label} className="keys-row">
                    <dt>{label}</dt>
                    <dd>
                      {k.split(/\s+/).map((part) => (
                        <kbd key={part}>{keys(part)}</kbd>
                      ))}
                    </dd>
                  </div>
                ))}
              </dl>
            ))}
          </div>
        )}
      </div>
    </aside>
  );
}
