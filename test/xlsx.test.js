const test = require('node:test');
const assert = require('node:assert');
const zlib = require('node:zlib');
const { build, crc32 } = require('../xlsx.js');

// 圧縮なしzipの中身を取り出す（CRCも検査する）
function unzip(u8) {
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  const files = {};
  let eocd = u8.length - 22;
  assert.strictEqual(dv.getUint32(eocd, true), 0x06054b50);
  const count = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  for (let i = 0; i < count; i++) {
    assert.strictEqual(dv.getUint32(p, true), 0x02014b50);
    const crc = dv.getUint32(p + 16, true);
    const size = dv.getUint32(p + 24, true);
    const nameLen = dv.getUint16(p + 28, true);
    const local = dv.getUint32(p + 42, true);
    const name = Buffer.from(u8.subarray(p + 46, p + 46 + nameLen)).toString('utf8');
    const start = local + 30 + dv.getUint16(local + 26, true) + dv.getUint16(local + 28, true);
    const data = u8.subarray(start, start + size);
    assert.strictEqual(zlib.crc32(data), crc, name + ' のCRC');
    files[name] = Buffer.from(data).toString('utf8');
    p += 46 + nameLen;
  }
  return files;
}

const sample = {
  sheetName: '10月',
  header: [{ text: 'スタッフ' }, { text: '1\n木', day: '', high: false }, { text: '3\n土', day: 'sat', high: true }, { text: '4\n日', day: 'sun', high: true }, { text: '出勤' }],
  rows: [
    { name: '石川', cells: [false, true, true], total: '2日' },
    { name: 'A&B<"x">', cells: [true, false, false], total: '1日' },
  ],
};

test('crc32 は標準の値と一致する', () => {
  assert.strictEqual(crc32(Buffer.from('123456789')), 0xcbf43926);
});

test('xlsx に必要なファイルが揃い、CRCが正しい', () => {
  const f = unzip(build(sample));
  assert.deepStrictEqual(Object.keys(f).sort(), ['[Content_Types].xml', 'xl/_rels/workbook.xml.rels', 'xl/styles.xml', 'xl/workbook.xml', 'xl/worksheets/sheet1.xml', '_rels/.rels'].sort());
  assert.match(f['xl/workbook.xml'], /<sheet name="10月"/);
});

test('シートに見出し・名前・出勤セルが入り、ポイントは入らない', () => {
  const sheet = unzip(build(sample))['xl/worksheets/sheet1.xml'];
  assert.match(sheet, /<t xml:space="preserve">3\n土<\/t>/);
  assert.match(sheet, /<t xml:space="preserve">石川<\/t>/);
  assert.match(sheet, /<t xml:space="preserve">A&amp;B&lt;&quot;x&quot;&gt;<\/t>/);
  assert.strictEqual((sheet.match(/<t xml:space="preserve">出<\/t>/g) || []).length, 3);
  assert.doesNotMatch(sheet, /pt/);
  assert.match(sheet, /<dimension ref="A1:E3"\/>/);
});

test('XMLに使えない制御文字は取り除かれる', () => {
  const f = unzip(build({ ...sample, rows: [{ name: 'a\u0001b', cells: [false, false, false], total: '0日' }] }));
  assert.match(f['xl/worksheets/sheet1.xml'], /<t xml:space="preserve">ab<\/t>/);
});
