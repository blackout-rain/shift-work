/*
 * シフト自動作成の計算部分（ブラウザでも Node でも動く）
 *
 * 条件
 *   - 毎日、出勤者の戦力ポイント合計が必要ポイント以上
 *   - 希望休の日は出勤しない
 *   - 3日連続では出勤しない（2連勤まで）
 *
 * 「何連勤しているか」(0/1/2) を人数分まとめた状態を使い、
 * 最後の日まで条件を満たせるかを厳密に調べる。条件を満たす表が
 * 存在すれば必ず見つかり、存在しなければ最初に破綻する日を返す。
 * 満たす表の中から、余剰ポイントと出勤日数の偏りが小さいものを選ぶ。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ShiftSolver = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const MAX_STAFF = 12;
  const MAX_RUN = 2; // 連続で働ける日数の上限

  function mulberry32(seed) {
    let a = seed | 0;
    return function () {
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /**
   * input: {
   *   points:     number[n]        スタッフごとの戦力ポイント
   *   need:       number[D]        日ごとの必要ポイント
   *   high:       boolean[D]       土日祝など高め設定の日（偏りの計算に使う）
   *   off:        boolean[n][D]    希望休
   *   prevStreak: number[n]        月初の時点で何日連続で出勤中か（0〜2）
   * }
   * 戻り値: { ok:true, rows:number[n][D], cost } または { ok:false, conflict }
   */
  function solve(input, options) {
    const opts = Object.assign({ tries: 300, seed: 1 }, options);
    const { points, need } = input;
    const n = points.length;
    const D = need.length;
    if (n === 0 || D === 0) return { ok: false, conflict: { reason: 'empty' } };
    if (n > MAX_STAFF) throw new Error('スタッフは' + MAX_STAFF + '人までです');

    const off = input.off || points.map(() => new Array(D).fill(false));
    const high = input.high || need.map(() => false);
    const prev = input.prevStreak || points.map(() => 0);
    const pow3 = [1];
    for (let i = 1; i <= n; i++) pow3.push(pow3[i - 1] * 3);
    const S = pow3[n];

    const psum = new Int32Array(1 << n);
    for (let m = 1; m < 1 << n; m++) {
      const low = m & -m;
      psum[m] = psum[m ^ low] + points[31 - Math.clz32(low)];
    }

    const digit = (st, i) => Math.floor(st / pow3[i]) % 3;
    const allowedMask = (d, st) => {
      let m = 0;
      for (let i = 0; i < n; i++) if (digit(st, i) < MAX_RUN && !off[i][d]) m |= 1 << i;
      return m;
    };
    const nextState = (st, sub) => {
      let r = 0;
      for (let i = 0; i < n; i++) if (sub & (1 << i)) r += (digit(st, i) + 1) * pow3[i];
      return r;
    };

    let init = 0;
    for (let i = 0; i < n; i++) init += Math.min(MAX_RUN, Math.max(0, prev[i] | 0)) * pow3[i];

    // memo: 0=未計算 1=最後まで続けられる 2=行き止まり
    const memo = new Uint8Array((D + 1) * S);
    function feasible(d, st) {
      if (d === D) return true;
      const k = d * S + st;
      if (memo[k]) return memo[k] === 1;
      const allowed = allowedMask(d, st);
      let ok = false;
      for (let sub = allowed; ; sub = (sub - 1) & allowed) {
        if (psum[sub] >= need[d] && feasible(d + 1, nextState(st, sub))) {
          ok = true;
          break;
        }
        if (sub === 0) break;
      }
      memo[k] = ok ? 1 : 2;
      return ok;
    }

    if (!feasible(0, init)) return { ok: false, conflict: diagnose() };

    function diagnose() {
      let reach = new Set([init]);
      for (let d = 0; d < D; d++) {
        const next = new Set();
        let maxPossible = 0;
        for (const st of reach) {
          const allowed = allowedMask(d, st);
          maxPossible = Math.max(maxPossible, psum[allowed]);
          for (let sub = allowed; ; sub = (sub - 1) & allowed) {
            if (psum[sub] >= need[d]) next.add(nextState(st, sub));
            if (sub === 0) break;
          }
        }
        if (next.size === 0) {
          const offStaff = [];
          for (let i = 0; i < n; i++) if (off[i][d]) offStaff.push(i);
          return { reason: 'short', day: d, need: need[d], maxPossible, offStaff };
        }
        reach = next;
      }
      return { reason: 'unknown' };
    }

    function build(rng, noise) {
      let st = init;
      const rows = points.map(() => new Array(D).fill(0));
      const work = new Array(n).fill(0);
      const hiWork = new Array(n).fill(0);
      let surplus = 0;
      for (let d = 0; d < D; d++) {
        const allowed = allowedMask(d, st);
        const mean = work.reduce((a, b) => a + b, 0) / n;
        const hiMean = hiWork.reduce((a, b) => a + b, 0) / n;
        let best = -1;
        let bestScore = Infinity;
        for (let sub = allowed; ; sub = (sub - 1) & allowed) {
          if (psum[sub] >= need[d] && feasible(d + 1, nextState(st, sub))) {
            let score = 10 * (psum[sub] - need[d]) + rng() * noise;
            for (let i = 0; i < n; i++) {
              if (sub & (1 << i)) {
                score += 2 * (work[i] - mean);
                if (high[d]) score += 2 * (hiWork[i] - hiMean);
              }
            }
            if (score < bestScore) {
              bestScore = score;
              best = sub;
            }
          }
          if (sub === 0) break;
        }
        surplus += psum[best] - need[d];
        for (let i = 0; i < n; i++) {
          if (best & (1 << i)) {
            rows[i][d] = 1;
            work[i]++;
            if (high[d]) hiWork[i]++;
          }
        }
        st = nextState(st, best);
      }
      const spread = (a) => Math.max(...a) - Math.min(...a);
      return { rows, cost: 10 * surplus + 6 * spread(work) + 4 * spread(hiWork), surplus };
    }

    const rng = mulberry32(opts.seed);
    let best = null;
    for (let t = 0; t < opts.tries; t++) {
      const cand = build(rng, 2 + rng() * 14);
      if (!best || cand.cost < best.cost) best = cand;
    }
    return { ok: true, rows: best.rows, cost: best.cost, surplus: best.surplus };
  }

  /**
   * 出来上がった（または手で直した）表が条件を満たしているか調べる。
   * rows: number[n][D]（1=出勤）
   */
  function check(input, rows) {
    const { points, need } = input;
    const n = points.length;
    const D = need.length;
    const off = input.off || points.map(() => new Array(D).fill(false));
    const prev = input.prevStreak || points.map(() => 0);

    const total = [];
    const diff = [];
    for (let d = 0; d < D; d++) {
      let t = 0;
      for (let i = 0; i < n; i++) if (rows[i] && rows[i][d]) t += points[i];
      total.push(t);
      diff.push(t - need[d]);
    }

    const runCells = new Set(); // "i,d" 3連勤に含まれるセル
    for (let i = 0; i < n; i++) {
      const line = new Array(Math.min(MAX_RUN, Math.max(0, prev[i] | 0))).fill(1);
      const offset = line.length;
      for (let d = 0; d < D; d++) line.push(rows[i] && rows[i][d] ? 1 : 0);
      let run = 0;
      for (let k = 0; k < line.length; k++) {
        run = line[k] ? run + 1 : 0;
        if (run > MAX_RUN) {
          for (let b = 0; b <= MAX_RUN; b++) {
            const d = k - b - offset;
            if (d >= 0) runCells.add(i + ',' + d);
          }
        }
      }
    }

    const offCells = new Set(); // 希望休なのに出勤になっているセル
    for (let i = 0; i < n; i++)
      for (let d = 0; d < D; d++) if (off[i][d] && rows[i] && rows[i][d]) offCells.add(i + ',' + d);

    const shortDays = diff.filter((v) => v < 0).length;
    return { total, diff, runCells, offCells, shortDays };
  }

  return { solve, check, MAX_STAFF, MAX_RUN };
});
