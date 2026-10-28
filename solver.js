/*
 * シフト自動作成の計算部分（ブラウザでも Node でも動く）
 *
 * 条件
 *   - 毎日、出勤者の戦力ポイント合計が必要ポイント以上
 *   - 「絶対」の希望休の日は出勤しない
 *   - 3日連続では出勤しない（2連勤まで）
 *   - イベント出勤の日は、その人を出勤扱い（連勤には数える）にし、店のポイントには数えない
 *
 * 「何連勤しているか」(0/1/2) を人数分まとめた状態を使い、
 * 最後の日まで条件を満たせるかを厳密に調べる。条件を満たす表が
 * 存在すれば必ず見つかり、存在しなければ最初に破綻する日を返す。
 * 満たす表の中から、次の順に良いものを選ぶ。
 *   1. 「できれば」の希望休がなるべく叶う（叶わない1日につき SOFT_W）
 *   2. 余剰ポイントが少ない（1ptにつき SURPLUS_W）
 *   3. 出勤日数・土日祝の出勤の偏りが小さい
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ShiftSolver = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const MAX_STAFF = 12;
  const MAX_RUN = 2; // 連続で働ける日数の上限
  const SURPLUS_W = 10; // 余剰ポイント1ptあたりの重み
  const SOFT_W = 25; // 「できれば休み」を叶えられなかった1日あたりの重み

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
   *   off:        boolean[n][D]    絶対の希望休
   *   soft:       boolean[n][D]    できれば休みたい日（任意。絶対と重なる日は絶対を優先）
   *   event:      boolean[n][D]    イベントに出る日（任意）。出勤扱い・連勤に数える・店のポイントには数えない
   *   prevStreak: number[n]        月初の時点で何日連続で出勤中か（0〜2）
   *   workBase:   number[n]        すでに出勤した日数（任意。偏りの計算に足す。solveFrom が使う）
   *   highBase:   number[n]        すでに出勤した高め設定の日数（任意）
   * }
   * 戻り値: { ok:true, rows:number[n][D], cost } または { ok:false, conflict }
   */
  function solve(input, options) {
    const startedAt = Date.now();
    const opts = Object.assign({ tries: 40, starts: 4, iters: 150000, seed: 1, timeBudgetMs: 2500 }, options);
    const { points, need } = input;
    const n = points.length;
    const D = need.length;
    if (n === 0 || D === 0) return { ok: false, conflict: { reason: 'empty' } };
    if (n > MAX_STAFF) throw new Error('スタッフは' + MAX_STAFF + '人までです');

    const off = input.off || points.map(() => new Array(D).fill(false));
    const soft = input.soft || points.map(() => new Array(D).fill(false));
    const high = input.high || need.map(() => false);
    const prev = input.prevStreak || points.map(() => 0);
    const event = input.event || points.map(() => new Array(D).fill(false));
    // イベント出勤の人は、その日は店の出勤から外し（allowedMask）、連勤だけ進める（nextState に足す）
    const evMask = [];
    const evWork = new Array(n).fill(0);
    const evHigh = new Array(n).fill(0);
    for (let d = 0; d < D; d++) {
      let m = 0;
      for (let i = 0; i < n; i++)
        if (event[i][d] && !off[i][d]) {
          m |= 1 << i;
          evWork[i]++;
          if (high[d]) evHigh[i]++;
        }
      evMask.push(m);
    }
    // 偏りの計算では、イベント出勤も出勤日数に入れる
    const workBase = (input.workBase || points.map(() => 0)).map((v, i) => v + evWork[i]);
    const highBase = (input.highBase || points.map(() => 0)).map((v, i) => v + evHigh[i]);
    // その日に「できれば休み」の人（絶対の希望休の人は出勤できないので除く）
    const softMask = [];
    for (let d = 0; d < D; d++) {
      let m = 0;
      for (let i = 0; i < n; i++) if (soft[i][d] && !off[i][d]) m |= 1 << i;
      softMask.push(m);
    }
    const popcount = (x) => {
      let c = 0;
      for (; x; x &= x - 1) c++;
      return c;
    };
    const softMiss = (d, sub) => popcount(sub & softMask[d]);
    // その日にsubの人が出勤したときの罰点（余剰ポイント＋叶えられない「できれば休み」）
    const dayPenalty = (d, sub) => SURPLUS_W * (psum[sub] - need[d]) + SOFT_W * softMiss(d, sub);

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
      for (let i = 0; i < n; i++) if (digit(st, i) < MAX_RUN && !off[i][d] && !(evMask[d] & (1 << i))) m |= 1 << i;
      return m;
    };
    // その日イベントに出る人のうち、すでに2連勤中の人（この状態では3連勤になってしまう）
    const evOver = (d, st) => {
      let m = 0;
      for (let i = 0; i < n; i++) if (evMask[d] & (1 << i) && digit(st, i) >= MAX_RUN) m |= 1 << i;
      return m;
    };
    const nextState = (st, sub) => {
      let r = 0;
      for (let i = 0; i < n; i++) if (sub & (1 << i)) r += (digit(st, i) + 1) * pow3[i];
      return r;
    };

    /*
     * その日の候補は「必要ポイントを満たし、誰か1人を外すと足りなくなる」組み合わせだけで足りる。
     * 余分な人を足しても余剰ポイントと連勤が増えるだけで、後の日に有利にならないため。
     */
    const minimalCache = new Map();
    function minimalSubsets(d, allowed) {
      const key = need[d] * 4096 + allowed;
      let list = minimalCache.get(key);
      if (list) return list;
      list = [];
      for (let sub = allowed; ; sub = (sub - 1) & allowed) {
        if (psum[sub] >= need[d]) {
          let minimal = true;
          for (let b = sub; b; b &= b - 1) {
            if (psum[sub] - points[31 - Math.clz32(b & -b)] >= need[d]) {
              minimal = false;
              break;
            }
          }
          if (minimal) list.push(sub);
        }
        if (sub === 0) break;
      }
      minimalCache.set(key, list);
      return list;
    }

    let init = 0;
    for (let i = 0; i < n; i++) init += Math.min(MAX_RUN, Math.max(0, prev[i] | 0)) * pow3[i];

    // minPenalty(d, st): d日目以降を条件どおり組んだときの罰点合計の最小値（組めなければ INF）
    const INF = 1e9;
    const memo = new Int32Array((D + 1) * S).fill(-1);
    function minPenalty(d, st) {
      if (d === D) return 0;
      const k = d * S + st;
      if (memo[k] >= 0) return memo[k];
      if (evOver(d, st)) return (memo[k] = INF);
      const allowed = allowedMask(d, st);
      let best = INF;
      for (const sub of minimalSubsets(d, allowed)) {
        const rest = minPenalty(d + 1, nextState(st, sub | evMask[d]));
        if (rest < INF) best = Math.min(best, dayPenalty(d, sub) + rest);
      }
      memo[k] = best;
      return best;
    }
    const feasible = (d, st) => minPenalty(d, st) < INF;

    if (!feasible(0, init)) return { ok: false, conflict: diagnose() };

    function diagnose() {
      let reach = new Set([init]);
      for (let d = 0; d < D; d++) {
        const next = new Set();
        let maxPossible = 0;
        let overMask = 0;
        let usable = 0;
        for (const st of reach) {
          const over = evOver(d, st);
          if (over) {
            overMask |= over;
            continue;
          }
          usable++;
          const allowed = allowedMask(d, st);
          maxPossible = Math.max(maxPossible, psum[allowed]);
          for (const sub of minimalSubsets(d, allowed)) next.add(nextState(st, sub | evMask[d]));
        }
        if (usable === 0) {
          // イベント出勤が重なって、3連勤になってしまう
          const staff = [];
          for (let i = 0; i < n; i++) if (overMask & (1 << i)) staff.push(i);
          return { reason: 'run', day: d, staff };
        }
        if (next.size === 0) {
          const offStaff = [];
          const eventStaff = [];
          for (let i = 0; i < n; i++) {
            if (off[i][d]) offStaff.push(i);
            if (evMask[d] & (1 << i)) eventStaff.push(i);
          }
          return { reason: 'short', day: d, need: need[d], maxPossible, offStaff, eventStaff };
        }
        reach = next;
      }
      return { reason: 'unknown' };
    }

    const fairness = (arr) => {
      let mx = -Infinity;
      let mn = Infinity;
      let sum = 0;
      for (const v of arr) {
        if (v > mx) mx = v;
        if (v < mn) mn = v;
        sum += v;
      }
      const mean = sum / arr.length;
      let ss = 0;
      for (const v of arr) ss += (v - mean) * (v - mean);
      return 2 * (mx - mn) + ss;
    };
    // 「できれば休み」と余剰ポイントを優先し、そのうえで出勤日数と土日祝出勤の偏りを小さくする
    const costOf = (surplus, missed, work, hi) => SURPLUS_W * surplus + SOFT_W * missed + 3 * fairness(work) + 3 * fairness(hi);

    function build(rng, noise) {
      let st = init;
      const rows = points.map(() => new Array(D).fill(0));
      const work = workBase.slice();
      const hiWork = highBase.slice();
      let surplus = 0;
      let missed = 0;
      for (let d = 0; d < D; d++) {
        const allowed = allowedMask(d, st);
        const mean = work.reduce((a, b) => a + b, 0) / n;
        const hiMean = hiWork.reduce((a, b) => a + b, 0) / n;
        let best = -1;
        let bestScore = Infinity;
        for (const sub of minimalSubsets(d, allowed)) {
          const nxt = nextState(st, sub | evMask[d]);
          const rest = minPenalty(d + 1, nxt);
          if (rest >= INF) continue;
          let score = dayPenalty(d, sub) + rest + rng() * noise;
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
        surplus += psum[best] - need[d];
        missed += softMiss(d, best);
        for (let i = 0; i < n; i++) {
          if (best & (1 << i)) {
            rows[i][d] = 1;
            work[i]++;
            if (high[d]) hiWork[i]++;
          }
        }
        st = nextState(st, best | evMask[d]);
      }
      return { rows, surplus, missed, cost: costOf(surplus, missed, work, hiWork) };
    }

    /*
     * 条件を保ったまま少しずつ入れ替えて、出勤日数と土日祝の出勤の偏りを減らす。
     * 変更のたびに「必要ポイント」「希望休」「3連勤」を確かめ、破るものは取り消す。
     */
    function anneal(start, rng, iters) {
      const rows = start.rows.map((r) => r.slice());
      const tot = new Int32Array(D);
      const work = workBase.slice();
      const hi = highBase.slice();
      let surplus = 0;
      let missed = 0;
      for (let i = 0; i < n; i++)
        for (let d = 0; d < D; d++)
          if (rows[i][d]) {
            tot[d] += points[i];
            work[i]++;
            if (high[d]) hi[i]++;
            if (softMask[d] & (1 << i)) missed++;
          }
      for (let d = 0; d < D; d++) surplus += tot[d] - need[d];

      const setCell = (i, d, v) => {
        if (rows[i][d] === v) return;
        const sign = v ? 1 : -1;
        rows[i][d] = v;
        tot[d] += sign * points[i];
        surplus += sign * points[i];
        if (softMask[d] & (1 << i)) missed += sign;
        work[i] += sign;
        if (high[d]) hi[i] += sign;
      };
      const lineOk = (i) => {
        let run = Math.min(MAX_RUN, Math.max(0, prev[i] | 0));
        const r = rows[i];
        for (let d = 0; d < D; d++) {
          if (r[d] || evMask[d] & (1 << i)) {
            if ((r[d] && (off[i][d] || evMask[d] & (1 << i))) || ++run > MAX_RUN) return false;
          } else run = 0;
        }
        return true;
      };
      const ri = (k) => Math.floor(rng() * k);

      let cost = costOf(surplus, missed, work, hi);
      let bestCost = cost;
      let bestRows = rows.map((r) => r.slice());
      const T0 = 8;
      const T1 = 0.2;
      for (let it = 0; it < iters; it++) {
        if ((it & 1023) === 0 && Date.now() - startedAt > opts.timeBudgetMs) break;
        const T = T0 * Math.pow(T1 / T0, it / iters);
        const kind = rng();
        let ops;
        if (kind < 0.45) {
          // 同じ日の担当を入れ替える
          const d = ri(D), i = ri(n), j = ri(n);
          if (rows[i][d] !== 1 || rows[j][d] !== 0) continue;
          ops = [[i, d, 0], [j, d, 1]];
        } else if (kind < 0.85) {
          // 同じ人の出勤日を動かす
          const i = ri(n), d1 = ri(D), d2 = ri(D);
          if (rows[i][d1] !== 1 || rows[i][d2] !== 0) continue;
          ops = [[i, d1, 0], [i, d2, 1]];
        } else {
          // 2人の出勤日を入れ替える
          const i = ri(n), j = ri(n), d1 = ri(D), d2 = ri(D);
          if (i === j || rows[i][d1] !== 1 || rows[i][d2] !== 0 || rows[j][d1] !== 0 || rows[j][d2] !== 1) continue;
          ops = [[i, d1, 0], [j, d1, 1], [i, d2, 1], [j, d2, 0]];
        }
        const old = ops.map(([i, d]) => rows[i][d]);
        ops.forEach(([i, d, v]) => setCell(i, d, v));
        let valid = true;
        for (const [i, d] of ops) {
          if (tot[d] < need[d] || !lineOk(i)) { valid = false; break; }
        }
        let next = cost;
        if (valid) {
          next = costOf(surplus, missed, work, hi);
          valid = next <= cost || rng() < Math.exp((cost - next) / T);
        }
        if (!valid) {
          for (let k = ops.length - 1; k >= 0; k--) setCell(ops[k][0], ops[k][1], old[k]);
          continue;
        }
        cost = next;
        if (cost < bestCost) {
          bestCost = cost;
          bestRows = rows.map((r) => r.slice());
        }
      }
      let bestSurplus = 0;
      let bestMissed = 0;
      for (let d = 0; d < D; d++) {
        let t = 0;
        for (let i = 0; i < n; i++)
          if (bestRows[i][d]) {
            t += points[i];
            if (softMask[d] & (1 << i)) bestMissed++;
          }
        bestSurplus += t - need[d];
      }
      return { rows: bestRows, cost: bestCost, surplus: bestSurplus, missed: bestMissed };
    }

    const rng = mulberry32(opts.seed);
    const pool = [];
    for (let t = 0; t < opts.tries; t++) {
      if (t > 0 && Date.now() - startedAt > opts.timeBudgetMs / 2) break;
      pool.push(build(rng, 2 + rng() * 14));
    }
    pool.sort((a, b) => a.cost - b.cost);
    let best = pool[0];
    for (let k = 0; k < Math.min(opts.starts, pool.length); k++) {
      const cand = anneal(pool[k], rng, opts.iters);
      if (cand.cost < best.cost) best = cand;
    }
    return {
      ok: true,
      rows: best.rows,
      cost: best.cost,
      surplus: best.surplus,
      missed: best.missed, // 叶えられなかった「できれば休み」の日数
      penalty: SURPLUS_W * best.surplus + SOFT_W * best.missed,
      optimalPenalty: minPenalty(0, init), // 余剰ポイントと「できれば休み」だけで見た理論上の最小
    };
  }

  /**
   * 途中から作り直す。from 日目（0始まり）より前は rows のまま動かさず、from 日目以降だけを組み直す。
   * 固定した部分の末尾の連勤は引き継ぎ、すでに出勤した日数は偏りの計算に入れる。
   * 戻り値は solve と同じ。rows は月全体、conflict.day も月全体の日（0始まり）。
   */
  function solveFrom(input, rows, from, options) {
    const D = input.need.length;
    if (from <= 0) return solve(input, options);
    const n = input.points.length;
    if (from >= D) return { ok: true, rows: rows.map((r) => r.slice()) };
    const high = input.high || input.need.map(() => false);
    const prev0 = input.prevStreak || input.points.map(() => 0);
    const prevStreak = [];
    const workBase = [];
    const highBase = [];
    for (let i = 0; i < n; i++) {
      let run = prev0[i] | 0;
      let work = 0;
      let hi = 0;
      for (let d = 0; d < from; d++) {
        const w = rows[i][d] || (input.event && input.event[i][d]); // イベント出勤も出勤日数・連勤に数える
        run = w ? run + 1 : 0;
        if (w) {
          work++;
          if (high[d]) hi++;
        }
      }
      prevStreak.push(Math.min(MAX_RUN, run));
      workBase.push(work);
      highBase.push(hi);
    }
    const tail = (a) => a.slice(from);
    const sub = {
      points: input.points,
      need: tail(input.need),
      high: tail(high),
      off: input.off && input.off.map(tail),
      soft: input.soft && input.soft.map(tail),
      event: input.event && input.event.map(tail),
      prevStreak,
      workBase,
      highBase,
    };
    const r = solve(sub, options);
    if (!r.ok) {
      const c = r.conflict;
      return { ok: false, conflict: c.day === undefined ? c : Object.assign({}, c, { day: c.day + from }) };
    }
    return Object.assign({}, r, { rows: rows.map((row, i) => row.slice(0, from).concat(r.rows[i])) });
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
    const soft = input.soft || points.map(() => new Array(D).fill(false));
    const prev = input.prevStreak || points.map(() => 0);

    const event = input.event || points.map(() => new Array(D).fill(false));
    const total = [];
    const diff = [];
    for (let d = 0; d < D; d++) {
      let t = 0;
      for (let i = 0; i < n; i++) if (rows[i] && rows[i][d] && !event[i][d]) t += points[i]; // イベント出勤は店のポイントに数えない
      total.push(t);
      diff.push(t - need[d]);
    }

    const runCells = new Set(); // "i,d" 3連勤に含まれるセル
    for (let i = 0; i < n; i++) {
      const line = new Array(Math.min(MAX_RUN, Math.max(0, prev[i] | 0))).fill(1);
      const offset = line.length;
      for (let d = 0; d < D; d++) line.push((rows[i] && rows[i][d]) || event[i][d] ? 1 : 0);
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

    const softCells = new Set(); // 「できれば休み」なのに出勤になっているセル（条件違反ではない）
    for (let i = 0; i < n; i++)
      for (let d = 0; d < D; d++) if (soft[i][d] && !off[i][d] && rows[i] && rows[i][d]) softCells.add(i + ',' + d);

    const shortDays = diff.filter((v) => v < 0).length;
    return { total, diff, runCells, offCells, softCells, shortDays };
  }

  return { solve, solveFrom, check, MAX_STAFF, MAX_RUN };
});
