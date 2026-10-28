// さまざまな条件（人数・必要ポイント・希望休・できれば休み・イベント・連勤の制限・途中から作り直し）を
// ランダムに作り、「作れたと答えた表は、必ず条件を満たす」ことを確かめる。乱数は固定なので毎回同じ。
const test = require('node:test');
const assert = require('node:assert');
const { solve, solveFrom, check } = require('../solver.js');

function rng(seed) {
  let a = seed | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeCase(seed) {
  const r = rng(seed);
  const pick = (a) => a[Math.floor(r() * a.length)];
  const n = 3 + Math.floor(r() * 8); // 3〜10人
  const D = pick([28, 29, 30, 31]);
  const points = Array.from({ length: n }, () => 1 + Math.floor(r() * 3));
  const total = points.reduce((a, b) => a + b, 0);
  const low = Math.max(1, Math.round(total * (0.35 + r() * 0.2)));
  const hi = Math.min(total, low + Math.floor(r() * 3));
  const isHigh = (d) => d % 7 === 5 || d % 7 === 6;
  const mat = (p) => points.map(() => Array.from({ length: D }, () => r() < p));
  const off = mat(0.05);
  const event = mat(0.03);
  const soft = mat(0.05);
  // 同じ日に重ならないようにする（アプリでも1日につきどれか1つ）
  for (let i = 0; i < n; i++)
    for (let d = 0; d < D; d++) {
      if (off[i][d]) { event[i][d] = false; soft[i][d] = false; }
      if (event[i][d]) soft[i][d] = false;
    }
  return {
    points,
    need: Array.from({ length: D }, (_, d) => (isHigh(d) ? hi : low)),
    high: Array.from({ length: D }, (_, d) => isHigh(d)),
    off, soft, event,
    prevStreak: points.map(() => Math.floor(r() * 3)),
    maxRun: pick([0, 2, undefined]),
  };
}

test('ランダムな条件で、作れたと答えた表は必ず条件を満たす', () => {
  let ok = 0;
  let infeasible = 0;
  for (let seed = 1; seed <= 150; seed++) {
    const input = makeCase(seed);
    const r = solve(input, { seed, timeBudgetMs: 400, tries: 8, starts: 1, iters: 20000 });
    if (!r.ok) {
      infeasible++;
      assert.ok(['short', 'run'].includes(r.conflict.reason), 'seed ' + seed + ': 想定外の理由 ' + JSON.stringify(r.conflict));
      assert.ok(r.conflict.day >= 0 && r.conflict.day < input.need.length, 'seed ' + seed + ': 破綻日が範囲外');
      continue;
    }
    ok++;
    const c = check(input, r.rows);
    const tag = 'seed ' + seed + ' ';
    assert.strictEqual(c.shortDays, 0, tag + 'ポイント不足');
    assert.strictEqual(c.runCells.size, 0, tag + '連勤の違反');
    assert.strictEqual(c.offCells.size, 0, tag + '希望休なのに出勤');
    input.event.forEach((row, i) => row.forEach((e, d) => e && assert.strictEqual(r.rows[i][d], 0, tag + 'イベントの日に店の出勤が入っている')));
    r.rows.forEach((row) => assert.ok(row.every((v) => v === 0 || v === 1)));
  }
  console.log('     (ランダム150件: 作れた ' + ok + ' 件、組めない ' + infeasible + ' 件)');
  assert.ok(ok >= 60, '作れる条件が少なすぎる: ' + ok);
  assert.ok(infeasible >= 1, '組めない例も混ざっている');
});

test('ランダムな条件で、途中から作り直しても固定部分は変わらず、条件を満たす', () => {
  let checked = 0;
  for (let seed = 1001; seed <= 1100; seed++) {
    const input = makeCase(seed);
    const first = solve(input, { seed, timeBudgetMs: 400, tries: 8, starts: 1, iters: 20000 });
    if (!first.ok) continue;
    const D = input.need.length;
    const from = 3 + (seed % (D - 6));
    // 作り直す側の条件を少し変える（後半に希望休を足す）
    const changed = { ...input, off: input.off.map((row) => row.slice()) };
    for (let i = 0; i < changed.off.length; i += 3) if (!changed.event[i][D - 2]) changed.off[i][D - 2] = true;
    const r = solveFrom(changed, first.rows, from, { seed: seed + 1, timeBudgetMs: 400, tries: 8, starts: 1, iters: 20000 });
    if (!r.ok) {
      assert.ok(['short', 'run'].includes(r.conflict.reason));
      assert.ok(r.conflict.day >= from && r.conflict.day < D, 'seed ' + seed + ': 破綻日が作り直す範囲の外');
      continue;
    }
    checked++;
    r.rows.forEach((row, i) => assert.deepStrictEqual(row.slice(0, from), first.rows[i].slice(0, from), 'seed ' + seed + ': 固定部分が変わった'));
    // 固定部分は元の表のまま（元の条件を満たしている）で、足した希望休は後半の日だけなので、月全体で条件を満たすはず
    const c = check(changed, r.rows);
    assert.strictEqual(c.shortDays, 0, 'seed ' + seed + ' ポイント不足');
    assert.strictEqual(c.runCells.size, 0, 'seed ' + seed + ' 連勤の違反');
    assert.strictEqual(c.offCells.size, 0, 'seed ' + seed + ' 希望休なのに出勤');
  }
  console.log('     (途中から作り直し: 確認できた ' + checked + ' 件)');
  assert.ok(checked >= 30, '確認できた件数が少なすぎる: ' + checked);
});
