# Gallery — Local Folder Reader

Browse any local folder as a visual gallery — **100% in your browser, nothing
uploaded.** Each subfolder becomes a card with an auto-generated cover; click
into media to read it as a vertical scroll or page by page.

No server. No build step. No dependencies. Just three files.

## Requirements

- **Chrome or Edge recommended** — the app uses the [File System Access API][fsa]
  (`showDirectoryPicker`) for lazy reads and one-click **recent folders**.
- **Firefox and Safari** are supported through a `<input webkitdirectory>`
  fallback. The picked folder is read up front (higher memory) and recent
  folders are unavailable, but browsing, reading, and thumbnails all work.

[fsa]: https://developer.mozilla.org/docs/Web/API/File_System_API

## Run it

1. Keep `index.html`, `app.js`, and `styles.css` together in the same folder.
2. Open `index.html` in Chrome or Edge.
3. Click **Choose a folder** and pick any directory — internal or external drive.
4. Click a card's cover to view its media, or the `›` button to go inside.

That's it. There is nothing to install and no server to start.

## Features

- **Mixed-content grid** — a folder shows **both** subfolder cards **and**
  per-file media cards (folders first, then files). Clicking a media card opens
  the reader at that exact item; folder cards enter when they contain subfolders.
- **Folder grid** with lazily-generated, IndexedDB-cached cover thumbnails
  (images and videos), EXIF-auto-oriented so phone photos match the reader.
- **Open by drag-and-drop** — drop a folder onto the window to open it
  (Chrome/Edge), in addition to the picker button and recent-folder chips.
- **Two reading modes** — vertical *scroll* (windowed for flat memory use) and
  *paged* (one item at a time) — plus an auto-advancing **slideshow** with a
  configurable interval and a **screen wake lock** so the display stays on.
- **Reader extras** — fullscreen, an image-info overlay (name · dimensions ·
  size), and a one-click download of the current item.
- **Recent folders** for one-click reopening (Chrome/Edge).
- **Accessible** — keyboard-reachable cards with **arrow-key grid navigation**
  (roving tabindex), ARIA-labelled controls, focus trapping in the reader and
  settings drawer, a visible focus ring, and live-region folder announcements.
- **Preferences** (persisted): card density, reading width, sort order
  (name ↑ / name ↓ / date / size / shuffle), snap scrolling, slideshow interval,
  and a default reading mode (auto / scroll / pages).
- **Thumbnail cache** stored locally in IndexedDB so reopening a drive is
  instant — bounded with LRU eviction so it never grows without limit; clearable
  from Settings.

## Keyboard shortcuts

| Key            | Action                                   |
| -------------- | ---------------------------------------- |
| `Esc`          | Close the reader / settings              |
| `← ↑ → ↓`      | Move between cards in the grid           |
| `Home / End`   | First / last card in the grid            |
| `Enter / Space`| Open the focused card                    |
| `Backspace`    | Go up one folder                         |
| `← / →`        | Previous / next item (paged mode)        |
| `Space`        | Next (paged) · scroll down (scroll mode) |
| `Home / End`   | First / last item                        |
| `m`            | Toggle scroll / paged mode               |
| `s`            | Toggle slideshow                         |
| `f`            | Toggle fullscreen                        |
| `i`            | Toggle image-info overlay (paged mode)   |

## Privacy

Everything runs on your machine. No file contents, thumbnails, or folder names
are ever uploaded. Cover thumbnails are cached locally in your browser's
IndexedDB and can be cleared at any time from **Settings → Thumbnail cache**.

## Architecture

- **Three files**: `index.html` (markup), `styles.css` (styling), `app.js`
  (all logic, wrapped in a single IIFE).
- **Node model**: navigation items are `{ name, handle }` objects where `handle`
  is a File System Access API handle. This is the seam every feature builds on.
- **Read queue**: file reads are throttled (`READ_MAX`) to stay kind to slow or
  external disks.
- **Windowed scroll**: only items near the viewport are loaded; far ones are
  unloaded so memory stays flat.
- **Caches**: a `WeakMap` for directory listings and IndexedDB for thumbnails
  and recent folders.

## Roadmap

The reasoned improvement plan lives in **[IMPROVEMENTS.md](./IMPROVEMENTS.md)**.
Both rounds are now **shipped**: mixed-content navigation, robustness,
accessibility, viewer features, and the Firefox/Safari fallback, plus the
second round's **robustness & correctness** (bounded thumbnail cache,
EXIF-correct thumbnails, sort by date/size), **navigation & input**
(drag-and-drop a folder, keyboard grid navigation), and **quality-of-life
polish** (wake lock during slideshow, persisted reading mode, live-region
announcements). **Zoom / pan on paged images** and a **shortcut-help overlay**
remain deferred.
