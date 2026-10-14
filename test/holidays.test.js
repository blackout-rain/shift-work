const test = require('node:test');
const assert = require('node:assert');
const { holidayName } = require('../holidays.js');

// 内閣府の公表どおりの祝日（月-日）を年ごとに確認する
const expected = {
  2025: ['1-1', '1-13', '2-11', '2-23', '2-24', '3-20', '4-29', '5-3', '5-4', '5-5', '5-6', '7-21', '8-11', '9-15', '9-23', '10-13', '11-3', '11-23', '11-24'],
  2026: ['1-1', '1-12', '2-11', '2-23', '3-20', '4-29', '5-3', '5-4', '5-5', '5-6', '7-20', '8-11', '9-21', '9-22', '9-23', '10-12', '11-3', '11-23'],
  2027: ['1-1', '1-11', '2-11', '2-23', '3-21', '3-22', '4-29', '5-3', '5-4', '5-5', '7-19', '8-11', '9-20', '9-23', '10-11', '11-3', '11-23'],
};

for (const [year, list] of Object.entries(expected)) {
  test(year + '年の祝日が過不足なく一致する', () => {
    const got = [];
    for (let m = 1; m <= 12; m++) {
      const days = new Date(+year, m, 0).getDate();
      for (let d = 1; d <= days; d++) if (holidayName(+year, m, d)) got.push(m + '-' + d);
    }
    assert.deepStrictEqual(got, list);
  });
}

test('振替休日・国民の休日の名前', () => {
  assert.strictEqual(holidayName(2026, 5, 6), '振替休日');
  assert.strictEqual(holidayName(2026, 9, 22), '国民の休日');
  assert.strictEqual(holidayName(2026, 11, 3), '文化の日');
  assert.strictEqual(holidayName(2026, 11, 4), null);
});
