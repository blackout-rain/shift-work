const test = require('node:test');
const assert = require('node:assert');
const { solve, solveFrom, check } = require('../solver.js');

const points = [3, 3, 2, 2, 2, 1, 1];
const D = 30;
const isHigh = (d) => d % 7 === 5 || d % 7 === 6; // 0日目を月曜とした土日
const base = () => ({
  points,
  need: Array.from({ length: D }, (_, d) => (isHigh(d) ? 9 : 7)),
  high: Array.from({ length: D }, (_, d) => isHigh(d)),
  off: points.map(() => new Array(D).fill(false)),
  prevStreak: points.map(() => 0),
});

test('希望休と3連勤禁止を守り、毎日の必要ポイントを満たす', () => {
  const input = base();
  [[0, 4], [1, 5], [1, 6], [2, 12], [3, 12], [4, 20], [5, 8], [6, 8]].forEach(([i, d]) => (input.off[i][d] = true));
  const r = solve(input);
  assert.ok(r.ok);
  const c = check(input, r.rows);
  assert.strictEqual(c.shortDays, 0);
  assert.strictEqual(c.runCells.size, 0);
  assert.strictEqual(c.offCells.size, 0);
});

test('前月末の連勤を引き継ぐ', () => {
  const input = base();
  input.prevStreak = [2, 2, 0, 0, 0, 0, 0];
  const r = solve(input);
  assert.ok(r.ok);
  assert.strictEqual(r.rows[0][0], 0);
  assert.strictEqual(r.rows[1][0], 0);
  assert.strictEqual(check(input, r.rows).runCells.size, 0);
});

test('組めない場合は最初に破綻する日を返す', () => {
  const input = base();
  // 12日目(0始まり)に、3pt以外の全員を休みにする → 最大6ptで必要7ptに届かない
  [0, 1, 2, 3, 4].forEach((i) => (input.off[i][12] = i !== 0));
  const r = solve(input);
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.conflict.reason, 'short');
  assert.strictEqual(r.conflict.day, 12);
  assert.ok(r.conflict.maxPossible < r.conflict.need);
});

test('同じ入力・同じseedなら同じ表になる', () => {
  const a = solve(base(), { seed: 7 });
  const b = solve(base(), { seed: 7 });
  assert.deepStrictEqual(a.rows, b.rows);
});

test('check は手で直した表の3連勤・不足・希望休違反を検出する', () => {
  const input = base();
  input.off[0][1] = true;
  const rows = points.map(() => new Array(D).fill(0));
  [0, 1, 2].forEach((d) => (rows[1][d] = 1)); // 3連勤
  rows[0][1] = 1; // 希望休なのに出勤
  const c = check(input, rows);
  assert.ok(c.runCells.has('1,0') && c.runCells.has('1,2'));
  assert.ok(c.offCells.has('0,1'));
  assert.ok(c.shortDays > 0);
});

test('余剰ポイントは理論上の最小値に一致し、偏りも小さい', () => {
  const input = base();
  [[0, 4], [1, 5], [1, 6], [2, 12], [3, 12], [4, 20], [5, 8], [6, 8]].forEach(([i, d]) => (input.off[i][d] = true));
  input.need = input.need.map((v) => v - 1); // 少し余裕のある設定
  const r = solve(input, { seed: 3 });
  assert.ok(r.ok);
  const c = check(input, r.rows);
  const surplus = c.diff.reduce((a, v) => a + Math.max(v, 0), 0);
  assert.strictEqual(surplus, r.surplus);
  assert.strictEqual(r.penalty, r.optimalPenalty);
  const work = r.rows.map((row) => row.reduce((a, b) => a + b, 0));
  assert.ok(Math.max(...work) - Math.min(...work) <= 2);
});

test('「できれば休み」は組める範囲でなるべく叶える', () => {
  const input = base();
  input.soft = points.map(() => new Array(D).fill(false));
  [[0, 3], [1, 9], [2, 15], [3, 15], [4, 22], [5, 22], [6, 27]].forEach(([i, d]) => (input.soft[i][d] = true));
  const r = solve(input, { seed: 5 });
  assert.ok(r.ok);
  assert.strictEqual(r.missed, 0);
  const c = check(input, r.rows);
  assert.strictEqual(c.softCells.size, 0);
  assert.strictEqual(c.shortDays, 0);
});

test('「できれば休み」で全員が休みたい日でも必要ポイントは満たす（組めない扱いにしない）', () => {
  const input = base();
  input.soft = points.map(() => new Array(D).fill(false));
  input.soft.forEach((row) => (row[10] = true)); // 全員が11日目に「できれば休み」
  const r = solve(input, { seed: 5 });
  assert.ok(r.ok);
  const c = check(input, r.rows);
  assert.strictEqual(c.shortDays, 0);
  assert.ok(r.missed > 0); // 全員は休めない
  assert.strictEqual(r.penalty, r.optimalPenalty);
  assert.strictEqual(c.softCells.size, r.missed);
});

test('絶対の希望休は「できれば」より優先され、必ず守られる', () => {
  const input = base();
  input.soft = points.map(() => new Array(D).fill(false));
  input.off[0][5] = true;
  input.soft[0][5] = true; // 同じ日に両方 → 絶対が優先
  const r = solve(input, { seed: 2 });
  assert.ok(r.ok);
  assert.strictEqual(r.rows[0][5], 0);
  assert.strictEqual(check(input, r.rows).offCells.size, 0);
});

/* ---- 途中から作り直す ---- */
test('途中から作り直しても、それより前の日は1マスも変わらない', () => {
  const input = base();
  const first = solve(input, { seed: 3 });
  assert.ok(first.ok);
  const from = 12;
  const r = solveFrom(input, first.rows, from, { seed: 99 });
  assert.ok(r.ok);
  r.rows.forEach((row, i) => assert.deepStrictEqual(row.slice(0, from), first.rows[i].slice(0, from)));
  const c = check(input, r.rows);
  assert.strictEqual(c.shortDays, 0);
  assert.strictEqual(c.runCells.size, 0);
  assert.strictEqual(c.offCells.size, 0);
});

test('途中から作り直すと、変更した希望休が反映され、境目の連勤も守る', () => {
  const input = base();
  const first = solve(input, { seed: 3 });
  const from = 15;
  // 固定部分の末尾で2連勤している人を作り、その翌日(from)は必ず休みになることを見る
  const rows = first.rows.map((r) => r.slice());
  rows[0][from - 1] = 1;
  rows[0][from - 2] = 1;
  rows[0][from - 3] = 0; // 固定部分の中で3連勤にならないようにする
  input.off[1][20] = true; // 後から入った希望休
  input.off[1][from + 2] = true;
  const r = solveFrom(input, rows, from, { seed: 5 });
  assert.ok(r.ok);
  assert.strictEqual(r.rows[0][from], 0, '2連勤の翌日は休み');
  assert.strictEqual(r.rows[1][20], 0);
  assert.strictEqual(r.rows[1][from + 2], 0);
  assert.strictEqual(check(input, r.rows).runCells.size, 0);
});

test('前月末の連勤も、固定部分がずっと出勤なら途中から作り直しても引き継がれる', () => {
  const input = base();
  input.prevStreak = [1, 0, 0, 0, 0, 0, 0];
  const rows = points.map(() => new Array(D).fill(0));
  rows[0][0] = 1; // 前月末1日＋1日目で2連勤
  const r = solveFrom(input, rows, 1, { seed: 1 });
  assert.ok(r.ok);
  assert.strictEqual(r.rows[0][1], 0);
});

test('途中から組めない場合は、月全体での日付(0始まり)で破綻日を返す', () => {
  const input = base();
  const first = solve(input, { seed: 3 });
  [1, 2, 3, 4].forEach((i) => (input.off[i][20] = true)); // 20日目に3ptの1人しか出られない
  const r = solveFrom(input, first.rows, 10, { seed: 3 });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.conflict.reason, 'short');
  assert.strictEqual(r.conflict.day, 20);
});

test('固定した部分で多く出ている人は、作り直す部分では出勤が少なめになる', () => {
  const input = base();
  const from = 15;
  const rows = points.map(() => new Array(D).fill(0));
  for (let d = 0; d < from; d += 2) rows[4][d] = 1; // 伊藤(4)だけ前半に8日出勤済み
  const tail = (a) => a.slice(from);
  const plain = solve({ ...input, need: tail(input.need), high: tail(input.high), off: input.off.map(tail) }, { seed: 2 });
  const withBase = solveFrom(input, rows, from, { seed: 2 });
  assert.ok(plain.ok && withBase.ok);
  const sum = (a) => a.reduce((x, y) => x + y, 0);
  assert.ok(sum(tail(withBase.rows[4])) < sum(plain.rows[4]) - 2, '前半で出た分、後半はかなり少なくなる');
});

/* ---- イベント出勤 ---- */
const withEvents = (input, list) => {
  input.event = points.map(() => new Array(D).fill(false));
  list.forEach(([i, d]) => (input.event[i][d] = true));
  return input;
};

test('イベントの日は店のポイントに数えず、その人は店の出勤から外れる', () => {
  const input = withEvents(base(), [[0, 3], [0, 10], [1, 17], [2, 18]]);
  const r = solve(input);
  assert.ok(r.ok);
  assert.strictEqual(r.rows[0][3], 0);
  assert.strictEqual(r.rows[0][10], 0);
  assert.strictEqual(r.rows[1][17], 0);
  assert.strictEqual(r.rows[2][18], 0);
  const c = check(input, r.rows);
  assert.strictEqual(c.shortDays, 0, '残りの人で必要ポイントを満たす');
  assert.strictEqual(c.runCells.size, 0);
});

test('イベントの日も連勤に数える（前後の日を足して3連勤にならない）', () => {
  const input = withEvents(base(), [[3, 8], [3, 9], [4, 15]]);
  const r = solve(input);
  assert.ok(r.ok);
  assert.strictEqual(r.rows[3][7], 0, 'イベント2連続の前日は休み');
  assert.strictEqual(r.rows[3][10], 0, 'イベント2連続の翌日は休み');
  assert.strictEqual(check(input, r.rows).runCells.size, 0);
});

test('イベントが3日続くと3連勤になるので、その日を返して組めないとする', () => {
  const input = withEvents(base(), [[5, 1], [5, 2], [5, 3]]);
  const r = solve(input);
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.conflict.reason, 'run');
  assert.strictEqual(r.conflict.day, 3);
  assert.deepStrictEqual(r.conflict.staff, [5]);
});

test('前月末に2連勤中なら、月初のイベント出勤は3連勤になる', () => {
  const input = withEvents(base(), [[0, 0]]);
  input.prevStreak = [2, 0, 0, 0, 0, 0, 0];
  const r = solve(input);
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.conflict.reason, 'run');
  assert.strictEqual(r.conflict.day, 0);
});

test('イベントの日数に決まりはなく、たくさん入れても組める', () => {
  const list = [];
  for (let d = 1; d < D; d += 3) list.push([5, d]); // 1pt の人が10日イベント
  list.push([6, 2], [6, 5], [6, 8]);
  const input = withEvents(base(), list);
  const r = solve(input);
  assert.ok(r.ok);
  const c = check(input, r.rows);
  assert.strictEqual(c.shortDays, 0);
  assert.strictEqual(c.runCells.size, 0);
});

test('イベントの出勤も出勤日数に数え、偏りを調整する', () => {
  const input = withEvents(base(), [[4, 1], [4, 4], [4, 7], [4, 10], [4, 13], [4, 16], [4, 19], [4, 22]]);
  const r = solve(input, { seed: 4 });
  assert.ok(r.ok);
  const shop = (i) => r.rows[i].reduce((a, b) => a + b, 0);
  assert.ok(shop(4) < shop(3), 'イベントが多い人は、店の出勤が少なめになる');
});

test('途中から作り直すときも、固定部分のイベントを連勤に数える', () => {
  const input = withEvents(base(), [[0, 13], [0, 14]]);
  const rows = points.map(() => new Array(D).fill(0));
  const r = solveFrom(input, rows, 15, { seed: 1 });
  assert.ok(r.ok);
  assert.strictEqual(r.rows[0][15], 0, 'イベント2連続の翌日は休み');
});
