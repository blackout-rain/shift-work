(function () {
  'use strict';

  const KEY = 'shift-work-v1';
  const MAX_UI_STAFF = 10;
  const WD = ['日', '月', '火', '水', '木', '金', '土'];
  const $ = (id) => document.getElementById(id);
  const uid = () => Math.random().toString(36).slice(2, 9);
  const pad = (n) => String(n).padStart(2, '0');
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  /* ---------- 保存データ ---------- */
  function defaults() {
    return {
      staff: [['佐藤', 3], ['鈴木', 3], ['田中', 2], ['高橋', 2], ['伊藤', 2], ['渡辺', 1], ['山本', 1]].map(([name, points]) => ({ id: uid(), name, points, prevStreak: 0 })),
      needWeekday: 7,
      needHigh: 9,
      months: {},
    };
  }
  function load() {
    try {
      const s = JSON.parse(localStorage.getItem(KEY));
      if (s && Array.isArray(s.staff) && s.months) return s;
    } catch (e) { /* 保存データが無い・壊れている場合は初期状態で始める */ }
    return null;
  }
  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) { /* 保存できなくても動作は続ける */ }
  }

  let state = load();
  const firstRun = !state;
  if (!state) state = defaults();

  // 公開ページなど、ダウンロードや印刷が使えない環境か
  const sandboxed = typeof window.claude !== 'undefined';
  function toast(text) {
    const el = document.createElement('div');
    el.className = 'toast';
    el.textContent = text;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 3000);
  }

  const now = new Date();
  const ui = { year: now.getFullYear(), month: now.getMonth(), mode: 'off', msg: null };

  const monthKey = () => ui.year + '-' + pad(ui.month + 1);
  const dayCount = () => new Date(ui.year, ui.month + 1, 0).getDate();
  const weekday = (day) => new Date(ui.year, ui.month, day).getDay();
  function md() {
    const k = monthKey();
    if (!state.months[k]) state.months[k] = { off: {}, shifts: null, dayType: {}, needOv: {} };
    return state.months[k];
  }

  /* ---------- 日ごとの設定 ---------- */
  function isHigh(day) {
    const t = md().dayType[day];
    if (t) return t === 'high';
    const w = weekday(day);
    return w === 0 || w === 6;
  }
  const defaultNeed = (day) => (isHigh(day) ? state.needHigh : state.needWeekday);
  function needOf(day) {
    const o = md().needOv[day];
    return o === undefined ? defaultNeed(day) : o;
  }

  /* ---------- 計算エンジンとの受け渡し ---------- */
  function buildInput() {
    const D = dayCount();
    const m = md();
    const days = Array.from({ length: D }, (_, i) => i + 1);
    return {
      points: state.staff.map((s) => s.points),
      need: days.map(needOf),
      high: days.map(isHigh),
      off: state.staff.map((s) => days.map((d) => !!(m.off[s.id] && m.off[s.id][d]))),
      prevStreak: state.staff.map((s) => s.prevStreak || 0),
    };
  }
  function currentRows() {
    const m = md();
    const D = dayCount();
    return state.staff.map((s) => Array.from({ length: D }, (_, i) => (m.shifts && m.shifts[s.id] && m.shifts[s.id][i]) || 0));
  }
  function setRows(rows) {
    const m = md();
    m.shifts = {};
    state.staff.forEach((s, i) => { m.shifts[s.id] = rows[i].slice(); });
  }

  /* ---------- 描画 ---------- */
  function renderGrid() {
    const D = dayCount();
    const m = md();
    const input = buildInput();
    const made = !!m.shifts;
    const rows = currentRows();
    const res = ShiftSolver.check(input, rows);

    let h = '<table class="g"><thead><tr><th class="n">スタッフ</th>';
    for (let d = 1; d <= D; d++) {
      const w = weekday(d);
      const cls = (w === 6 ? 'sat ' : w === 0 ? 'sun ' : '') + (isHigh(d) ? 'hi' : '');
      h += '<th class="' + cls + '"><button class="dayBtn" data-d="' + d + '" title="高め／通常を切り替え">' + d + '<br>' + WD[w] + '</button></th>';
    }
    h += '<th class="cnt">出勤</th></tr></thead><tbody>';
    state.staff.forEach((s, i) => {
      let cnt = 0;
      h += '<tr><td class="n">' + esc(s.name) + '<span>' + s.points + 'pt</span></td>';
      for (let d = 1; d <= D; d++) {
        const isOff = input.off[i][d - 1];
        const works = rows[i][d - 1] === 1;
        if (works) cnt++;
        const bad = res.runCells.has(i + ',' + (d - 1)) || res.offCells.has(i + ',' + (d - 1));
        const cls = 'cell ' + (isOff ? 'r' : works ? 'w' : '') + (bad ? ' v' : '');
        const body = isOff ? '<span class="scr">希</span><span class="prt">休</span>'
          : works ? '出' : '<span class="prt">休</span>';
        h += '<td class="' + cls + '" data-i="' + i + '" data-d="' + d + '">' + body + '</td>';
      }
      h += '<td class="cnt">' + (made ? cnt + '日' : '–') + '</td></tr>';
    });
    h += '</tbody><tfoot><tr class="needRow"><th>必要pt</th>';
    for (let d = 1; d <= D; d++) {
      const ov = m.needOv[d] !== undefined;
      h += '<td><input class="needIn' + (ov ? ' ov' : '') + '" type="number" min="0" max="99" data-d="' + d + '" value="' + needOf(d) + '" aria-label="' + d + '日の必要ポイント"></td>';
    }
    h += '<td></td></tr><tr><th>合計pt</th>';
    for (let d = 0; d < D; d++) h += '<td>' + (made ? res.total[d] : '–') + '</td>';
    h += '<td></td></tr><tr><th>判定</th>';
    for (let d = 0; d < D; d++) {
      if (!made) h += '<td>–</td>';
      else h += res.diff[d] >= 0 ? '<td class="ok">OK</td>' : '<td class="ng">' + res.diff[d] + '</td>';
    }
    h += '<td></td></tr></tfoot></table>';
    $('grid').innerHTML = h;
    renderBanner(res, made);
    renderOffForm();
  }

  function renderBanner(res, made) {
    const b = $('banner');
    if (ui.msg) {
      b.className = 'banner ' + ui.msg.kind;
      b.innerHTML = ui.msg.html;
      return;
    }
    if (!made) {
      b.className = 'banner';
      b.innerHTML = '希望休のセルをタップして入れ、「自動作成」を押してください。';
      return;
    }
    const surplus = res.diff.reduce((a, v) => a + Math.max(v, 0), 0);
    const parts = [];
    if (res.shortDays) parts.push('<span><b>' + res.shortDays + '日</b>で必要ポイントが足りません</span>');
    if (res.runCells.size) parts.push('<span>3連勤になっているセルが<b>' + res.runCells.size + '個</b>あります</span>');
    if (res.offCells.size) parts.push('<span>希望休なのに出勤のセルが<b>' + res.offCells.size + '個</b>あります</span>');
    if (parts.length) {
      b.className = 'banner warn';
      b.innerHTML = parts.join('');
    } else {
      b.className = 'banner ok';
      b.innerHTML = '<span><b>すべての条件を満たしています。</b>余剰ポイントは月合計で' + surplus + 'ptです。</span>';
    }
  }

  const OFF_SLOTS = 3;
  let offSig = '';
  function renderOffForm() {
    const D = dayCount();
    const sig = monthKey() + '|' + state.staff.map((s) => s.id + s.name + s.points).join(',');
    const wrap = $('offRows');
    if (sig !== offSig) {
      offSig = sig;
      const opts = ['<option value="">—</option>'];
      for (let d = 1; d <= D; d++) opts.push('<option value="' + d + '">' + (ui.month + 1) + '/' + d + '（' + WD[weekday(d)] + '）</option>');
      wrap.innerHTML = state.staff.map((s) =>
        '<div class="off-row" data-id="' + s.id + '"><div class="who">' + esc(s.name) + '<span>' + s.points + 'pt</span></div>' +
        Array.from({ length: OFF_SLOTS }, (_, k) => '<select data-slot="' + k + '" aria-label="' + esc(s.name) + 'の希望休' + (k + 1) + '">' + opts.join('') + '</select>').join('') +
        '<div class="more" hidden></div></div>').join('');
    }
    wrap.querySelectorAll('.off-row').forEach((row) => {
      const days = offDays(row.dataset.id);
      row.querySelectorAll('select').forEach((sel, k) => {
        sel.value = days[k] ? String(days[k]) : '';
        sel.classList.toggle('set', !!days[k]);
      });
      const more = row.querySelector('.more');
      more.hidden = days.length <= OFF_SLOTS;
      more.textContent = 'ほか' + (days.length - OFF_SLOTS) + '日分はシフト表で入力されています（' + days.slice(OFF_SLOTS).map((d) => (ui.month + 1) + '/' + d).join('、') + '）';
    });
    $('offMonth').textContent = (ui.month + 1) + '月';
  }

  function renderMonth() {
    $('monthLabel').textContent = ui.year + '年' + (ui.month + 1) + '月';
  }

  function renderSettings() {
    $('needWeekday').value = state.needWeekday;
    $('needHigh').value = state.needHigh;
    let h = '<div class="staff-row staff-head"><span>名前</span><span>pt</span><span>前月末の連勤</span><span></span></div>';
    state.staff.forEach((s) => {
      h += '<div class="staff-row" data-id="' + s.id + '">' +
        '<input data-f="name" value="' + esc(s.name) + '" aria-label="名前" maxlength="8">' +
        '<input data-f="points" type="number" min="1" max="9" value="' + s.points + '" aria-label="戦力ポイント">' +
        '<select data-f="prevStreak" aria-label="前月末の連勤">' +
        [0, 1, 2].map((v) => '<option value="' + v + '"' + (s.prevStreak === v ? ' selected' : '') + '>' + v + '日</option>').join('') +
        '</select><button class="btn" data-del="' + s.id + '" aria-label="' + esc(s.name) + 'を削除">削除</button></div>';
    });
    $('staffList').innerHTML = h;
    $('addStaff').disabled = state.staff.length >= MAX_UI_STAFF;
  }

  function renderAll() {
    renderMonth();
    renderGrid();
  }
  function changed() {
    ui.msg = null;
    save();
    renderGrid();
  }

  /* ---------- 操作 ---------- */
  function setOff(id, d, on) {
    const m = md();
    m.off[id] = m.off[id] || {};
    if (on) {
      m.off[id][d] = 1;
      if (m.shifts && m.shifts[id]) m.shifts[id][d - 1] = 0;
    } else delete m.off[id][d];
  }
  const offDays = (id) => Object.keys(md().off[id] || {}).map(Number).sort((x, y) => x - y);

  function toggleCell(i, d) {
    const s = state.staff[i];
    const m = md();
    if (ui.mode === 'off') {
      setOff(s.id, d, !(m.off[s.id] && m.off[s.id][d]));
    } else {
      if (m.off[s.id] && m.off[s.id][d]) return;
      if (!m.shifts) setRows(currentRows());
      if (!m.shifts[s.id]) m.shifts[s.id] = new Array(dayCount()).fill(0);
      m.shifts[s.id][d - 1] = m.shifts[s.id][d - 1] ? 0 : 1;
    }
    changed();
  }

  // 計算中は表示を切り替え、画面が固まって見えないようにする
  function solve() {
    const btn = $('solveBtn');
    if (btn.disabled) return;
    btn.disabled = true;
    btn.textContent = '作成中…';
    setTimeout(() => {
      try {
        runSolve();
      } finally {
        btn.disabled = false;
        btn.textContent = '自動作成';
      }
    }, 30);
  }

  function runSolve() {
    const input = buildInput();
    const r = ShiftSolver.solve(input, { seed: Math.floor(Math.random() * 1e6) });
    if (r.ok) {
      setRows(r.rows);
      ui.msg = null;
      save();
      renderGrid();
      return;
    }
    const c = r.conflict;
    let html;
    if (c.reason === 'short') {
      const day = c.day + 1;
      const who = c.offStaff.map((i) => state.staff[i].name);
      html = '<span><b>' + (ui.month + 1) + '/' + day + '（' + WD[weekday(day)] + '）の必要' + c.need + 'ptを満たせません。</b>' +
        'この日に出られる人の合計は最大' + c.maxPossible + 'ptです。</span>' +
        (who.length ? '<span>この日の希望休：' + esc(who.join('、')) + '</span>' : '') +
        '<span>直前までの連勤制限も影響しています。この日の希望休を減らす、必要ptを下げる、スタッフを増やすのいずれかで解決します。</span>';
    } else {
      html = '<span><b>条件を満たす表を作れませんでした。</b>スタッフの設定を確認してください。</span>';
    }
    ui.msg = { kind: 'bad', html };
    renderGrid();
  }

  function exportCsv() {
    const D = dayCount();
    const rows = currentRows();
    const head = ['スタッフ'];
    for (let d = 1; d <= D; d++) head.push((ui.month + 1) + '/' + d + '(' + WD[weekday(d)] + ')');
    head.push('出勤日数');
    const lines = [head];
    state.staff.forEach((s, i) => {
      const line = [s.name];
      let cnt = 0;
      for (let d = 0; d < D; d++) {
        if (rows[i][d]) { line.push('出'); cnt++; } else line.push('休');
      }
      line.push(cnt);
      lines.push(line);
    });
    const csv = lines.map((l) => l.map((v) => '"' + String(v).replace(/"/g, '""') + '"').join(',')).join('\r\n');
    if (sandboxed) {
      // ダウンロードできない環境では、Excelに貼り付けられるタブ区切りでコピーする
      const tsv = lines.map((l) => l.join('\t')).join('\n');
      const done = () => toast('表をコピーしました。Excelやスプレッドシートに貼り付けられます');
      const fail = () => toast('コピーできませんでした');
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(tsv).then(done, fail);
      else fail();
      return;
    }
    const url = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'shift-' + monthKey() + '.csv';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function setMode(mode) {
    ui.mode = mode;
    $('modeOff').classList.toggle('on', mode === 'off');
    $('modeWork').classList.toggle('on', mode === 'work');
    $('modeOff').setAttribute('aria-pressed', String(mode === 'off'));
    $('modeWork').setAttribute('aria-pressed', String(mode === 'work'));
  }

  function shiftMonth(delta) {
    const d = new Date(ui.year, ui.month + delta, 1);
    ui.year = d.getFullYear();
    ui.month = d.getMonth();
    ui.msg = null;
    renderAll();
  }

  /* ---------- イベント ---------- */
  $('grid').addEventListener('click', (e) => {
    const cell = e.target.closest('td.cell');
    if (cell) return toggleCell(+cell.dataset.i, +cell.dataset.d);
    const dayBtn = e.target.closest('.dayBtn');
    if (dayBtn) {
      const d = +dayBtn.dataset.d;
      const m = md();
      const next = isHigh(d) ? 'normal' : 'high';
      const w = weekday(d);
      const isDefault = next === (w === 0 || w === 6 ? 'high' : 'normal');
      if (isDefault) delete m.dayType[d]; else m.dayType[d] = next;
      changed();
    }
  });
  $('grid').addEventListener('change', (e) => {
    const inp = e.target.closest('.needIn');
    if (!inp) return;
    const d = +inp.dataset.d;
    const m = md();
    const v = inp.value === '' ? NaN : Math.max(0, Math.min(99, Math.round(+inp.value)));
    if (isNaN(v) || v === defaultNeed(d)) delete m.needOv[d];
    else m.needOv[d] = v;
    changed();
  });

  $('offRows').addEventListener('change', (e) => {
    const sel = e.target.closest('select');
    if (!sel) return;
    const id = sel.closest('.off-row').dataset.id;
    const old = offDays(id)[+sel.dataset.slot];
    if (old) setOff(id, old, false);
    if (sel.value) setOff(id, +sel.value, true);
    changed();
  });

  $('prevMonth').onclick = () => shiftMonth(-1);
  $('nextMonth').onclick = () => shiftMonth(1);
  $('solveBtn').onclick = solve;
  $('csvBtn').onclick = exportCsv;
  if (sandboxed) {
    $('csvBtn').textContent = '表をコピー';
    $('printBtn').hidden = true;
  }
  $('printBtn').onclick = () => window.print();
  $('modeOff').onclick = () => setMode('off');
  $('modeWork').onclick = () => setMode('work');

  ['needWeekday', 'needHigh'].forEach((id) => {
    $(id).addEventListener('change', (e) => {
      const v = Math.max(0, Math.min(99, Math.round(+e.target.value || 0)));
      state[id] = v;
      e.target.value = v;
      changed();
    });
  });

  $('staffList').addEventListener('change', (e) => {
    const row = e.target.closest('.staff-row');
    if (!row || !row.dataset.id) return;
    const s = state.staff.find((x) => x.id === row.dataset.id);
    const f = e.target.dataset.f;
    if (f === 'points') {
      s.points = Math.max(1, Math.min(9, Math.round(+e.target.value || 1)));
      e.target.value = s.points;
    } else if (f === 'prevStreak') s.prevStreak = +e.target.value;
    else if (f === 'name') s.name = e.target.value.trim() || '名前';
    changed();
  });
  $('staffList').addEventListener('input', (e) => {
    if (e.target.dataset.f !== 'name') return;
    const s = state.staff.find((x) => x.id === e.target.closest('.staff-row').dataset.id);
    s.name = e.target.value;
    save();
    renderGrid();
  });
  $('staffList').addEventListener('click', (e) => {
    const id = e.target.dataset.del;
    if (!id || state.staff.length <= 1) return;
    state.staff = state.staff.filter((s) => s.id !== id);
    Object.values(state.months).forEach((m) => {
      delete m.off[id];
      if (m.shifts) delete m.shifts[id];
    });
    renderSettings();
    changed();
  });
  $('addStaff').onclick = () => {
    if (state.staff.length >= MAX_UI_STAFF) return;
    state.staff.push({ id: uid(), name: 'スタッフ' + (state.staff.length + 1), points: 1, prevStreak: 0 });
    renderSettings();
    changed();
  };
  let resetTimer = null;
  $('resetBtn').onclick = () => {
    const btn = $('resetBtn');
    if (!btn.classList.contains('armed')) {
      btn.classList.add('armed');
      btn.textContent = 'もう一度押すと、入力をすべて消します';
      resetTimer = setTimeout(() => {
        btn.classList.remove('armed');
        btn.textContent = 'すべて初期状態に戻す';
      }, 4000);
      return;
    }
    clearTimeout(resetTimer);
    btn.classList.remove('armed');
    btn.textContent = 'すべて初期状態に戻す';
    state = defaults();
    ui.msg = null;
    renderSettings();
    renderAll();
    solve();
  };

  /* ---------- 起動 ---------- */
  renderSettings();
  renderAll();
  if (firstRun) solve();
})();
