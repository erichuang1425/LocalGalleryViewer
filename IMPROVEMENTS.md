# Improvements Roadmap

This document is the reasoned plan for evolving Gallery while preserving its
defining qualities: **no build step, no dependencies, three files, Chrome/Edge
first.** It is a map for implementers — every item cites the exact
`file:line` it touches so the work can be picked up without re-deriving context.

## The central design fact

Every navigation item is a `{ name, handle }` object where `handle` exposes
`getFile()`, `values()`, and `isSameEntry()`. Every consumer relies on this:
`getURL` (`app.js:94`), `thumbURL` (`app.js:126`), `findCover` (`app.js:85`),
and recents (`app.js:141`). **Most changes flow through this single seam** — get
the handle contract right and downstream code stays untouched.

Implementation order at a glance:

1. Robustness hardening (cheap, low-risk; provides helpers reused later).
2. Mixed-content navigation + the path-aware cache key.
3. Accessibility (applied once over the final card markup).
4. Viewer features (cheap wins first).
5. Browser-support fallback (validated last, against a finished UI).

---

## 1. Mixed-content navigation — highest priority

### Problem

When a folder contains **both** media files and subfolders, the interface does
not present its contents intuitively — it jumps straight to the media and the
sibling subfolders become hard to reach.

- `render()` (`app.js:173-211`) renders only `dirs` as cards and collapses any
  direct media into a single "▶ View them" banner (`app.js:185-190`). Media
  files are never individually browsable.
- `cardClick()` (`app.js:242-247`) on a subfolder card that holds both media and
  subfolders calls `openReader(info.files, …)` — it jumps into the reader, and
  the nested subfolders are reachable only via the small `›` enter button
  (`app.js:206`). The cover click effectively hides the folder's structure.

### Target behavior

A mixed folder's grid shows **both** folder cards **and** per-file media cards.
Clicking a media card opens the reader positioned at that exact item. Folder
cards keep entering folders.

### Design

- **Unify the grid model** in `render()` (`app.js:197-210`). Replace the
  dirs-only loop and the `.here` banner (`app.js:185-190`) with one list of
  typed entries:
  - folder entry → `{ type: "dir", node: d }`
  - file entry → `{ type: "file", node: f, index: k }`, where `index` is the
    file's position within `sorted(files)` so the reader can open at it.
  - Ordering: **folders first, then media files**, each group independently
    `sorted()` (`app.js:45-51`). Predictable, and avoids the "shuffle scatters
    folders among files" problem of interleaving.
- **Split `fillCard`** (`app.js:213-240`). File cards skip `listing` /
  `findCover` and call `thumbURL(node.handle)` directly — `thumbURL`
  (`app.js:126-134`) already handles image, video, and SVG. Reuse the same
  `.cover .img` insert path (`app.js:234-237`) and the `coverObs` lazy
  IntersectionObserver (`app.js:195`) so file thumbnails inherit read-queue
  throttling (`schedule` `app.js:55-56`) and IndexedDB caching for free. File
  card placeholder glyph: `🖼` / `🎞`; badge: a single extension/▶ chip.
- **Revise `cardClick` semantics** (`app.js:242-247`) — applies to folder cards:
  - subdirs present → `enter(d)` regardless of whether media also exists
    (**this fixes the bug**);
  - media-only (no subdirs) → `openReader(info.files, d.name)` (keep the leaf
    "album" shortcut);
  - empty → toast (`app.js:246`).
  Update `.open-hint` text (`app.js:226`): `enter ▸` when dirs present,
  `view ▸` when media-only.
- **New `openReaderAt(items, title, index)`** wrapping `openReader`
  (`app.js:256-262`). `openReader` hardcodes `i:0` (`app.js:257`); the new
  wrapper accepts a start index. Because `sorted()` re-sorts (and `shuffle`
  would invalidate a numeric index), **locate the clicked item post-sort by
  reference identity** (`R.items.indexOf(item)`). Open file-card launches in
  **paged** mode (the user clicked a specific image); whole-folder "view" keeps
  the **scroll** default.

### Trade-offs

Removes the `.here` banner (note in changelog). Folders-first ordering means all
folders precede media in a mixed folder — conventional and predictable. File
cards multiply object URLs, but `coverObs` + `schedule` throttling and
`coverUrls` revocation on re-render (`app.js:175`) already bound this.

**Effort: M–L · Risk: M** (central render/click/reader paths; the shuffle-index
interaction is the subtle part).

---

## 2. Robustness / quality — surgical

- **(a) Thumbnail cache-key collision.** `app.js:129` keys on
  `name|size|lastModified`, so two identically-sized files named `cover.jpg` in
  different folders collide. Thread the folder path:
  `thumbURL(fh, keyPrefix)` where `keyPrefix = stack.map(n => n.name).join("/")`,
  and key on `keyPrefix + "|" + name + "|" + size + "|" + lastModified`. Folds
  naturally into §1 (file cards already know the path). Invalidates the existing
  cache — acceptable; it's regenerable and `clearCache` exists (`app.js:71`).
- **(b) Guard preference parsing.** `JSON.parse(localStorage…)` at `app.js:28`
  throws on corrupt data and breaks the whole IIFE before anything renders. Wrap
  in try/catch → `{}`. Also defend `savePrefs` (`app.js:30`) against quota /
  private-mode failures.
- **(c) Optional debug logging.** Add
  `const DEBUG = /[?&]debug/.test(location.search); const dbg = (...a) => DEBUG && console.warn("[gallery]", ...a);`
  and replace the meaningful silent catches (`app.js:110, 131, 145, 229, 293`)
  with `dbg(...)`. Keep expected user-cancel catches quiet (e.g. the
  `showDirectoryPicker` abort at `app.js:150`). **Zero behavior change** without
  `?debug`.
- **(d) Extract a video-element factory.** The blocks at `app.js:296` and
  `app.js:318` differ only by `preload`/`autoplay`. Add
  `makeVideo({ autoplay = false, preload = "metadata" } = {})` and call it from
  both. Pure refactor.
- **(e) Image thumbnail timeout.** `videoThumb` has a 4s guard (`app.js:123`) but
  `imgThumb` (`app.js:99-111`) can hang on a pathological `createImageBitmap`.
  Wrap the `imgThumb(file)` call in `thumbURL` (`app.js:131`) in a timeout race
  (~8s — images can legitimately be large). On null the existing
  `if (!blob) return null` path (`app.js:132`) shows the placeholder.

**Effort: S–M · Risk: L** (only the cache-key threading needs care to reach all
`thumbURL` callers).

---

## 3. Accessibility

- **ARIA labels** on icon-only buttons: `#settingsBtn` (`index.html:20`),
  `#slide` (`index.html:46`), `#rclose` (`index.html:47`), `#navL`/`#navR`
  (`index.html:53,55`), and the JS-created `.enter` button (`app.js:204`). Add
  `aria-pressed` to the toggles, synced in `setMode` (`app.js:273-274`) and
  `startSlide`/`stopSlide` (`app.js:330-331`). Wrap the mode `.seg`
  (`index.html:43-44`) in `role="group" aria-label="Reading mode"`.
- **Keyboard-reachable cards.** Cards are `div.card` with `onclick` on `.cover`
  (`app.js:207`) — not focusable. Add `role="button"`, `tabindex="0"`, an
  `aria-label`, and an Enter/Space handler in the `render()` card loop
  (`app.js:199-208`). The `›` `.enter` button is already a real `<button>`.
- **Focus trap + restore — settings drawer.** In `openSettings`
  (`app.js:338-343`) record `document.activeElement` and move focus to `#sClose`;
  trap `Tab` within `#settings` while open; in `closeSettings` (`app.js:344`)
  restore focus. Escape already closes (`app.js:384`).
- **Focus trap + restore — reader.** Add `role="dialog" aria-modal="true"
  aria-labelledby="rtitle"` to `#reader` (`index.html:37`). Record/restore focus
  in `openReader`/`closeReader` (`app.js:256-269`); trap `Tab` in the global
  keydown handler (`app.js:383-398`). Mind the auto-hiding paged bar
  (`hidebar` `app.js:335`, `styles.css:103`) so focus never lands on a hidden
  control — reveal the bar on focus.
- **Visible focus ring.** `styles.css:41` uses `outline:none` and there is no
  global focus style. Add
  `:focus-visible{ outline:2px solid var(--accent); outline-offset:2px }` and
  override the bare `outline:none`. `:focus-visible` keeps the ring off for mouse
  users.
- **Contrast.** `--faint:#5d574e` on `--bg:#0c0b0a` (`styles.css:7,5`) is
  ~2.6:1 and **fails WCAG AA**; it is used for `.note`, `.empty`, and
  placeholders (`styles.css:62,89,40`). Bump toward `#736c62` and verify `--dim`
  for the 12px mono chips (`styles.css:81`). A token tweak in `:root`
  (`styles.css:4-13`) propagates everywhere.
- **Reduced motion.** Already handled globally (`styles.css:149`). Additionally
  consider not auto-starting the slideshow under `prefers-reduced-motion`.

**Effort: M · Risk: L** (additive; the subtle part is the focus trap vs the
auto-hiding paged bar).

---

## 4. Viewer features

Cheap, high-value wins first; the gesture-heavy one is deferred.

- **4.1 Configurable slideshow interval.** Replace the hardcoded `3500`
  (`app.js:330`). Add `prefs.slideMs` (default 3500) to the prefs object
  (`app.js:26-27`), use `+prefs.slideMs` in `startSlide`, add a segmented control
  in the settings drawer (`index.html:69` region) wired via the existing
  `bindSeg` (`app.js:345-350`) and reflected by `markSeg` in `applyPrefs`
  (`app.js:31-40`). **S · Very low risk.**
- **4.2 Fullscreen toggle.** Add a `.rbar` button (`index.html:38-48`) and an
  `f` key binding (`app.js:385-395`); call `#reader.requestFullscreen()` /
  `document.exitFullscreen()`, sync state on `fullscreenchange`. **Subtlety:**
  when `document.fullscreenElement` is set, `Esc` exits fullscreen (browser
  default) and must **not** also close the reader — guard the Escape branch
  (`app.js:387`). **S · L.**
- **4.3 Image-info overlay.** Add a `.rbar` toggle and an `i` key binding. Show
  `name · WxH · fmtBytes(size)` (reuse `fmtBytes` `app.js:17`) for `R.items[R.i]`
  in `showPage` (`app.js:312-325`); read dimensions from `naturalWidth` /
  `videoWidth` in the load callback (`app.js:321`). Paged mode only. **S–M · L.**
- **4.4 (optional) Download current item.** A `.rbar` button creating a
  temporary `<a download>` from the already-created object URL (`app.js:316`).
  "Reveal in folder" is not possible from the web sandbox. **S · Very low risk.**
- **4.5 (deferred) Zoom / pan on paged images.** CSS-transform zoom driven by
  wheel + drag + double-tap. **Conflicts** with swipe-to-navigate
  (`app.js:401-402`) and the left/right click zones (`index.html:51-52`,
  `styles.css:123-124`); navigation must be disabled while zoomed and
  `touch-action:pan-y` (`styles.css:119`) adjusted for pinch. **L · M–H — out of
  scope for this round.**

**Effort (4.1–4.4): S–M · Risk: L.**

---

## 5. Browser-support fallback (Firefox / Safari)

These browsers lack `showDirectoryPicker`; startup currently just disables
`#pick` (`app.js:407-415`). Add a fallback using
`<input type="file" webkitdirectory>`.

### Virtual-handle adapter

Make the rest of the app handle-agnostic instead of forking every consumer:

- On `change`, read the flat `FileList`; each `File` has a `webkitRelativePath`
  like `Root/sub/a.jpg`. Build a tree of virtual directory nodes keyed by path
  segments, filtering files with `isMedia` (`app.js:15`) on insert to match
  `listing` (`app.js:79`).
- Expose virtual handles that quack like the real API:
  - `VirtualFileHandle { kind:"file", name, getFile: async () => file }` — works
    unchanged with `getURL` (`app.js:94`) and `thumbURL` (`app.js:126`).
  - `VirtualDirHandle { kind:"directory", name, values: async function*() {…} }`
    yielding child virtual handles directly — matching how `listing` consumes
    entries at `app.js:77-79`.
- Build the tree **once** per pick so object identities are stable for the
  `dirCache` WeakMap (`app.js:23,75`). `findCover` (`app.js:85-93`) then recurses
  unchanged.
- Branch in `pick()` (`app.js:149-152`): real API path, or open the input and
  build the virtual root, then `launch()` (`app.js:158`).
- Gate everything with `const FALLBACK = !window.showDirectoryPicker;` near
  `app.js:20`.

### Limitations (document for users)

Virtual handles cannot be persisted (no durable `File`/permission model), so:

- **No recents and no permission re-grant** — disable `addRecent`
  (`app.js:141-146`), hide `#recents` (`app.js:412`, `index.html:31`), and adjust
  the intro note (`index.html:32`).
- `webkitdirectory` reads the whole subtree **eagerly**, materializing every
  `File` up front — higher memory than the lazy FS Access iteration (thumbnail
  generation is still throttled).
- Safari's `webkitdirectory` is historically quirky — test specifically.

**Why the adapter:** routing the fallback through the `{ name, handle }` seam
means **zero changes** to `listing`, `getURL`, `thumbURL`, `findCover`, the
reader, and the grid. The risk concentrates entirely in matching the
`values()`-yields-handles contract that `listing` expects (`app.js:77-79`).

**Effort: M · Risk: M.**

---

## Summary table

| # | Area                         | Effort | Risk |
| - | ---------------------------- | ------ | ---- |
| 1 | Mixed-content navigation     | M–L    | M    |
| 2 | Robustness / quality         | S–M    | L    |
| 3 | Accessibility                | M      | L    |
| 4 | Viewer features (4.1–4.4)    | S–M    | L    |
| 5 | Browser-support fallback     | M      | M    |
| — | Zoom / pan (4.5, deferred)   | L      | M–H  |
