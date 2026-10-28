// ブラウザで実際に操作して確かめる（要 Playwright）。実行: npm run test:e2e
// 対象は引数で変えられる: node test/e2e/app.e2e.js [index.html | dist/shift.html]
const path = require('path');
const fs = require('fs');
let chromium;
try { ({ chromium } = require('playwright')); } catch (e) { ({ chromium } = require(path.join(require('child_process').execSync('npm root -g').toString().trim(), 'playwright'))); }

const target = path.resolve(process.argv[2] || 'index.html');
const url = 'file://' + target;
let failed = 0;
const ok = (name, cond, extra) => {
  console.log((cond ? 'PASS ' : 'FAIL ') + name + (cond ? '' : '  ← ' + JSON.stringify(extra)));
  if (!cond) failed++;
};

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined }).catch(() => chromium.launch());

  // 希望休の選択欄で、日付と曜日の表示が切れていないか（最長の選択肢が欄に収まるか）
  const offTextFits = (pg) => pg.$$eval('#offRows select', (sels) => {
    const cv = document.createElement('canvas').getContext('2d');
    const bad = [];
    sels.forEach((s) => {
      const cs = getComputedStyle(s);
      cv.font = cs.fontWeight + ' ' + cs.fontSize + ' ' + cs.fontFamily;
      // 標準の矢印が付く欄は、矢印の分(約20px)が文字に重なる。環境ごとの字幅の差にも備えて余裕(6px)を見る
      const arrow = cs.appearance === 'none' || cs.webkitAppearance === 'none' ? 0 : 20;
      const avail = s.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight) - arrow;
      const widest = Math.max(...Array.from(s.options).map((o) => cv.measureText(o.text).width));
      if (widest + 6 > avail) bad.push({ avail: Math.round(avail), widest: Math.round(widest) });
    });
    return bad.length ? bad.slice(0, 3) : null;
  });

  // 自動作成が終わる（ボタンが元に戻る）まで待つ
  const solved = (pg) => pg.waitForFunction(() => !document.getElementById('solveBtn').disabled);

  async function open(opts = {}) {
    const ctx = await browser.newContext({ viewport: { width: 1100, height: 900 }, acceptDownloads: true, ...opts });
    const pg = await ctx.newPage();
    const errs = [];
    pg.on('pageerror', (e) => errs.push(String(e)));
    pg.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
    await pg.addInitScript(() => { window.__printCalls = 0; window.print = () => { window.__printCalls++; }; });
    await pg.goto(url);
    await pg.waitForSelector('#grid table');
    await solved(pg);
    return { ctx, pg, errs };
  }
  const staffCount = (pg) => pg.$$eval('#staffList .staff-row[data-id]', (e) => e.length);
  const gridRows = (pg) => pg.$$eval('#grid tbody tr', (e) => e.length);
  const offRows = (pg) => pg.$$eval('#offRows .off-row', (e) => e.length);

  // ---- 起動 ----
  let { ctx, pg, errs } = await open();
  ok('起動時にエラーがない', errs.length === 0, errs);
  ok('初期スタッフ7人', (await staffCount(pg)) === 7);
  ok('初回は自動で作成済み', /すべての条件を満たしています/.test(await pg.textContent('#banner')), await pg.textContent('#banner'));

  // ---- スタッフ追加 ----
  await pg.click('#addStaff');
  ok('スタッフ追加: 設定一覧が8人', (await staffCount(pg)) === 8);
  ok('スタッフ追加: シフト表が8行', (await gridRows(pg)) === 8);
  ok('スタッフ追加: 希望休欄が8行', (await offRows(pg)) === 8);
  const newId = await pg.$eval('#staffList .staff-row[data-id]:last-of-type', (e) => e.dataset.id);
  await pg.fill(`#staffList [data-id="${newId}"] [data-f="name"]`, '新人A');
  await pg.fill(`#staffList [data-id="${newId}"] [data-f="points"]`, '2');
  await pg.press(`#staffList [data-id="${newId}"] [data-f="points"]`, 'Tab');
  ok('名前とポイントが表に反映', /新人A\s*2pt/.test(await pg.$eval('#grid tbody tr:last-child td.n', (e) => e.textContent)), await pg.$eval('#grid tbody tr:last-child td.n', (e) => e.textContent));
  await pg.click('#solveBtn');
  await solved(pg);
  ok('追加後の自動作成が成功', /すべての条件を満たしています/.test(await pg.textContent('#banner')), await pg.textContent('#banner'));
  ok('追加したスタッフにも出勤が入る', (await pg.$$eval('#grid tbody tr:last-child td.w', (e) => e.length)) > 0);

  // 上限まで追加 → 無効化 → 削除で復活
  while (!(await pg.$eval('#addStaff', (e) => e.disabled))) await pg.click('#addStaff');
  ok('10人で追加ボタンが無効になる', (await staffCount(pg)) === 10);
  let t = Date.now();
  await pg.click('#solveBtn');
  await solved(pg);
  const ms10 = Date.now() - t;
  ok('10人の自動作成が3秒以内', ms10 < 3000, ms10);
  console.log('     (10人の自動作成: ' + ms10 + 'ms)');
  ok('10人の自動作成が成功', /すべての条件を満たしています/.test(await pg.textContent('#banner')), await pg.textContent('#banner'));
  const modalOpen = async () => !(await pg.$eval('#modal', (e) => e.hidden));
  await pg.click('#staffList [data-del]');
  ok('削除ボタンを押してもすぐには消えず、確認ポップが出る', (await modalOpen()) && (await staffCount(pg)) === 10 && /を削除しますか/.test(await pg.textContent('#modalTitle')), await pg.textContent('#modalTitle'));
  ok('確認ポップの初期フォーカスはキャンセル側', await pg.$eval('#modalCancel', (e) => e === document.activeElement));
  await pg.click('#modalCancel');
  ok('キャンセルすると削除されない', !(await modalOpen()) && (await staffCount(pg)) === 10);
  await pg.click('#staffList [data-del]');
  await pg.keyboard.press('Escape');
  ok('Escでも削除されずに閉じる', !(await modalOpen()) && (await staffCount(pg)) === 10);
  await pg.click('#staffList [data-del]');
  await pg.click('#modalOk');
  ok('確認後に削除すると9人になり追加ボタンが復活', !(await modalOpen()) && (await staffCount(pg)) === 9 && !(await pg.$eval('#addStaff', (e) => e.disabled)));

  // ---- 必要ポイントの設定 ----
  await pg.fill('#needWeekday', '5');
  await pg.press('#needWeekday', 'Tab');
  const needRow = await pg.$$eval('#grid tfoot tr.needRow input', (e) => e.map((x) => +x.value));
  const dayInfo = await pg.$$eval('#grid thead .dayBtn', (e) => e.map((x) => x.textContent));
  const weekdayIdx = dayInfo.findIndex((s) => /[月火水木金]/.test(s) && !/土|日/.test(s));
  ok('平日の必要ポイントが表に反映', needRow[weekdayIdx] === 5, { needRow, weekdayIdx });
  // 日付タップで高め/通常を切り替え
  const before = await pg.$eval(`#grid .dayBtn[data-d="${weekdayIdx + 1}"]`, (e) => e.closest('th').className);
  await pg.click(`#grid .dayBtn[data-d="${weekdayIdx + 1}"]`);
  const afterNeed = await pg.$eval(`#grid tfoot input[data-d="${weekdayIdx + 1}"]`, (e) => +e.value);
  ok('日付タップで高めの日になり必要ptが変わる', afterNeed !== 5 && !/hi/.test(before), { before, afterNeed });
  // 必要ptを直接書き換え
  await pg.fill(`#grid tfoot input[data-d="2"]`, '4');
  await pg.press(`#grid tfoot input[data-d="2"]`, 'Tab');
  ok('必要ptの直接編集が保存される', (await pg.$eval('#grid tfoot input[data-d="2"]', (e) => +e.value)) === 4);

  // ---- 希望休 ----
  const id0 = await pg.$eval('#offRows .off-row', (e) => e.dataset.id);
  await pg.selectOption(`#offRows [data-id="${id0}"] select[data-slot="0"]`, '12');
  ok('希望休欄の選択がシフト表の「希」に出る', (await pg.$eval('#grid tbody tr:first-child td[data-d="12"]', (e) => e.classList.contains('r'))));
  await pg.click('#grid tbody tr:nth-child(2) td[data-d="13"]');
  ok('表のタップで希望休が入る', (await pg.$eval('#grid tbody tr:nth-child(2) td[data-d="13"]', (e) => e.classList.contains('r'))));
  await pg.click('#solveBtn');
  await solved(pg);
  ok('希望休を守って作成', (await pg.$eval('#grid tbody tr:first-child td[data-d="12"]', (e) => !e.classList.contains('w'))));

  // ---- 希望休の入力欄は1行に3人 ----
  const tops = await pg.$$eval('#offRows .off-row', (e) => e.map((x) => Math.round(x.getBoundingClientRect().top)));
  ok('希望休の入力欄は1行に3人並ぶ', tops[0] === tops[1] && tops[1] === tops[2] && tops[3] > tops[2], tops);

  ok('希望休の日付と曜日が切れずに全部見える(幅1100px)', (await offTextFits(pg)) === null, await offTextFits(pg));

  // ---- 「絶対」と「できれば」 ----
  const idS = await pg.$eval('#offRows .off-row:nth-child(3)', (e) => e.dataset.id);
  await pg.selectOption(`#offRows [data-id="${idS}"] select[data-slot="0"]`, '15');
  ok('日付を選ぶと初期は「絶」', (await pg.textContent(`#offRows [data-id="${idS}"] .kind[data-slot="0"]`)) === '絶');
  await pg.click(`#offRows [data-id="${idS}"] .kind[data-slot="0"]`);
  ok('ボタンで「△(できれば)」に切り替わる', (await pg.textContent(`#offRows [data-id="${idS}"] .kind[data-slot="0"]`)) === '△' && (await pg.$eval(`#offRows [data-id="${idS}"] .slot[data-slot="0"]`, (e) => e.classList.contains('k2'))));
  const softCell = '#grid tbody tr:nth-child(3) td[data-d="15"]';
  ok('表では「できれば休み」の見た目になる', await pg.$eval(softCell, (e) => e.classList.contains('s') || e.classList.contains('sm')));
  await pg.click('#solveBtn');
  await solved(pg);
  ok('組める範囲で「できれば休み」が叶う(休みになる)', await pg.$eval(softCell, (e) => e.classList.contains('s') && !e.classList.contains('w')), await pg.$eval(softCell, (e) => e.className));
  ok('「できれば休み」は叶っても条件を満たす表', /すべての条件を満たしています/.test(await pg.textContent('#banner')), await pg.textContent('#banner'));
  // 表のタップ: 絶対 → できれば → なし
  const tap = '#grid tbody tr:nth-child(5) td[data-d="20"]';
  const kindOf = () => pg.$eval(tap, (e) => (e.classList.contains('r') ? 'hard' : e.classList.contains('s') || e.classList.contains('sm') ? 'soft' : 'none'));
  const seq = [];
  for (let k = 0; k < 3; k++) { await pg.click(tap); seq.push(await kindOf()); }
  ok('表のタップで 絶対 → できれば → なし と変わる', seq.join() === 'hard,soft,none', seq);
  // 全員ができれば休みでも組める
  for (let k = 0; k < 9; k++) {
    const c = `#grid tbody tr:nth-child(${k + 1}) td[data-d="25"]`;
    await pg.click(c); await pg.click(c);
  }
  await pg.click('#solveBtn');
  await solved(pg);
  ok('全員が「できれば休み」の日があっても自動作成できる', /すべての条件を満たしています/.test(await pg.textContent('#banner')), await pg.textContent('#banner'));
  ok('叶わなかった「できれば休み」は出勤のまま黄色い枠で示される', (await pg.$$eval('#grid td.sm', (e) => e.length)) > 0);

  // ---- 出勤を直す ----
  await pg.click('#modeWork');
  const cell = '#grid tbody tr:nth-child(3) td[data-d="8"]';
  const w0 = await pg.$eval(cell, (e) => e.classList.contains('w'));
  await pg.click(cell);
  ok('出勤を直すモードでセルが切り替わる', (await pg.$eval(cell, (e) => e.classList.contains('w'))) !== w0);
  await pg.click('#modeOff');

  // ---- 3連勤の検出 ----
  await pg.click('#modeWork');
  for (const d of [1, 2, 3]) {
    const c = `#grid tbody tr:nth-child(4) td[data-d="${d}"]`;
    if (!(await pg.$eval(c, (e) => e.classList.contains('w') || e.classList.contains('r')))) await pg.click(c);
  }
  const bad = await pg.$$eval('#grid td.v', (e) => e.length);
  ok('手直しで3連勤にすると赤く警告される', bad >= 3 || /3連勤/.test(await pg.textContent('#banner')), await pg.textContent('#banner'));
  await pg.click('#modeOff');

  // ---- 月の切り替えと保存 ----
  const m0 = await pg.textContent('#monthLabel');
  await pg.click('#nextMonth');
  ok('翌月に切り替わる', (await pg.textContent('#monthLabel')) !== m0);
  await pg.click('#prevMonth');
  await pg.reload();
  await pg.waitForSelector('#grid table');
  ok('再読み込み後もスタッフ名が残る', /新人A/.test(await pg.textContent('#grid')));
  ok('再読み込み後もスタッフ数が残る', (await staffCount(pg)) === 9);

  // ---- イベント出勤 ----
  const evRow = (name) => `#eventRows .ev-row:has(.who[title="${name}"])`;
  const firstName = await pg.$eval('#grid tbody tr:first-child td.n', (e) => e.firstChild.textContent);
  const needBefore = await pg.$$eval('#grid tfoot tr:nth-child(2) td', (e) => e.map((x) => x.textContent));
  // 日数に決まりがないので、同じ人に何日でも追加できる
  for (const day of ['3', '4', '10', '17', '18', '24']) await pg.selectOption(`${evRow(firstName)} .evAdd`, day);
  ok('イベントの日をいくつでも追加できる', (await pg.$$eval(`${evRow(firstName)} .chip`, (e) => e.length)) === 6);
  ok('イベントの日が表に「イ」で出る', (await pg.$$eval('#grid tbody tr:first-child td.ev', (e) => e.map((x) => x.textContent.trim()))).join() === 'イ,イ,イ,イ,イ,イ');
  await pg.click('#solveBtn');
  await solved(pg);
  const evCells = await pg.$$eval('#grid tbody tr:first-child td.cell', (tds) => tds.map((td) => (td.classList.contains('ev') ? 'ev' : td.classList.contains('w') ? 'w' : '-')));
  ok('イベントの日は店の出勤に入らない', evCells.filter((c) => c === 'ev').length === 6 && ![2, 3, 9, 16, 17, 23].some((i) => evCells[i] === 'w'), evCells.join(''));
  ok('イベントを入れても条件を満たしている', /すべての条件を満たしています/.test(await pg.textContent('#banner')), await pg.textContent('#banner'));
  const total = await pg.$$eval('#grid tfoot tr:nth-child(2) td', (e) => e.map((x) => x.textContent));
  ok('イベントの人は合計ptに数えない（必要ptは満たす）', !(await pg.$$eval('#grid tfoot td.ng', (e) => e.length)), total);
  const cntText = await pg.textContent('#grid tbody tr:first-child td.cnt');
  const workDays = evCells.filter((c) => c !== '-').length;
  ok('出勤日数にイベントの日も入る', cntText === workDays + '日', { cntText, workDays });
  await pg.click(`${evRow(firstName)} .evDel`);
  ok('イベントの日を削除できる', (await pg.$$eval(`${evRow(firstName)} .chip`, (e) => e.length)) === 5);
  // セルのタップ: 絶対休み → できれば休み → イベント → なし
  const tapCell = '#grid tbody tr:last-child td.cell[data-d="26"]';
  const tapCls = async () => (await pg.$eval(tapCell, (e) => e.className)).replace(/\s*(cell|lk)\s*/g, ' ').trim();
  const tapSeq = [];
  for (let k = 0; k < 4; k++) { await pg.click(tapCell); tapSeq.push(await tapCls()); }
  ok('セルのタップで 絶対→できれば→イベント→なし と変わる', tapSeq[0].includes('r') && tapSeq[1].includes('s') && tapSeq[2] === 'ev' && !/\b(r|s|ev)\b/.test(tapSeq[3]), tapSeq);
  // イベント3日連続は組めない
  const lastName = await pg.$eval('#grid tbody tr:last-child td.n', (e) => e.firstChild.textContent);
  for (const day of ['5', '6', '7']) await pg.selectOption(`${evRow(lastName)} .evAdd`, day); // 月・火・水（必要ptに余裕のある平日）
  await pg.click('#solveBtn');
  await solved(pg);
  ok('イベントが3日続くと3連勤になるので、案内が出る', /3連勤になってしまいます/.test(await pg.textContent('#banner')), await pg.textContent('#banner'));
  await pg.click(`${evRow(lastName)} .evDel`);
  await pg.click(`${evRow(lastName)} .evDel`);
  await pg.click(`${evRow(lastName)} .evDel`);
  await pg.click('#solveBtn');
  await solved(pg);
  ok('イベントを減らして作り直すと成功する', /すべての条件を満たしています/.test(await pg.textContent('#banner')), await pg.textContent('#banner'));

  // ---- Excel ----
  await pg.click('#solveBtn');
  await solved(pg);
  const [dl] = await Promise.all([pg.waitForEvent('download'), pg.click('#excelBtn')]);
  const xbuf = fs.readFileSync(await dl.path());
  const fnameOk = /^shift-\d{4}-\d{2}\.xlsx$/.test(dl.suggestedFilename());
  ok('Excelがダウンロードできる', fnameOk && xbuf.slice(0, 2).toString() === 'PK', dl.suggestedFilename());
  // 圧縮なしのzipなので、中身のXMLがそのまま読める
  const xtext = xbuf.toString('utf8');
  ok('Excelに全スタッフの名前があり、戦力ポイントは載らない', /新人A/.test(xtext) && !/\d+pt/.test(xtext));
  fs.writeFileSync(process.env.XLSX_OUT || '/tmp/shift-export.xlsx', xbuf);

  // ---- 途中から作り直す ----
  const workGrid = (pg) => pg.$$eval('#grid tbody tr', (trs) => trs.map((tr) => Array.from(tr.querySelectorAll('td.cell')).map((td) => (td.classList.contains('w') ? 1 : 0))));
  const same = (a, b, days) => a.every((row, i) => row.slice(0, days).join() === b[i].slice(0, days).join());
  ok('作成済みなら開始日を選べる', !(await pg.$eval('#fromDay', (e) => e.disabled)) && (await pg.textContent('#solveBtn')) === '自動作成');
  await pg.selectOption('#fromDay', '16');
  ok('開始日を選ぶとボタンの表示が変わる', (await pg.textContent('#solveBtn')) === '16日以降を作り直す', await pg.textContent('#solveBtn'));
  const lockedCols = await pg.$$eval('#grid thead th.lk', (e) => e.length);
  const lockedCells = await pg.$$eval('#grid tbody td.lk', (e) => e.length);
  ok('固定される15日分が薄く表示される', lockedCols === 15 && lockedCells === 15 * (await gridRows(pg)), { lockedCols, lockedCells });
  await pg.click('#grid td.cell[data-i="0"][data-d="20"]'); // 20日に希望休（絶対）を追加
  const beforePart = await workGrid(pg);
  let changedAfter = false;
  let partOk = true;
  for (let k = 0; k < 6; k++) {
    await pg.click('#solveBtn');
    await solved(pg);
    const g = await workGrid(pg);
    partOk = partOk && same(beforePart, g, 15) && g[0][19] === 0 && /すべての条件を満たしています/.test(await pg.textContent('#banner'));
    if (!same(beforePart.map((r) => r.slice(15)), g.map((r) => r.slice(15)), 99)) changedAfter = true;
  }
  ok('16日以降を作り直しても、15日までは1マスも変わらず条件を満たす', partOk, await pg.textContent('#banner'));
  ok('16日以降は作り直しで変わる', changedAfter);
  ok('作り直したあともボタンは選んだ開始日のまま', (await pg.textContent('#solveBtn')) === '16日以降を作り直す');
  await pg.selectOption('#fromDay', '1');
  ok('1日から（全部）に戻すと自動作成になる', (await pg.textContent('#solveBtn')) === '自動作成' && (await pg.$$eval('#grid .lk', (e) => e.length)) === 0);

  // ---- 印刷 ----
  await pg.click('#printBtn');
  ok('印刷ボタンで印刷ダイアログが呼ばれる', (await pg.evaluate(() => window.__printCalls)) === 1);
  await pg.emulateMedia({ media: 'print' });
  const vis = async (sel) => pg.$eval(sel, (e) => getComputedStyle(e).display !== 'none').catch(() => false);
  ok('印刷時は操作ボタン・設定・ポイント行が隠れる', !(await vis('.actions')) && !(await vis('.settings')) && !(await vis('#banner')) && !(await vis('tfoot')));
  ok('印刷時はシフト表が表示される', await vis('#grid table'));
  const pdf = await pg.pdf({ landscape: true, format: 'A4', printBackground: true });
  const pdfText = pdf.toString('latin1');
  const pages = (pdfText.match(/\/Type\s*\/Page[^s]/g) || []).length;
  ok('印刷結果(PDF)が1ページに収まる', pages === 1, pages);
  fs.writeFileSync(process.env.PDF_OUT || '/tmp/shift-print.pdf', pdf);
  await pg.emulateMedia({ media: 'screen' });

  // ---- リセット ----
  await pg.click('#resetBtn');
  ok('リセットは確認ポップが出て、キャンセルなら消えない', (await modalOpen()) && (await staffCount(pg)) === 9);
  await pg.click('#modalCancel');
  ok('キャンセル後もスタッフは9人のまま', !(await modalOpen()) && (await staffCount(pg)) === 9);
  await pg.click('#resetBtn');
  await pg.click('#modalOk');
  await solved(pg);
  ok('リセット2回目で初期状態(7人)に戻る', (await staffCount(pg)) === 7);
  ok('ここまでエラーなし', errs.length === 0, errs);
  await ctx.close();

  // ---- 祝日（カレンダーどおり・必要ポイントが多め） ----
  ({ ctx, pg, errs } = await open());
  while ((await pg.textContent('#monthLabel')) !== '2026年11月') await pg.click('#nextMonth');
  const hols = await pg.$$eval('#grid thead th.hol .dayBtn', (e) => e.map((x) => x.textContent.replace(/\s/g, '')));
  ok('2026年11月の祝日は3日(文化の日)と23日(勤労感謝の日)', JSON.stringify(hols) === JSON.stringify(['3祝', '23祝']), hols);
  const needs = await pg.$$eval('#grid tfoot tr.needRow input', (e) => e.map((x) => +x.value));
  const hi = +(await pg.inputValue('#needHigh')), lo = +(await pg.inputValue('#needWeekday'));
  ok('祝日の必要ポイントは土日と同じ「高め」', needs[2] === hi && needs[22] === hi && needs[6] === hi, { needs, hi });
  ok('祝日でない平日(11/4)は通常', needs[3] === lo, { needs, lo });
  ok('希望休の選択肢に月が付かず、祝日は「祝」と分かる', (await pg.$eval('#offRows select', (s) => s.options[3].text)) === '3(祝)', await pg.$eval('#offRows select', (s) => s.options[3].text));
  await pg.click('#grid .dayBtn[data-d="3"]');
  ok('祝日を通常に切り替えられる', (await pg.$eval('#grid tfoot input[data-d="3"]', (e) => +e.value)) === lo);
  await pg.click('#grid .dayBtn[data-d="3"]');
  ok('もう一度押すとカレンダーどおりに戻る', (await pg.$eval('#grid tfoot input[data-d="3"]', (e) => +e.value)) === hi);
  await pg.click('#solveBtn');
  await solved(pg);
  ok('祝日を含む月でも自動作成できる', /すべての条件を満たしています/.test(await pg.textContent('#banner')), await pg.textContent('#banner'));
  await ctx.close();

  // ---- 希望休の表示が切れない(画面幅ごと) ----
  for (const w of [1280, 900, 700]) {
    ({ ctx, pg, errs } = await open({ viewport: { width: w, height: 900 } }));
    ok('希望休の日付と曜日が切れずに全部見える(幅' + w + 'px)', (await offTextFits(pg)) === null, await offTextFits(pg));
    await ctx.close();
  }

  // ---- スマホ(タッチ) ----
  ({ ctx, pg, errs } = await open({ viewport: { width: 390, height: 800 }, hasTouch: true, isMobile: true }));
  await pg.tap('#addStaff');
  ok('スマホでスタッフ追加をタップできる', (await staffCount(pg)) === 8);
  await pg.tap('#grid tbody tr:first-child td[data-d="5"]');
  ok('スマホで表のセルをタップできる', await pg.$eval('#grid tbody tr:first-child td[data-d="5"]', (e) => e.classList.contains('r')));
  ok('スマホでも希望休の日付と曜日が全部見える', (await offTextFits(pg)) === null, await offTextFits(pg));
  ok('スマホで横にはみ出さない', (await pg.evaluate('document.documentElement.scrollWidth')) <= 390);
  ok('スマホでエラーなし', errs.length === 0, errs);
  await ctx.close();

  // ---- 端末をまたぐ同期（偽のFirebaseサーバーで確かめる） ----
  const fb = { doc: null, updateTime: null, tick: 0, puts: 0, offline: false, users: { 'me@example.com': 'secret' } };
  const fbRoute = async (route) => {
    const req = route.request();
    const u = new URL(req.url());
    const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' };
    const send = (status, body) => route.fulfill({ status, headers: { ...cors, 'content-type': 'application/json' }, body: JSON.stringify(body) });
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    if (fb.offline) return route.abort('failed');
    if (u.hostname === 'identitytoolkit.googleapis.com') {
      const b = JSON.parse(req.postData());
      if (fb.users[b.email] !== b.password) return send(400, { error: { message: 'INVALID_LOGIN_CREDENTIALS' } });
      return send(200, { idToken: 't', refreshToken: 'r', expiresIn: '3600', email: b.email });
    }
    if (u.hostname === 'securetoken.googleapis.com') return send(200, { id_token: 't', refresh_token: 'r', expires_in: '3600' });
    if (req.method() === 'GET') {
      if (!fb.doc) return send(404, { error: { status: 'NOT_FOUND' } });
      return send(200, { fields: { json: { stringValue: fb.doc } }, updateTime: fb.updateTime });
    }
    const exists = u.searchParams.get('currentDocument.exists');
    const ut = u.searchParams.get('currentDocument.updateTime');
    if ((exists === 'false' && fb.doc) || (ut && ut !== fb.updateTime)) return send(409, { error: { status: 'ABORTED' } });
    fb.doc = JSON.parse(req.postData()).fields.json.stringValue;
    fb.updateTime = '2026-10-28T00:00:' + String(++fb.tick).padStart(2, '0') + 'Z';
    fb.puts++;
    return send(200, { updateTime: fb.updateTime });
  };
  const devices = [];
  async function openDevice() {
    const c = await browser.newContext({ viewport: { width: 1100, height: 900 } }); // 端末ごとに保存領域が別
    await c.route(/googleapis\.com/, fbRoute);
    await c.addInitScript(() => { window.SHIFT_SYNC = { apiKey: 'k', projectId: 'p' }; });
    const p = await c.newPage();
    const e = [];
    p.on('pageerror', (x) => e.push(String(x)));
    await p.goto(url);
    await p.waitForSelector('#grid table');
    devices.push(c);
    return { ctx: c, pg: p, errs: e };
  }
  const statText = (p) => p.textContent('#syncStat');
  const synced = (p) => p.waitForFunction(() => /同期済み/.test(document.getElementById('syncStat').textContent), null, { timeout: 8000 });
  const saved = () => JSON.parse(fb.doc);
  const login = async (p, pass = 'secret') => {
    await p.fill('#loginEmail', 'me@example.com');
    await p.fill('#loginPass', pass);
    await p.click('#loginOk');
  };
  const evFirst = '#eventRows .ev-row:first-child';
  const staffNames = (p) => p.$$eval('#grid tbody td.n', (e) => e.map((x) => x.firstChild.textContent));

  const A = await openDevice();
  ok('同期の設定があり未ログインなら、ログイン画面が出る', !(await A.pg.$eval('#login', (e) => e.hidden)) && /未ログイン/.test(await statText(A.pg)));
  await login(A.pg, 'wrong');
  await A.pg.waitForFunction(() => document.getElementById('loginErr').textContent.length > 0);
  ok('パスワードが違うとエラーが出て、ログイン画面は閉じない', /メールアドレスかパスワードが違います/.test(await A.pg.textContent('#loginErr')) && !(await A.pg.$eval('#login', (e) => e.hidden)));
  await login(A.pg);
  await synced(A.pg);
  ok('ログインするとログイン画面が閉じ、同期済みになる', (await A.pg.$eval('#login', (e) => e.hidden)) && (await A.pg.textContent('#syncBtn')) === 'ログアウト');
  ok('クラウドが空だと、この端末のデータ（スタッフと最初の表）が送られる', fb.doc && saved().staff.length === 7 && Object.values(saved().months)[0].shifts, fb.doc && Object.keys(saved()));

  const puts0 = fb.puts;
  await A.pg.selectOption(`${evFirst} .evAdd`, '12');
  await synced(A.pg);
  await A.pg.waitForFunction(() => /同期済み/.test(document.getElementById('syncStat').textContent));
  const monthOf = () => Object.values(saved().months)[0];
  const firstId = () => saved().staff[0].id;
  ok('変更すると自動でクラウドに保存される（イベント日が入る）', fb.puts > puts0 && monthOf().off[firstId()]['12'] === 3, { puts: fb.puts, puts0 });

  const B = await openDevice();
  await login(B.pg);
  await synced(B.pg);
  const gridA = await A.pg.$$eval('#grid tbody tr', (trs) => trs.map((tr) => Array.from(tr.querySelectorAll('td.cell')).map((td) => td.className).join('|')));
  const gridB = await B.pg.$$eval('#grid tbody tr', (trs) => trs.map((tr) => Array.from(tr.querySelectorAll('td.cell')).map((td) => td.className).join('|')));
  ok('別の端末でログインすると、同じシフト表とイベント日が見える', gridA.join('\n') === gridB.join('\n') && (await B.pg.$$eval(`${evFirst} .chip`, (e) => e.length)) === 1);
  ok('2台目は初期データで上書きせず、クラウドのデータを使う', (await staffCount(B.pg)) === 7 && saved().staff.length === 7);

  await B.pg.fill('#staffList .staff-row:first-child [data-f="name"]', 'テスト太郎');
  await B.pg.press('#staffList .staff-row:first-child [data-f="name"]', 'Tab');
  await synced(B.pg);
  await B.pg.waitForFunction(() => /同期済み/.test(document.getElementById('syncStat').textContent));
  await A.pg.evaluate(() => document.dispatchEvent(new Event('visibilitychange'))); // 画面に戻ったときの確認
  await A.pg.waitForFunction(() => /テスト太郎/.test(document.getElementById('grid').textContent), null, { timeout: 8000 });
  ok('別の端末での変更が、画面に戻ったときに反映される', (await staffNames(A.pg))[0] === 'テスト太郎');

  await A.pg.reload();
  await A.pg.waitForSelector('#grid table');
  await synced(A.pg);
  ok('再読み込みしてもログインしたままで、同じデータが見える', (await A.pg.$eval('#login', (e) => e.hidden)) && (await staffNames(A.pg))[0] === 'テスト太郎');

  fb.offline = true;
  await A.pg.selectOption(`${evFirst} .evAdd`, '20');
  await A.pg.waitForFunction(() => /未保存/.test(document.getElementById('syncStat').textContent), null, { timeout: 8000 });
  ok('通信できないときは「未保存」と表示し、この端末には保存される', /未保存/.test(await statText(A.pg)) && (await A.pg.evaluate(() => JSON.parse(localStorage.getItem('shift-work-v1')).months)) !== null);
  fb.offline = false;
  await A.pg.evaluate(() => window.dispatchEvent(new Event('online')));
  await synced(A.pg);
  ok('通信が戻ると未保存の変更が送られる', monthOf().off[firstId()]['20'] === 3);

  // 衝突: A が通信できない間に編集し、その間に B も編集 → A は未送信の変更を退避し、B の内容に合わせる
  fb.offline = true;
  await A.pg.selectOption(`${evFirst} .evAdd`, '21');
  await A.pg.waitForFunction(() => /未保存/.test(document.getElementById('syncStat').textContent), null, { timeout: 8000 });
  fb.offline = false;
  await B.pg.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await B.pg.waitForFunction(() => /同期済み/.test(document.getElementById('syncStat').textContent));
  await B.pg.fill('#staffList .staff-row:nth-child(2) [data-f="name"]', 'テスト花子');
  await B.pg.press('#staffList .staff-row:nth-child(2) [data-f="name"]', 'Tab');
  await B.pg.waitForFunction(() => /同期済み/.test(document.getElementById('syncStat').textContent));
  await new Promise((r) => setTimeout(r, 1200));
  await A.pg.evaluate(() => window.dispatchEvent(new Event('online')));
  await A.pg.waitForFunction(() => /テスト花子/.test(document.getElementById('grid').textContent), null, { timeout: 8000 });
  const backup = await A.pg.evaluate(() => localStorage.getItem('shift-work-backup-v1'));
  ok('同時に編集して衝突したら、クラウドの内容に合わせ、この端末の未送信分を退避する', (await staffNames(A.pg))[1] === 'テスト花子' && backup && /"21":3/.test(backup) && !monthOf().off[firstId()]['21'], { names: await staffNames(A.pg), hasBackup: !!backup });

  await A.pg.click('#syncBtn');
  ok('ログアウトは確認ポップが出る', !(await A.pg.$eval('#modal', (e) => e.hidden)));
  await A.pg.click('#modalOk');
  ok('ログアウトすると「ログイン」に戻り、以後の変更はクラウドに送られない', (await A.pg.textContent('#syncBtn')) === 'ログイン' && /未ログイン/.test(await statText(A.pg)));
  const putsOut = fb.puts;
  await A.pg.selectOption(`${evFirst} .evAdd`, '22');
  await new Promise((r) => setTimeout(r, 1500));
  ok('ログアウト中の変更は、クラウドには送られない', fb.puts === putsOut);
  ok('同期のテスト中にエラーがない', A.errs.length === 0 && B.errs.length === 0, [A.errs, B.errs]);
  for (const c of devices) await c.close();

  await browser.close();
  console.log(failed ? `\n${failed} 件失敗` : '\nすべて成功');
  process.exit(failed ? 1 : 0);
})();
