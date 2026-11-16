// Canadian Insurance Ad Teardown: renders everything from data/*.json.
// Data is inserted with textContent only (ad copy is untrusted text).

(async function () {
  'use strict';

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  // el('p', {class: 'x', text: 'hi'}, child, child...)
  function el(tag, attrs = {}, ...kids) {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (v === null || v === undefined || v === false) continue;
      if (k === 'text') n.textContent = v;
      else if (k === 'class') n.className = v;
      else if (k === 'dataset') Object.assign(n.dataset, v);
      else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
      else n.setAttribute(k, v === true ? '' : v);
    }
    for (const k of kids.flat()) if (k !== null && k !== undefined && k !== false) n.append(k);
    return n;
  }

  async function load(path) {
    const r = await fetch(path, { cache: 'no-cache' });
    if (!r.ok) throw new Error(`${path}: ${r.status}`);
    return r.json();
  }

  let ads, tax, briefs, sources, excluded;
  try {
    [ads, tax, briefs, sources, excluded] = await Promise.all([
      load('data/ads.json'), load('data/taxonomy.json'), load('data/briefs.json'),
      load('data/sources.json'), load('data/excluded.json').catch(() => []),
    ]);
  } catch (err) {
    $('#stats').replaceWith(el('p', { class: 'hypothesis-banner',
      text: 'Could not load the data files. If you opened index.html directly from disk, serve the folder instead (for example: python -m http.server) and open http://localhost:8000.' }));
    console.error(err);
    return;
  }

  // ---------- labels & helpers ----------
  const index = list => Object.fromEntries(list.map(x => [x.key, x]));
  const ANG = index(tax.angles), AUD = index(tax.audiences), PROD = index(tax.products),
        FMT = index(tax.formats), LANG = index(tax.languages);
  const angleOrder = tax.angles.map(a => a.key);
  const label = (map, key) => (map[key] ? map[key].label : key);
  const pct = (n, d) => (d ? Math.round((100 * n) / d) : 0);
  const fmtDate = iso => new Date(iso + 'T12:00:00').toLocaleDateString('en-CA', { month: 'short', day: 'numeric', year: 'numeric' });
  const count = (xs, f) => xs.reduce((s, x) => s + (f(x) ? 1 : 0), 0);
  const listText = items => items.length <= 1 ? (items[0] || '') :
    items.slice(0, -1).join(', ') + ' and ' + items[items.length - 1];

  const brandCounts = {};
  ads.forEach(a => { brandCounts[a.brand] = (brandCounts[a.brand] || 0) + 1; });
  const HOME = 'PolicyMe';
  const brands = Object.keys(brandCounts).sort((a, b) =>
    (a === HOME ? -1 : b === HOME ? 1 : brandCounts[b] - brandCounts[a]));
  const byBrand = b => ads.filter(a => a.brand === b);
  const competitors = brands.filter(b => b !== HOME);

  // share bins for the sequential ramp: (0,10], (10,20], (20,35], (35,50], 50+
  const BINS = [10, 20, 35, 50];
  const BIN_LABELS = ['up to 10%', '10–20%', '20–35%', '35–50%', '50%+'];
  const bin = share => (share <= 0 ? 0 : 1 + BINS.filter(t => share * 100 > t).length);

  // ---------- hero ----------
  const starts = ads.map(a => a.start_date).filter(Boolean).sort();
  const collected = [...new Set(ads.map(a => a.collected_date))].sort();
  const stats = [
    ['Ads analyzed', ads.length.toLocaleString('en-CA')],
    ['Brands', String(brands.length)],
    ['Collected', collected.map(fmtDate).join(', ')],
    ['Start dates', starts.length ? `${fmtDate(starts[0]).replace(/, \d{4}$/, '')} – ${fmtDate(starts[starts.length - 1])}` : '—'],
  ];
  $('#stats').append(...stats.map(([k, v]) => el('div', {}, el('dt', { text: k }), el('dd', { text: v }))));
  const exBrands = [...new Set(excluded.map(e => e.brand))];
  $('#hero-note').textContent =
    `An independent analysis of public ads, not affiliated with PolicyMe. ${brands.map(b => `${b} (${brandCounts[b]})`).join(' · ')}. ` +
    (excluded.length ? `${excluded.length} more ads from ${listText(exBrands)} were left out because they weren't insurance or were outside PolicyMe's market.` : '');

  // ---------- findings ----------
  const pm = byBrand(HOME);
  const findings = [];

  // 1. one post text, many creatives
  const couples = pm.filter(a => (a.hook || '').startsWith('Couples save 10%'));
  if (couples.length) {
    const leadOffer = count(couples, a => a.primary_angle === 'offer_discount');
    const top = Object.entries(couples.reduce((m, a) => (m[a.primary_angle] = (m[a.primary_angle] || 0) + 1, m), {}))
      .sort((x, y) => y[1] - x[1]).slice(0, 3).map(([k]) => label(ANG, k).toLowerCase());
    findings.push({
      title: `${couples.length} of ${pm.length} PolicyMe ads share the same “Couples save 10%” post text`,
      body: `Only ${leadOffer} of those ${couples.length} creatives leads with the discount; the most common leads are ${listText(top)}. The post text stays fixed while the creative carries the angle, which looks like creative testing against a constant message.`,
      basis: `${couples.length} / ${pm.length}`,
    });
  }

  // 2. social proof never leads
  const leadSP = count(ads, a => a.primary_angle === 'social_proof');
  const pmReviews = count(pm, a => (a.proof_elements || []).includes('reviews'));
  findings.push({
    title: leadSP ? `Only ${leadSP} of ${ads.length} ads lead with social proof` : 'No brand leads with social proof',
    body: `${leadSP} of ${ads.length} ads open on reviews or ratings, yet ${pmReviews} of ${pm.length} PolicyMe ads mention their review score in the post text. PolicyMe's strongest proof point is never the hook.`,
    basis: `${leadSP} / ${ads.length}`,
  });

  // 3. competitors own a lane; PolicyMe spreads out
  function topAngles(xs) {
    const m = {};
    xs.forEach(a => { m[a.primary_angle] = (m[a.primary_angle] || 0) + 1; });
    const max = Math.max(...Object.values(m));
    return { keys: angleOrder.filter(k => m[k] === max), n: max, distinct: Object.keys(m).length };
  }
  if (competitors.length) {
    const parts = competitors.map(b => {
      const xs = byBrand(b), t = topAngles(xs);
      return `${b} leads with ${listText(t.keys.map(k => label(ANG, k).toLowerCase()))} in ${t.n} of ${xs.length} ads (${pct(t.n, xs.length)}%)`;
    });
    const tp = topAngles(pm);
    const tpNames = listText(tp.keys.map(k => label(ANG, k).toLowerCase()));
    const tpText = tp.keys.length > 1
      ? `its most-used lead angles (${tpNames}, tied) cover only ${tp.n} of ${pm.length} ads each`
      : `its most-used lead angle (${tpNames}) covers only ${tp.n} of ${pm.length} ads`;
    findings.push({
      title: 'Each competitor owns one lane; PolicyMe spreads across many',
      body: `${parts.join('. ')}. PolicyMe spreads its ads across ${tp.distinct} different lead angles: ${tpText}.`,
      basis: `${tp.distinct} angles`,
    });
  }

  // 4. critical illness / risk protection
  const pmCI = count(pm, a => a.product === 'critical_illness');
  const ciOthers = competitors.map(b => [b, count(byBrand(b), a => a.product === 'critical_illness'), count(byBrand(b), a => a.primary_angle === 'risk_protection'), brandCounts[b]])
    .filter(([, ci, risk]) => ci || risk);
  if (ciOthers.length) {
    const pmRisk = count(pm, a => a.primary_angle === 'risk_protection');
    findings.push({
      title: `${pmCI ? pmCI : 'None'} of PolicyMe's ${pm.length} ads promote critical illness`,
      body: ciOthers.map(([b, ci, risk, n]) => `${b} runs ${ci} critical illness ad${ci === 1 ? '' : 's'} and leads ${risk} of ${n} ads with risk protection (illness, disability, lost income)`).join('. ') +
        (pmRisk ? `. PolicyMe leads ${pmRisk} ads with that angle.` : '. PolicyMe never leads with that angle.'),
      basis: `${pmCI} / ${pm.length}`,
    });
  }

  // 5. audiences PolicyMe doesn't reach
  const pmSeniors = count(pm, a => a.audience === 'seniors');
  const pmNonEn = count(pm, a => a.language && a.language !== 'en');
  const reach = competitors.map(b => {
    const xs = byBrand(b);
    const langs = [...new Set(xs.filter(a => a.language && a.language !== 'en').map(a => label(LANG, a.language).replace(/ \(.*\)/, '')))];
    return { b, seniors: count(xs, a => a.audience === 'seniors'), nonEn: count(xs, a => a.language && a.language !== 'en'), langs };
  }).filter(r => r.seniors || r.nonEn);
  if (reach.length) {
    findings.push({
      title: 'Competitors reach audiences PolicyMe doesn\'t',
      body: reach.map(r => `${r.b} runs ${r.seniors} ad${r.seniors === 1 ? '' : 's'} for seniors and retirees and ${r.nonEn} in ${listText(r.langs) || 'other languages'}`).join('. ') +
        `. PolicyMe has ${pmSeniors} for seniors and ${pmNonEn} in a language other than English among its ${pm.length}.`,
      basis: `${pmSeniors + pmNonEn} / ${pm.length}`,
    });
  }

  $('#findings-list').append(...findings.slice(0, 5).map(f =>
    el('li', {},
      el('div', { class: 'finding-head' }, el('span', { class: 'finding-title', text: f.title }), el('span', { class: 'basis', text: f.basis })),
      el('p', { class: 'finding-body', text: f.body }))));

  // ---------- tooltip ----------
  const tip = $('#tooltip');
  function showTip(target, x, y) {
    const [strong, rest] = (target.dataset.tip || '').split('|');
    tip.replaceChildren(el('strong', { text: strong }), document.createTextNode(rest || ''));
    tip.hidden = false;
    const r = tip.getBoundingClientRect();
    let left = x + 14, top = y + 14;
    if (left + r.width > window.innerWidth - 8) left = x - r.width - 14;
    if (top + r.height > window.innerHeight - 8) top = y - r.height - 14;
    tip.style.left = Math.max(8, left) + 'px';
    tip.style.top = Math.max(8, top) + 'px';
  }
  const hideTip = () => { tip.hidden = true; };
  document.addEventListener('pointermove', e => {
    const t = e.target.closest && e.target.closest('[data-tip]');
    if (t) showTip(t, e.clientX, e.clientY); else hideTip();
  });
  document.addEventListener('focusin', e => {
    const t = e.target.closest && e.target.closest('[data-tip]');
    if (t) { const r = t.getBoundingClientRect(); showTip(t, r.left + r.width / 2, r.bottom); } else hideTip();
  });
  window.addEventListener('scroll', hideTip, { passive: true });

  // ---------- gap map ----------
  let gapMode = 'primary';
  const hasAngle = (a, k, mode) => a.primary_angle === k || (mode === 'any' && (a.secondary_angles || []).includes(k));

  function renderGapMap() {
    const t = $('#gap-map');
    const verb = gapMode === 'any' ? 'mention' : 'lead with';
    t.replaceChildren(
      el('caption', { class: 'visually-hidden', text: `Number of ads per brand that ${verb} each angle` }),
      el('thead', {}, el('tr', {}, el('th', { scope: 'col', text: 'Brand' }),
        ...tax.angles.map(a => el('th', { scope: 'col', class: a.added ? 'added' : null, title: `${a.label}: ${a.definition}`, text: a.short })))),
      el('tbody', {}, ...brands.map(b => {
        const xs = byBrand(b);
        return el('tr', {}, el('th', { scope: 'row' }, b, el('small', { text: `${xs.length} ads` })),
          ...tax.angles.map(ang => {
            const n = count(xs, a => hasAngle(a, ang.key, gapMode));
            const share = n / xs.length, bn = bin(share);
            const tipText = `${n} of ${xs.length} ads (${pct(n, xs.length)}%)|${b} · ${verb} ${ang.label.toLowerCase()}`;
            if (!n) return el('td', { class: 'zero', text: '—', 'aria-label': `${b}, ${ang.label}: none`, dataset: { tip: `None|${b} doesn't ${verb} ${ang.label.toLowerCase()}` } });
            return el('td', {
              class: `b${bn}`, tabindex: '0', role: 'button', text: String(n),
              'aria-label': `${b}, ${ang.label}: ${n} of ${xs.length} ads. Show in gallery.`,
              dataset: { tip: tipText },
              onclick: () => jumpToGallery(b, ang.key, gapMode === 'any'),
              onkeydown: e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); jumpToGallery(b, ang.key, gapMode === 'any'); } },
            });
          }));
      })));

    // callouts
    const counts = Object.fromEntries(brands.map(b => [b, Object.fromEntries(tax.angles.map(ang =>
      [ang.key, count(byBrand(b), a => hasAngle(a, ang.key, gapMode))]))]));
    const nobody = tax.angles.filter(a => brands.every(b => !counts[b][a.key])).map(a => a.label);
    const onlyComp = tax.angles.filter(a => !counts[HOME][a.key] && competitors.some(b => counts[b][a.key])).map(a => a.label);
    const onlyHome = tax.angles.filter(a => counts[HOME][a.key] && competitors.every(b => !counts[b][a.key])).map(a => a.label);
    const any = gapMode === 'any';
    const items = [];
    if (nobody.length) items.push(`${any ? 'Nobody mentions' : 'Nobody leads with'}: ${listText(nobody)}.`);
    if (onlyComp.length) items.push(`${any ? 'Only competitors mention' : 'Only competitors lead with'}: ${listText(onlyComp)}. These are open lanes for PolicyMe.`);
    if (onlyHome.length) items.push(`${any ? 'Only PolicyMe mentions' : 'Only PolicyMe leads with'}: ${listText(onlyHome)}.`);
    $('#gap-callouts').replaceChildren(...items.map(s => el('li', { text: s })));
  }
  $('#gap-legend').append(
    el('span', { class: 'sw' }, el('i', { class: 'zero' }), 'none (gap)'),
    ...BIN_LABELS.map((l, i) => el('span', { class: 'sw' }, el('i', { style: `background: var(--heat-${i + 1})` }), l)),
    el('span', { text: 'of the brand’s ads · * angle added to the original taxonomy' }));
  $$('#gaps .seg').forEach(btn => btn.addEventListener('click', () => {
    gapMode = btn.dataset.mode;
    $$('#gaps .seg').forEach(b => b.setAttribute('aria-pressed', String(b === btn)));
    renderGapMap();
  }));
  renderGapMap();

  // ---------- product x audience ----------
  const prodKeys = tax.products.map(p => p.key).filter(k => ads.some(a => a.product === k));
  const audKeys = tax.audiences.map(a => a.key).filter(k => ads.some(a => a.audience === k));
  const paSel = $('#pa-brand');
  paSel.append(el('option', { value: '', text: 'All brands' }), ...brands.map(b => el('option', { value: b, text: b })));
  function renderPA() {
    const xs = paSel.value ? byBrand(paSel.value) : ads;
    $('#pa-grid').replaceChildren(
      el('thead', {}, el('tr', {}, el('th', { scope: 'col', text: 'Product' }), ...audKeys.map(k => el('th', { scope: 'col', text: label(AUD, k) })))),
      el('tbody', {}, ...prodKeys.map(p => el('tr', {}, el('th', { scope: 'row', text: label(PROD, p) }),
        ...audKeys.map(k => {
          const n = count(xs, a => a.product === p && a.audience === k);
          if (!n) return el('td', { class: 'zero', text: '—' });
          return el('td', { class: `b${bin(n / xs.length)}`, tabindex: '0', text: String(n),
            dataset: { tip: `${n} ad${n === 1 ? '' : 's'} (${pct(n, xs.length)}%)|${label(PROD, p)} for ${label(AUD, k).toLowerCase()}${paSel.value ? ' · ' + paSel.value : ''}` } });
        })))));
  }
  paSel.addEventListener('change', renderPA);
  renderPA();

  // ---------- longest-running ----------
  function thumb(a, small = false) {
    if (a.image) return el('div', { class: 'thumb' }, el('img', { src: a.image, alt: `${a.brand} ad creative`, loading: 'lazy', decoding: 'async' }));
    const text = a.format === 'unclear' ? (small ? 'Video' : 'Video: tagged from post text only') : 'No image';
    return el('div', { class: 'thumb placeholder', text });
  }
  $('#longest-list').append(...brands.map(b => {
    const top = byBrand(b).filter(a => a.days_running !== null && a.days_running !== undefined)
      .sort((x, y) => y.days_running - x.days_running || x.id.localeCompare(y.id)).slice(0, 3);
    return el('div', { class: 'long-col' }, el('h3', { text: b }),
      ...top.map(a => el('article', { class: 'long-item' }, thumb(a, true),
        el('div', {},
          el('div', { class: 'days' }, String(a.days_running), el('small', { text: ' days running' })),
          el('p', { text: a.hook || '' }),
          el('ul', { class: 'chips' }, el('li', { class: 'chip lead', text: label(ANG, a.primary_angle) })),
          el('div', { class: 'card-foot' }, el('a', { href: a.ad_url, target: '_blank', rel: 'noopener', text: 'View original ↗' }))))));
  }));

  // ---------- gallery ----------
  const PAGE = 24;
  const state = { brand: '', primary_angle: '', format: '', product: '', angleAny: false, shown: PAGE };
  const FILTER_LABELS = { brand: null, primary_angle: ANG, format: FMT, product: PROD };
  // ads with a creative image first, then longest-running first
  const sorted = ads.slice().sort((x, y) =>
    (!x.image - !y.image) || (y.days_running ?? -1) - (x.days_running ?? -1) || x.id.localeCompare(y.id));

  function buildSelect(key) {
    const sel = $(`select[data-filter="${key}"]`);
    const keys = key === 'brand' ? brands
      : (key === 'primary_angle' ? tax.angles : key === 'format' ? tax.formats : tax.products).map(x => x.key);
    const all = { brand: 'All brands', primary_angle: 'All angles', format: 'All formats', product: 'All products' }[key];
    sel.replaceChildren(el('option', { value: '', text: all }),
      ...keys.filter(k => ads.some(a => a[key] === k)).map(k =>
        el('option', { value: k, text: `${FILTER_LABELS[key] ? label(FILTER_LABELS[key], k) : k} (${count(ads, a => a[key] === k)})` })));
    sel.addEventListener('change', () => {
      state[key] = sel.value;
      if (key === 'primary_angle') state.angleAny = false;
      state.shown = PAGE;
      renderGallery();
    });
  }
  ['brand', 'primary_angle', 'format', 'product'].forEach(buildSelect);

  function matches(a) {
    if (state.brand && a.brand !== state.brand) return false;
    if (state.format && a.format !== state.format) return false;
    if (state.product && a.product !== state.product) return false;
    if (state.primary_angle && !hasAngle(a, state.primary_angle, state.angleAny ? 'any' : 'primary')) return false;
    return true;
  }

  function card(a) {
    const sec = (a.secondary_angles || []);
    const extra = sec.length > 3 ? sec.length - 3 : 0;
    const meta = [
      a.days_running !== null && a.days_running !== undefined ? `Running ${a.days_running} days` : 'Start date unknown',
      label(FMT, a.format), label(PROD, a.product), label(AUD, a.audience),
      a.language && a.language !== 'en' ? label(LANG, a.language) : null,
    ].filter(Boolean).join(' · ');
    return el('article', { class: 'card' },
      thumb(a),
      el('div', { class: 'card-body' },
        el('div', { class: 'card-top' }, el('span', { class: 'brand', text: a.brand + (a.creator_partner ? ` × ${a.creator_partner}` : '') }), el('span', { class: 'id', text: a.id })),
        el('p', { class: 'hook', text: a.hook ? `“${a.hook}”` : '(no post text)' }),
        a.video_hook ? el('p', { class: 'opens' }, el('b', { text: 'Opens on: ' }), `“${a.video_hook}”`) : null,
        el('ul', { class: 'chips', 'aria-label': 'Angles' },
          el('li', { class: 'chip lead', title: 'Lead angle', text: label(ANG, a.primary_angle) }),
          ...sec.slice(0, 3).map(k => el('li', { class: 'chip', text: label(ANG, k) })),
          extra ? el('li', { class: 'chip', title: sec.slice(3).map(k => label(ANG, k)).join(', '), text: `+${extra}` }) : null),
        el('p', { class: 'meta', text: meta }),
        a.notes ? el('details', {}, el('summary', { text: 'Tagging notes' }), el('p', { text: a.notes })) : null,
        el('div', { class: 'card-foot' }, el('a', { href: a.ad_url, target: '_blank', rel: 'noopener', text: 'View original ↗' }))));
  }

  function renderGallery() {
    const xs = sorted.filter(matches);
    const bits = [state.brand, state.primary_angle ? `${state.angleAny ? 'mentioning' : 'leading with'} ${label(ANG, state.primary_angle).toLowerCase()}` : '',
      state.format ? label(FMT, state.format) : '', state.product ? label(PROD, state.product) : ''].filter(Boolean);
    $('#result-count').textContent = `${xs.length} ad${xs.length === 1 ? '' : 's'}${bits.length ? ' · ' + bits.join(' · ') : ''} · longest-running first (videos not reviewed shown last)`;
    const box = $('#cards');
    box.replaceChildren(...(xs.length ? xs.slice(0, state.shown).map(card) : [el('p', { class: 'empty', text: 'No ads match these filters.' })]));
    $('.more').hidden = xs.length <= state.shown;
  }
  $('#show-more').addEventListener('click', () => { state.shown += PAGE; renderGallery(); });
  $('#reset-filters').addEventListener('click', () => {
    Object.assign(state, { brand: '', primary_angle: '', format: '', product: '', angleAny: false, shown: PAGE });
    $$('select[data-filter]').forEach(s => { s.value = ''; });
    renderGallery();
  });
  function jumpToGallery(brand, angle, any) {
    Object.assign(state, { brand, primary_angle: angle, format: '', product: '', angleAny: any, shown: PAGE });
    $('select[data-filter="brand"]').value = brand;
    $('select[data-filter="primary_angle"]').value = angle;
    $('select[data-filter="format"]').value = '';
    $('select[data-filter="product"]').value = '';
    renderGallery();
    $('#gallery').scrollIntoView();
  }
  renderGallery();

  // ---------- briefs ----------
  $('#briefs-list').append(...briefs.map((b, i) => el('article', { class: 'brief' },
    el('span', { class: 'tag', text: `Brief ${i + 1} · hypothesis` }),
    el('h3', { text: b.title }),
    el('p', { class: 'gap' }, el('strong', { text: 'The gap: ' }), b.gap),
    el('dl', { class: 'brief-grid' },
      el('div', {}, el('dt', { text: 'Objective' }), el('dd', { text: b.objective })),
      el('div', {}, el('dt', { text: 'Target audience' }), el('dd', { text: b.audience })),
      el('div', {}, el('dt', { text: 'Customer worry' }), el('dd', { text: b.worry }))),
    el('ul', { class: 'concepts', 'aria-label': 'Creative concepts' }, ...b.concepts.map((c, j) => el('li', {},
      el('p', { class: 'c-hook', text: `${j + 1}. ${c.hook}` }),
      el('p', { text: c.visual }),
      el('span', { class: 'c-format', text: c.format })))),
    el('dl', { class: 'brief-grid' },
      el('div', {}, el('dt', { text: 'Test against the control' }), el('dd', { text: b.test })),
      el('div', {}, el('dt', { text: 'Success metric' }), el('dd', { text: b.metric })),
      el('div', {}, el('dt', { text: 'Scale / kill rule' }), el('dd', { text: b.rule }))))));

  // ---------- method ----------
  const exBy = {};
  excluded.forEach(e => { const k = `${e.brand}|${e.reason}`; exBy[k] = (exBy[k] || 0) + 1; });
  $('#sources-list').append(
    ...sources.map(s => el('li', {}, el('strong', { text: s.brand + ': ' }), s.search)),
    ...Object.entries(exBy).map(([k, n]) => { const [b, r] = k.split('|'); return el('li', { text: `Excluded ${n} ${b} ads. ${r}` }); }));
  const notReviewed = count(ads, a => a.format === 'unclear');
  $('#limit-videos').textContent = notReviewed
    ? `${notReviewed} competitor videos were tagged from their post text only (shown as “Video: not reviewed”). PolicyMe's videos were checked frame by frame for the first 3 seconds.`
    : 'All videos were checked frame by frame for the first 3 seconds.';
  $('#taxonomy-list').append(...tax.angles.flatMap(a => [
    el('dt', { text: a.label + (a.added ? ' (added)' : '') }), el('dd', { text: a.definition })]));
})();
