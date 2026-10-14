const test = require('node:test');
const assert = require('node:assert');
const { solve, check } = require('../solver.js');

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
