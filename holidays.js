/*
 * 日本の祝日（国民の祝日に関する法律どおり）。通信は不要で、年から計算する。
 * 春分・秋分は 1980〜2099 年向けの近似式。振替休日・国民の休日も含む。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ShiftHolidays = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const cache = {};

  // その月の第n月曜日の日付
  function nthMonday(y, m, n) {
    const first = new Date(y, m - 1, 1).getDay();
    return 1 + ((8 - first) % 7) + (n - 1) * 7;
  }
  function equinox(y, base) {
    return Math.floor(base + 0.242194 * (y - 1980) - Math.floor((y - 1980) / 4));
  }

  function build(y) {
    const h = new Map(); // 'm-d' → 名前
    const add = (m, d, name) => h.set(m + '-' + d, name);

    add(1, 1, '元日');
    add(1, nthMonday(y, 1, 2), '成人の日');
    add(2, 11, '建国記念の日');
    if (y >= 2020) add(2, 23, '天皇誕生日');
    add(3, equinox(y, 20.8431), '春分の日');
    add(4, 29, '昭和の日');
    add(5, 3, '憲法記念日');
    add(5, 4, 'みどりの日');
    add(5, 5, 'こどもの日');
    // 東京五輪の年だけ、海の日・スポーツの日・山の日が移動した
    if (y === 2020) { add(7, 23, '海の日'); add(7, 24, 'スポーツの日'); add(8, 10, '山の日'); }
    else if (y === 2021) { add(7, 22, '海の日'); add(7, 23, 'スポーツの日'); add(8, 8, '山の日'); }
    else {
      add(7, nthMonday(y, 7, 3), '海の日');
      if (y >= 2016) add(8, 11, '山の日');
      add(10, nthMonday(y, 10, 2), y >= 2020 ? 'スポーツの日' : '体育の日');
    }
    add(9, nthMonday(y, 9, 3), '敬老の日');
    add(9, equinox(y, 23.2488), '秋分の日');
    add(11, 3, '文化の日');
    add(11, 23, '勤労感謝の日');

    const key = (dt) => (dt.getMonth() + 1) + '-' + dt.getDate();
    // 国民の休日: 前日と翌日がどちらも祝日の平日
    for (let d = new Date(y, 0, 2); d.getFullYear() === y; d.setDate(d.getDate() + 1)) {
      if (h.has(key(d))) continue;
      const prev = new Date(y, d.getMonth(), d.getDate() - 1);
      const next = new Date(y, d.getMonth(), d.getDate() + 1);
      if (h.has(key(prev)) && h.has(key(next)) && d.getDay() !== 0) h.set(key(d), '国民の休日');
    }
    // 振替休日: 祝日が日曜なら、次の祝日でない日
    for (const k of Array.from(h.keys())) {
      const [m, d] = k.split('-').map(Number);
      if (new Date(y, m - 1, d).getDay() !== 0) continue;
      const sub = new Date(y, m - 1, d + 1);
      while (h.has(key(sub))) sub.setDate(sub.getDate() + 1);
      if (sub.getFullYear() === y) h.set(key(sub), '振替休日');
    }
    return h;
  }

  /** 祝日なら名前、そうでなければ null（month は 1〜12） */
  function holidayName(y, month, day) {
    if (!cache[y]) cache[y] = build(y);
    return cache[y].get(month + '-' + day) || null;
  }

  return { holidayName };
});
