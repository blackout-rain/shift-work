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

  // ---- CSV ----
  await pg.click('#solveBtn');
  await solved(pg);
  const [dl] = await Promise.all([pg.waitForEvent('download'), pg.click('#csvBtn')]);
  const csvPath = await dl.path();
  const csv = fs.readFileSync(csvPath, 'utf8');
  ok('CSVがダウンロードできる', /^shift-\d{4}-\d{2}\.csv$/.test(dl.suggestedFilename()), dl.suggestedFilename());
  ok('CSVに全スタッフ分の行がある', csv.trim().split(/\r?\n/).length === 1 + 9, csv.split(/\r?\n/).length);
  ok('CSVの先頭にBOMがあり日本語が読める', csv.charCodeAt(0) === 0xfeff && /新人A/.test(csv));

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

  // ---- スマホ(タッチ) ----
  ({ ctx, pg, errs } = await open({ viewport: { width: 390, height: 800 }, hasTouch: true, isMobile: true }));
  await pg.tap('#addStaff');
  ok('スマホでスタッフ追加をタップできる', (await staffCount(pg)) === 8);
  await pg.tap('#grid tbody tr:first-child td[data-d="5"]');
  ok('スマホで表のセルをタップできる', await pg.$eval('#grid tbody tr:first-child td[data-d="5"]', (e) => e.classList.contains('r')));
  ok('スマホで横にはみ出さない', (await pg.evaluate('document.documentElement.scrollWidth')) <= 390);
  ok('スマホでエラーなし', errs.length === 0, errs);
  await ctx.close();

  await browser.close();
  console.log(failed ? `\n${failed} 件失敗` : '\nすべて成功');
  process.exit(failed ? 1 : 0);
})();
