// Projects: a proposed book, its comparable titles, and how critics received them.
// Projects live in this browser's localStorage as { id: { id, title, pitch, comps: [slug], hidden: [slug], created, edited } }.
// Comparable titles are suggested from three signals, each scaled to its best match and then summed:
//   pitch    the title and pitch scored against data/comps.json, a table of distinctive terms per book (site/build.py)
//   comps    the same terms averaged over the titles already chosen
//   critics  books the critics of the chosen titles also reviewed well, damped by each critic's review count
// The sum is scaled by review depth so thinly reviewed books rank lower. Everything else on the page is computed from the
// chosen titles' reviews: reception, outlets and critics, recurring terms in the pull quotes, and representative quotes.
(() => {
  const KEY = 'publisher-projects';
  const W_PITCH = 1, W_COMPS = 1, W_CRITICS = 0.5;
  const SUGGEST = 12, QUOTES = 8, PEOPLE = 12, THEMES = 12;

  let P = {};
  try { P = JSON.parse(localStorage.getItem(KEY)) || {}; } catch { P = {}; }
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(P)); } catch {} };
  const day = t => t ? new Date(t).toISOString().slice(0, 10) : '';
  const short = b => `<a href="#/book/${enc(b.slug)}" data-book-preview="${esc(b.slug)}">${esc(b.title.split(/:\s/)[0])}</a>`;
  const pct = (a, n) => n ? Math.round(100 * a / n) + '%' : '';
  const who = e => cByName[e.name] === e ? cLink(e) : oLink(e);
  const mixBar = (d, wide) => {
    const n = d[0] + d[1] + d[2] + d[3];
    return `<span class="mix${wide ? ' wide' : ''}" title="${esc(distTxt(d))}">${n ? d.map((x, j) => `<i class="r${4 - j}" style="width:${100 * x / n}%"></i>`).join('') : ''}</span>`;
  };
  const touch = p => { p.edited = Date.now(); save(); };

  // ---- term index (mirrors tokens() in site/build.py) ----
  let IX = null;
  const loadIndex = () => IX ??= fetch('data/comps.json').then(r => r.json()).then(d => {
    const inv = new Map(), vec = new Map();
    for (const row of d.books) {
      const b = B[row[0]], v = [];
      for (let k = 1; k < row.length; k += 2) {
        const w = row[k + 1] / 1000;
        v.push([row[k], w]);
        (inv.get(row[k]) || inv.set(row[k], []).get(row[k])).push([b, w]);
      }
      vec.set(b, v);
    }
    return { stop: new Set(d.stop), tid: new Map(d.terms.map((t, i) => [t, i])), terms: d.terms, idf: d.idf, inv, vec };
  }).catch(e => { IX = null; throw e; });
  const stem = w => w.length > 4 && w.endsWith('ies') ? w.slice(0, -3) + 'y'
    : w.length > 4 && /(sses|xes|ches|shes)$/.test(w) ? w.slice(0, -2)
    : w.length > 3 && w.endsWith('s') && !/(ss|us|is|ics)$/.test(w) ? w.slice(0, -1) : w;
  function tokens(text, stop) {
    const words = (String(text).toLowerCase().replace(/’/g, "'").match(/[a-z][a-z'-]+/g) || [])
      .map(w => w.replace(/^['-]+|['-]+$/g, '').replace(/'s$/, '')).map(w => stop.has(w) ? w : stem(w));
    const ok = w => w.length > 2 && !stop.has(w);
    const out = words.filter(ok);
    for (let i = 1; i < words.length; i++) if (ok(words[i - 1]) && ok(words[i])) out.push(words[i - 1] + ' ' + words[i]);
    return out;
  }
  function queryVec(text, ix) {
    const tf = new Map();
    for (const t of tokens(text, ix.stop)) { const j = ix.tid.get(t); if (j !== undefined) tf.set(j, (tf.get(j) || 0) + 1); }
    const v = new Map();
    for (const [j, k] of tf) v.set(j, (1 + Math.log(k)) * ix.idf[j]);
    return unit(v);
  }
  function unit(v) {
    let n = 0; for (const w of v.values()) n += w * w; n = Math.sqrt(n) || 1;
    for (const [j, w] of v) v.set(j, w / n);
    return v;
  }
  const keyTerms = (b, ix, k = 3) => {
    const own = new Set(tokens(`${b.title} ${b.author}`, ix.stop).flatMap(t => t.split(' ')));
    return (ix.vec.get(b) || []).map(([j]) => ix.terms[j]).filter(t => !t.split(' ').some(w => own.has(w))).slice(0, k).join(', ');
  };

  // ---- suggestions ----
  function suggest(p, ix) {
    const comps = p.comps.map(s => bySlug[s]).filter(Boolean);
    const skip = new Set([...p.comps, ...p.hidden]);
    const parts = { pitch: new Map(), comps: new Map(), critics: new Map() };
    const scan = (v, into, hits) => { for (const [j, w] of v) for (const [b, bw] of ix.inv.get(j) || []) { into.set(b, (into.get(b) || 0) + w * bw); hits?.set(b, (hits.get(b) || 0) + 1); } };
    const q = queryVec(`${p.title} ${p.pitch}`, ix), hits = new Map();
    scan(q, parts.pitch, hits);
    // one shared term is weak evidence: halve those, so a single rare word in the pitch cannot carry a book
    for (const [b, k] of hits) if (k < 2) parts.pitch.set(b, parts.pitch.get(b) / 2);
    if (comps.length) {
      const c = new Map();
      for (const b of comps) for (const [j, w] of ix.vec.get(b) || []) c.set(j, (c.get(j) || 0) + w);
      scan(unit(c), parts.comps);
      const set = new Set(comps), cw = new Map();
      for (const r of R) if (r.c && r.v && set.has(r.b)) cw.set(r.c, (cw.get(r.c) || 0) + 1);
      for (const r of R) if (r.v >= 3 && cw.has(r.c)) parts.critics.set(r.b, (parts.critics.get(r.b) || 0) + cw.get(r.c) / Math.sqrt(1 + r.c.n));
    }
    const total = new Map(), best = new Map();
    for (const [name, m, w] of [['pitch', parts.pitch, W_PITCH], ['comps', parts.comps, W_COMPS], ['critics', parts.critics, W_CRITICS]]) {
      let top = 0; for (const x of m.values()) if (x > top) top = x;
      if (!top) continue;
      for (const [b, x] of m) {
        if (skip.has(b.slug) || b.cnt < 3) continue;
        const s = w * x / top;
        total.set(b, (total.get(b) || 0) + s);
        if (!best.has(b) || best.get(b)[1] < s) best.set(b, [name, s]);
      }
    }
    const depth = b => 0.75 + 0.25 * Math.min(1, Math.log(1 + b.cnt) / Math.log(30));
    // keep to the comps' side of fiction and nonfiction; with no comps yet, read it from the pitch
    const gc = {}; for (const b of comps) for (const g of b.genres) gc[g] = (gc[g] || 0) + 1;
    const fictional = comps.length ? (gc['Fiction'] || 0) > (gc['Non-Fiction'] || 0)
      : /\b(novels?|fiction|stories|thriller|mystery|poems|poetry|fantasy|romance)\b/i.test(p.pitch);
    const kind = b => !b.genres.length ? 0.85 : b.genres.includes(fictional ? 'Fiction' : 'Non-Fiction') ? 1 : 0.6;
    const near = b => comps.length && b.genres.length ? 0.8 + 0.2 * b.genres.filter(g => gc[g]).length / b.genres.length : 1;
    return [...total].map(([b, s]) => ({ b, s: s * depth(b) * kind(b) * near(b), why: best.get(b)[0] })).sort((x, y) => y.s - x.s).slice(0, SUGGEST)
      .map(x => ({ ...x, reason: reason(x, q, comps, ix) }));
  }
  function reason({ b, why }, q, comps, ix) {
    const v = ix.vec.get(b) || [];
    if (why === 'pitch') {
      const hit = v.filter(([j]) => q.has(j)).sort((x, y) => q.get(y[0]) * y[1] - q.get(x[0]) * x[1]).slice(0, 2).map(([j]) => ix.terms[j]);
      return hit.length ? 'matches ' + hit.join(', ') : 'matches the pitch';
    }
    if (why === 'comps') {
      const m = new Map(v);
      let top = null, s = 0;
      for (const c of comps) { let x = 0; for (const [j, w] of ix.vec.get(c) || []) x += w * (m.get(j) || 0); if (x > s) { s = x; top = c; } }
      return top ? 'like ' + short(top) : 'like your comps';
    }
    return 'reviewed by critics of your comps';
  }

  // ---- reviews of the chosen titles ----
  function reception(comps) {
    const set = new Set(comps), rs = R.filter(r => set.has(r.b));
    const dist = [0, 0, 0, 0]; let sum = 0, cnt = 0;
    for (const r of rs) if (r.v) { dist[4 - r.v]++; sum += r.v; cnt++; }
    const years = {};
    for (const b of comps) if (b.year) { const y = years[b.year] ??= { n: 0, sum: 0, cnt: 0, books: 0 }; y.books++; y.n += b.n; y.sum += b.sum; y.cnt += b.cnt; }
    const outlets = new Map(), critics = new Map();
    for (const r of rs) {
      for (const [e, m] of [[r.o, outlets], [r.c, critics]]) {
        if (!e) continue;
        const x = m.get(e) || m.set(e, { e, books: new Map(), dist: [0, 0, 0, 0], sum: 0, cnt: 0, outlets: new Map() }).get(e);
        x.books.set(r.b, r.v); if (r.v) { x.dist[4 - r.v]++; x.sum += r.v; x.cnt++; }
        if (m === critics && r.o) x.outlets.set(r.o, (x.outlets.get(r.o) || 0) + 1);
      }
    }
    const rank = m => [...m.values()].sort((a, b) => b.books.size - a.books.size || b.cnt - a.cnt).slice(0, PEOPLE);
    return { rs, dist, sum, cnt, years, outlets: rank(outlets), critics: rank(critics), nOutlets: outlets.size };
  }

  function trendSvg(years) {
    const ys = Object.keys(years).map(Number).sort((a, b) => a - b);
    if (ys.length < 2) return '';
    const lo = ys[0], hi = ys[ys.length - 1], W = 680, H = 150, L = 44, Bm = 20, span = Math.max(1, hi - lo);
    const maxN = Math.max(...ys.map(y => years[y].n));
    const x = y => L + (W - L - 10) * (y - lo) / span, bw = Math.max(4, Math.min(24, (W - L) / (span + 1) * 0.6));
    const yN = n => H - Bm - (H - Bm - 10) * n / maxN, yM = m => H - Bm - (H - Bm - 10) * (m - 1) / 3;
    const pts = ys.filter(y => years[y].cnt).map(y => [x(y), yM(years[y].sum / years[y].cnt)]);
    const ticks = ys.length <= 12 ? ys : ys.filter((y, i) => i % Math.ceil(ys.length / 10) === 0);
    return `<svg class="trend" viewBox="0 0 ${W} ${H}" role="img" aria-label="Reviews and mean rating of the comparable titles by publication year">
      ${ys.map(y => `<rect class="bar" x="${x(y) - bw / 2}" y="${yN(years[y].n)}" width="${bw}" height="${H - Bm - yN(years[y].n)}"><title>${y}: ${years[y].books} titles, ${years[y].n} reviews</title></rect>`).join('')}
      <polyline class="line" points="${pts.map(p => p.join(',')).join(' ')}"/>
      ${pts.map(([px, py], i) => `<circle class="dot" cx="${px}" cy="${py}" r="2.5"/>`).join('')}
      ${['pan', 'rave'].map((l, i) => `<text x="0" y="${yM(i ? 4 : 1) + 4}">${l}</text>`).join('')}
      ${ticks.map(y => `<text x="${x(y)}" y="${H - 4}" text-anchor="middle">${y}</text>`).join('')}
    </svg>`;
  }

  // ---- themes: recurring terms in the comps' pull quotes ----
  async function themes(comps, ix) {
    const details = await Promise.all(comps.map(b => detail(b.slug).then(d => [b, d]).catch(() => [b, { r: [] }])));
    const own = new Set(comps.flatMap(b => tokens(`${b.title} ${b.author}`, ix.stop)));
    const quotes = [], df = new Map();
    for (const [b, d] of details) for (const [, v, critic, outlet, url, q, src, date] of d.r) {
      if (!q || (S.src && (S.src === 'bm' ? src : !src))) continue;
      const ts = new Set(tokens(q, ix.stop).filter(t => ix.tid.has(t) && !own.has(t) && !t.split(' ').some(w => own.has(w))));
      quotes.push({ b, v, critic, outlet, url, q, date, ts });
      for (const t of ts) { const x = df.get(t) || df.set(t, { t, n: 0, pos: 0, neg: 0, books: new Set() }).get(t); x.n++; x.books.add(b); if (v >= 3) x.pos++; else if (v) x.neg++; }
    }
    const min = Math.max(2, Math.round(quotes.length / 60));
    const list = [...df.values()].filter(x => x.n >= min && x.books.size >= Math.min(2, comps.length))
      .map(x => ({ ...x, score: x.n * ix.idf[ix.tid.get(x.t)] })).sort((a, b) => b.score - a.score).slice(0, THEMES);
    return { quotes, list };
  }

  // ---- views ----
  V.projects = () => {
    const list = Object.values(P).sort((a, b) => b.edited - a.edited);
    head(`<div class="meta">${list.length ? int(list.length) + (list.length === 1 ? ' project' : ' projects') + ' · ' : ''}<button type="button" class="tx" data-act="new">new project</button></div>`);
    $('#below').innerHTML = list.length ? `<div class="scroll"><table class="plain"><thead><tr><th>Project</th><th class="r">Comps</th><th class="r">Reviews</th><th class="r">Edited</th></tr></thead><tbody>${list.map(p => {
      const comps = p.comps.map(s => bySlug[s]).filter(Boolean);
      return `<tr><td><a href="#/project/${enc(p.id)}">${esc(p.title || 'Untitled project')}</a>${p.pitch ? `<span class="sub">${esc(p.pitch.slice(0, 80))}</span>` : ''}</td><td class="r">${comps.length}</td><td class="r">${int(comps.reduce((s, b) => s + b.n, 0))}</td><td class="r nw">${day(p.edited)}</td></tr>`;
    }).join('')}</tbody></table></div>` : '<p class="empty">Start a project for a book you are considering. Describe it, choose comparable titles, and see how critics received them.</p>';
    $('#count').textContent = ''; $('#out').innerHTML = '';
  };

  V.project = id => {
    const p = P[id];
    if (!p) return head('<h1>Not found</h1>');
    head('');
    $('#count').textContent = ''; $('#out').innerHTML = '';
    $('#below').innerHTML = `<div class="proj">
      <input class="title" id="p-title" placeholder="Untitled project" value="${esc(p.title)}" aria-label="Project title">
      <textarea class="pitch" id="p-pitch" rows="1" placeholder="Describe the book: its subject, approach and readers. Comparable titles are suggested from this." aria-label="Pitch">${esc(p.pitch)}</textarea>
      <div class="meta" id="p-meta"></div>
      <div class="jump">${[['comps', 'Comparable titles'], ['reception', 'Reception'], ['people', 'Outlets and critics'], ['themes', 'Themes'], ['quotes', 'Criticism']]
        .map(([k, l]) => `<button type="button" class="tx" data-jump="${k}">${l}</button>`).join('')}</div>
      <p class="brief" id="p-brief"></p>
      <h2 class="sec" id="s-comps">Comparable titles</h2><div id="p-comps"></div>
      <input class="find" id="p-find" placeholder="Add a title" autocomplete="off" spellcheck="false" aria-label="Add a comparable title"><ul class="hits" id="p-hits"></ul>
      <h2 class="sec">Suggested</h2><div class="meta" style="margin:0">From the pitch, the titles above, and the critics who reviewed them</div><div id="p-suggest"><p class="loading">Loading…</p></div>
      <h2 class="sec" id="s-reception">Reception</h2><div id="p-reception"></div>
      <h2 class="sec" id="s-people">Outlets and critics</h2><div id="p-people"></div>
      <h2 class="sec" id="s-themes">Themes</h2><div id="p-themes"></div>
      <h2 class="sec" id="s-quotes">Representative criticism</h2><div id="p-quotes"></div>
    </div>`;
    fit($('#p-pitch'));
    render(p);
  };

  let quoteState = { filter: '', theme: '', shown: QUOTES }, themeData = null, renderId = 0;
  async function render(p, { only } = {}) {
    const id = ++renderId;
    const comps = p.comps.map(s => bySlug[s]).filter(Boolean);
    delete $('#p-meta').dataset.confirm;
    $('#p-meta').innerHTML = `${int(comps.length)} ${comps.length === 1 ? 'title' : 'titles'} · created ${day(p.created)} · edited ${day(p.edited)} · <button type="button" class="tx" data-act="delete">delete</button>`;
    let ix;
    try { ix = await loadIndex(); } catch { $('#p-suggest').innerHTML = '<p class="empty">Suggestions are unavailable. Reload to try again.</p>'; return; }
    if (id !== renderId || S.arg !== p.id) return;
    const sugg = suggest(p, ix);
    $('#p-suggest').innerHTML = sugg.length ? `<ul class="hits">${sugg.map(x => `<li><span class="grow">${short(x.b)} <span class="d">${esc(baseAuthor(x.b.author))}${x.b.year ? ', ' + x.b.year : ''} · ${x.reason}</span></span>
      <button type="button" class="tx" data-add="${esc(x.b.slug)}">add</button><button type="button" class="tx x" data-hide="${esc(x.b.slug)}" aria-label="Dismiss">×</button></li>`).join('')}</ul>`
      : '<p class="empty">Write a pitch or add a title to get suggestions.</p>';
    if (only === 'suggest') return;

    $('#p-comps').innerHTML = comps.length ? `<div class="scroll"><table class="plain"><thead><tr><th>Title</th><th class="desk">Author</th><th class="r">Year</th><th class="r">Reviews</th><th>Reception</th><th class="r" title="${esc(TIP.adj)}">Adjusted</th><th class="desk">Key terms</th><th></th></tr></thead><tbody>${comps.slice().sort((a, b) => (b.adj ?? 0) - (a.adj ?? 0)).map(b =>
      `<tr><td>${short(b)}<span class="sub">${esc(baseAuthor(b.author))}</span></td><td class="desk">${esc(baseAuthor(b.author))}</td><td class="r">${b.year || ''}</td><td class="r">${int(b.n)}</td><td>${mixBar(b.dist)}</td><td class="r">${f2(b.adj)}</td><td class="desk d">${esc(keyTerms(b, ix))}</td><td class="r"><button type="button" class="tx x" data-remove="${esc(b.slug)}" aria-label="Remove">×</button></td></tr>`).join('')}</tbody></table></div>`
      : '<p class="empty">No comparable titles yet. Add one below or from the suggestions.</p>';

    if (!comps.length) {
      for (const k of ['reception', 'people', 'themes', 'quotes']) $('#p-' + k).innerHTML = '<p class="empty">Add comparable titles to see this.</p>';
      $('#p-brief').textContent = '';
      return;
    }
    const rc = reception(comps);
    const [rave, pos, mixed, pan] = rc.dist;
    $('#p-reception').innerHTML = `${mixBar(rc.dist, true)}<div class="legend">${['rave', 'positive', 'mixed', 'pan'].map((l, j) => `<span><b>${pct(rc.dist[j], rc.cnt)}</b> ${l}</span>`).join('')}<span><b>${int(rc.rs.length)}</b> reviews</span><span><b>${f2(rc.cnt ? rc.sum / rc.cnt : null)}</b> mean</span></div>
      ${trendSvg(rc.years) ? `<div class="meta" style="margin-top:20px">Reviews (bars) and mean rating (line) by publication year</div>${trendSvg(rc.years)}` : ''}`;
    const outletRows = rc.outlets.map(x => `<tr><td class="nw">${oLink(x.e)}</td><td class="r">${x.books.size} of ${comps.length}</td><td>${mixBar(x.dist)}</td><td class="r">${f2(x.cnt ? x.sum / x.cnt : null)}</td><td class="r">${sgn(x.e.vs)}</td></tr>`).join('');
    const criticRows = rc.critics.map(x => {
      const home = [...x.outlets].sort((a, b) => b[1] - a[1])[0]?.[0];
      return `<tr><td class="nw">${cLink(x.e)}${home ? `<span class="sub">${esc(home.name)}</span>` : ''}</td><td class="desk d nw">${home ? esc(home.name) : ''}</td><td class="list">${[...x.books].map(([b, v]) => `${short(b)} <span class="d">${LABEL[v] || 'review'}</span>`).join(', ')}</td><td class="r">${int(x.e.n)}</td></tr>`;
    }).join('');
    $('#p-people').innerHTML = `<div class="two">
      <div><div class="meta" style="margin:0">Outlets that reviewed the most of these titles</div><div class="scroll"><table class="plain"><thead><tr><th>Outlet</th><th class="r">Titles</th><th>Reception</th><th class="r">Mean</th><th class="r" title="${esc(TIP.vs)}">Vs. others</th></tr></thead><tbody>${outletRows}</tbody></table></div></div>
      <div><div class="meta" style="margin:0">Critics who reviewed them</div><div class="scroll"><table class="plain"><thead><tr><th>Critic</th><th class="desk">Outlet</th><th>Their ratings</th><th class="r">Reviews</th></tr></thead><tbody>${criticRows}</tbody></table></div></div></div>`;

    $('#p-themes').innerHTML = '<p class="loading">Reading reviews…</p>';
    $('#p-quotes').innerHTML = '';
    const th = await themes(comps, ix);
    if (id !== renderId || S.arg !== p.id) return;
    themeData = th;
    if (quoteState.theme && !th.list.some(x => x.t === quoteState.theme)) quoteState.theme = '';
    $('#p-themes').innerHTML = th.list.length ? `<div class="meta" style="margin:0">Terms that recur in the pull quotes, and how often they appear in positive reviews. Select one to see its quotes</div><div class="scroll narrow"><table class="plain"><thead><tr><th>Term</th><th class="r">Reviews</th><th class="r">Titles</th><th class="r">In positive reviews</th><th>Leans</th></tr></thead><tbody>${th.list.map(x => {
      const share = x.pos / Math.max(1, x.pos + x.neg);
      return `<tr><td><button type="button" class="tx${quoteState.theme === x.t ? ' on' : ''}" data-theme="${esc(x.t)}">${esc(x.t)}</button></td><td class="r">${int(x.n)}</td><td class="r">${x.books.size}</td><td class="r">${pct(x.pos, x.pos + x.neg)}</td><td class="d">${share >= 0.85 ? 'praised' : share >= 0.6 ? 'mostly praised' : 'divided'}</td></tr>`;
    }).join('')}</tbody></table></div>` : '<p class="empty">Too few pull quotes to find recurring terms.</p>';
    drawQuotes();

    const top = rc.outlets[0];
    const praised = th.list.filter(x => x.pos / Math.max(1, x.pos + x.neg) >= 0.85).slice(0, 2).map(x => x.t);
    const divided = th.list.filter(x => x.pos / Math.max(1, x.pos + x.neg) < 0.6).slice(0, 1).map(x => x.t);
    $('#p-brief').innerHTML = `${int(comps.length)} comparable ${comps.length === 1 ? 'title' : 'titles'} drew ${int(rc.rs.length)} reviews from ${int(rc.nOutlets)} outlets, ${pct(rave + pos, rc.cnt)} rave or positive and ${pct(mixed + pan, rc.cnt)} mixed or pan.`
      + (top && top.books.size > 1 ? ` ${esc(top.e.name)} reviewed the most (${top.books.size} of ${comps.length}).` : '')
      + (praised.length ? ` Reviews most often praised ${praised.map(esc).join(' and ')}` + (divided.length ? `; ${esc(divided[0])} divided critics.` : '.') : '');
  }

  function drawQuotes() {
    const th = themeData, box = $('#p-quotes');
    if (!th || !box) return;
    const groups = { '': () => true, positive: q => q.v >= 3, mixed: q => q.v === 2, negative: q => q.v === 1 };
    const rated = th.quotes.filter(q => q.v);
    const strong = new Set(th.list.map(x => x.t));
    const pool = rated.filter(groups[quoteState.filter]).filter(q => !quoteState.theme || q.ts.has(quoteState.theme))
      .map(q => ({ ...q, score: [...q.ts].filter(t => strong.has(t)).length + Math.log10(1 + (oByName[q.outlet]?.n || 0)) / 2 - (q.q.length > 400 ? 1 : 0) }))
      .sort((a, b) => b.score - a.score);
    // round-robin across titles so one book does not take every slot
    const byBook = new Map(); for (const q of pool) (byBook.get(q.b) || byBook.set(q.b, []).get(q.b)).push(q);
    const order = []; for (let i = 0; order.length < pool.length; i++) for (const qs of byBook.values()) if (qs[i]) order.push(qs[i]);
    const shown = order.slice(0, quoteState.shown);
    box.innerHTML = `<div class="filters">${[['', 'All'], ['positive', 'Positive'], ['mixed', 'Mixed'], ['negative', 'Negative']].map(([k, l]) =>
      `<button type="button" class="tx${quoteState.filter === k ? ' on' : ''}" data-filter="${k}">${l} ${int(rated.filter(groups[k]).length)}</button>`).join('')}
      ${quoteState.theme ? `<button type="button" class="tx on" data-theme="${esc(quoteState.theme)}">“${esc(quoteState.theme)}” ×</button>` : ''}</div>
      <div class="quotes">${shown.map(q => `<div class="rev"><div class="h"><b>${LABEL[q.v]}</b> · ${short(q.b)} · ${q.critic ? cLink(cByName[q.critic]) : 'Unsigned'}${q.outlet ? ', ' + oLink(oByName[q.outlet]) : ''}${q.date ? ' · ' + esc(q.date) : ''}${q.url ? ` · <a href="${esc(q.url)}" target="_blank" rel="noopener">read ↗</a>` : ''}</div><p>${esc(q.q)}</p></div>`).join('') || '<p class="empty">No quotes match.</p>'}</div>
      ${order.length > shown.length ? `<button type="button" class="tx d more" data-act="more-quotes">${Math.min(QUOTES, order.length - shown.length)} more</button>` : ''}`;
  }

  function fit(t) { t.style.height = 'auto'; t.style.height = t.scrollHeight + 'px'; }
  function findHits(p, text) {
    const terms = fold(text).split(/\s+/).filter(Boolean), have = new Set(p.comps);
    if (!terms.length) return '';
    return B.filter(b => b.n && !have.has(b.slug) && terms.every(t => b.hay.includes(t))).sort((a, b) => b.n - a.n).slice(0, 8)
      .map(b => `<li><span class="grow">${short(b)} <span class="d">${esc(baseAuthor(b.author))}${b.year ? ', ' + b.year : ''} · ${int(b.n)} reviews</span></span><button type="button" class="tx" data-add="${esc(b.slug)}">add</button></li>`).join('')
      || '<li><span class="d">No matching titles</span></li>';
  }

  // ---- events ----
  let typing;
  const current = () => S.view === 'project' ? P[S.arg] : null;
  $('#below').addEventListener('input', e => {
    const p = current(); if (!p) return;
    if (e.target.id === 'p-title' || e.target.id === 'p-pitch') {
      p[e.target.id === 'p-title' ? 'title' : 'pitch'] = e.target.value;
      if (e.target.id === 'p-pitch') fit(e.target);
      touch(p);
      clearTimeout(typing); typing = setTimeout(() => render(p, { only: 'suggest' }), 350);
    }
    if (e.target.id === 'p-find') $('#p-hits').innerHTML = findHits(p, e.target.value);
  });
  $('#below').addEventListener('click', e => {
    const p = current(), t = e.target.closest('button');
    if (!t) return;
    if (t.dataset.act === 'new') return newProject();
    if (!p) return;
    const d = t.dataset;
    if (d.jump) return document.getElementById('s-' + d.jump)?.scrollIntoView({ behavior: 'smooth' });
    if (d.add) { if (!p.comps.includes(d.add)) p.comps.push(d.add); p.hidden = p.hidden.filter(s => s !== d.add); $('#p-find').value = ''; $('#p-hits').innerHTML = ''; }
    else if (d.remove) p.comps = p.comps.filter(s => s !== d.remove);
    else if (d.hide) p.hidden.push(d.hide);
    else if (d.filter !== undefined) { quoteState.filter = d.filter; quoteState.shown = QUOTES; return drawQuotes(); }
    else if (d.theme !== undefined) {
      quoteState.theme = quoteState.theme === d.theme ? '' : d.theme; quoteState.shown = QUOTES;
      document.querySelectorAll('#p-themes [data-theme]').forEach(b => b.classList.toggle('on', b.dataset.theme === quoteState.theme));
      drawQuotes();
      if (quoteState.theme && t.closest('#p-themes')) $('#s-quotes').scrollIntoView({ behavior: 'smooth' });
      return;
    }
    else if (d.act === 'more-quotes') { quoteState.shown += QUOTES; return drawQuotes(); }
    else if (d.act === 'delete') {
      if (!$('#p-meta').dataset.confirm) { $('#p-meta').dataset.confirm = '1'; t.textContent = 'confirm delete'; return; }
      delete P[p.id]; save(); location.hash = '#/projects'; return;
    } else return;
    touch(p);
    render(p, d.hide ? { only: 'suggest' } : {});
  });
  $('#head').addEventListener('click', e => { if (e.target.closest('[data-act=new]')) newProject(); });
  function newProject() {
    const id = Date.now().toString(36);
    P[id] = { id, title: '', pitch: '', comps: [], hidden: [], created: Date.now(), edited: Date.now() };
    save();
    quoteState = { filter: '', theme: '', shown: QUOTES };
    location.hash = '#/project/' + id;
    setTimeout(() => $('#p-title')?.focus(), 50);
  }
  addEventListener('hashchange', () => { if (!location.hash.startsWith('#/project/')) quoteState = { filter: '', theme: '', shown: QUOTES }; });

  // ---- add to project from a book page ----
  const book = V.book;
  V.book = slug => {
    const done = book(slug);
    const list = Object.values(P).sort((a, b) => b.edited - a.edited);
    const meta = document.querySelector('#head .meta');
    if (meta && list.length) meta.insertAdjacentHTML('beforeend', ` · <select id="to-project" aria-label="Add to a project"><option value="">add to project</option>${list.map(p =>
      `<option value="${esc(p.id)}"${p.comps.includes(slug) ? ' disabled' : ''}>${esc(p.title || 'Untitled project')}${p.comps.includes(slug) ? ' (added)' : ''}</option>`).join('')}</select>`);
    return done;
  };
  $('#head').addEventListener('change', e => {
    if (e.target.id !== 'to-project' || !e.target.value) return;
    const p = P[e.target.value];
    if (p && !p.comps.includes(S.arg)) { p.comps.push(S.arg); touch(p); }
    const o = e.target.selectedOptions[0]; o.textContent += ' (added)'; o.disabled = true;
    e.target.value = '';
  });
})();
