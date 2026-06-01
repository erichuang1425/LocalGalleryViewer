/* ====================================================================
   Gallery — folder reader · logic  (plain script, no build / no server)
   ==================================================================== */
(function () {
  "use strict";

  const IMG = ["jpg","jpeg","png","gif","webp","avif","bmp","jfif","svg"];
  const VID = ["mp4","webm","mov","m4v","mkv","ogv","ogg"];
  const COVER_DEPTH = 4, DIR_SCAN_CAP = 12, THUMB = 480, READ_MAX = 4;

  const $ = s => document.querySelector(s);
  const ext = n => (n.split(".").pop() || "").toLowerCase();
  const isImg = n => IMG.includes(ext(n));
  const isVid = n => VID.includes(ext(n));
  const isMedia = n => isImg(n) || isVid(n);
  const natCmp = new Intl.Collator(undefined, { numeric:true, sensitivity:"base" }).compare;
  const fmtBytes = b => b < 1024 ? b + " B" : b < 1048576 ? (b/1024).toFixed(0) + " KB" : (b/1048576).toFixed(1) + " MB";
  const escapeHtml = s => s.replace(/[&<>"]/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;" }[c]));

  let root = null, stack = [], NAV_GEN = 0;
  const urls = new Map();          // reader full-res handle -> objectURL
  const coverUrls = new Set();     // grid thumb URLs (revoked on re-render)
  const dirCache = new WeakMap();  // dirHandle -> {dirs,files}

  /* ---------- preferences ---------- */
  const prefs = Object.assign(
    { density:"cozy", scrollWidth:"medium", sort:"name", snap:true },
    JSON.parse(localStorage.getItem("gallery.prefs") || "{}")
  );
  const savePrefs = () => localStorage.setItem("gallery.prefs", JSON.stringify(prefs));
  function applyPrefs() {
    const de = document.documentElement;
    de.style.setProperty("--card-min", { compact:"160px", cozy:"216px", large:"300px" }[prefs.density]);
    de.style.setProperty("--read-w",   { narrow:"720px", medium:"1000px", full:"100%" }[prefs.scrollWidth]);
    $("#scroll").style.scrollSnapType = prefs.snap ? "y proximity" : "none";
    markSeg("segDensity", prefs.density);
    markSeg("segWidth",   prefs.scrollWidth);
    markSeg("segSort",    prefs.sort);
    markSeg("segSnap",    prefs.snap ? "on" : "off");
  }
  function markSeg(id, val) {
    document.getElementById(id).querySelectorAll("button")
      .forEach(b => b.classList.toggle("act", b.dataset.v === val));
  }
  function sorted(arr) {
    const a = arr.slice();
    if (prefs.sort === "shuffle") { for (let i=a.length-1;i>0;i--){ const j=Math.random()*(i+1)|0; [a[i],a[j]]=[a[j],a[i]]; } return a; }
    a.sort((x,y) => natCmp(x.name, y.name));
    if (prefs.sort === "nameDesc") a.reverse();
    return a;
  }

  /* ---------- read queue (kind to slow / external disks) ---------- */
  let active = 0; const q = [];
  const schedule = fn => new Promise((res,rej) => { q.push({ fn,res,rej }); pump(); });
  function pump(){ while (active < READ_MAX && q.length){ const t = q.shift(); active++; t.fn().then(t.res,t.rej).finally(()=>{ active--; pump(); }); } }

  /* ---------- IndexedDB (thumb cache + recents) ---------- */
  let _db;
  function db(){ return _db || (_db = new Promise((res,rej) => {
    const r = indexedDB.open("gallery", 1);
    r.onupgradeneeded = () => { const d = r.result;
      if (!d.objectStoreNames.contains("thumbs")) d.createObjectStore("thumbs");
      if (!d.objectStoreNames.contains("meta"))   d.createObjectStore("meta"); };
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  })); }
  async function idbGet(store,k){ const d = await db(); return new Promise((res,rej)=>{ const rq=d.transaction(store).objectStore(store).get(k); rq.onsuccess=()=>res(rq.result); rq.onerror=()=>rej(rq.error); }); }
  async function idbPut(store,k,v){ const d = await db(); return new Promise((res,rej)=>{ const t=d.transaction(store,"readwrite"); t.objectStore(store).put(v,k); t.oncomplete=res; t.onerror=()=>rej(t.error); }); }
  async function cacheStats(){ const d = await db(); return new Promise(res=>{ let n=0,bytes=0; const cur=d.transaction("thumbs").objectStore("thumbs").openCursor();
    cur.onsuccess=e=>{ const c=e.target.result; if(c){ n++; if(c.value&&c.value.size) bytes+=c.value.size; c.continue(); } else res({n,bytes}); }; cur.onerror=()=>res({n,bytes}); }); }
  async function clearCache(){ const d = await db(); return new Promise(res=>{ const t=d.transaction("thumbs","readwrite"); t.objectStore("thumbs").clear(); t.oncomplete=res; t.onerror=res; }); }

  /* ---------- filesystem ---------- */
  async function listing(h){
    if (dirCache.has(h)) return dirCache.get(h);
    const dirs=[], files=[];
    for await (const e of h.values()){
      if (e.kind === "directory") dirs.push({ name:e.name, handle:e });
      else if (isMedia(e.name))   files.push({ name:e.name, handle:e });
    }
    dirs.sort((a,b)=>natCmp(a.name,b.name));
    files.sort((a,b)=>natCmp(a.name,b.name));
    const out = { dirs, files }; dirCache.set(h,out); return out;
  }
  async function findCover(h, depth=0){
    const { dirs, files } = await listing(h);
    const hit = files.find(f=>isImg(f.name)) || files.find(f=>isVid(f.name));
    if (hit) return hit;
    if (depth < COVER_DEPTH){
      for (const d of dirs.slice(0,DIR_SCAN_CAP)){ const c = await findCover(d.handle, depth+1); if (c) return c; }
    }
    return null;
  }
  async function getURL(fh){ if (urls.has(fh)) return urls.get(fh); const u = URL.createObjectURL(await fh.getFile()); urls.set(fh,u); return u; }
  function releaseURL(fh,u){ if (urls.get(fh) === u){ URL.revokeObjectURL(u); urls.delete(fh); } }
  function freeURLs(){ for (const u of urls.values()) URL.revokeObjectURL(u); urls.clear(); }

  /* ---------- thumbnails ---------- */
  async function imgThumb(file){
    try{
      let bmp;
      try { bmp = await createImageBitmap(file, { resizeWidth:THUMB, resizeQuality:"medium" }); }
      catch { bmp = await createImageBitmap(file); }
      const w = Math.min(THUMB, bmp.width), h = Math.max(1, Math.round(bmp.height*(w/bmp.width)));
      const c = ("OffscreenCanvas" in window) ? new OffscreenCanvas(w,h)
              : Object.assign(document.createElement("canvas"), { width:w, height:h });
      c.getContext("2d").drawImage(bmp,0,0,w,h); bmp.close && bmp.close();
      return c.convertToBlob ? await c.convertToBlob({ type:"image/webp", quality:.8 })
                             : await new Promise(r => c.toBlob(r, "image/webp", .8));
    } catch { return null; }
  }
  function videoThumb(file){
    return new Promise(res => {
      const url = URL.createObjectURL(file), v = document.createElement("video");
      v.muted=true; v.preload="metadata"; v.playsInline=true; v.src=url;
      let done=false; const fin = b => { if(done) return; done=true; URL.revokeObjectURL(url); res(b); };
      const grab = () => { try {
        const w=THUMB, h=Math.max(1, Math.round(v.videoHeight*(THUMB/v.videoWidth)));
        const c=document.createElement("canvas"); c.width=w; c.height=h;
        c.getContext("2d").drawImage(v,0,0,w,h); c.toBlob(b=>fin(b),"image/webp",.8);
      } catch { fin(null); } };
      v.onloadeddata = () => { try { v.currentTime = Math.min(1, (v.duration||3)/3); } catch { grab(); } };
      v.onseeked = grab; v.onerror = () => fin(null); setTimeout(()=>fin(null), 4000);
    });
  }
  async function thumbURL(fh){
    const file = await fh.getFile();                         // metadata read — cheap
    if (ext(file.name) === "svg"){ const u = URL.createObjectURL(file); coverUrls.add(u); return u; }
    const key = file.name + "|" + file.size + "|" + file.lastModified;
    let blob = await idbGet("thumbs", key).catch(()=>null);
    if (!blob){ blob = isVid(file.name) ? await videoThumb(file) : await imgThumb(file); if (blob) idbPut("thumbs", key, blob).catch(()=>{}); }
    if (!blob) return null;
    const u = URL.createObjectURL(blob); coverUrls.add(u); return u;
  }

  /* ---------- progress ---------- */
  let busyN = 0;
  function busy(on){ busyN = Math.max(0, busyN + (on?1:-1)); $("#prog").classList.toggle("go", busyN>0); }

  /* ---------- recents ---------- */
  async function addRecent(h){
    let recents = []; try { recents = (await idbGet("meta","recents")) || []; } catch {}
    const out = [h];
    for (const r of recents){ try { if (!(await h.isSameEntry(r))) out.push(r); } catch { out.push(r); } if (out.length>=6) break; }
    idbPut("meta","recents", out.slice(0,6)).catch(()=>{});
  }

  /* ---------- navigation ---------- */
  async function pick(){
    let h; try { h = await window.showDirectoryPicker({ mode:"read" }); } catch { return; }
    root = h; await addRecent(h); launch();
  }
  async function reopen(h){
    const opt = { mode:"read" };
    if (await h.queryPermission(opt) !== "granted" && await h.requestPermission(opt) !== "granted"){ toast("Permission denied"); return; }
    root = h; await addRecent(h); launch();
  }
  function launch(){ stack = [{ name:root.name, handle:root }]; $("#intro").style.display="none"; $("#bar").style.display="flex"; $("#main").style.display="block"; render(); }
  function goTo(i){ stack = stack.slice(0,i+1); render(); }
  function enter(n){ stack.push(n); render(); }
  function up(){ if (stack.length>1){ stack.pop(); render(); } }

  function crumbs(){
    const c = $("#crumbs"); c.innerHTML = "";
    stack.forEach((n,i) => {
      if (i) c.insertAdjacentHTML("beforeend", '<span class="sep">/</span>');
      const b = document.createElement("button"); b.textContent = n.name; b.title = n.name; b.onclick = () => goTo(i); c.appendChild(b);
    });
  }

  /* ---------- browse ---------- */
  let coverObs;
  async function render(){
    const gen = ++NAV_GEN;
    for (const u of coverUrls) URL.revokeObjectURL(u); coverUrls.clear();
    $("#filter").value = "";
    crumbs();
    const cur = stack[stack.length-1], m = $("#main"); m.innerHTML = "";
    busy(true);
    let data; try { data = await listing(cur.handle); } catch { busy(false); m.innerHTML = '<div class="empty">— cannot read folder —</div>'; return; }
    busy(false);
    if (gen !== NAV_GEN) return;
    const dirs = sorted(data.dirs), files = sorted(data.files);

    if (files.length){
      const here = document.createElement("div"); here.className = "here";
      here.innerHTML = `<span class="lbl">This folder holds <b>${files.length}</b> item${files.length>1?"s":""} directly.</span>`;
      const b = document.createElement("button"); b.className="btn solid"; b.textContent="▶ View them"; b.onclick = () => openReader(files, cur.name);
      here.appendChild(b); m.appendChild(here);
    }
    if (!dirs.length && !files.length){ m.insertAdjacentHTML("beforeend", '<div class="empty">— empty folder —</div>'); return; }
    if (!dirs.length) return;

    if (coverObs) coverObs.disconnect();
    coverObs = new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting){ coverObs.unobserve(e.target); schedule(() => fillCard(e.target, gen)); } }), { rootMargin:"500px" });

    const grid = document.createElement("div"); grid.className = "grid";
    dirs.forEach((d,i) => {
      const card = document.createElement("div"); card.className = "card";
      card.style.animationDelay = Math.min(i*28, 420) + "ms";
      card._name = d.name.toLowerCase();
      card.innerHTML =
        '<div class="cover shim"><div class="ph">📁</div><div class="badge"></div><div class="open-hint"></div></div>' +
        '<div class="meta"><span class="name">' + escapeHtml(d.name) + '</span><button class="enter" title="Go inside">›</button></div>';
      card._node = d;
      card.querySelector(".enter").onclick = e => { e.stopPropagation(); enter(d); };
      card.querySelector(".cover").onclick = () => cardClick(card, d);
      grid.appendChild(card); coverObs.observe(card);
    });
    m.appendChild(grid);
  }

  async function fillCard(card, gen){
    if (gen !== NAV_GEN) return;
    const d = card._node; let info;
    busy(true);
    try { info = await listing(d.handle); } catch { busy(false); card.querySelector(".cover").classList.remove("shim"); return; }
    card._info = info;
    const { dirs, files } = info, badge = card.querySelector(".badge");
    if (files.length){
      const imgs = files.filter(f=>isImg(f.name)).length, vids = files.length - imgs;
      if (imgs) badge.insertAdjacentHTML("beforeend", `<span class="chip">🖼 ${imgs}</span>`);
      if (vids) badge.insertAdjacentHTML("beforeend", `<span class="chip vid">▶ ${vids}</span>`);
    }
    if (dirs.length) badge.insertAdjacentHTML("beforeend", `<span class="chip">📁 ${dirs.length}</span>`);
    card.querySelector(".open-hint").textContent = files.length ? "view ▸" : "open ▸";

    const cover = card.querySelector(".cover");
    let cov = null; try { cov = await findCover(d.handle); } catch {}
    if (gen !== NAV_GEN){ busy(false); cover.classList.remove("shim"); return; }
    if (cov){
      const u = await thumbURL(cov.handle).catch(()=>null);
      if (u && gen === NAV_GEN){
        const ph = cover.querySelector(".ph"); if (ph) ph.remove();
        const img = document.createElement("img"); img.className="img"; img.decoding="async"; img.alt="";
        img.onload = () => img.classList.add("in"); img.src = u; cover.insertBefore(img, cover.firstChild);
      } else if (u){ URL.revokeObjectURL(u); coverUrls.delete(u); }
    }
    cover.classList.remove("shim"); busy(false);
  }

  async function cardClick(card, d){
    let info = card._info; if (!info){ try { info = await listing(d.handle); } catch { return; } }
    if (info.files.length) openReader(info.files, d.name);
    else if (info.dirs.length) enter(d);
    else toast("Folder is empty");
  }

  function filterCards(term){
    term = term.trim().toLowerCase();
    document.querySelectorAll(".card").forEach(c => c.classList.toggle("hide", term && !c._name.includes(term)));
  }

  /* ---------- reader ---------- */
  let R = { items:[], i:0, mode:"scroll" }, pageObs, barTimer, slideTimer = null;
  function openReader(items, title){
    R = { items: sorted(items), i:0, mode:"scroll" };
    $("#rtitle").textContent = title;
    const r = $("#reader"); r.classList.add("on","open-anim"); setTimeout(()=>r.classList.remove("open-anim"), 400);
    document.body.style.overflow = "hidden";
    setMode("scroll");
  }
  function closeReader(){
    stopSlide();
    $("#reader").classList.remove("on","hidebar");
    document.body.style.overflow = "";
    $("#scroll").innerHTML = ""; $("#stage").innerHTML = "";
    if (pageObs) pageObs.disconnect(); clearTimeout(barTimer); freeURLs();
  }
  function setMode(mode){
    if (mode !== "paged") stopSlide();
    R.mode = mode;
    $("#mScroll").classList.toggle("act", mode==="scroll");
    $("#mPage").classList.toggle("act", mode==="paged");
    $("#scroll").style.display = mode==="scroll" ? "block" : "none";
    $("#paged").classList.toggle("on", mode==="paged");
    $("#reader").classList.remove("hidebar"); clearTimeout(barTimer);
    if (mode === "paged") armBar();
    mode === "scroll" ? buildScroll() : buildPaged();
  }
  function counter(){ $("#rcount").textContent = R.mode==="paged" ? `${R.i+1} / ${R.items.length}` : `${R.items.length} items`; }

  /* scroll — windowed: load near viewport, unload far (memory stays flat) */
  function buildScroll(){
    counter();
    const wrap = $("#scroll"); wrap.innerHTML = ""; wrap.scrollTop = 0;
    if (pageObs) pageObs.disconnect();
    pageObs = new IntersectionObserver(es => es.forEach(e => e.isIntersecting ? loadItem(e.target) : unloadItem(e.target)), { root:wrap, rootMargin:"1600px 0px" });
    R.items.forEach((it,idx) => { const d=document.createElement("div"); d.className="item shim"; d._it=it; d._idx=idx; wrap.appendChild(d); pageObs.observe(d); });
  }
  async function loadItem(div){
    if (div._loaded) return; div._loaded = true;
    const it = div._it, u = await getURL(it.handle).catch(()=>null);
    if (!u || !div.isConnected){ div._loaded = false; return; }
    let el;
    if (isVid(it.name)){ el=document.createElement("video"); el.controls=true; el.preload="metadata"; el.playsInline=true; }
    else { el=document.createElement("img"); el.alt=it.name; el.decoding="async"; }
    const show = () => { div.classList.remove("shim"); div.classList.add("loaded","shown"); };
    el.onload = show; el.onloadeddata = show; el.onerror = () => div.classList.remove("shim");
    el.src = u; div.innerHTML = ""; div.appendChild(el);
  }
  function unloadItem(div){
    if (!div._loaded) return;
    const h = div.offsetHeight; if (h) div.style.minHeight = h + "px";
    const m = div.querySelector("img,video");
    if (m){ const u = m.currentSrc || m.src; m.removeAttribute("src"); if (m.load) try { m.load(); } catch {} releaseURL(div._it.handle, u); }
    div.innerHTML = ""; div.className = "item shim"; div.style.minHeight = ""; div._loaded = false;
  }

  /* paged */
  function buildPaged(){ showPage(R.i, 0); }
  async function showPage(i, dir){
    R.i = (i + R.items.length) % R.items.length; counter();
    const it = R.items[R.i], stage = $("#stage");
    $("#paged").classList.toggle("video", isVid(it.name));
    const u = await getURL(it.handle).catch(()=>null); if (!u) return;
    let el;
    if (isVid(it.name)){ el=document.createElement("video"); el.controls=true; el.autoplay=true; el.playsInline=true; }
    else { el=document.createElement("img"); el.alt=it.name; }
    stage.style.transition = "none"; stage.style.opacity = "0"; stage.style.transform = `translateX(${(dir||0)*26}px)`;
    el.onload = el.onloadeddata = () => requestAnimationFrame(() => {
      stage.style.transition = "opacity .18s ease, transform .24s var(--ease)"; stage.style.opacity = "1"; stage.style.transform = "none"; });
    el.src = u; stage.innerHTML = ""; stage.appendChild(el);
    [R.i+1, R.i-1].forEach(j => getURL(R.items[(j + R.items.length) % R.items.length].handle).catch(()=>{})); // prefetch
  }
  const next = () => R.mode==="paged" && showPage(R.i+1, 1);
  const prev = () => R.mode==="paged" && showPage(R.i-1, -1);

  /* slideshow */
  function startSlide(){ if (R.mode!=="paged") setMode("paged"); clearInterval(slideTimer); slideTimer = setInterval(next, 3500); $("#slide").textContent = "⏸"; }
  function stopSlide(){ if (!slideTimer) return; clearInterval(slideTimer); slideTimer = null; const s=$("#slide"); if (s) s.textContent = "▶"; }
  function toggleSlide(){ slideTimer ? stopSlide() : startSlide(); }

  /* floating arrows by proximity + auto-hiding bar (paged) */
  function armBar(){ clearTimeout(barTimer); barTimer = setTimeout(() => { if (R.mode==="paged") $("#reader").classList.add("hidebar"); }, 2600); }

  /* ---------- settings drawer ---------- */
  async function openSettings(){
    $("#settings").classList.add("on"); $("#backdrop").classList.add("on");
    $("#cacheStat").textContent = "calculating…";
    try { const { n, bytes } = await cacheStats(); $("#cacheStat").textContent = `${n} thumbnail${n!==1?"s":""} · ${fmtBytes(bytes)}`; }
    catch { $("#cacheStat").textContent = "—"; }
  }
  function closeSettings(){ $("#settings").classList.remove("on"); $("#backdrop").classList.remove("on"); }
  function bindSeg(id, key, after){
    document.getElementById(id).querySelectorAll("button").forEach(b => b.onclick = () => {
      prefs[key] = key === "snap" ? (b.dataset.v === "on") : b.dataset.v;
      savePrefs(); applyPrefs(); after && after();
    });
  }

  /* ---------- toast ---------- */
  let tT; function toast(m){ const t = $("#toast"); t.textContent = m; t.classList.add("on"); clearTimeout(tT); tT = setTimeout(()=>t.classList.remove("on"), 1800); }

  /* ---------- wiring ---------- */
  $("#pick").onclick = pick;
  $("#rootBtn").onclick = pick;
  $("#rclose").onclick = closeReader;
  $("#mScroll").onclick = () => setMode("scroll");
  $("#mPage").onclick = () => setMode("paged");
  $("#slide").onclick = toggleSlide;
  $("#navL").onclick = prev; $("#navR").onclick = next;
  $("#zL").onclick = prev; $("#zR").onclick = next;
  $("#filter").oninput = e => filterCards(e.target.value);
  $("#settingsBtn").onclick = openSettings;
  $("#sClose").onclick = closeSettings;
  $("#backdrop").onclick = closeSettings;
  $("#clearCache").onclick = async () => { await clearCache(); toast("Cache cleared"); openSettings(); };

  bindSeg("segDensity", "density");
  bindSeg("segWidth", "scrollWidth");
  bindSeg("segSnap", "snap");
  bindSeg("segSort", "sort", () => { if (stack.length) render(); });

  $("#paged").addEventListener("mousemove", e => {
    const w = innerWidth, x = e.clientX;
    $("#navL").classList.toggle("show", x < w*.2);
    $("#navR").classList.toggle("show", x > w*.8);
    $("#reader").classList.remove("hidebar"); armBar();
  });
  $("#paged").addEventListener("mouseleave", () => { $("#navL").classList.remove("show"); $("#navR").classList.remove("show"); });

  document.addEventListener("keydown", e => {
    if ($("#settings").classList.contains("on")){ if (e.key === "Escape") closeSettings(); return; }
    if ($("#reader").classList.contains("on")){
      const wrap = $("#scroll");
      if (e.key === "Escape") closeReader();
      else if (e.key === "ArrowRight" && R.mode==="paged"){ e.preventDefault(); next(); }
      else if (e.key === "ArrowLeft"  && R.mode==="paged"){ e.preventDefault(); prev(); }
      else if (e.key === " "){ e.preventDefault(); R.mode==="paged" ? next() : wrap.scrollBy({ top: wrap.clientHeight*.9, behavior:"smooth" }); }
      else if (e.key === "Home"){ e.preventDefault(); R.mode==="paged" ? showPage(0,-1) : wrap.scrollTo({ top:0, behavior:"smooth" }); }
      else if (e.key === "End"){ e.preventDefault(); R.mode==="paged" ? showPage(R.items.length-1,1) : wrap.scrollTo({ top:wrap.scrollHeight, behavior:"smooth" }); }
      else if (e.key.toLowerCase() === "m") setMode(R.mode==="scroll" ? "paged" : "scroll");
      else if (e.key.toLowerCase() === "s") toggleSlide();
      return;
    }
    if (e.key === "Backspace" && $("#main").style.display !== "none"){ e.preventDefault(); up(); }
  });

  let tx = 0;
  $("#paged").addEventListener("touchstart", e => tx = e.changedTouches[0].clientX, { passive:true });
  $("#paged").addEventListener("touchend", e => { const dx = e.changedTouches[0].clientX - tx; if (Math.abs(dx) > 50) dx < 0 ? next() : prev(); }, { passive:true });

  document.addEventListener("visibilitychange", () => { if (document.hidden) stopSlide(); });

  /* ---------- startup ---------- */
  (async () => {
    applyPrefs();
    if (!window.showDirectoryPicker){ $("#pick").disabled = true; $("#pick").textContent = "Browser not supported"; toast("Use Chrome or Edge."); return; }
    try {
      const recents = (await idbGet("meta","recents")) || [];
      const box = $("#recents");
      recents.slice(0,5).forEach(h => { const b=document.createElement("button"); b.className="rec"; b.textContent = "↻ " + h.name; b.onclick = () => reopen(h); box.appendChild(b); });
    } catch {}
  })();
})();
