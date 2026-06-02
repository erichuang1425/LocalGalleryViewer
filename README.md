# Gallery — Local Folder Reader

Browse any local folder as a visual gallery — **100% in your browser, nothing
uploaded.** Each subfolder becomes a card with an auto-generated cover; click
into media to read it as a vertical scroll or page by page.

No server. No build step. No dependencies. Just three files.

## Requirements

- **Chrome or Edge** — the app uses the [File System Access API][fsa]
  (`showDirectoryPicker`), which Firefox and Safari do not yet support. A
  fallback for those browsers is planned (see [Roadmap](#roadmap)).

[fsa]: https://developer.mozilla.org/docs/Web/API/File_System_API

## Run it

1. Keep `index.html`, `app.js`, and `styles.css` together in the same folder.
2. Open `index.html` in Chrome or Edge.
3. Click **Choose a folder** and pick any directory — internal or external drive.
4. Click a card's cover to view its media, or the `›` button to go inside.

That's it. There is nothing to install and no server to start.

## Features

- **Folder grid** with lazily-generated, IndexedDB-cached cover thumbnails
  (images and videos).
- **Two reading modes** — vertical *scroll* (windowed for flat memory use) and
  *paged* (one item at a time) — plus an auto-advancing **slideshow**.
- **Recent folders** for one-click reopening (Chrome/Edge).
- **Preferences** (persisted): card density, reading width, sort order
  (name ↑ / name ↓ / shuffle), and snap scrolling.
- **Thumbnail cache** stored locally in IndexedDB so reopening a drive is
  instant; clearable from Settings.

## Keyboard shortcuts

| Key            | Action                                   |
| -------------- | ---------------------------------------- |
| `Esc`          | Close the reader / settings              |
| `Backspace`    | Go up one folder                         |
| `← / →`        | Previous / next item (paged mode)        |
| `Space`        | Next (paged) · scroll down (scroll mode) |
| `Home / End`   | First / last item                        |
| `m`            | Toggle scroll / paged mode               |
| `s`            | Toggle slideshow                         |

Planned additions (`f` fullscreen, `i` image info) are described in the
[Roadmap](#roadmap).

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

A detailed, reasoned improvement plan — covering mixed-content folder
navigation, robustness, accessibility, new viewer features, and a
Firefox/Safari fallback — lives in **[IMPROVEMENTS.md](./IMPROVEMENTS.md)**.
