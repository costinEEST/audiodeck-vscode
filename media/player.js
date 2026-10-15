(function () {
  const vscode = acquireVsCodeApi();
  const $ = (id) => /** @type {any} */ (document.getElementById(id));

  // ---------- icons (inline SVG, inherit currentColor) ----------
  const svg = (d, fill = false) =>
    `<svg viewBox="0 0 24 24" width="16" height="16" ${
      fill ? 'fill="currentColor"' : 'fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"'
    } aria-hidden="true">${d}</svg>`;
  const ICON = {
    play: svg('<path d="M7 4.5v15l12.5-7.5z"/>', true),
    pause: svg('<rect x="6" y="4.5" width="4" height="15" rx="1"/><rect x="14" y="4.5" width="4" height="15" rx="1"/>', true),
    prev: svg('<path d="M18 5v14L8 12z"/><rect x="5" y="5" width="2.5" height="14" rx="1"/>', true),
    next: svg('<path d="M6 5v14l10-7z"/><rect x="16.5" y="5" width="2.5" height="14" rx="1"/>', true),
    back: svg('<path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 4v5h5"/>'),
    fwd: svg('<path d="M21 12a9 9 0 1 1-3-6.7"/><path d="M21 4v5h-5"/>'),
    repeat: svg('<path d="M17 2l4 4-4 4"/><path d="M3 11v-1a4 4 0 0 1 4-4h14"/><path d="M7 22l-4-4 4-4"/><path d="M21 13v1a4 4 0 0 1-4 4H3"/>'),
    shuffle: svg('<path d="M16 3h5v5"/><path d="M4 20 21 3"/><path d="M21 16v5h-5"/><path d="M15 15l6 6"/><path d="M4 4l5 5"/>'),
    vol: svg('<path d="M11 5 6 9H2v6h4l5 4z" fill="currentColor"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M19 5a10 10 0 0 1 0 14"/>'),
    mute: svg('<path d="M11 5 6 9H2v6h4l5 4z" fill="currentColor"/><path d="m22 9-6 6"/><path d="m16 9 6 6"/>'),
    grip: svg('<circle cx="9" cy="6" r="1.4"/><circle cx="15" cy="6" r="1.4"/><circle cx="9" cy="12" r="1.4"/><circle cx="15" cy="12" r="1.4"/><circle cx="9" cy="18" r="1.4"/><circle cx="15" cy="18" r="1.4"/>', true),
    x: svg('<path d="M18 6 6 18"/><path d="m6 6 12 12"/>'),
  };

  // ---------- state ----------
  /** @type {{tracks:{path:string,name:string}[], index:number, volume:number, rate:number, repeat:'off'|'all'|'one', shuffle:boolean, positions:Record<string,number>, bookmarks:Record<string,number[]>}} */
  let state = { tracks: [], index: -1, volume: 1, rate: 1, repeat: 'all', shuffle: false, positions: {}, bookmarks: {} };
  let config = { skipSeconds: 5, resumePosition: true };

  const audio = new Audio();
  audio.preload = 'auto';
  let blobUrl = '';
  let loadedPath = ''; // path currently in the <audio> element
  let pendingAutoplay = false;
  let seeking = false;
  /** @type {number|null} */ let loopA = null;
  /** @type {number|null} */ let loopB = null;
  let lastSave = 0;
  let muted = false;
  /** @type {string|null} */ let errorText = null;

  const current = () => state.tracks[state.index];

  function save() {
    vscode.postMessage({ type: 'save', state });
  }

  function savePosition(force = false) {
    const t = current();
    if (!t || !config.resumePosition || loadedPath !== t.path) return;
    const now = Date.now();
    if (!force && now - lastSave < 3000) return;
    lastSave = now;
    const pos = audio.currentTime;
    if (pos > 2 && audio.duration && pos < audio.duration - 2) state.positions[t.path] = Math.round(pos * 10) / 10;
    else delete state.positions[t.path];
    save();
  }

  // ---------- loading ----------
  function playIndex(i, autoplay = true) {
    if (i < 0 || i >= state.tracks.length) return;
    savePosition(true);
    clearLoop();
    errorText = null;
    state.index = i;
    save();
    pendingAutoplay = autoplay;
    loadedPath = '';
    audio.pause();
    render();
    $('title').textContent = `Loading ${state.tracks[i].name}…`;
    vscode.postMessage({ type: 'load', index: i, path: state.tracks[i].path });
  }

  function onAudioData(msg) {
    const t = current();
    if (!t || t.path !== msg.path) return; // stale response
    if (blobUrl) URL.revokeObjectURL(blobUrl);
    blobUrl = '';
    loadedPath = msg.path;
    audio.src = msg.src;
    audio.load();
  }

  audio.addEventListener('loadedmetadata', () => {
    const t = current();
    const resume = t && config.resumePosition ? state.positions[t.path] : 0;
    if (resume && resume < audio.duration - 2) audio.currentTime = resume;
    applyRate();
    if (pendingAutoplay) audio.play().catch(() => {});
    pendingAutoplay = false;
    updateNow();
    render();
  });

  audio.addEventListener('error', () => {
    if (!audio.src) return;
    const t = current();
    errorText = `Can't play “${t ? t.name : 'file'}” — format not supported by VS Code.`;
    updateNow();
  });

  audio.addEventListener('play', () => { updateNow(); tick(); });
  audio.addEventListener('pause', () => { savePosition(true); updateNow(); });
  audio.addEventListener('ended', () => {
    const t = current();
    if (t) { delete state.positions[t.path]; save(); }
    if (state.repeat === 'one') { audio.currentTime = 0; audio.play(); return; }
    const n = nextIndex();
    if (n >= 0) playIndex(n);
    else updateNow();
  });

  // ---------- transport ----------
  function togglePlay() {
    if (!state.tracks.length) { vscode.postMessage({ type: 'pickFiles' }); return; }
    const t = current();
    if (!t || loadedPath !== t.path) { playIndex(state.index >= 0 ? state.index : 0); return; }
    if (audio.paused) audio.play().catch(() => {});
    else audio.pause();
  }

  function nextIndex() {
    const n = state.tracks.length;
    if (!n) return -1;
    if (state.shuffle && n > 1) {
      let r;
      do { r = Math.floor(Math.random() * n); } while (r === state.index);
      return r;
    }
    if (state.index + 1 < n) return state.index + 1;
    return state.repeat === 'all' ? 0 : -1;
  }

  function next() {
    const n = nextIndex();
    if (n >= 0) playIndex(n, true);
  }

  function prev() {
    if (audio.currentTime > 3 && loadedPath) { audio.currentTime = loopA ?? 0; return; }
    const n = state.tracks.length;
    if (!n) return;
    const i = state.index - 1 >= 0 ? state.index - 1 : state.repeat === 'all' ? n - 1 : 0;
    playIndex(i, true);
  }

  function skip(sec) {
    if (!loadedPath || !isFinite(audio.duration)) return;
    audio.currentTime = Math.max(0, Math.min(audio.duration - 0.05, audio.currentTime + sec));
    drawProgress();
  }

  // speed
  const RATE_MIN = 0.25, RATE_MAX = 3;
  function setRate(r) {
    state.rate = Math.round(Math.max(RATE_MIN, Math.min(RATE_MAX, r)) * 100) / 100;
    applyRate();
    save();
    renderTools();
  }
  function applyRate() {
    audio.defaultPlaybackRate = state.rate;
    audio.playbackRate = state.rate;
    // keep natural voice pitch when slowing down
    // @ts-ignore
    audio.preservesPitch = true;
  }
  const rateStep = (r) => (r < 1 ? 0.05 : 0.1);

  // A–B loop
  function cycleLoop() {
    if (!loadedPath) return;
    if (loopA === null) loopA = audio.currentTime;
    else if (loopB === null) {
      if (audio.currentTime > loopA + 0.3) { loopB = audio.currentTime; audio.currentTime = loopA; }
      else loopA = audio.currentTime; // B before A: move A instead
    } else clearLoop();
    renderTools();
    drawProgress();
  }
  function clearLoop() { loopA = loopB = null; renderTools(); }

  // ---------- render ----------
  const fmt = (s) => {
    if (!isFinite(s) || s < 0) s = 0;
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = Math.floor(s % 60);
    return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(sec).padStart(2, '0');
  };

  function drawProgress() {
    const d = audio.duration;
    const ok = loadedPath && isFinite(d) && d > 0;
    const p = ok ? audio.currentTime / d : 0;
    if (!seeking) $('seek').value = String(Math.round(p * 1000));
    $('seekFill').style.width = `${(seeking ? $('seek').value / 10 : p * 100)}%`;
    $('cur').textContent = fmt(ok ? audio.currentTime : 0);
    $('dur').textContent = fmt(ok ? d : 0);
    const band = $('seekLoop');
    if (ok && loopA !== null) {
      const end = loopB ?? audio.currentTime;
      band.hidden = false;
      band.style.left = `${(loopA / d) * 100}%`;
      band.style.width = `${Math.max(0.5, ((end - loopA) / d) * 100)}%`;
      band.classList.toggle('pending', loopB === null);
    } else band.hidden = true;
  }

  let raf = 0;
  function tick() {
    cancelAnimationFrame(raf);
    const loop = () => {
      if (loopB !== null && loopA !== null && audio.currentTime >= loopB) audio.currentTime = loopA;
      drawProgress();
      savePosition();
      if (!audio.paused) raf = requestAnimationFrame(loop);
    };
    loop();
  }

  function updateNow() {
    const t = current();
    const playing = !audio.paused && !!loadedPath;
    $('title').textContent = errorText ?? (t ? t.name : 'Nothing playing');
    $('title').title = t ? t.path : '';
    $('title').classList.toggle('error', !!errorText);
    $('play').innerHTML = playing ? ICON.pause : ICON.play;
    $('play').setAttribute('aria-label', playing ? 'Pause' : 'Play');
    $('play').dataset.tooltip = `${playing ? 'Pause' : 'Play'} · Space`;
    document.querySelectorAll('#tracks li').forEach((li, i) => {
      li.classList.toggle('active', i === state.index);
      li.classList.toggle('playing', i === state.index && playing);
    });
    vscode.postMessage({ type: 'now', name: t ? t.name : null, playing });
    if ('mediaSession' in navigator && t) {
      try {
        navigator.mediaSession.metadata = new MediaMetadata({ title: t.name, artist: 'AudioDeck' });
        navigator.mediaSession.playbackState = playing ? 'playing' : 'paused';
      } catch { /* not available in every build */ }
    }
    drawProgress();
  }

  function renderTools() {
    $('rate').textContent = `${state.rate}×`;
    $('rate').classList.toggle('on', state.rate !== 1);
    const ab = $('ab');
    ab.textContent = loopA === null ? 'A–B' : loopB === null ? `A ${fmt(loopA)}…` : `${fmt(loopA)}–${fmt(loopB)}`;
    ab.classList.toggle('on', loopA !== null);
    const rp = $('repeat');
    rp.classList.toggle('on', state.repeat !== 'off');
    rp.innerHTML = ICON.repeat + (state.repeat === 'one' ? '<span class="badge">1</span>' : '');
    const repeatLabel = { off: 'Repeat: off', all: 'Repeat: playlist', one: 'Repeat: this track' }[state.repeat];
    rp.setAttribute('aria-label', repeatLabel);
    rp.dataset.tooltip = `${repeatLabel} · R`;
    $('shuffle').classList.toggle('on', state.shuffle);
    const shuffleLabel = state.shuffle ? 'Shuffle: on' : 'Shuffle: off';
    $('shuffle').setAttribute('aria-label', shuffleLabel);
    $('shuffle').dataset.tooltip = `${shuffleLabel} · S`;
    $('volume').value = String(muted ? 0 : state.volume);
    $('mute').innerHTML = muted || state.volume === 0 ? ICON.mute : ICON.vol;
    $('mute').setAttribute('aria-label', muted ? 'Unmute' : 'Mute');
    $('mute').dataset.tooltip = `${muted ? 'Unmute' : 'Mute'} · M`;
    audio.volume = state.volume;
    audio.muted = muted;
    $('back').setAttribute('aria-label', `Back ${config.skipSeconds} seconds`);
    $('fwd').setAttribute('aria-label', `Forward ${config.skipSeconds} seconds`);
    $('back').dataset.tooltip = `Back ${config.skipSeconds} seconds · ←`;
    $('fwd').dataset.tooltip = `Forward ${config.skipSeconds} seconds · →`;
    renderBookmarks();
  }

  function renderBookmarks() {
    const box = $('bookmarks');
    const t = current();
    const marks = t ? (state.bookmarks[t.path] || []) : [];
    box.replaceChildren();
    box.hidden = marks.length === 0;
    marks.forEach((time, index) => {
      const jump = document.createElement('button');
      jump.className = 'bookmark';
      jump.textContent = fmt(time);
      jump.title = `Jump to ${fmt(time)}`;
      jump.addEventListener('click', () => { if (loadedPath === t.path) { audio.currentTime = time; drawProgress(); } });
      const remove = document.createElement('button');
      remove.className = 'bookmark-remove';
      remove.textContent = '×';
      remove.setAttribute('aria-label', `Remove bookmark at ${fmt(time)}`);
      remove.addEventListener('click', () => { marks.splice(index, 1); if (!marks.length) delete state.bookmarks[t.path]; save(); renderBookmarks(); });
      const item = document.createElement('span');
      item.append(jump, remove);
      box.append(item);
    });
  }

  function addBookmark() {
    const t = current();
    if (!t || loadedPath !== t.path || !isFinite(audio.currentTime)) return;
    const marks = state.bookmarks[t.path] || (state.bookmarks[t.path] = []);
    const value = Math.round(audio.currentTime * 10) / 10;
    if (!marks.some((mark) => Math.abs(mark - value) < 0.5)) marks.push(value);
    marks.sort((a, b) => a - b);
    save(); renderBookmarks();
  }

  function render() {
    const ol = $('tracks');
    ol.innerHTML = '';
    state.tracks.forEach((t, i) => {
      const li = document.createElement('li');
      li.draggable = true;
      li.dataset.i = String(i);
      const resumed = config.resumePosition && state.positions[t.path];
      li.innerHTML = `
        <span class="grip" title="Drag to reorder">${ICON.grip}</span>
        <span class="num">${i + 1}</span>
        <span class="eq" aria-hidden="true"><i></i><i></i><i></i></span>
        <span class="name"></span>
        ${resumed ? `<span class="resume" title="Resumes at ${fmt(resumed)}">${fmt(resumed)}</span>` : ''}
        <button class="remove" title="Remove from playlist" aria-label="Remove">${ICON.x}</button>`;
      li.querySelector('.name').textContent = t.name;
      li.title = t.path;
      ol.appendChild(li);
    });
    $('empty').hidden = state.tracks.length > 0;
    $('count').textContent = state.tracks.length
      ? `${state.tracks.length} track${state.tracks.length === 1 ? '' : 's'}`
      : 'Playlist';
    updateNow();
    renderTools();
  }

  // ---------- playlist interactions ----------
  const ol = $('tracks');
  ol.addEventListener('click', (e) => {
    const li = e.target.closest('li');
    if (!li) return;
    const i = Number(li.dataset.i);
    if (e.target.closest('.remove')) { removeTrack(i); return; }
    if (i === state.index && loadedPath === current()?.path) togglePlay();
    else playIndex(i, true);
  });

  function removeTrack(i) {
    const wasCurrent = i === state.index;
    const [t] = state.tracks.splice(i, 1);
    delete state.positions[t.path];
    delete state.bookmarks[t.path];
    if (wasCurrent) {
      audio.pause();
      audio.removeAttribute('src');
      audio.load();
      loadedPath = '';
      clearLoop();
      errorText = null;
      state.index = Math.min(i, state.tracks.length - 1);
    } else if (i < state.index) state.index--;
    save();
    render();
  }

  let dragFrom = -1;
  ol.addEventListener('dragstart', (e) => {
    const li = e.target.closest('li');
    dragFrom = Number(li.dataset.i);
    li.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
  });
  ol.addEventListener('dragend', () => {
    document.querySelectorAll('.dragging,.drop-before,.drop-after').forEach((n) =>
      n.classList.remove('dragging', 'drop-before', 'drop-after'));
  });
  ol.addEventListener('dragover', (e) => {
    const li = e.target.closest('li');
    if (!li || dragFrom < 0) return;
    e.preventDefault();
    const r = li.getBoundingClientRect();
    const after = e.clientY > r.top + r.height / 2;
    document.querySelectorAll('.drop-before,.drop-after').forEach((n) => n.classList.remove('drop-before', 'drop-after'));
    li.classList.add(after ? 'drop-after' : 'drop-before');
  });
  ol.addEventListener('drop', (e) => {
    const li = e.target.closest('li');
    if (!li || dragFrom < 0) return;
    e.preventDefault();
    const r = li.getBoundingClientRect();
    let to = Number(li.dataset.i) + (e.clientY > r.top + r.height / 2 ? 1 : 0);
    const cur = current();
    const [moved] = state.tracks.splice(dragFrom, 1);
    if (dragFrom < to) to--;
    state.tracks.splice(to, 0, moved);
    if (cur) state.index = state.tracks.indexOf(cur);
    dragFrom = -1;
    save();
    render();
  });

  // ---------- controls ----------
  for (const id of ['prev', 'back', 'fwd', 'next', 'shuffle']) $(id).innerHTML = ICON[id];
  $('play').addEventListener('click', togglePlay);
  $('prev').addEventListener('click', prev);
  $('next').addEventListener('click', next);
  $('back').addEventListener('click', () => skip(-config.skipSeconds));
  $('fwd').addEventListener('click', () => skip(config.skipSeconds));
  $('slower').addEventListener('click', () => setRate(state.rate - rateStep(state.rate - 0.001)));
  $('faster').addEventListener('click', () => setRate(state.rate + rateStep(state.rate)));
  $('rate').addEventListener('click', () => setRate(1));
  $('ab').addEventListener('click', cycleLoop);
  $('mark').addEventListener('click', addBookmark);
  $('repeat').addEventListener('click', () => {
    state.repeat = { off: 'all', all: 'one', one: 'off' }[state.repeat];
    save(); renderTools();
  });
  $('shuffle').addEventListener('click', () => { state.shuffle = !state.shuffle; save(); renderTools(); });
  $('mute').addEventListener('click', () => { muted = !muted; renderTools(); });
  $('volume').addEventListener('input', (e) => {
    state.volume = Number(e.target.value);
    muted = false;
    renderTools();
  });
  $('volume').addEventListener('change', save);
  $('addFiles').addEventListener('click', () => vscode.postMessage({ type: 'pickFiles' }));
  $('emptyAdd').addEventListener('click', () => vscode.postMessage({ type: 'pickFiles' }));
  $('addFolder').addEventListener('click', () => vscode.postMessage({ type: 'pickFolder' }));

  const seek = $('seek');
  seek.addEventListener('input', () => { seeking = true; drawProgress(); });
  seek.addEventListener('change', () => {
    if (loadedPath && isFinite(audio.duration)) audio.currentTime = (seek.value / 1000) * audio.duration;
    seeking = false;
    drawProgress();
  });

  // keyboard shortcuts while the player has focus
  document.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const onRange = e.target instanceof HTMLInputElement;
    const k = e.key;
    if (k === ' ') { e.preventDefault(); if (!e.repeat) togglePlay(); }
    else if (onRange) return;
    else if (k === 'ArrowLeft') { e.preventDefault(); if (e.shiftKey) prev(); else skip(-config.skipSeconds); }
    else if (k === 'ArrowRight') { e.preventDefault(); if (e.shiftKey) next(); else skip(config.skipSeconds); }
    else if (k === '[') setRate(state.rate - rateStep(state.rate - 0.001));
    else if (k === ']') setRate(state.rate + rateStep(state.rate));
    else if (k === '=') setRate(1);
    else if (k === 'l' || k === 'L') cycleLoop();
    else if (k === 'b' || k === 'B') addBookmark();
    else if (k === 'm' || k === 'M') { muted = !muted; renderTools(); }
    else if (k === 'r' || k === 'R') $('repeat').click();
    else if (k === 's' || k === 'S') $('shuffle').click();
    else if (k === 'Escape') clearLoop();
  });

  // stop a focused button from also "clicking" on Space
  document.addEventListener('keyup', (e) => { if (e.key === ' ') e.preventDefault(); });

  // hardware media keys, where the runtime supports it
  if ('mediaSession' in navigator) {
    const ms = navigator.mediaSession;
    const set = (a, fn) => { try { ms.setActionHandler(a, fn); } catch { /* unsupported */ } };
    set('play', togglePlay);
    set('pause', togglePlay);
    set('previoustrack', prev);
    set('nexttrack', next);
    set('seekbackward', () => skip(-config.skipSeconds));
    set('seekforward', () => skip(config.skipSeconds));
  }

  // ---------- messages from the extension ----------
  const COMMANDS = {
    togglePlay,
    next,
    prev,
    back: () => skip(-config.skipSeconds),
    forward: () => skip(config.skipSeconds),
    speedUp: () => setRate(state.rate + rateStep(state.rate)),
    speedDown: () => setRate(state.rate - rateStep(state.rate - 0.001)),
    loopAB: cycleLoop,
  };

  window.addEventListener('message', (ev) => {
    const m = ev.data;
    switch (m.type) {
      case 'init':
        state = { ...state, ...m.state };
        state.bookmarks ||= {};
        config = { ...config, ...m.config };
        if (state.index >= state.tracks.length) state.index = state.tracks.length - 1;
        render();
        if (state.index >= 0) playIndex(state.index, false); // preload, don't autoplay
        break;
      case 'config':
        config = { ...config, ...m.config };
        render();
        break;
      case 'tracks': {
        const cur = current();
        state.tracks = m.tracks;
        if (cur) state.index = state.tracks.findIndex((t) => t.path === cur.path);
        if (!state.tracks.length) {
          audio.pause(); audio.removeAttribute('src'); loadedPath = ''; state.index = -1; clearLoop();
        }
        save();
        render();
        if (m.play >= 0) playIndex(m.play, true);
        else if (state.index < 0 && state.tracks.length) playIndex(0, false);
        break;
      }
      case 'audio':
        onAudioData(m);
        break;
      case 'loadError':
        if (current()?.path === m.path) { errorText = `Can't open file: ${m.message}`; updateNow(); }
        break;
      case 'command':
        COMMANDS[m.name]?.();
        break;
    }
  });

  window.addEventListener('beforeunload', () => savePosition(true));

  render();
  vscode.postMessage({ type: 'ready' });
})();
