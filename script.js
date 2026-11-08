(() => {
  'use strict';

  /* ---------- helpers ---------- */
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const PEAKS = { Easy: '\u25B2', Medium: '\u25B2\u25B2', Hard: '\u25B2\u25B2\u25B2' };
  const ISSUE_RE = /github\.com\/[^/\s]+\/[^/\s]+\/issues\/\d+/;

  const store = {
    get(key, fallback) {
      try { const v = JSON.parse(localStorage.getItem(key)); return v ?? fallback; } catch { return fallback; }
    },
    set(key, value) {
      try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage may be blocked */ }
    },
  };

  const state = {
    url: null, meta: null, plan: '', busy: false, renderQueued: false,
    history: [], results: [], saved: store.get('saved', []), recent: store.get('recent', []),
  };

  function toast(message, isError = false) {
    const el = document.createElement('div');
    el.className = 'toast' + (isError ? ' err' : '');
    el.textContent = message;
    $('#toasts').appendChild(el);
    setTimeout(() => el.remove(), isError ? 6000 : 2600);
  }

  async function api(path, options) {
    const res = await fetch(path, options);
    let data = {};
    try { data = await res.json(); } catch { /* non-JSON error */ }
    if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
    return data;
  }

  const postJSON = (path, body) => api(path, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });

  /* ---------- markdown (sanitized) ---------- */
  if (window.DOMPurify) {
    DOMPurify.addHook('afterSanitizeAttributes', (node) => {
      if (node.tagName === 'A') { node.setAttribute('target', '_blank'); node.setAttribute('rel', 'noopener noreferrer'); }
    });
  }
  function md(text) {
    if (window.marked && window.DOMPurify) return DOMPurify.sanitize(marked.parse(text));
    return '<pre>' + esc(text) + '</pre>';
  }

  async function copyText(text, okMessage = 'Copied') {
    try { await navigator.clipboard.writeText(text); toast(okMessage); }
    catch {
      const ta = document.createElement('textarea');
      ta.value = text; document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); toast(okMessage); } catch { toast('Copy failed', true); }
      ta.remove();
    }
  }

  /* ---------- theme ---------- */
  function setTheme(theme, persist) {
    document.documentElement.dataset.theme = theme;
    if (persist) store.set('theme', theme);
  }
  setTheme(store.get('theme', null) || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'), false);
  $('#themeBtn').addEventListener('click', () => {
    setTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark', true);
  });

  /* ---------- config ---------- */
  async function loadConfig() {
    try {
      const c = await api('/api/config');
      $('#modelBadge').textContent = 'Groq: ' + c.model;
      if (!c.llm_ready) {
        const b = $('#banner');
        b.hidden = false;
        b.textContent = 'The server has no GROQ_API_KEY yet, so AI ranking and plans are switched off. Add the key and restart.';
      }
    } catch {
      $('#modelBadge').textContent = 'Server unreachable';
    }
  }

  /* ---------- tabs ---------- */
  function switchTab(name) {
    $$('.tab').forEach((t) => t.setAttribute('aria-selected', String(t.dataset.tab === name)));
    $$('.pane').forEach((p) => { p.hidden = p.id !== 'pane-' + name; });
    if (name === 'saved' || name === 'recent') renderLists();
  }
  $$('.tab').forEach((t) => t.addEventListener('click', () => switchTab(t.dataset.tab)));

  /* ---------- search ---------- */
  function renderSkeleton() {
    $('#results').innerHTML = '<div class="skeleton"></div><div class="skeleton"></div><div class="skeleton"></div>';
  }

  function ago(iso) {
    if (!iso) return '';
    const days = Math.max(0, Math.round((Date.now() - new Date(iso)) / 86400000));
    return days === 0 ? 'updated today' : days === 1 ? 'updated yesterday' : `updated ${days} days ago`;
  }

  const isSaved = (url) => state.saved.some((s) => s.url === url);

  function issueCard(issue, i) {
    const diff = issue.difficulty || '';
    const mins = issue.minutes ? `about ${issue.minutes} min` : '';
    return `
      <article class="issue ${esc(diff)}">
        <div class="issue-repo">${esc(issue.repo)}</div>
        <h3 class="issue-title"><a href="${esc(issue.url)}" target="_blank" rel="noopener noreferrer">${esc(issue.title)}</a></h3>
        ${issue.why ? `<p class="issue-why">${esc(issue.why)}</p>` : ''}
        <div class="chips">
          ${diff ? `<span class="chip diff ${esc(diff)}" title="Difficulty">${PEAKS[diff] || ''} ${esc(diff)}</span>` : ''}
          ${mins ? `<span class="chip">${esc(mins)}</span>` : ''}
          <span class="chip">${issue.comments} comments</span>
          ${issue.updated ? `<span class="chip">${esc(ago(issue.updated))}</span>` : ''}
          ${issue.labels.map((l) => `<span class="chip">${esc(l)}</span>`).join('')}
        </div>
        <div class="issue-foot">
          <div class="score">
            ${issue.score ? `<span>Beginner fit ${issue.score}/10</span><span class="score-bar"><i style="width:${issue.score * 10}%"></i></span>` : '<span>Not ranked</span>'}
          </div>
          <div class="chips">
            <button class="star" type="button" data-save="${i}" aria-pressed="${isSaved(issue.url)}" aria-label="Save issue" title="Save for later">&#9733;</button>
            <button class="btn small primary" type="button" data-plan="${i}">Get route</button>
          </div>
        </div>
      </article>`;
  }

  function renderResults(payload) {
    state.results = payload.issues;
    if (!payload.issues.length) {
      $('#results').innerHTML = '<div class="empty-note">No open issues matched. Try another language, a different label, or clear the keyword.</div>';
      return;
    }
    const note = payload.ranked ? 'Ranked by the AI for beginner fit' : 'AI ranking is off, showing newest first';
    $('#results').innerHTML = `
      <div class="results-head"><h2>${payload.issues.length} open issues</h2><span class="hint">${note}</span></div>
      ${payload.issues.map(issueCard).join('')}`;
  }

  async function doSearch(event) {
    if (event) event.preventDefault();
    const params = new URLSearchParams({
      language: $('#lang').value, label: $('#label').value, q: $('#kw').value.trim(),
      hacktoberfest: $('#hf').checked ? '1' : '0',
    });
    renderSkeleton();
    try {
      renderResults(await api('/api/search?' + params));
    } catch (err) {
      $('#results').innerHTML = `<div class="empty-note">${esc(err.message)}</div>`;
    }
  }

  $('#searchForm').addEventListener('submit', doSearch);
  $('#results').addEventListener('click', (e) => {
    const planBtn = e.target.closest('[data-plan]');
    const saveBtn = e.target.closest('[data-save]');
    if (planBtn) startPlan(state.results[+planBtn.dataset.plan].url);
    if (saveBtn) {
      const issue = state.results[+saveBtn.dataset.save];
      toggleSaved({ url: issue.url, title: issue.title, repo: issue.repo });
      saveBtn.setAttribute('aria-pressed', String(isSaved(issue.url)));
    }
  });

  $('#urlForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const url = $('#urlInput').value.trim();
    if (!ISSUE_RE.test(url)) { toast('Paste a link like github.com/owner/repo/issues/123', true); return; }
    startPlan(url);
  });

  /* ---------- saved + recent ---------- */
  function toggleSaved(item) {
    state.saved = isSaved(item.url) ? state.saved.filter((s) => s.url !== item.url) : [item, ...state.saved];
    store.set('saved', state.saved);
    $('#savedCount').textContent = state.saved.length ? `(${state.saved.length})` : '';
    toast(isSaved(item.url) ? 'Saved for later' : 'Removed from saved');
  }

  function addRecent(item) {
    state.recent = [item, ...state.recent.filter((r) => r.url !== item.url)].slice(0, 12);
    store.set('recent', state.recent);
  }

  function listHTML(items, empty, removable) {
    if (!items.length) return `<div class="empty-note" style="border:0">${empty}</div>`;
    return items.map((it, i) => `
      <div class="list-item">
        <div><b>${esc(it.title)}</b><span>${esc(it.repo)}</span></div>
        <div class="chips">
          <button class="btn small primary" data-open="${esc(it.url)}">Get route</button>
          ${removable ? `<button class="btn small" data-remove="${i}">Remove</button>` : ''}
        </div>
      </div>`).join('');
  }

  function renderLists() {
    $('#savedList').innerHTML = listHTML(state.saved, 'Nothing saved yet. Tap the star on an issue to keep it here.', true);
    $('#recentList').innerHTML = listHTML(state.recent, 'Issues you plan will show up here.', false);
    $('#savedCount').textContent = state.saved.length ? `(${state.saved.length})` : '';
  }

  document.addEventListener('click', (e) => {
    const open = e.target.closest('[data-open]');
    const remove = e.target.closest('[data-remove]');
    if (open) startPlan(open.dataset.open);
    if (remove) {
      state.saved.splice(+remove.dataset.remove, 1);
      store.set('saved', state.saved);
      renderLists();
      $$('[data-save]').forEach((b) => b.setAttribute('aria-pressed', String(isSaved(state.results[+b.dataset.save]?.url))));
    }
  });

  /* ---------- plan streaming (Server-Sent Events over fetch) ---------- */
  async function streamPlan(url, fresh, handlers) {
    const res = await fetch('/api/plan/stream', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url, fresh }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || `Request failed (${res.status})`);
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let cut;
      while ((cut = buffer.indexOf('\n\n')) >= 0) {
        const raw = buffer.slice(0, cut);
        buffer = buffer.slice(cut + 2);
        let event = 'message';
        let data = '';
        raw.split('\n').forEach((line) => {
          if (line.startsWith('event:')) event = line.slice(6).trim();
          else if (line.startsWith('data:')) data += line.slice(5).trim();
        });
        if (data && handlers[event]) handlers[event](JSON.parse(data));
      }
    }
  }

  function setStep(id, stepState) {
    const li = $(`#steps [data-step="${id}"]`);
    if (li) li.className = stepState;
  }

  function scheduleRender() {
    if (state.renderQueued) return;
    state.renderQueued = true;
    requestAnimationFrame(() => {
      state.renderQueued = false;
      $('#planOut').innerHTML = md(state.plan);
    });
  }

  function setActions(enabled) {
    $$('#actions button').forEach((b) => { b.disabled = !enabled; });
  }

  function resetPlanUI() {
    state.plan = ''; state.history = [];
    $('#planEmpty').hidden = true;
    $('#planView').hidden = false;
    $('#planRepo').textContent = '';
    $('#planTitle').textContent = 'Loading issue...';
    $('#planChips').innerHTML = '';
    $$('#steps li').forEach((li) => { li.className = ''; });
    $('#trail').open = true;
    $('#trailSummary').textContent = 'Sherpa is working';
    $('#analysis').hidden = true;
    $('#facts').innerHTML = '';
    $('#summary').textContent = '';
    $('#files').innerHTML = '';
    $('#planOut').innerHTML = '';
    $('#planOut').classList.add('streaming');
    $('#draftBox').hidden = true;
    $('#askBox').hidden = true;
    $('#askLog').innerHTML = '';
    setActions(false);
  }

  const handlers = {
    step: ({ id, state: s }) => setStep(id, s),
    meta: (meta) => {
      state.meta = meta;
      $('#planRepo').textContent = `${meta.owner}/${meta.repo}${meta.language ? ' (' + meta.language + ')' : ''}`;
      $('#planTitle').innerHTML = `<a href="${esc(meta.url)}" target="_blank" rel="noopener noreferrer" style="color:inherit">${esc(meta.title)}</a>`;
      $('#planChips').innerHTML =
        `<span class="chip">#${meta.number}</span><span class="chip">${esc(meta.state)}</span>` +
        `<span class="chip">${meta.comments} comments</span>` +
        meta.labels.map((l) => `<span class="chip">${esc(l)}</span>`).join('');
      addRecent({ url: meta.url, title: meta.title, repo: `${meta.owner}/${meta.repo}` });
    },
    analysis: (a) => {
      $('#analysis').hidden = false;
      $('#facts').innerHTML =
        `<div><dt>Difficulty</dt><dd style="color:var(--${a.difficulty === 'Easy' ? 'easy' : a.difficulty === 'Hard' ? 'hard' : 'med'})">${PEAKS[a.difficulty] || ''} ${esc(a.difficulty)}</dd></div>` +
        `<div><dt>Time</dt><dd>about ${a.minutes} min</dd></div>` +
        (a.skills.length ? `<div><dt>Skills</dt><dd>${a.skills.map(esc).join(', ')}</dd></div>` : '') +
        (a.risk ? `<div><dt>Watch out</dt><dd style="font-weight:500">${esc(a.risk)}</dd></div>` : '');
      $('#summary').textContent = a.summary;
    },
    files: (files) => {
      $('#files').innerHTML = files.map((f) =>
        `<a href="${esc(f.url)}" target="_blank" rel="noopener noreferrer">${esc(f.path)}</a>`).join('');
    },
    token: ({ t }) => { state.plan += t; scheduleRender(); },
    done: ({ cached, ms }) => {
      $$('#steps li').forEach((li) => { li.className = 'done'; });
      $('#trailSummary').textContent = cached ? 'Loaded from cache' : `Route ready in ${(ms / 1000).toFixed(1)}s`;
      $('#trail').open = false;
      $('#planOut').classList.remove('streaming');
      $('#planOut').innerHTML = md(state.plan);
      setActions(true);
      $('#askBox').hidden = false;
    },
    error: ({ message }) => failPlan(message),
  };

  function failPlan(message) {
    const running = $('#steps li.running');
    if (running) running.className = 'error';
    $('#trailSummary').textContent = 'Something went wrong';
    $('#planOut').classList.remove('streaming');
    $('#planTitle').textContent = state.meta ? state.meta.title : 'Could not build the route';
    toast(message, true);
    if (state.plan) setActions(true);
  }

  async function startPlan(url, fresh = false) {
    if (state.busy) { toast('A route is already being built. Give it a moment.'); return; }
    state.busy = true;
    state.url = url;
    state.meta = null;
    switchTab('plan');
    resetPlanUI();
    $('#pane-plan').scrollIntoView({ behavior: 'smooth', block: 'start' });
    try {
      await streamPlan(url, fresh, handlers);
    } catch (err) {
      failPlan(err.message);
    } finally {
      state.busy = false;
    }
  }

  /* ---------- plan actions: copy, download, regenerate, drafts ---------- */
  const DRAFT_TITLES = { claim: 'Claim comment', pr: 'PR description', commit: 'Commit message' };

  async function makeDraft(kind, button) {
    const original = button.textContent;
    button.disabled = true;
    button.textContent = 'Writing...';
    try {
      const { text } = await postJSON('/api/draft', { url: state.url, kind, plan: state.plan });
      $('#draftTitle').textContent = DRAFT_TITLES[kind];
      $('#draftOut').textContent = text;
      $('#draftBox').hidden = false;
      $('#draftBox').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    } catch (err) {
      toast(err.message, true);
    } finally {
      button.disabled = false;
      button.textContent = original;
    }
  }

  $('#actions').addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-action]');
    if (!btn || btn.disabled) return;
    const [action, arg] = btn.dataset.action.split(':');
    if (action === 'copy') copyText(state.plan, 'Plan copied');
    if (action === 'regen') startPlan(state.url, true);
    if (action === 'draft') makeDraft(arg, btn);
    if (action === 'download') {
      const name = state.meta ? `${state.meta.repo}-issue-${state.meta.number}-plan.md` : 'plan.md';
      const link = document.createElement('a');
      link.href = URL.createObjectURL(new Blob([state.plan], { type: 'text/markdown' }));
      link.download = name;
      link.click();
      URL.revokeObjectURL(link.href);
    }
  });
  $('#draftCopy').addEventListener('click', () => copyText($('#draftOut').textContent, 'Draft copied'));

  /* ---------- ask Sherpa ---------- */
  function addBubble(role, html) {
    const el = document.createElement('div');
    el.className = 'bubble ' + (role === 'user' ? 'me' : 'bot');
    el.innerHTML = html;
    $('#askLog').appendChild(el);
    el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    return el;
  }

  $('#askForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const input = $('#askInput');
    const question = input.value.trim();
    if (!question) return;
    input.value = '';
    addBubble('user', esc(question));
    const pending = addBubble('assistant', '<i>Thinking...</i>');
    $('#askBtn').disabled = true;
    try {
      const { answer } = await postJSON('/api/ask', {
        url: state.url, question, plan: state.plan, history: state.history.slice(-6),
      });
      pending.innerHTML = md(answer);
      state.history.push({ role: 'user', content: question }, { role: 'assistant', content: answer });
    } catch (err) {
      pending.textContent = err.message;
    } finally {
      $('#askBtn').disabled = false;
    }
  });

  /* ---------- keyboard + start ---------- */
  document.addEventListener('keydown', (e) => {
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName);
    if (e.key === '/' && !typing) { e.preventDefault(); $('#kw').focus(); }
  });

  loadConfig();
  renderLists();
  doSearch();
})();
