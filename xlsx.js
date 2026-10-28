/*
 * シフト表を .xlsx（Excel）にする。外部ライブラリなし・通信なし。
 * xlsx は XML を zip にしたもの。ここでは圧縮なし(stored)の zip を自前で組み立てる。
 *
 * build({ sheetName, header, rows }) → Uint8Array
 *   header: [{ text, day, high }]  day: 'sat' | 'sun'（土曜／日曜・祝日の文字色）、high: 必要ptが多めの日（上に赤い太線）
 *           先頭がスタッフ列、末尾が出勤日数列。日付セルの text は「1\n木」のように改行で曜日を分ける
 *   rows:   [{ name, cells: [true|false|'ev', …], total }]  true=出勤 'ev'=イベント出勤（「イ」）
 *   note:   表の下に1行だけ書く説明（任意）
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ShiftXlsx = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const enc = new TextEncoder();
  const xml = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  // XML に書けない制御文字（改行・タブ以外）を除く
  const clean = (s) => String(s).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');

  /* ---------- zip ---------- */
  const CRC_TABLE = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c >>> 0;
    }
    return t;
  })();
  function crc32(buf) {
    let c = 0xffffffff;
    for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }

  function zip(files) {
    const d = new Date();
    const time = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
    const date = (Math.max(d.getFullYear() - 1980, 0) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
    const parts = [];
    const central = [];
    let offset = 0;
    const push = (u8) => { parts.push(u8); offset += u8.length; };
    files.forEach((f) => {
      const name = enc.encode(f.name);
      const data = enc.encode(f.data);
      const crc = crc32(data);
      const head = new DataView(new ArrayBuffer(30));
      head.setUint32(0, 0x04034b50, true);
      head.setUint16(4, 20, true);
      head.setUint16(6, 0x0800, true); // ファイル名は UTF-8
      head.setUint16(8, 0, true); // 圧縮なし
      head.setUint16(10, time, true);
      head.setUint16(12, date, true);
      head.setUint32(14, crc, true);
      head.setUint32(18, data.length, true);
      head.setUint32(22, data.length, true);
      head.setUint16(26, name.length, true);
      head.setUint16(28, 0, true);
      const cd = new DataView(new ArrayBuffer(46));
      cd.setUint32(0, 0x02014b50, true);
      cd.setUint16(4, 20, true);
      cd.setUint16(6, 20, true);
      cd.setUint16(8, 0x0800, true);
      cd.setUint16(10, 0, true);
      cd.setUint16(12, time, true);
      cd.setUint16(14, date, true);
      cd.setUint32(16, crc, true);
      cd.setUint32(20, data.length, true);
      cd.setUint32(24, data.length, true);
      cd.setUint16(28, name.length, true);
      cd.setUint32(42, offset, true);
      central.push(new Uint8Array(cd.buffer), name);
      push(new Uint8Array(head.buffer));
      push(name);
      push(data);
    });
    const cdStart = offset;
    central.forEach(push);
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true);
    end.setUint16(8, files.length, true);
    end.setUint16(10, files.length, true);
    end.setUint32(12, offset - cdStart, true);
    end.setUint32(16, cdStart, true);
    push(new Uint8Array(end.buffer));
    const out = new Uint8Array(offset);
    let p = 0;
    parts.forEach((u8) => { out.set(u8, p); p += u8.length; });
    return out;
  }

  /* ---------- 見た目（画面の配色に合わせる） ---------- */
  const COLOR = { line: 'FF8A9A94', head: 'FFE8ECE7', headInk: 'FF5A6A6C', ink: 'FF16262A', work: 'FFD5EDE5', workInk: 'FF06483B', sat: 'FF2F6FB3', sun: 'FFC9503A', hi: 'FFC9503A', ev: 'FFE6DFF5', evInk: 'FF5B3FB0' };

  // cellXfs の番号
  const S = { name: 1, headName: 2, head: 3, headSat: 4, headSun: 5, work: 6, off: 7, total: 8, headCnt: 9, event: 13, note: 14 };
  // 必要ptが多めの日の見出しは、上に赤い太線を付けた別スタイルにする
  const HI = { head: 10, headSat: 11, headSun: 12 };

  function styles() {
    // borders の 0 番は必ず「罫線なし」にする（標準スタイルが使う番号。ここに枠を入れるとExcelで罫線が出ない）
    const border = (top) => '<border><left style="thin"><color rgb="' + COLOR.line + '"/></left><right style="thin"><color rgb="' + COLOR.line + '"/></right>' +
      (top ? '<top style="thick"><color rgb="' + COLOR.hi + '"/></top>' : '<top style="thin"><color rgb="' + COLOR.line + '"/></top>') +
      '<bottom style="thin"><color rgb="' + COLOR.line + '"/></bottom><diagonal/></border>';
    const font = (color, bold) => '<font>' + (bold ? '<b/>' : '') + '<sz val="11"/><color rgb="' + color + '"/><name val="Yu Gothic"/><family val="2"/></font>';
    const fill = (rgb) => '<fill><patternFill patternType="solid"><fgColor rgb="' + rgb + '"/><bgColor indexed="64"/></patternFill></fill>';
    const xf = (font, fillId, borderId, h) => '<xf numFmtId="0" fontId="' + font + '" fillId="' + fillId + '" borderId="' + borderId + '" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1">' +
      '<alignment horizontal="' + h + '" vertical="center" wrapText="1"' + (h === 'left' ? ' indent="1"' : '') + '/></xf>';
    // fonts: 0 通常 1 太字 2 見出し(灰) 3 土曜 4 日祝 5 出 6 イベント
    const fonts = [font(COLOR.ink, false), font(COLOR.ink, false), font(COLOR.headInk, false), font(COLOR.sat, false), font(COLOR.sun, false), font(COLOR.workInk, true), font(COLOR.evInk, true)];
    // fills: 0,1 は Excel が必須とする既定 2 見出し 3 出 4 イベント
    const fills = ['<fill><patternFill patternType="none"/></fill>', '<fill><patternFill patternType="gray125"/></fill>', fill(COLOR.head), fill(COLOR.work), fill(COLOR.ev)];
    const borders = ['<border><left/><right/><top/><bottom/><diagonal/></border>', border(false), border(true)];
    // borderId: 1 = 四方に細い罫線、2 = 上だけ赤い太線
    const xfs = [
      '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>', // 0 既定（標準スタイル）
      xf(1, 0, 1, 'left'), // 1 スタッフ名
      xf(2, 2, 1, 'left'), // 2 見出し(スタッフ)
      xf(2, 2, 1, 'center'), // 3 見出し(平日)
      xf(3, 2, 1, 'center'), // 4 見出し(土)
      xf(4, 2, 1, 'center'), // 5 見出し(日祝)
      xf(5, 3, 1, 'center'), // 6 出勤
      xf(0, 0, 1, 'center'), // 7 休み(空白)
      xf(2, 0, 1, 'center'), // 8 出勤日数
      xf(2, 2, 1, 'center'), // 9 見出し(出勤日数)
      xf(2, 2, 2, 'center'), // 10 見出し(平日だが多めの日)
      xf(3, 2, 2, 'center'), // 11 見出し(土・多め)
      xf(4, 2, 2, 'center'), // 12 見出し(日祝・多め)
      xf(6, 4, 1, 'center'), // 13 イベント出勤
      '<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment horizontal="left" vertical="center"/></xf>', // 14 表の下の説明（折り返さず右へはみ出して読ませる）
    ];
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
      '<fonts count="' + fonts.length + '">' + fonts.join('') + '</fonts>' +
      '<fills count="' + fills.length + '">' + fills.join('') + '</fills>' +
      '<borders count="' + borders.length + '">' + borders.join('') + '</borders>' +
      '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
      '<cellXfs count="' + xfs.length + '">' + xfs.join('') + '</cellXfs>' +
      '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>';
  }

  /* ---------- シート ---------- */
  function colName(i) {
    let s = '';
    for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
    return s;
  }
  const str = (ref, style, text) => '<c r="' + ref + '" s="' + style + '" t="inlineStr"><is><t xml:space="preserve">' + xml(clean(text)) + '</t></is></c>';
  const blank = (ref, style) => '<c r="' + ref + '" s="' + style + '"/>';

  function sheet(header, rows, note) {
    const cols = header.length;
    const noteRow = rows.length + 3; // 表との間に1行あける
    const last = colName(cols - 1) + (note ? noteRow : rows.length + 1);
    let h = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
      '<sheetPr><pageSetUpPr fitToPage="1"/></sheetPr><dimension ref="A1:' + last + '"/>' +
      '<sheetViews><sheetView workbookViewId="0" showGridLines="0"><pane xSplit="1" ySplit="1" topLeftCell="B2" activePane="bottomRight" state="frozen"/>' +
      '<selection pane="topRight"/><selection pane="bottomLeft"/><selection pane="bottomRight" activeCell="B2" sqref="B2"/></sheetView></sheetViews>' +
      '<sheetFormatPr defaultRowHeight="21" customHeight="1"/>' +
      '<cols><col min="1" max="1" width="12" customWidth="1"/><col min="2" max="' + (cols - 1) + '" width="4.6" customWidth="1"/><col min="' + cols + '" max="' + cols + '" width="7.5" customWidth="1"/></cols>' +
      '<sheetData><row r="1" ht="34" customHeight="1">';
    header.forEach((c, i) => {
      const ref = colName(i) + '1';
      let style;
      if (i === 0) style = S.headName;
      else if (i === cols - 1) style = S.headCnt;
      else {
        const key = c.day === 'sat' ? 'headSat' : c.day === 'sun' ? 'headSun' : 'head';
        style = (c.high ? HI : S)[key];
      }
      h += str(ref, style, c.text);
    });
    h += '</row>';
    rows.forEach((r, ri) => {
      const n = ri + 2;
      h += '<row r="' + n + '" ht="24" customHeight="1">' + str('A' + n, S.name, r.name);
      r.cells.forEach((works, ci) => {
        const ref = colName(ci + 1) + n;
        h += works === 'ev' ? str(ref, S.event, 'イ') : works ? str(ref, S.work, '出') : blank(ref, S.off);
      });
      h += str(colName(cols - 1) + n, S.total, r.total) + '</row>';
    });
    if (note) h += '<row r="' + noteRow + '">' + str('A' + noteRow, S.note, note) + '</row>';
    return h + '</sheetData><pageMargins left="0.4" right="0.4" top="0.5" bottom="0.5" header="0.3" footer="0.3"/>' +
      '<pageSetup paperSize="9" orientation="landscape" fitToWidth="1" fitToHeight="0"/></worksheet>';
  }

  function build(opt) {
    const name = clean(opt.sheetName || 'シフト表').replace(/[\\/?*[\]:]/g, '').slice(0, 31) || 'シフト表';
    const head = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
    return zip([
      { name: '[Content_Types].xml', data: head + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Default Extension="xml" ContentType="application/xml"/>' +
        '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
        '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
        '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>' },
      { name: '_rels/.rels', data: head + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>' },
      { name: 'xl/workbook.xml', data: head + '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
        '<bookViews><workbookView/></bookViews><sheets><sheet name="' + xml(name) + '" sheetId="1" r:id="rId1"/></sheets></workbook>' },
      { name: 'xl/_rels/workbook.xml.rels', data: head + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>' +
        '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>' },
      { name: 'xl/styles.xml', data: styles() },
      { name: 'xl/worksheets/sheet1.xml', data: sheet(opt.header, opt.rows, opt.note || '') },
    ]);
  }

  return { build, crc32 };
});
