# CodeBoard

A lightweight, local-first mood board for coding context. When an agent mentions an edge case mid-explanation, paste it here instead of opening a side chat or forgetting it.

## Run

```bash
npm install
npm run dev          # http://localhost:5173
```

Production build (serves `dist/` and the preview API on 127.0.0.1:4173):

```bash
npm run build && npm start
```

### Private GitHub links

Without a token, GitHub's API allows 60 requests/hour and can't see private repos (those cards fall back to `owner/repo · PR #3`). To use your GitHub CLI login:

```bash
npm run dev:github     # or: npm run build && npm run start:github
```

This passes `gh auth token` to the local server only; it's used for `api.github.com` requests and nothing else.

### Link previews

Previews are fetched by the local server, and the preview image is saved into IndexedDB with the card, so cards keep their image even if the site later rate-limits, blocks hotlinking or deletes it. Stack Overflow and npm use their public APIs (their pages block bots). Sites that block servers entirely (e.g. Medium) get a basic card titled from the URL.

## Tour boards

New installs start with four tour boards built from real cards, listed in their own **Tour** section of the sidebar; each section of a board is a marker, so `⌘→` steps through it. In Sidebar → Settings:

- **Show tour boards** hides them everywhere (sidebar, board switching, search) without deleting anything.
- **Refresh tour boards** resets them to their original state and brings back any you deleted. Your own boards are never touched.

## Using it

Shortcuts are written for Mac below. On Windows and Linux the app shows them with Ctrl, Shift and Backspace instead (⌘ → Ctrl, ⇧ → Shift, ⌫ → Backspace; screenshots are Win+Shift+S), and the same keys work.

| Action | How |
| --- | --- |
| Add anything | `⌘V` anywhere on the canvas. Lands under the cursor. |
| Screenshot | Snip to clipboard (`⌘⇧⌃4` on macOS), then `⌘V` |
| Pinterest | Pin links (`pinterest.com/pin/…` or `pin.it/…`) show as the full image with a small Pinterest badge in the corner that opens the pin. The lock button keeps the aspect ratio while resizing (on by default) |
| Rotate images | Select an image or Pinterest card: drag the round handle above it (snaps to straight angles; Shift = 15° steps; double-click resets), or use the Rotate 90° button |
| SVG | Drop/paste an `.svg` file, or paste SVG markup (e.g. Figma's "Copy as SVG"); it becomes an image card |
| Code | Paste code or a ```` ``` ```` fenced block. Language is auto-detected; change it in the card header |
| Link | Paste a URL (or several, one per line). Preview loads automatically; GitHub PRs/issues show open/merged/closed |
| Wheel | Click empty canvas outside any box (with nothing selected) for a radial menu: note, text, code, link, image, box, marker, glide. Point towards an option and click, or press its letter |
| Note / text / code | `N` / `T` / `C`, the dock, the wheel, or double-click empty canvas for a note |
| Note style | Select a note: colour (or none, for free text), font (sans, serif, mono, handwritten), size, bold, alignment (left/centre/right) |
| Box | `F` or `⌘G` wraps the selected cards in a translucent box; with nothing selected, adds an empty one. Click anywhere inside it to select and resize it; drag it by its title (or its edge) and its cards come along. Clear the title to hide it |
| Arrow | Hover a card, drag from a dot on its edge to another card's dot, or anywhere on the card (it attaches to the side nearest where you let go), or to empty space to create a connected note. Select an arrow to change colour, curve/straight/elbow, dashes, arrowheads, label, or drag either end onto another card to re-attach it |
| Markers | `M` marks the current view; the bookmark button on a box marks that box. `⌘←`/`⌘→` (or `⌘↑`/`⌘↓`) glide between markers; the bar at the top lists, renames and removes them |
| Background | Palette button (top right): dots, grid, math paper, notebook, isometric, crosses, blank; 10 canvas colours plus custom |
| Glide | `G`, the dock or the wheel: move the cursor towards any edge and the board travels that way (faster near the edge) |
| Escape | Leaves whatever you're in: glide, the wheel, a text field, menus, the selection |
| Navigate | Scroll/trackpad pans · pinch or `⌘`+scroll zooms · space-drag pans · `⇧1` fits everything |
| Select | Drag on empty canvas (boxes are included only when fully inside the drag) · `⌘`-click to add · `⌫` deletes |
| Cut / copy / paste | `⌘X` / `⌘C` the selection (a selected box brings everything inside it, arrows between copied cards come too), then `⌘V` at the cursor, on this or any board. The system clipboard also gets a plain-text version for pasting into chats |
| Switch boards | `⌘⇧↑` / `⌘⇧↓` go to the previous / next board in the sidebar (wraps around) |
| Search | `⌘K` searches every board |
| Sidebar | `⌘\` hides/shows it |
| Large boards | Sidebar → Settings → **Load nearby only**: images, link previews and code only load within ½, 1 or 2 screens of the view (and further ahead while gliding); far cards show a light placeholder |

Everything is stored in your browser's IndexedDB. There's no account and no cloud. Clearing site data for localhost deletes your boards.

## Layout

```
src/
  App.tsx            boards, active board, ⌘K
  Canvas.tsx         React Flow canvas: paste/drop, placement, persistence
  Sidebar.tsx        board list (create, rename, delete)
  SearchPalette.tsx  cross-board search
  db.ts              Dexie schema: boards, cards, image blobs
  cards/             one component per card type + shared frame/toolbar
  lib/classify.ts    decides what a paste is (image / link / code / note)
  lib/code.ts        highlight.js setup and language detection
server/
  preview.ts         POST /api/preview: fetches Open Graph/GitHub metadata
  index.ts           production static server
```
