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
  function saveLocal() {
    try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) { /* 保存できなくても動作は続ける */ }
  }
  // 変更のたびに、この端末に保存し、ログイン中ならクラウドにも送る（markDirty）
  function save() {
    saveLocal();
    markDirty();
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
  const ui = { year: now.getFullYear(), month: now.getMonth(), mode: 'off', msg: null, fromDay: 1 };

  const monthKey = () => ui.year + '-' + pad(ui.month + 1);
  const dayCount = () => new Date(ui.year, ui.month + 1, 0).getDate();
  const weekday = (day) => new Date(ui.year, ui.month, day).getDay();
  function md() {
    const k = monthKey();
    if (!state.months[k]) state.months[k] = { off: {}, shifts: null, dayType: {}, needOv: {} };
    return state.months[k];
  }

  /* ---------- 日ごとの設定 ---------- */
  const holiday = (day) => ShiftHolidays.holidayName(ui.year, ui.month + 1, day);
  // 土日と祝日（カレンダーどおり）は、必要ポイントが多めの日
  function defaultHigh(day) {
    const w = weekday(day);
    return w === 0 || w === 6 || !!holiday(day);
  }
  function isHigh(day) {
    const t = md().dayType[day];
    return t ? t === 'high' : defaultHigh(day);
  }
  const defaultNeed = (day) => (isHigh(day) ? state.needHigh : state.needWeekday);
  function needOf(day) {
    const o = md().needOv[day];
    return o === undefined ? defaultNeed(day) : o;
  }

  /* ---------- 希望休（1=絶対休み、2=できれば休み） ---------- */
  // 3=イベント出勤（出勤扱い・連勤に数える・店のポイントには数えない）。希望休と同じ置き場に入れ、1日につきどれか1つ
  const HARD = 1;
  const SOFT = 2;
  const EVENT = 3;
  const offKind = (id, d) => (md().off[id] && md().off[id][d]) || 0;

  /* ---------- 計算エンジンとの受け渡し ---------- */
  function buildInput() {
    const D = dayCount();
    const m = md();
    const days = Array.from({ length: D }, (_, i) => i + 1);
    return {
      points: state.staff.map((s) => s.points),
      need: days.map(needOf),
      high: days.map(isHigh),
      off: state.staff.map((s) => days.map((d) => offKind(s.id, d) === HARD)),
      soft: state.staff.map((s) => days.map((d) => offKind(s.id, d) === SOFT)),
      event: state.staff.map((s) => days.map((d) => offKind(s.id, d) === EVENT)),
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
    const from = fromDay(); // この日より前は作り直しで変わらない（表では薄く表示）
    const lk = (d) => (d < from ? ' lk' : '');

    let h = '<table class="g"><thead><tr><th class="n">スタッフ</th>';
    for (let d = 1; d <= D; d++) {
      const w = weekday(d);
      const hol = holiday(d);
      const cls = (hol ? 'hol ' : w === 6 ? 'sat ' : w === 0 ? 'sun ' : '') + (isHigh(d) ? 'hi' : '') + lk(d);
      const title = (hol ? hol + '（' + WD[w] + '）　' : '') + 'タップで高め／通常を切り替え';
      h += '<th class="' + cls + '"><button class="dayBtn" data-d="' + d + '" title="' + title + '">' + d + '<br>' + (hol ? '祝' : WD[w]) + '</button></th>';
    }
    h += '<th class="cnt">出勤</th></tr></thead><tbody>';
    state.staff.forEach((s, i) => {
      let cnt = 0;
      h += '<tr><td class="n">' + esc(s.name) + '<span>' + s.points + 'pt</span></td>';
      for (let d = 1; d <= D; d++) {
        const kind = offKind(s.id, d);
        const works = rows[i][d - 1] === 1;
        if (works) cnt++;
        const bad = res.runCells.has(i + ',' + (d - 1)) || res.offCells.has(i + ',' + (d - 1));
        let cls = 'cell' + lk(d);
        let body;
        let title = '';
        if (kind === EVENT) { cls += ' ev'; body = 'イ'; title = 'イベント出勤（店のポイントには数えません）'; cnt++; }
        else if (kind === HARD) { cls += ' r'; body = '<span class="scr">絶</span><span class="prt">休</span>'; title = '絶対に休み'; }
        else if (kind === SOFT && !works) { cls += ' s'; body = '<span class="scr">△</span><span class="prt">休</span>'; title = 'できれば休み'; }
        else if (works) { cls += ' w' + (kind === SOFT ? ' sm' : ''); body = '出'; title = kind === SOFT ? 'できれば休みの希望でしたが出勤です' : ''; }
        else body = '<span class="prt">休</span>';
        if (bad) cls += ' v';
        h += '<td class="' + cls + '" data-i="' + i + '" data-d="' + d + '"' + (title ? ' title="' + title + '"' : '') + '>' + body + '</td>';
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
    renderEventForm();
    renderFromDay(made);
  }

  // 作り直す開始日。まだ表を作っていない月は、最初から全部作るので選べない
  const fromDay = () => (md().shifts ? Math.min(Math.max(ui.fromDay, 1), dayCount()) : 1);
  let fromSig = '';
  function renderFromDay(made) {
    const sel = $('fromDay');
    const sig = monthKey();
    if (sig !== fromSig) {
      fromSig = sig;
      let o = '';
      for (let d = 1; d <= dayCount(); d++) o += '<option value="' + d + '">' + d + '日(' + (holiday(d) ? '祝' : WD[weekday(d)]) + ')から' + (d === 1 ? '（全部）' : '') + '</option>';
      sel.innerHTML = o;
    }
    sel.disabled = !made;
    sel.title = made ? 'この日より前は今の表のまま残し、この日以降だけを作り直します' : '先に一度「自動作成」すると、途中から作り直せます';
    sel.value = String(fromDay());
    const btn = $('solveBtn');
    if (!btn.disabled) btn.textContent = fromDay() > 1 ? fromDay() + '日以降を作り直す' : '自動作成';
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
      let softTotal = 0;
      state.staff.forEach((s) => { for (let d = 1; d <= dayCount(); d++) if (offKind(s.id, d) === SOFT) softTotal++; });
      b.innerHTML = '<span><b>すべての条件を満たしています。</b>余剰ポイントは月合計で' + surplus + 'ptです。</span>' +
        (softTotal ? '<span>「できれば休み」' + softTotal + '日のうち、' + (softTotal - res.softCells.size) + '日が叶いました' +
          (res.softCells.size ? '（叶わなかった日は黄色い枠）' : '') + '。</span>' : '');
    }
  }

  const OFF_SLOTS = 3;
  const KIND_LABEL = { 1: '絶', 2: '△' };
  const KIND_TITLE = { 1: '絶対に休み（押すと「できれば」に切り替え）', 2: 'できれば休み（押すと「絶対」に切り替え）' };
  let offSig = '';
  function renderOffForm() {
    const D = dayCount();
    const sig = monthKey() + '|' + state.staff.map((s) => s.id + s.name).join(',');
    const wrap = $('offRows');
    if (sig !== offSig) {
      offSig = sig;
      const opts = ['<option value="">—</option>'];
      for (let d = 1; d <= D; d++) opts.push('<option value="' + d + '">' + d + '(' + (holiday(d) ? '祝' : WD[weekday(d)]) + ')</option>');
      wrap.innerHTML = state.staff.map((s) =>
        '<div class="off-row" data-id="' + s.id + '"><div class="who" title="' + esc(s.name) + '">' + esc(s.name) + '</div>' +
        Array.from({ length: OFF_SLOTS }, (_, k) =>
          '<span class="slot" data-slot="' + k + '"><select data-slot="' + k + '" aria-label="' + esc(s.name) + 'の希望休' + (k + 1) + '">' + opts.join('') + '</select>' +
          '<button class="kind" data-slot="' + k + '" hidden></button></span>').join('') +
        '<div class="more" hidden></div></div>').join('');
    }
    wrap.querySelectorAll('.off-row').forEach((row) => {
      const list = offList(row.dataset.id);
      row.querySelectorAll('.slot').forEach((slot, k) => {
        const it = list[k];
        const sel = slot.querySelector('select');
        const btn = slot.querySelector('.kind');
        sel.value = it ? String(it.day) : '';
        slot.className = 'slot' + (it ? ' has k' + it.kind : '');
        btn.hidden = !it;
        if (it) {
          btn.textContent = KIND_LABEL[it.kind];
          btn.title = KIND_TITLE[it.kind];
          btn.setAttribute('aria-label', KIND_TITLE[it.kind]);
        }
      });
      const more = row.querySelector('.more');
      more.hidden = list.length <= OFF_SLOTS;
      more.textContent = 'ほか' + (list.length - OFF_SLOTS) + '日（表で入力）: ' + list.slice(OFF_SLOTS).map((x) => x.day + (x.kind === SOFT ? '(△)' : '')).join('、') + '日';
    });
    $('offMonth').textContent = (ui.month + 1) + '月';
  }

  // イベント出勤の入力。日数に決まりがないので、スタッフごとに日付を好きなだけ追加・削除できる
  function renderEventForm() {
    const D = dayCount();
    const dayLabel = (d) => d + '(' + (holiday(d) ? '祝' : WD[weekday(d)]) + ')';
    $('eventRows').innerHTML = state.staff.map((s) => {
      const days = eventDays(s.id);
      const opts = ['<option value="">＋日付を追加</option>'];
      for (let d = 1; d <= D; d++) if (!days.includes(d)) opts.push('<option value="' + d + '">' + dayLabel(d) + '</option>');
      return '<div class="ev-row" data-id="' + s.id + '"><div class="who" title="' + esc(s.name) + '">' + esc(s.name) + '</div><div class="chips">' +
        days.map((d) => '<span class="chip">' + dayLabel(d) + '<button class="evDel" data-d="' + d + '" aria-label="' + esc(s.name) + 'の' + d + '日のイベントを削除" title="削除">×</button></span>').join('') +
        '<select class="evAdd" aria-label="' + esc(s.name) + 'にイベントの日を追加">' + opts.join('') + '</select></div></div>';
    }).join('');
    $('evMonth').textContent = (ui.month + 1) + '月';
  }

  function renderMonth() {
    $('monthLabel').textContent = ui.year + '年' + (ui.month + 1) + '月';
  }

  function renderSettings() {
    $('needWeekday').value = state.needWeekday;
    $('needHigh').value = state.needHigh;
    let h = '';
    state.staff.forEach((s) => {
      h += '<div class="staff-row" data-id="' + s.id + '">' +
        '<input data-f="name" value="' + esc(s.name) + '" aria-label="名前" maxlength="8">' +
        '<label class="pt"><input data-f="points" type="number" min="1" max="9" value="' + s.points + '" aria-label="戦力ポイント">pt</label>' +
        '<select data-f="prevStreak" aria-label="前月末の連勤" title="前月末の連勤">' +
        [0, 1, 2].map((v) => '<option value="' + v + '"' + (s.prevStreak === v ? ' selected' : '') + '>連' + v + '日</option>').join('') +
        '</select><button class="x" data-del="' + s.id + '" aria-label="' + esc(s.name) + 'を削除" title="削除">×</button></div>';
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
  // kind: 1=絶対休み 2=できれば休み 3=イベント出勤 0=解除
  function setOff(id, d, kind) {
    const m = md();
    m.off[id] = m.off[id] || {};
    if (!kind) delete m.off[id][d];
    else {
      m.off[id][d] = kind;
      if ((kind === HARD || kind === EVENT) && m.shifts && m.shifts[id]) m.shifts[id][d - 1] = 0;
    }
  }
  const kindList = (id, pick) => Object.keys(md().off[id] || {}).map(Number).sort((x, y) => x - y).map((day) => ({ day, kind: offKind(id, day) })).filter((x) => pick(x.kind));
  const offList = (id) => kindList(id, (k) => k === HARD || k === SOFT); // 希望休の入力欄に出すもの
  const eventDays = (id) => kindList(id, (k) => k === EVENT).map((x) => x.day);

  function toggleCell(i, d) {
    const s = state.staff[i];
    const m = md();
    if (ui.mode === 'off') {
      // タップするたびに 絶対休み → できれば休み → イベント → なし
      const next = { 0: HARD, [HARD]: SOFT, [SOFT]: EVENT, [EVENT]: 0 }[offKind(s.id, d)];
      setOff(s.id, d, next);
    } else {
      if (offKind(s.id, d) === HARD || offKind(s.id, d) === EVENT) return;
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
        renderFromDay(!!md().shifts);
      }
    }, 30);
  }

  function runSolve() {
    if (!md().shifts) ui.fromDay = 1; // 初めて作るときは必ず月初から（リセット後に前の開始日が残らないように）
    const input = buildInput();
    const from = fromDay() - 1;
    const opts = { seed: Math.floor(Math.random() * 1e6) };
    const r = from > 0 ? ShiftSolver.solveFrom(input, currentRows(), from, opts) : ShiftSolver.solve(input, opts);
    if (r.ok) {
      setRows(r.rows);
      ui.msg = null;
      save();
      renderGrid();
      if (from > 0) toast((from + 1) + '日以降を作り直しました。' + from + '日までは変わっていません');
      return;
    }
    const c = r.conflict;
    let html;
    if (c.reason === 'short') {
      const day = c.day + 1;
      const who = c.offStaff.map((i) => state.staff[i].name);
      const ev = (c.eventStaff || []).map((i) => state.staff[i].name);
      html = '<span><b>' + (ui.month + 1) + '/' + day + '（' + WD[weekday(day)] + '）の必要' + c.need + 'ptを満たせません。</b>' +
        'この日に店に出られる人の合計は最大' + c.maxPossible + 'ptです。</span>' +
        (who.length ? '<span>この日の希望休：' + esc(who.join('、')) + '</span>' : '') +
        (ev.length ? '<span>この日のイベント出勤：' + esc(ev.join('、')) + '</span>' : '') +
        '<span>直前までの連勤制限も影響しています。この日の希望休やイベントを減らす、必要ptを下げる、スタッフを増やすのいずれかで解決します。</span>';
    } else if (c.reason === 'run') {
      const day = c.day + 1;
      const who = c.staff.map((i) => state.staff[i].name);
      html = '<span><b>' + (ui.month + 1) + '/' + day + '（' + WD[weekday(day)] + '）に、' + esc(who.join('、')) + 'が3連勤になってしまいます。</b></span>' +
        '<span>イベント出勤も連勤に数えます。イベントの日が3日以上続いているか、前月末からの連勤と重なっています。イベントの日を見直してください。</span>';
    } else {
      html = '<span><b>条件を満たす表を作れませんでした。</b>スタッフの設定を確認してください。</span>';
    }
    ui.msg = { kind: 'bad', html };
    renderGrid();
  }

  // 画面の表（スタッフ名・出勤・出勤日数）と同じ内容。戦力ポイントは含めない
  function sheetData() {
    const D = dayCount();
    const rows = currentRows();
    const made = !!md().shifts;
    const header = [{ text: 'スタッフ' }];
    for (let d = 1; d <= D; d++) {
      const w = weekday(d);
      const hol = holiday(d);
      header.push({ text: d + '\n' + (hol ? '祝' : WD[w]), day: hol || w === 0 ? 'sun' : w === 6 ? 'sat' : '', high: isHigh(d) });
    }
    header.push({ text: '出勤' });
    let hasEvent = false;
    const body = state.staff.map((s, i) => {
      // 出勤日数には、イベント出勤も含める
      let cnt = 0;
      const cells = rows[i].map((v, k) => {
        if (offKind(s.id, k + 1) === EVENT) { hasEvent = true; cnt++; return 'ev'; }
        if (v === 1) cnt++;
        return v === 1;
      });
      return { name: s.name, cells, total: made ? cnt + '日' : '–' };
    });
    return { sheetName: (ui.month + 1) + '月', header, rows: body, note: hasEvent ? 'イ：イベント出勤（店のポイントには数えません）' : '' };
  }

  function exportExcel() {
    const data = sheetData();
    if (sandboxed) {
      // ダウンロードできない環境では、Excelに貼り付けられるタブ区切りでコピーする
      const lines = [data.header.map((c) => c.text.replace(/\n(.+)/, '($1)'))]
        .concat(data.rows.map((r) => [r.name].concat(r.cells.map((w) => (w === 'ev' ? 'イ' : w ? '出' : '')), r.total)));
      const tsv = lines.map((l) => l.join('\t')).join('\n');
      const done = () => toast('表をコピーしました。Excelやスプレッドシートに貼り付けられます');
      const fail = () => toast('コピーできませんでした');
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(tsv).then(done, fail);
      else fail();
      return;
    }
    const type = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    const url = URL.createObjectURL(new Blob([ShiftXlsx.build(data)], { type }));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'shift-' + monthKey() + '.xlsx';
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
    ui.fromDay = 1;
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
      if (next === (defaultHigh(d) ? 'high' : 'normal')) delete m.dayType[d]; else m.dayType[d] = next;
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
    const old = offList(id)[+sel.dataset.slot];
    if (old) setOff(id, old.day, 0);
    if (sel.value) setOff(id, +sel.value, old ? old.kind : HARD);
    changed();
  });
  $('offRows').addEventListener('click', (e) => {
    const btn = e.target.closest('.kind');
    if (!btn) return;
    const id = btn.closest('.off-row').dataset.id;
    const it = offList(id)[+btn.dataset.slot];
    if (!it) return;
    setOff(id, it.day, it.kind === HARD ? SOFT : HARD);
    changed();
  });

  $('eventRows').addEventListener('change', (e) => {
    const sel = e.target.closest('.evAdd');
    if (!sel || !sel.value) return;
    setOff(sel.closest('.ev-row').dataset.id, +sel.value, EVENT);
    changed();
  });
  $('eventRows').addEventListener('click', (e) => {
    const btn = e.target.closest('.evDel');
    if (!btn) return;
    setOff(btn.closest('.ev-row').dataset.id, +btn.dataset.d, 0);
    changed();
  });

  $('prevMonth').onclick = () => shiftMonth(-1);
  $('nextMonth').onclick = () => shiftMonth(1);
  $('solveBtn').onclick = solve;
  $('fromDay').onchange = (e) => {
    ui.fromDay = +e.target.value;
    renderGrid();
  };
  $('excelBtn').onclick = exportExcel;
  if (sandboxed) {
    $('excelBtn').textContent = '表をコピー';
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
  /* ---------- 確認ポップ ---------- */
  // 確認ポップを出し、「実行する」が押されたら true、それ以外（キャンセル・Esc・外側タップ）は false を返す
  function ask({ title, body, ok }) {
    return new Promise((resolve) => {
      const modal = $('modal');
      const okBtn = $('modalOk');
      const cancelBtn = $('modalCancel');
      const opener = document.activeElement;
      $('modalTitle').textContent = title;
      $('modalBody').textContent = body;
      okBtn.textContent = ok;
      modal.hidden = false;
      cancelBtn.focus(); // 誤って実行しないよう、初期フォーカスはキャンセル側
      const finish = (answer) => {
        modal.hidden = true;
        modal.removeEventListener('click', onOverlay);
        document.removeEventListener('keydown', onKey, true);
        okBtn.onclick = cancelBtn.onclick = null;
        if (opener && opener.isConnected) opener.focus();
        resolve(answer);
      };
      const onOverlay = (e) => { if (e.target === modal) finish(false); };
      const onKey = (e) => {
        if (e.key === 'Escape') { e.preventDefault(); finish(false); }
        else if (e.key === 'Tab') {
          // フォーカスをポップの中に閉じ込める
          e.preventDefault();
          (document.activeElement === okBtn ? cancelBtn : okBtn).focus();
        }
      };
      okBtn.onclick = () => finish(true);
      cancelBtn.onclick = () => finish(false);
      modal.addEventListener('click', onOverlay);
      document.addEventListener('keydown', onKey, true);
    });
  }

  $('staffList').addEventListener('click', async (e) => {
    const id = e.target.dataset.del;
    if (!id) return;
    if (state.staff.length <= 1) return toast('最後の1人は削除できません');
    const s = state.staff.find((x) => x.id === id);
    const yes = await ask({
      title: '「' + s.name + '」を削除しますか？',
      body: 'この人の希望休とシフトも、すべての月から消えます。元に戻せません。',
      ok: '削除する',
    });
    if (!yes) return;
    state.staff = state.staff.filter((x) => x.id !== id);
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
  $('resetBtn').onclick = async () => {
    const yes = await ask({
      title: 'すべて初期状態に戻しますか？',
      body: 'スタッフ・希望休・作成したシフトなど、入力した内容をすべて消します。元に戻せません。',
      ok: '初期状態に戻す',
    });
    if (!yes) return;
    state = defaults();
    ui.msg = null;
    renderSettings();
    renderAll();
    solve();
  };

  /* ---------- 端末をまたぐ同期 ---------- */
  // ログインしている間は、変更をクラウド（Firestore）に自動で保存し、別の端末の変更を読み込む。
  // 設定が空・公開ページ（sandboxed）では何もせず、これまでどおりこの端末の中だけに保存する。
  const sync = ShiftSync.create(sandboxed ? {} : window.SHIFT_SYNC);
  const META_KEY = 'shift-work-sync-v1'; // この端末が最後に同期した時刻と、未送信の変更があるか
  const BACKUP_KEY = 'shift-work-backup-v1'; // クラウドの内容に置き換えたとき、この端末の未送信データを退避する
  const readMeta = () => {
    try {
      const m = JSON.parse(localStorage.getItem(META_KEY));
      if (m && typeof m === 'object') return m;
    } catch (e) { /* 初めての端末 */ }
    return null;
  };
  // 同期の記録が無い端末でも、すでに使っていたデータがあれば「未送信」とみなす
  let meta = readMeta() || { updateTime: null, dirty: !firstRun };
  const writeMeta = () => {
    try { localStorage.setItem(META_KEY, JSON.stringify(meta)); } catch (e) { /* 保存できなくても動作は続ける */ }
  };
  let syncBusy = false;
  let syncRev = 0; // 変更のたびに増やし、送信中の変更を取りこぼさない
  let syncTimer = null;
  let retryTimer = null;

  function setStat(kind, text) {
    const el = $('syncStat');
    el.className = 'syncStat ' + kind;
    el.textContent = text;
  }
  function renderSyncUi() {
    $('sync').hidden = !sync.enabled;
    if (!sync.enabled) return;
    $('syncBtn').textContent = sync.signedIn() ? 'ログアウト' : 'ログイン';
    $('syncBtn').title = sync.signedIn() ? sync.email() + ' でログイン中' : '';
    $('saveNote').textContent = sync.signedIn()
      ? '入力内容はこの端末に保存され、ログイン中はクラウドにも自動で保存されます（どの端末からでも同じ内容が見られます）。'
      : '入力内容はこの端末にだけ保存されます。ログインすると、クラウドにも保存されます。';
  }

  function markDirty() {
    if (!sync.enabled) return;
    meta.dirty = true;
    writeMeta();
    syncRev++;
    if (!sync.signedIn()) return setStat('off', '未ログイン（この端末にだけ保存）');
    setStat('busy', '保存待ち…');
    clearTimeout(syncTimer);
    syncTimer = setTimeout(push, 700);
  }

  // 失敗の種類ごとに、表示と次の動きを決める
  function syncError(e) {
    if (e.code === 'network') {
      setStat('warn', meta.dirty ? '未保存（通信できません）' : '通信できません');
      clearTimeout(retryTimer);
      retryTimer = setTimeout(() => (meta.dirty ? push() : pull(true)), 20000);
    } else if (e.code === 'signedout') {
      lock(e.message);
    } else {
      setStat('warn', e.message);
      toast(e.message);
    }
  }

  async function push() {
    if (!sync.enabled || !sync.signedIn() || !meta.dirty || syncBusy) return;
    syncBusy = true;
    const rev = syncRev;
    setStat('busy', '保存中…');
    try {
      const r = await sync.save(JSON.stringify(state), meta.updateTime);
      meta.updateTime = r.updateTime;
      if (rev === syncRev) meta.dirty = false;
      writeMeta();
      setStat('ok', '同期済み');
    } catch (e) {
      syncBusy = false;
      return e.conflict ? pull() : syncError(e);
    }
    syncBusy = false;
    if (meta.dirty) push(); // 送信中にさらに変更があった
  }

  const validState = (s) => s && Array.isArray(s.staff) && s.staff.length && s.months && typeof s.months === 'object';

  async function pull(quiet) {
    if (!sync.enabled || !sync.signedIn() || syncBusy) return;
    syncBusy = true;
    setStat('busy', '読み込み中…');
    try {
      const r = await sync.load();
      syncBusy = false;
      if (!r.exists) {
        // クラウドがまだ空なら、この端末のデータを最初のデータとして送る
        meta.updateTime = null;
        meta.dirty = true;
        writeMeta();
        if (firstRun && !md().shifts) solve(); // 初めての端末は、最初の表を作る（作ると自動で送られる）
        else push();
        return;
      }
      if (r.updateTime === meta.updateTime) {
        if (meta.dirty) push();
        else setStat('ok', '同期済み');
        return;
      }
      // クラウドの方が新しい（または、この端末が初めて同期する）ので、クラウドの内容に合わせる
      let remote = null;
      try { remote = JSON.parse(r.json); } catch (e) { /* 読めない場合は下で止める */ }
      if (!validState(remote)) return setStat('warn', 'クラウドのデータを読めませんでした');
      if (meta.dirty) {
        try { localStorage.setItem(BACKUP_KEY, JSON.stringify({ at: new Date().toISOString(), state })); } catch (e) { /* 退避できなくても続ける */ }
      }
      const hadLocalEdits = meta.dirty;
      state = remote;
      saveLocal();
      meta = { updateTime: r.updateTime, dirty: false };
      writeMeta();
      ui.msg = null;
      renderSettings();
      renderAll();
      setStat('ok', '同期済み');
      if (hadLocalEdits) toast('クラウドの内容を読み込みました。この端末の未送信の変更は退避してあります');
      else if (quiet) toast('別の端末での変更を読み込みました');
    } catch (e) {
      syncBusy = false;
      syncError(e);
    }
  }

  /* ログイン（ログインするまでは、シフト表などの中身は画面に出さない） */
  function lock(msg) {
    document.body.classList.add('locked');
    clearTimeout(syncTimer);
    clearTimeout(retryTimer);
    renderSyncUi();
    setStat('off', '未ログイン');
    showLogin(msg);
  }
  function unlock() {
    document.body.classList.remove('locked');
    hideLogin();
    renderSyncUi();
  }
  function showLogin(msg) {
    $('loginErr').textContent = msg || '';
    $('login').hidden = false;
    try { $('loginEmail').value = $('loginEmail').value || localStorage.getItem('shift-work-last-email') || ''; } catch (e) { /* 無くてよい */ }
    ($('loginEmail').value ? $('loginPass') : $('loginEmail')).focus();
  }
  function hideLogin() {
    $('login').hidden = true;
    $('loginPass').value = '';
    $('loginErr').textContent = '';
  }
  $('loginForm').onsubmit = async (e) => {
    e.preventDefault();
    const btn = $('loginOk');
    btn.disabled = true;
    $('loginErr').textContent = '';
    try {
      await sync.signIn($('loginEmail').value, $('loginPass').value);
      try { localStorage.setItem('shift-work-last-email', sync.email()); } catch (err) { /* 無くてよい */ }
      unlock();
      await pull();
    } catch (err) {
      $('loginErr').textContent = err.message;
    } finally {
      btn.disabled = false;
    }
  };
  $('syncBtn').onclick = async () => {
    if (!sync.signedIn()) return lock();
    const yes = await ask({
      title: 'ログアウトしますか？',
      body: '画面からシフトが見えなくなります。もう一度ログインすると、クラウドの内容が表示されます。',
      ok: 'ログアウト',
    });
    if (!yes) return;
    sync.signOut();
    lock();
  };
  // 別の端末で変更していることがあるので、画面に戻ったときに最新を確認する。ネットワークが戻ったら未送信分を送る
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && sync.signedIn() && !meta.dirty) pull(true);
  });
  window.addEventListener('online', () => {
    if (sync.signedIn()) meta.dirty ? push() : pull(true);
  });

  /* ---------- 起動 ---------- */
  renderSettings();
  renderAll();
  renderSyncUi();
  if (!sync.enabled) {
    if (firstRun) solve();
  } else if (sync.signedIn()) {
    setStat('busy', '読み込み中…');
    pull();
  } else {
    lock();
  }
})();
