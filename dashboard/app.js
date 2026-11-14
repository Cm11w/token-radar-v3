/* Token Radar v3 dashboard: hash-routed views over window.RADAR and
   window.BENCHMARKS. No network, no framework. Every figure on screen comes
   from the snapshot by way of the model in lib/model.ts. */
(function () {
  'use strict';

  var view = document.getElementById('view');
  var RADAR = window.RADAR;
  var BENCH = window.BENCHMARKS;
  if (!RADAR || !BENCH) {
    view.innerHTML = '<p class="empty">No radar data was loaded. This page reads ../data.js and benchmarks.js next to it.</p>';
    return;
  }

  /* ---------- formatting ---------- */

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function money(n) {
    if (n === null || n === undefined) return '—';
    if (n >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (n >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (n >= 1e3) return '$' + (n / 1e3).toFixed(1) + 'K';
    return '$' + Math.round(n);
  }
  function moneyFull(n) {
    return '$' + Math.round(n).toLocaleString('en-US');
  }
  function mult(x) {
    return x === null || x === undefined ? '—' : x.toFixed(3) + '×';
  }
  function pct(x) {
    if (x === null || x === undefined) return '<span class="muted">—</span>';
    var cls = x > 0 ? 'up' : x < 0 ? 'down' : 'muted';
    var sign = x > 0 ? '+' : '';
    return '<span class="' + cls + '">' + sign + x.toFixed(1) + '%</span>';
  }
  function ageText(days) {
    if (days === null || days === undefined) return '—';
    if (days < 365) return days + 'd';
    return (days / 365).toFixed(1) + 'y';
  }
  function catLabel(r) {
    return r.category === null ? 'Uncategorised' : r.category;
  }

  /* ---------- routing ---------- */

  var sortKey = 'rank';
  var sortDir = 1;

  function route() {
    var hash = (location.hash || '#/').slice(1);
    var parts = hash.split('?');
    var path = parts[0] || '/';
    var query = new URLSearchParams(parts[1] || '');
    return { path: path, query: query };
  }
  function setNav(name) {
    var links = document.querySelectorAll('[data-nav]');
    for (var i = 0; i < links.length; i++) {
      links[i].classList.toggle('active', links[i].getAttribute('data-nav') === name);
    }
  }
  function go(path) {
    if (location.hash === '#' + path) render();
    else location.hash = '#' + path;
  }

  /* ---------- shared pieces ---------- */

  function statsStrip() {
    return '<div class="stats">' +
      '<div class="stat"><span class="num amber">' + RADAR.board_size + '</span><span class="lbl">protocols ranked</span></div>' +
      '<div class="stat"><span class="num">' + RADAR.watchlist_size + '</span><span class="lbl">watchlist covered, of ' + RADAR.watchlist_size + '</span></div>' +
      '<div class="stat"><span class="num">' + RADAR.early_size + '</span><span class="lbl">early rows below the $50M floor</span></div>' +
      '<div class="stat"><span class="num">' + BENCH.peer_count + '</span><span class="lbl">traded peers priced the board</span></div>' +
      '<div class="stat"><span class="num">' + BENCH.global_median.toFixed(3) + '×</span><span class="lbl">market median mcap / TVL</span></div>' +
      '<div class="stat"><span class="num">' + esc(RADAR.as_of) + '</span><span class="lbl">snapshot date (frozen)</span></div>' +
      '</div>';
  }

  /* ---------- board view ---------- */

  function boardRows(filtered) {
    var rows = filtered.slice();
    var key = sortKey;
    var dir = sortDir;
    rows.sort(function (a, b) {
      var av = a[key];
      var bv = b[key];
      if (av === null || av === undefined) av = -Infinity;
      if (bv === null || bv === undefined) bv = -Infinity;
      if (typeof av === 'string') return dir * (av < bv ? -1 : av > bv ? 1 : 0);
      return dir * (av - bv) || (a.slug < b.slug ? -1 : 1);
    });
    return rows;
  }

  function headerCell(label, key, numeric) {
    var arrow = sortKey === key ? (sortDir === 1 ? ' ▲' : ' ▼') : '';
    return '<th class="sortable' + (numeric ? ' num' : '') + '" data-sort="' + key + '">' + label + arrow + '</th>';
  }

  function renderBoard(query) {
    var cat = query.get('cat') || 'all';
    var q = (query.get('q') || '').toLowerCase();
    var watchOnly = query.get('watch') === '1';

    var categories = [];
    var seen = {};
    RADAR.rows.forEach(function (r) {
      var c = catLabel(r);
      if (!seen[c]) { seen[c] = true; categories.push(c); }
    });
    categories.sort();

    var filtered = RADAR.rows.filter(function (r) {
      if (cat !== 'all' && catLabel(r) !== cat) return false;
      if (watchOnly && !r.on_watchlist) return false;
      if (q && (r.name.toLowerCase().indexOf(q) < 0 && r.slug.toLowerCase().indexOf(q) < 0)) return false;
      return true;
    });
    var rows = boardRows(filtered);

    var opts = '<option value="all">All categories</option>' + categories.map(function (c) {
      return '<option value="' + esc(c) + '"' + (c === cat ? ' selected' : '') + '>' + esc(c) + '</option>';
    }).join('');

    var html = statsStrip() +
      '<div class="controls">' +
      '<label>Category <select id="f-cat">' + opts + '</select></label>' +
      '<label>Search <input type="search" id="f-q" placeholder="Name or slug" value="' + esc(query.get('q') || '') + '"></label>' +
      '<label class="check"><input type="checkbox" id="f-watch"' + (watchOnly ? ' checked' : '') + '> Watchlist only</label>' +
      '<span class="count">' + rows.length + ' of ' + RADAR.rows.length + ' protocols</span>' +
      '</div>' +
      '<div class="tblwrap scroll"><table><thead><tr>' +
      headerCell('Rank', 'rank') + '<th>Protocol</th><th>Category</th>' +
      headerCell('TVL', 'tvl_usd', true) +
      headerCell('7d', 'change_7d', true) +
      headerCell('Age', 'age_days', true) +
      headerCell('Peer ×', 'peer_multiple', true) +
      headerCell('Implied value', 'implied_value_usd', true) +
      '</tr></thead><tbody>';

    if (rows.length === 0) {
      html += '<tr><td colspan="8" class="empty">No protocol matches this filter.</td></tr>';
    }
    rows.forEach(function (r) {
      html += '<tr class="rowlink" data-slug="' + esc(r.slug) + '">' +
        '<td class="rank">' + r.rank + '</td>' +
        '<td class="namecell"><span class="nm">' + esc(r.name) + '</span>' +
        (r.on_watchlist ? '<span class="badge">Watchlist</span>' : '') +
        '<div class="sub">' + esc(r.chains.slice(0, 3).join(' · ')) + (r.chains.length > 3 ? ' +' + (r.chains.length - 3) : '') + '</div></td>' +
        '<td>' + esc(catLabel(r)) + '</td>' +
        '<td class="num">' + money(r.tvl_usd) + '</td>' +
        '<td class="num">' + pct(r.change_7d) + '</td>' +
        '<td class="num">' + ageText(r.age_days) + '</td>' +
        '<td class="num">' + mult(r.peer_multiple) + '</td>' +
        '<td class="num strong">' + money(r.implied_value_usd) + '</td>' +
        '</tr>';
    });
    html += '</tbody></table></div>' +
      '<p class="lede" style="margin-top:12px">Ranked by implied value. <b>Peer ×</b> is the category-calibrated ' +
      'multiple: the category\'s traded peers, shrunk toward the market median. Open any row for the ' +
      'full breakdown and the peer comparison behind its price.</p>';
    view.innerHTML = html;

    function applyFilter() {
      var params = new URLSearchParams();
      var c = document.getElementById('f-cat').value;
      var qq = document.getElementById('f-q').value.trim();
      if (c !== 'all') params.set('cat', c);
      if (qq) params.set('q', qq);
      if (document.getElementById('f-watch').checked) params.set('watch', '1');
      var s = params.toString();
      go('/' + (s ? '?' + s : ''));
    }
    document.getElementById('f-cat').addEventListener('change', applyFilter);
    document.getElementById('f-watch').addEventListener('change', applyFilter);
    document.getElementById('f-q').addEventListener('change', applyFilter);
    var heads = view.querySelectorAll('[data-sort]');
    for (var i = 0; i < heads.length; i++) {
      heads[i].addEventListener('click', function () {
        var k = this.getAttribute('data-sort');
        if (sortKey === k) sortDir = -sortDir;
        else { sortKey = k; sortDir = k === 'rank' ? 1 : -1; }
        render();
      });
    }
    var links = view.querySelectorAll('[data-slug]');
    for (var j = 0; j < links.length; j++) {
      links[j].addEventListener('click', function () {
        go('/protocol/' + encodeURIComponent(this.getAttribute('data-slug')));
      });
    }
    setNav('board');
  }

  /* ---------- detail view ---------- */

  function splitStep(step) {
    var m = /^(.*) Cost: (.*)\. Time: (.*)\.$/.exec(step);
    if (!m) return { text: step, cost: '', time: '' };
    return { text: m[1], cost: m[2], time: m[3] };
  }

  function renderDetail(slug) {
    var row = null;
    for (var i = 0; i < RADAR.rows.length; i++) {
      if (RADAR.rows[i].slug === slug) { row = RADAR.rows[i]; break; }
    }
    if (!row) {
      view.innerHTML = '<p class="empty">No protocol with that slug is on the board.</p><p><a href="#/">&larr; Back to the board</a></p>';
      setNav('board');
      return;
    }
    var vsMedian = row.category_median_tvl > 0 ? (row.tvl_usd / row.category_median_tvl) : 1;
    var chainList = row.chains.slice(0, 4).join(' · ') + (row.chains.length > 4 ? ' +' + (row.chains.length - 4) : '');
    var peerNote = row.peer_count > 0
      ? row.peer_count + ' traded peer' + (row.peer_count === 1 ? '' : 's') + ' in ' + esc(catLabel(row)) + ', raw median ' + mult(row.raw_peer_median) + ', weight ' + row.shrink_weight.toFixed(2) + ' on the category'
      : 'no traded peer in ' + esc(catLabel(row)) + ' — priced at the market median';

    var peersHtml = '';
    if (row.peers.length === 0) {
      peersHtml = '<p class="muted">No traded token in this category has a positive recorded market cap, so the peer table is empty and the market median prices this protocol.</p>';
    } else {
      peersHtml = '<div class="tblwrap"><table><thead><tr><th>Traded peer</th><th class="num">TVL</th><th class="num">Market cap</th><th class="num">Multiple</th></tr></thead><tbody>';
      row.peers.forEach(function (p) {
        peersHtml += '<tr><td>' + esc(p.name) + '</td><td class="num">' + money(p.tvl_usd) + '</td><td class="num">' + money(p.mcap_usd) + '</td><td class="num">' + mult(p.multiple) + '</td></tr>';
      });
      peersHtml += '<tr class="peer-self"><td>' + esc(row.name) + ' (implied)</td><td class="num">' + money(row.tvl_usd) + '</td><td class="num">' + money(row.implied_value_usd) + '</td><td class="num">' + mult(row.peer_multiple) + '</td></tr>';
      if (row.raw_peer_median !== null) {
        peersHtml += '<tr class="peer-ref"><td>Category peer median</td><td class="num">—</td><td class="num">—</td><td class="num">' + mult(row.raw_peer_median) + '</td></tr>';
      }
      peersHtml += '<tr class="peer-ref"><td>Whole-market peer median (' + BENCH.peer_count + ' peers)</td><td class="num">—</td><td class="num">—</td><td class="num">' + mult(BENCH.global_median) + '</td></tr>';
      peersHtml += '</tbody></table></div>';
    }

    var stepsHtml = '<ol class="steps">' + row.farm_steps.map(function (s) {
      var part = splitStep(s);
      return '<li><div>' + esc(part.text) + '</div><div class="costtime">Cost: <b>' + esc(part.cost) + '</b> &nbsp;·&nbsp; Time: <b>' + esc(part.time) + '</b></div></li>';
    }).join('') + '</ol>';

    view.innerHTML =
      '<a class="backlink" href="#/">&larr; Back to the board</a>' +
      '<div class="detail-head"><h2>' + esc(row.name) + '</h2><span class="rank nowrap"># ' + row.rank + ' of ' + RADAR.rows.length + '</span>' +
      (row.on_watchlist ? '<span class="badge">Watchlist</span>' : '<span class="badge" style="color:var(--muted);border-color:var(--line)">Early</span>') + '</div>' +
      '<p class="detail-meta">' + esc(catLabel(row)) + ' · ' + esc(chainList || 'chain unreported') +
      ' · TVL ' + moneyFull(row.tvl_usd) + ' · 7d ' + (row.change_7d === null ? 'unreported' : (row.change_7d > 0 ? '+' : '') + row.change_7d.toFixed(1) + '%') +
      ' · tracked since ' + esc(row.listed_at || 'unknown') + ' · records no token</p>' +
      '<div class="grid">' +
      '<div class="card"><h3>Why this rank</h3>' +
      '<div class="factor"><span class="fl">TVL</span><span class="fv">' + moneyFull(row.tvl_usd) + '</span></div>' +
      '<div class="factor"><span class="fl">Peer multiple (calibrated)</span><span class="fv">' + mult(row.peer_multiple) + '</span></div>' +
      '<div class="factor"><span class="fl">Peer-size factor</span><span class="fv">' + row.size_factor.toFixed(3) + '×</span></div>' +
      '<div class="factor"><span class="fl">Growth factor</span><span class="fv">' + row.growth_multiplier.toFixed(3) + '×</span></div>' +
      '<div class="factor"><span class="fl">Maturity factor</span><span class="fv">' + row.maturity_multiplier.toFixed(3) + '×</span></div>' +
      '<div class="factor total"><span class="fl">Implied value</span><span class="fv">' + moneyFull(row.implied_value_usd) + '</span></div>' +
      '<div class="formula">implied = TVL × ' + row.peer_multiple.toFixed(3) + ' × ' + row.size_factor.toFixed(3) + ' × ' + row.growth_multiplier.toFixed(3) + ' × ' + row.maturity_multiplier.toFixed(3) + '</div>' +
      '</div>' +
      '<div class="card"><h3>Standing among its peers</h3>' +
      '<div class="factor"><span class="fl">TVL rank in ' + esc(catLabel(row)) + '</span><span class="fv">#' + row.category_rank + ' of ' + row.category_size + '</span></div>' +
      '<div class="factor"><span class="fl">TVL vs category median</span><span class="fv">' + vsMedian.toFixed(2) + '×</span></div>' +
      '<div class="factor"><span class="fl">Category median pre-token TVL</span><span class="fv">' + money(row.category_median_tvl) + '</span></div>' +
      '<div class="factor"><span class="fl">Peer basis</span><span class="fv" style="white-space:normal;text-align:right">' + peerNote + '</span></div>' +
      '<p class="muted" style="margin:12px 0 0">The peer multiple is measured from traded tokens in the same ' +
      'category and shrunk toward the market median, so a thin peer set cannot set an extreme price. ' +
      'See the <a href="#/peers">peer benchmarks</a> for the full calibration table.</p>' +
      '</div></div>' +
      '<h3>Peer comparison — traded tokens in ' + esc(catLabel(row)) + '</h3>' + peersHtml +
      '<h3>Farm plan</h3>' + stepsHtml;
    setNav('board');
  }

  /* ---------- peers view ---------- */

  function renderPeers() {
    var cats = BENCH.categories;
    var withPeers = cats.filter(function (c) { return c.peer_count > 0; });
    var noPeers = cats.filter(function (c) { return c.peer_count === 0; });
    var solid = withPeers.filter(function (c) { return c.peer_count >= 3; });
    var richest = solid.slice().sort(function (a, b) { return b.calibrated - a.calibrated; })[0];
    var cheapest = solid.slice().sort(function (a, b) { return a.calibrated - b.calibrated; })[0];
    var biggest = cats.slice().sort(function (a, b) { return b.pre_token - a.pre_token; })[0];

    var insights = '<ul class="insights">';
    if (richest && cheapest) {
      insights += '<li>Among categories with at least 3 traded peers, <b>' + esc(richest.category) + '</b> carries the richest calibrated multiple (' + mult(richest.calibrated) + ') and <b>' + esc(cheapest.category) + '</b> the leanest (' + mult(cheapest.calibrated) + ') — a ' + (richest.calibrated / cheapest.calibrated).toFixed(1) + '× spread the market itself sets.</li>';
    }
    insights += '<li><b>' + esc(biggest.category) + '</b> holds the most pre-token protocols on the board (' + biggest.pre_token + '), led by ' + esc(biggest.top_name) + ' at ' + money(biggest.top_tvl) + ' TVL.</li>';
    if (noPeers.length > 0) {
      insights += '<li>' + noPeers.length + ' categor' + (noPeers.length === 1 ? 'y has' : 'ies have') + ' no traded peer at all (' + noPeers.map(function (c) { return esc(c.category); }).join(', ') + ') — those rows are priced at the market median of ' + mult(BENCH.global_median) + ', with weight 0 on the category.</li>';
    }
    var thin = withPeers.filter(function (c) { return c.peer_count < 3; });
    if (thin.length > 0) {
      insights += '<li>' + thin.length + ' categor' + (thin.length === 1 ? 'y leans' : 'ies lean') + ' on 1–2 peers, so shrinkage pulls them most of the way to the market median instead of trusting a thin median.</li>';
    }
    insights += '</ul>';

    var rowsHtml = cats.map(function (c) {
      return '<tr class="rowlink" data-cat="' + esc(c.category) + '">' +
        '<td class="strong">' + esc(c.category) + '</td>' +
        '<td class="num">' + c.pre_token + '</td>' +
        '<td class="num">' + c.peer_count + '</td>' +
        '<td class="num">' + mult(c.raw_median) + '</td>' +
        '<td class="num">' + c.shrink_weight.toFixed(2) + '</td>' +
        '<td class="num strong">' + mult(c.calibrated) + '</td>' +
        '<td class="num">' + money(c.median_tvl) + '</td>' +
        '<td>' + esc(c.top_name) + ' <span class="muted">' + money(c.top_tvl) + '</span></td></tr>';
    }).join('');

    view.innerHTML = statsStrip() +
      '<h2>Peer benchmarks — how each category is priced</h2>' +
      '<p class="lede">Each category\'s multiple is the <b>median market-cap-to-TVL multiple of its traded tokens</b>, ' +
      'shrunk toward the whole market\'s median in log space with weight <b>n / (n + 4)</b> on the category\'s own median. ' +
      'A category with many peers keeps its own price; a category with few peers borrows most of the market\'s. ' +
      'Click a category to open the board filtered to it.</p>' +
      insights +
      '<div class="tblwrap"><table><thead><tr><th>Category</th><th class="num">Pre-token</th><th class="num">Traded peers</th>' +
      '<th class="num">Raw peer median</th><th class="num">Weight on category</th><th class="num">Calibrated ×</th>' +
      '<th class="num">Median pre-token TVL</th><th>Largest pre-token</th></tr></thead><tbody>' + rowsHtml + '</tbody></table></div>' +
      '<p class="lede" style="margin-top:12px">Peers are protocols with a positive recorded market cap, CEX tokens excluded. ' +
      'The market median of ' + mult(BENCH.global_median) + ' is measured from all ' + BENCH.peer_count + ' of them. ' +
      'Every figure on this page is recomputed from the frozen snapshot at run time.</p>';
    var links = view.querySelectorAll('[data-cat]');
    for (var i = 0; i < links.length; i++) {
      links[i].addEventListener('click', function () {
        go('/?cat=' + encodeURIComponent(this.getAttribute('data-cat')));
      });
    }
    setNav('peers');
  }

  /* ---------- live view ---------- */

  function renderLive() {
    var rowsHtml = RADAR.live.map(function (p) {
      return '<tr><td class="namecell"><span class="nm">' + esc(p.name) + '</span><div class="sub">' + esc(p.chains.slice(0, 3).join(' · ')) + '</div></td>' +
        '<td>' + esc(p.category === null ? 'Uncategorised' : p.category) + '</td>' +
        '<td class="num">' + money(p.tvl_usd) + '</td>' +
        '<td class="num strong">' + money(p.mcap_usd) + '</td>' +
        '<td class="num">' + mult(p.multiple) + '</td>' +
        '<td class="num">' + pct(p.change_7d) + '</td></tr>';
    }).join('');
    view.innerHTML = statsStrip() +
      '<h2>Live tokens — the market\'s own values</h2>' +
      '<p class="lede">These protocols already trade, so the board shows the market\'s own market cap for them — ' +
      'never a model\'s guess — and keeps them out of the ranked board. Their multiples are the peer evidence ' +
      'the board is priced from. Top ' + RADAR.live.length + ' by market cap.</p>' +
      '<div class="tblwrap"><table><thead><tr><th>Protocol</th><th>Category</th><th class="num">TVL</th>' +
      '<th class="num">Market cap</th><th class="num">Multiple</th><th class="num">7d</th></tr></thead><tbody>' +
      rowsHtml + '</tbody></table></div>';
    setNav('live');
  }

  /* ---------- method view ---------- */

  function renderMethod() {
    var m = RADAR.model;
    view.innerHTML =
      '<div class="prose"><h2>Method — radar-3 peer benchmark</h2>' +
      '<p>The board answers one question: <b>what would a protocol\'s token be worth if its record stayed ' +
      'as it is?</b> It does not predict whether or when a token is issued. The price is relative: each ' +
      'protocol is valued the way the market already values traded tokens in its own category.</p>' +
      '<h3>The formula</h3>' +
      '<div class="formula">implied = TVL × calibrated multiple × size factor × growth factor × maturity factor</div>' +
      '<h3>1. The peer multiple, calibrated across categories</h3>' +
      '<p>Peers are the snapshot\'s protocols with a positive recorded market cap, CEX tokens excluded ' +
      '(' + BENCH.peer_count + ' peers). For each category the model takes the <b>median</b> of its peers\' ' +
      'market-cap-to-TVL multiples, then shrinks it toward the whole market\'s median of <b>' + mult(BENCH.global_median) + '</b> ' +
      'in log space, with weight <code>n / (n + ' + m.shrink_prior + ')</code> on the category\'s own median. A category with ' +
      '15 peers keeps most of its own price; a category with one peer moves only a fifth of the way from the ' +
      'market median to that peer\'s multiple; a category with no peers is priced at the market median. ' +
      'Medians and logs keep one wild multiple from setting any category\'s price. The full table is on the ' +
      '<a href="#/peers">peer benchmarks</a> page.</p>' +
      '<h3>2. The peer-size factor</h3>' +
      '<p>Within its category, a protocol\'s TVL is compared with the median TVL of the category\'s pre-token ' +
      'set: <code>1 + ' + m.size_slope + ' × ln(TVL / category median)</code>, clamped to ' + m.size_floor + '–' + m.size_cap + '. ' +
      'Category leaders earn a small premium over the peer median; sub-scale protocols a small discount. ' +
      'The clamp keeps this factor a nudge, never the price.</p>' +
      '<h3>3. Growth and maturity</h3>' +
      '<p>The seven-day TVL change is clamped to ' + m.growth_floor_pct + '%…+' + m.growth_cap_pct + '% and half-weighted: ' +
      '<code>1 + change × ' + m.growth_weight + '</code>. Maturity runs from ' + m.maturity_floor + ' for a brand-new protocol to ' +
      (m.maturity_floor + m.maturity_range) + ' at ' + m.maturity_cap_days + ' days tracked with no token; an unknown ' +
      'tracking date counts as ' + m.unknown_age_days + ' days.</p>' +
      '<h3>Who is ranked</h3>' +
      '<p>Every protocol on the snapshot\'s watchlist (' + RADAR.watchlist_size + '), plus every other protocol that records no token ' +
      'and is not a wrapped, staked or bridged product of a token that already trades — the same exclusions the ' +
      'watchlist rule applies (excluded categories, version-marked names, wrapped/staked/staking words, ' +
      'exchange-prefixed names). That gives ' + RADAR.board_size + ' rows, ' + RADAR.early_size + ' of them below the $50M floor: ' +
      'the early launches the radar exists to find. Protocols whose token already trades are shown apart, ' +
      'at the market\'s own values, on the <a href="#/live">live tokens</a> page.</p>' +
      '<h3>Farm plans</h3>' +
      '<p>Each row carries six steps derived from the protocol\'s own record — its category, its chains, its ' +
      'TVL tier and its age — each with what it costs and how long it takes. Capital is tiered by TVL, the ' +
      'hold length by age, and the main action by category. The plan is a starting routine, not advice, and ' +
      'no step ever asks for a payment to claim.</p>' +
      '<div class="callout"><p><b>Read the record honestly.</b> The snapshot is one frozen fetch. A protocol ' +
      'is said to <i>record</i> no token, never to <i>have</i> none: its record may miss a token that exists. ' +
      'Implied values are this entry\'s claim from the snapshot\'s figures, and the snapshot carries no ranking, ' +
      'no implied value and no farm plan of its own — deriving them is the entry\'s work.</p></div>' +
      '</div>';
    setNav('method');
  }

  /* ---------- render ---------- */

  function render() {
    var r = route();
    if (r.path === '/' || r.path === '') renderBoard(r.query);
    else if (r.path === '/peers') renderPeers();
    else if (r.path === '/live') renderLive();
    else if (r.path === '/method') renderMethod();
    else if (r.path.indexOf('/protocol/') === 0) renderDetail(decodeURIComponent(r.path.slice(10)));
    else renderBoard(r.query);
    window.scrollTo(0, 0);
  }

  window.addEventListener('hashchange', render);
  render();
})();
