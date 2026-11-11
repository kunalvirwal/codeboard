import type { Board, BoardAppearance, BoardEdge, Card, FrameCard, FrameColor, LinkCard, NoteCard, NoteData, StoredBlob } from './db';
import { PREVIEW_VERSION } from './lib/previewVersion';

/**
 * The built-in tour: a few ordinary boards whose cards demonstrate the
 * features they describe. Each section is a box with a marker, so ⌘→ steps
 * through a board like slides. Users can edit or delete them like any board.
 */
export interface TourData {
  boards: Board[];
  cards: Card[];
  edges: BoardEdge[];
  blobs: StoredBlob[];
}

const uid = () => crypto.randomUUID();

const SAMPLE_IMAGE = `<svg xmlns="http://www.w3.org/2000/svg" width="480" height="360" viewBox="0 0 480 360">
<rect width="480" height="360" fill="#f4ede1"/>
<circle cx="160" cy="175" r="112" fill="#ff8a5c"/>
<circle cx="310" cy="205" r="118" fill="#5b5bd6" fill-opacity="0.88"/>
<rect x="262" y="58" width="150" height="92" rx="22" fill="#ffd166"/>
<path d="M44 318 Q 240 238 436 318" fill="none" stroke="#17171a" stroke-width="10" stroke-linecap="round"/>
</svg>`;

// Two stand-in "pins" so the Pinterest section works offline.
const PIN_TALL = `<svg xmlns="http://www.w3.org/2000/svg" width="480" height="640" viewBox="0 0 480 640">
<rect width="480" height="640" fill="#e8e2f6"/>
<circle cx="240" cy="250" r="150" fill="#9b6bff"/>
<rect x="60" y="430" width="360" height="56" rx="28" fill="#ffd166"/>
<rect x="110" y="510" width="260" height="40" rx="20" fill="#ff8a5c"/>
<circle cx="330" cy="150" r="46" fill="#fff" fill-opacity="0.85"/>
</svg>`;

const PIN_SQUARE = `<svg xmlns="http://www.w3.org/2000/svg" width="480" height="480" viewBox="0 0 480 480">
<rect width="480" height="480" fill="#ffe3d8"/>
<path d="M0 340 Q 120 260 240 330 T 480 300 V480 H0 Z" fill="#2fb36b"/>
<circle cx="340" cy="140" r="70" fill="#ff8a5c"/>
<rect x="70" y="120" width="140" height="140" rx="30" fill="#4c8dff" transform="rotate(-10 140 190)"/>
</svg>`;

const SAMPLE_CODE = `// Pasted code is highlighted, and its language is detected.
export async function retry<T>(fn: () => Promise<T>, tries = 3) {
  for (let i = 0; i < tries; i++) {
    try {
      return await fn();
    } catch (err) {
      if (i === tries - 1) throw err;
    }
  }
}`;

/** Space between sections, so each box reads on its own; the ⌘→ arrows cross it. */
const GAP = 380;

export function buildTour(startTime = Date.now()): TourData {
  let clock = startTime;
  const tick = () => clock++;
  const data: TourData = { boards: [], cards: [], edges: [], blobs: [] };

  const board = (name: string, appearance?: BoardAppearance): Board => {
    const b: Board = { id: uid(), name, createdAt: tick(), updatedAt: Date.now(), appearance, markers: [], tour: true };
    data.boards.push(b);
    return b;
  };

  const base = (b: Board, x: number, y: number, width: number) => ({
    id: uid(),
    boardId: b.id,
    x,
    y,
    width,
    createdAt: tick(),
    updatedAt: Date.now(),
  });

  const frame = (b: Board, x: number, y: number, w: number, h: number, title: string, color: FrameColor) => {
    const card: FrameCard = { ...base(b, x, y, w), height: h, type: 'frame', data: { title, color } };
    data.cards.push(card);
    return card;
  };

  const arrow = (b: Board, from: Card, to: Card, sides: [string, string], opts: Partial<BoardEdge> = {}) => {
    data.edges.push({
      id: uid(),
      boardId: b.id,
      source: from.id,
      target: to.id,
      sourceHandle: sides[0],
      targetHandle: sides[1],
      color: 'ink',
      path: 'curve',
      dashed: false,
      arrows: 'end',
      createdAt: tick(),
      ...opts,
    });
  };

  /**
   * Lays sections out left to right. Each is a marked box (a ⌘→ stop), joined
   * to the previous one by a dashed "Press ⌘→" arrow. Content inside is placed
   * relative to the section's top-left corner.
   */
  const sections = (b: Board) => {
    let nextX = 0;
    let previous: FrameCard | null = null;
    const add = (w: number, h: number, title: string, color: FrameColor) => {
      const box = frame(b, nextX, 0, w, h, title, color);
      b.markers!.push({ id: uid(), name: title, cardId: box.id, x: 0, y: 0, zoom: 1 });
      if (previous) arrow(b, previous, box, ['r', 'l'], { color: 'gray', dashed: true, label: 'Press ⌘→', localizeKeys: true });
      previous = box;
      nextX += w + GAP;
      return box;
    };
    /**
     * The board's last stop, below the final section: where to go next, with
     * the switch-board keys as a big keycap.
     */
    const finish = (heading: string, hint: string) => {
      const last = previous!;
      const w = 620;
      const box = frame(b, Math.round(last.x + (last.width - w) / 2), (last.height ?? 0) + 300, w, 250, 'Up next', 'purple');
      b.markers!.push({ id: uid(), name: 'Up next', cardId: box.id, x: 0, y: 0, zoom: 1 });
      arrow(b, last, box, ['b', 't'], { color: 'gray', dashed: true, label: 'Press ⌘→', localizeKeys: true });
      note(b, box, 40, 64, heading, { color: 'none', size: 'l', bold: true, w: 540 });
      note(b, box, 40, 126, '⌘⇧↓', { color: 'black', font: 'mono', size: 'xl', align: 'center', w: 270 });
      note(b, box, 340, 138, hint, { color: 'none', w: 240 });
    };
    return Object.assign(add, { finish });
  };

  const note = (b: Board, box: Card, dx: number, dy: number, text: string, opts: Partial<NoteData> & { w?: number } = {}) => {
    const { w = 300, ...style } = opts;
    // Shortcuts are written Mac-style; localizeKeys shows them as Ctrl/Shift/... on
    // Windows and Linux when drawn, wherever the board was created.
    const card: NoteCard = {
      ...base(b, box.x + dx, box.y + dy, w),
      type: 'note',
      data: { text, color: 'yellow', localizeKeys: true, ...style },
    };
    data.cards.push(card);
    return card;
  };

  // ------------------------------------------------------------ 1 · Start here
  {
    const b = board('Tour 1 · Start here', { pattern: 'graph', color: 'blueprint' });
    const section = sections(b);

    const welcome = section(800, 380, 'Welcome', 'purple');
    note(b, welcome, 40, 64, 'Welcome to CodeBoard', { color: 'none', size: 'xl', bold: true, w: 700 });
    note(
      b,
      welcome,
      40,
      130,
      "A calm canvas for everything that comes up while you code with an agent: screenshots, snippets, links, and the edge cases you'll come back to.",
      { color: 'none', w: 700 },
    );
    note(b, welcome, 40, 230, 'Press ⌘→ to go to the next box. Press ⌘← to go back.', { font: 'hand', w: 330 });
    note(b, welcome, 420, 230, 'These tour boards are yours to play with. To delete one, hover it in the sidebar and click ×.', {
      color: 'blue',
      w: 340,
    });

    const paste = section(1000, 770, 'Paste anything', 'blue');
    note(b, paste, 40, 70, 'Press ⌘⇧⌃4 to snip part of your screen, then press ⌘V here. It becomes an image card.', { w: 290 });
    data.cards.push({ ...base(b, paste.x + 370, 70, 590), type: 'code', data: { code: SAMPLE_CODE, language: 'typescript' } });
    note(b, paste, 40, 250, 'Copy a link and press ⌘V. It becomes a preview card; GitHub PRs and issues show their status.', {
      color: 'green',
      w: 290,
    });
    note(b, paste, 40, 430, 'Drag images, SVGs or code files from Finder onto the board.', { color: 'pink', w: 290 });
    data.cards.push({ ...base(b, paste.x + 370, 390, 320), type: 'link', data: { url: 'https://github.com/xyflow/xyflow', status: 'loading' } });
    note(b, paste, 720, 390, 'Copy a ``` fenced block from a chat and press ⌘V. It keeps its language.', { color: 'gray', w: 240 });

    const around = section(800, 390, 'Get around', 'green');
    note(b, around, 40, 70, 'Scroll or swipe with two fingers to pan. Pinch, or hold ⌘ and scroll, to zoom.', { w: 340 });
    note(b, around, 420, 70, 'Drag on empty space to select. Press ⌫ to delete. Press ⇧1 to fit everything on screen.', { w: 340 });
    note(b, around, 40, 240, 'Press G, then move the cursor toward any edge: the board glides that way. Press Esc to stop.', {
      color: 'purple',
      w: 340,
    });
    note(b, around, 420, 240, 'Click − and + in the bottom-left corner to zoom, and the map button to show the minimap.', {
      color: 'gray',
      w: 340,
    });

    const find = section(780, 200, 'Find things', 'orange');
    note(b, find, 40, 70, 'Press ⌘K and type to search every note, snippet, link and box.', { color: 'blue', w: 330 });
    note(b, find, 410, 70, 'Press ⌘⇧↑ or ⌘⇧↓ to switch to the previous or next board.', { color: 'green', w: 330 });

    section.finish('Up next: Notes, boxes, arrows', 'Press it to switch to the next board.');
  }

  // ------------------------------------------------------------ 2 · Notes, boxes, arrows
  {
    const b = board('Tour 2 · Notes, boxes, arrows', { pattern: 'ruled', color: 'paper' });
    const section = sections(b);

    const notes = section(1000, 525, 'Notes', 'gray');
    note(
      b,
      notes,
      40,
      64,
      'Press N for a sticky note or T for free text, or double-click empty canvas. Click a note, then pick its colour, font, size and alignment in the toolbar above it. You can style it before you type.',
      { color: 'none', w: 900 },
    );
    (['yellow', 'orange', 'pink', 'purple', 'blue', 'green', 'gray', 'black'] as const).forEach((color, i) =>
      note(b, notes, 40 + i * 115, 180, color[0].toUpperCase() + color.slice(1), { color, size: 's', w: 105 }),
    );
    note(b, notes, 40, 290, 'Sans, for everyday notes', { font: 'sans', w: 210 });
    note(b, notes, 270, 290, 'Serif, for reading', { font: 'serif', w: 210 });
    note(b, notes, 500, 290, 'Mono, for ids and paths', { font: 'mono', w: 210 });
    note(b, notes, 730, 290, 'Hand, for quick thoughts', { font: 'hand', w: 210 });
    note(b, notes, 40, 440, 'Small', { color: 'none', size: 's', w: 110 });
    note(b, notes, 170, 432, 'Medium', { color: 'none', size: 'm', w: 140 });
    note(b, notes, 330, 422, 'Large', { color: 'none', size: 'l', w: 170 });
    note(b, notes, 520, 412, 'Huge', { color: 'none', size: 'xl', bold: true, w: 220 });
    note(b, notes, 780, 430, 'Left, centre or right', { color: 'none', align: 'right', w: 180 });

    const boxes = section(860, 445, 'Boxes', 'blue');
    const inner = frame(b, boxes.x + 40, 70, 440, 325, 'Drag me by my title', 'purple');
    note(b, inner, 30, 70, 'Drag the purple title to move this box. Everything inside comes along.', { w: 220 });
    note(b, inner, 270, 70, 'Even this one.', { color: 'pink', w: 140 });
    note(b, inner, 30, 230, 'Click empty space inside a box to select it, then drag a corner to resize.', { color: 'none', size: 's', w: 380 });
    note(b, boxes, 520, 70, 'Select a few cards, then press F (or ⌘G) to draw a box around them.', { color: 'green', w: 300 });
    note(b, boxes, 520, 240, 'Click a box, then click the bookmark in its toolbar to make it a marker.', { color: 'gray', w: 300 });

    const arrows = section(980, 545, 'Arrows', 'green');
    const idea = note(b, arrows, 40, 100, 'Idea', { w: 200 });
    const proto = note(b, arrows, 390, 100, 'Prototype', { color: 'blue', w: 200 });
    const ship = note(b, arrows, 740, 100, 'Ship it', { color: 'green', w: 200 });
    const edge = note(b, arrows, 390, 280, 'Edge case', { color: 'pink', w: 200 });
    arrow(b, idea, proto, ['r', 'l']);
    arrow(b, proto, ship, ['r', 'l'], { path: 'straight' });
    arrow(b, proto, edge, ['b', 't'], { path: 'step', dashed: true, color: 'pink', label: 'found' });
    arrow(b, edge, ship, ['r', 'b'], { color: 'orange', arrows: 'both' });
    note(b, arrows, 40, 410, 'Hover a card and drag from a dot on its edge onto another card. Let go on empty space to get a new connected note.', {
      color: 'none',
      w: 430,
    });
    note(b, arrows, 510, 410, 'Click an arrow to change its colour, shape and label. Then drag either end onto another card.', {
      color: 'none',
      w: 430,
    });

    section.finish('Up next: Get organised', 'Press it to switch to the next board.');
  }

  // ------------------------------------------------------------ 3 · Get organised
  {
    const b = board('Tour 3 · Get organised', { pattern: 'iso', color: 'chalk' });
    const section = sections(b);

    const markers = section(800, 220, 'Markers', 'orange');
    note(b, markers, 40, 70, "Press M to mark what's on screen. Click the bookmark in a box's toolbar to mark that box.", { w: 340 });
    note(b, markers, 420, 70, 'Press ⌘→ and ⌘← (or ⌘↓ ⌘↑) to glide between markers. Click the bar at the top to rename or remove them.', {
      color: 'blue',
      w: 340,
    });

    const wheel = section(780, 220, 'The wheel', 'purple');
    note(b, wheel, 40, 70, 'Click empty canvas, outside any box, to open the wheel.', { color: 'purple', w: 330 });
    note(b, wheel, 410, 70, 'Move the cursor toward an option and click, or press its letter: N, T, C, L, I, F, M or G.', { w: 330 });

    const clip = section(800, 220, 'Cut, copy, paste', 'green');
    note(b, clip, 40, 70, 'Select some cards and press ⌘X or ⌘C. Press ⌘⇧↓ to switch boards, then press ⌘V.', { color: 'green', w: 340 });
    note(b, clip, 420, 70, 'The text lands on your clipboard too, so ⌘V in a chat pastes it.', { color: 'gray', w: 340 });

    const esc = section(540, 200, 'Esc', 'gray');
    note(b, esc, 40, 70, 'Press Esc to get out of anything: a text field, glide, the wheel, a menu, or the selection.', {
      color: 'black',
      w: 460,
    });

    section.finish('Up next: Make it yours', 'Press it to switch to the next board.');
  }

  // ------------------------------------------------------------ 4 · Make it yours
  {
    const b = board('Tour 4 · Make it yours', { pattern: 'graph', color: 'sage' });
    const section = sections(b);

    const bg = section(800, 220, 'Backgrounds', 'blue');
    note(b, bg, 40, 70, "Click the palette button in the top-right corner to pick this board's pattern and colour.", { w: 340 });
    note(b, bg, 420, 70, 'Every tour board has its own look: Blueprint, a Paper notebook, Chalkboard, and Math paper on Sage here.', {
      color: 'blue',
      w: 340,
    });

    const images = section(880, 390, 'Images', 'purple');
    const blobId = uid();
    data.blobs.push({ id: blobId, blob: new Blob([SAMPLE_IMAGE], { type: 'image/svg+xml' }) });
    data.cards.push({
      ...base(b, images.x + 50, 100, 320),
      type: 'image',
      rotation: 352,
      data: { blobId, naturalWidth: 480, naturalHeight: 360, name: 'sample.svg' },
    });
    note(b, images, 440, 70, 'Click the image, then drag the round handle above it to rotate. Hold ⇧ to snap to 15°. Double-click the handle to reset.', {
      color: 'pink',
      w: 400,
    });
    note(b, images, 440, 250, "Click the copy button in an image's toolbar to copy it back out, ready to paste anywhere.", {
      color: 'green',
      w: 400,
    });

    const pins = section(1000, 500, 'Pinterest pins', 'pink');
    const pin = (dx: number, w: number, svg: string, nw: number, nh: number, rotation?: number) => {
      const blobId = uid();
      data.blobs.push({ id: blobId, blob: new Blob([svg], { type: 'image/svg+xml' }) });
      const card: LinkCard = {
        ...base(b, pins.x + dx, 80, w),
        type: 'link',
        rotation,
        data: {
          url: 'https://www.pinterest.com/',
          status: 'ok',
          version: PREVIEW_VERSION,
          imageBlobId: blobId,
          preview: {
            title: 'Sample pin',
            siteName: 'Pinterest',
            display: 'image',
            image: `sample-pin-${nw}x${nh}.svg`,
            favicon: 'https://s.pinimg.com/webapp/pinterest_favicon-70db4fa7.svg',
          },
        },
      };
      data.cards.push(card);
    };
    pin(50, 220, PIN_TALL, 480, 640);
    pin(320, 220, PIN_SQUARE, 480, 480, 6);
    note(b, pins, 590, 70, 'Copy a pin link (pinterest.com/pin/… or pin.it/…) and press ⌘V. You get the whole picture, no text.', { w: 370 });
    note(b, pins, 590, 210, "Click the round badge in a pin's corner to open it. Double-clicking a pin does nothing, so it never opens by accident.", {
      color: 'gray',
      w: 370,
    });
    note(b, pins, 590, 350, "The lock in a pin's toolbar keeps its shape while you resize; click it to resize freely. Rotate pins with the round handle.", {
      color: 'pink',
      w: 370,
    });

    const big = section(560, 200, 'Big boards', 'gray');
    note(b, big, 40, 70, 'Click Settings at the bottom of the sidebar and turn on Load nearby only to keep huge boards fast.', {
      color: 'gray',
      w: 480,
    });

    const done = section(660, 220, 'All yours', 'orange');
    note(b, done, 40, 70, 'Hover a tour board in the sidebar and click × to delete it. Settings → Refresh tour boards brings them back.', {
      font: 'hand',
      size: 'l',
      w: 580,
    });

    section.finish("That's the tour", 'Press it to go to your own boards.');
  }

  return data;
}
