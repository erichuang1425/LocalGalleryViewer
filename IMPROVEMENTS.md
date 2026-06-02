# Improvements Roadmap

This document is the reasoned plan for evolving Gallery while preserving its
defining qualities: **no build step, no dependencies, three files, Chrome/Edge
first.** It is a map for implementers — every item cites the exact
`file:line` it touches so the work can be picked up without re-deriving context.

> **History:** the original roadmap (mixed-content navigation, robustness,
> accessibility, viewer features 4.1–4.4, and the Firefox/Safari fallback) is
> **shipped**. This is the *next* round, focused on robustness/correctness,
> navigation/input, and quality-of-life polish.

## The central design fact

Every navigation item is a `{ name, handle }` object where `handle` exposes
`getFile()`, `values()`, and `isSameEntry()`. Every consumer relies on this:
`getURL` (`app.js:111`), `thumbURL` (`app.js:154`), `findCover` (`app.js:99`),
and `listing` (`app.js:86`). **Most changes flow through this single seam** —
route new work through it and downstream code stays untouched. That principle is
what kept the first roadmap low-risk; it still applies here.

Implementation order at a glance:

1. Robustness / correctness (cheap, high-value, low-risk).
2. Navigation & input (additive; the grid-keyboard pattern needs care).
3. Quality-of-life polish (small, independent wins).

---

## A. Robustness & correctness

### A1. Bounded thumbnail cache — size cap + LRU eviction

**Problem.** `thumbURL` (`app.js:154-165`) writes every generated thumbnail blob
into the IndexedDB `thumbs` store (`idbPut`, `app.js:161`) and **never evicts**.
Browsing a large drive grows the cache without bound until the browser reclaims
it unpredictably.

**Design.** Change the stored record from a bare `Blob` to
`{ blob, bytes, atime }`:

- Read path (`app.js:158`): `const rec = await idbGet("thumbs", key)…; blob = rec && rec.blob`.
- `cacheStats` (`app.js:82`, today reads `c.value.size`) → read `c.value.bytes`.
- Write path (`app.js:161`): store `{ blob, bytes: blob.size, atime: Date.now() }`.
- On a cache **hit**, bump `atime` (debounced — never one write per scrolled
  card).
- Add `const THUMB_CACHE_MAX` (a byte budget, e.g. ~80 MB, and/or a count cap).
  An opportunistic `evict()` — run on DB open and after a batch of puts — cursors
  the store (reuse the `cacheStats` cursor pattern, `app.js:81-82`), and when over
  budget deletes oldest-`atime` records until back under.

`clearCache` (`app.js:83`) is unchanged. The record-shape change invalidates the
existing cache; that's acceptable (regenerable, and Clear cache already exists).

**Effort: S–M · Risk: L.**

### A2. EXIF auto-orientation in canvas thumbnails

**Problem.** `imgThumb` (`app.js:125-137`) builds thumbnails with
`createImageBitmap(file, …)` (`app.js:128-129`), which **ignores EXIF
orientation** by default. The full-resolution reader `<img>` auto-orients, so
phone photos render **sideways in the grid but upright in the reader** — a
visible, confusing mismatch.

**Design.** Pass `imageOrientation:"from-image"` in **both** `createImageBitmap`
option objects — the resized call (`app.js:128`) and the bare fallback
(`app.js:129`). The downstream dimension math (`app.js:130`) then operates on the
already-oriented `bmp.width/height`, so nothing else changes. Browsers that
don't support the option ignore it (graceful). The SVG branch (`app.js:156`) and
`videoThumb` (`app.js:138-151`) are unaffected.

**Effort: S · Risk: L.** (Invalidating old, mis-oriented cached thumbs pairs
naturally with A1's record-shape bump.)

### A3. Sort by date-modified / size

**Problem.** `sorted()` (`app.js:57-63`) supports only name ↑ / name ↓ / shuffle
(default `prefs.sort:"name"`, `app.js:38`; control `segSort`,
`index.html:69-70`). There is no chronological or size ordering.

**Design — the subtle item, because name sort is synchronous while date/size
need async file metadata.** `lastModified` and `size` come from
`handle.getFile()`, a cheap metadata read (per the comment at `app.js:155`).

- Add `date` (newest-first) and `size` (largest-first) buttons to `segSort`
  (`index.html:70`).
- Keep **directories name-sorted always** — they have no single mtime and already
  render folders-first (`app.js:274-276`). Date/size reorders only the **files**
  group.
- When `prefs.sort ∈ {date,size}`, `render()` (before building the grid at
  `app.js:266`) runs a throttled metadata pass (`schedule`, `app.js:67`) that
  caches `node._meta = { mtime, size }`, then sorts the files array by it.
  `openReader` (`app.js:374`) keeps consuming the already-ordered array, so the
  reader sequence matches the grid.

**Effort: M · Risk: L–M** (the async-metadata-before-render seam is the careful
part; everything downstream is unchanged).

---

## B. Navigation & input

### B1. Drag-and-drop a folder to open

**Problem.** Opening is only via the button → `pick()` (`app.js:230-234`,
`showDirectoryPicker`) or a recent-folder chip. No drag-and-drop.

**Design (Chrome/Edge primary path).** Add `dragover`/`drop` listeners on
`#intro` (`index.html:24`) and `#main` (`index.html:35`):

- `dragover` must `preventDefault()` to allow a drop, and toggles a `.dragover`
  affordance ("Drop a folder to open").
- `drop` takes the first `DataTransferItem.getAsFileSystemHandle()`; if
  `kind === "directory"`, set `root = handle`, `await addRecent(handle)`,
  `launch()` (`app.js:240`). This reuses the exact pick path — **zero downstream
  change** thanks to the `{ name, handle }` seam.
- FALLBACK browsers (`app.js:26`, no `getAsFileSystemHandle`): drag-drop is a
  no-op (optionally a toast pointing at the picker button). Document this.

Add a small `.dragover` style in `styles.css`.

**Effort: S–M · Risk: L.**

### B2. Roving-tabindex arrow-key grid navigation

**Problem.** Cards are `role="button" tabindex="0"` with an Enter/Space handler
(`app.js:308-310`), so Tab steps through **every** card — tedious on large grids
and not the expected grid accessibility pattern.

**Design — roving tabindex.** Exactly one card carries `tabindex=0`; the rest
`tabindex=-1`. Arrow keys move focus (left/right within a row, up/down across
rows using a column count derived from the grid layout), Home/End jump to the
first/last **visible** card.

- Initialize in the `render()` card loop (`app.js:280-312`): first card
  `tabindex=0`, others `-1`.
- Delegate an Arrow/Home/End keydown handler on the `.grid` container; on a
  card's `focus`, make it the roving target.
- Skip `.hide` cards so it respects the live filter (`filterCards`,
  `app.js:365-368`). The existing Enter/Space handler (`app.js:310`) stays.

**Effort: M · Risk: L.**

---

## C. Quality-of-life polish

### C1. Screen Wake Lock during slideshow

**Problem.** A running slideshow (`startSlide`, `app.js:496`) lets the display
sleep.

**Design.** Guard with `"wakeLock" in navigator`; on `startSlide` request
`navigator.wakeLock.request("screen")` and stash the sentinel; release it in
`stopSlide` (`app.js:497`). Wake locks auto-release when the tab hides — and the
slideshow already stops on `visibilitychange` hidden (`app.js:603`) — so no
re-acquire bookkeeping is needed. Wrap in try/catch (the request rejects on some
surfaces).

**Effort: S · Risk: L.**

### C2. Persisted default reading mode

**Problem.** Entry points hardcode the mode: a file card opens `"paged"`
(`app.js:304`); a whole-folder album opens `"scroll"` via `openReader`
(`app.js:374`). Users who always prefer one mode can't set it.

**Design.** Add `prefs.readerMode` with default `"auto"` (today's contextual
behavior) to the prefs object (`app.js:38`); add a `segReaderMode` control to the
settings drawer (`index.html:63-78`), wired via the existing `bindSeg`
(`app.js:531`) and reflected by `markSeg`/`applyPrefs` (`app.js:42-56`). Resolve
it in `openReaderAt` (`app.js:385`): `auto` keeps the passed mode;
`scroll`/`paged` override it.

**Effort: S · Risk: L.**

### C3. Live-region announcement on navigation

**Problem.** Folder changes update the breadcrumb (`crumbs()`, `app.js:245-251`)
but nothing announces the new folder or its contents to screen-reader users.

**Design.** Add a visually-hidden `aria-live="polite"` element (`#srStatus`, with
a `.sr-only` class in `styles.css`) to `index.html`. At the end of `render()`
(after the grid is appended, `app.js:313`) set its text, e.g.
`"<folder> — N folders, M files"` — the counts are already in hand from
`data.dirs` / `data.files` (`app.js:266`). Scope: grid navigation only.

**Effort: S · Risk: L.**

---

## Deferred (out of scope this round)

- **Zoom / pan on paged images** — CSS-transform zoom driven by wheel + pinch +
  double-tap + drag. **Conflicts** with swipe-to-navigate (`app.js:599-601`), the
  left/right click zones (`index.html:54-55`), and `touch-action:pan-y`
  (`styles.css:128`); navigation must be disabled while zoomed. **L · M–H.**
- **`?` keyboard-shortcut help overlay** — a discoverability layer over the
  existing shortcuts (`app.js:576-597`). **S · L.**

---

## Summary table

| #  | Area                                 | Effort | Risk |
| -- | ------------------------------------ | ------ | ---- |
| A1 | Bounded thumbnail cache (LRU)        | S–M    | L    |
| A2 | EXIF auto-orientation in thumbs      | S      | L    |
| A3 | Sort by date / size                  | M      | L–M  |
| B1 | Drag-and-drop folder to open         | S–M    | L    |
| B2 | Roving-tabindex grid navigation      | M      | L    |
| C1 | Wake Lock during slideshow           | S      | L    |
| C2 | Persisted default reading mode       | S      | L    |
| C3 | Live-region navigation announcement  | S      | L    |
| —  | Zoom/pan · shortcut help (deferred)  | —      | —    |
