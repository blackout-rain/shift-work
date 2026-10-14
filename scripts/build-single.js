// index.html・style.css・solver.js・app.js を、単体で開ける1つのHTMLにまとめる
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');
const inline = (code) => code.replace(/<\/script>/gi, '<\\/script>');

let html = read('index.html');
html = html.replace('<link rel="stylesheet" href="style.css">', '<style>\n' + read('style.css') + '</style>');
html = html.replace('<script src="solver.js"></script>', '<script>\n' + inline(read('solver.js')) + '</script>');
html = html.replace('<script src="holidays.js"></script>', '<script>\n' + inline(read('holidays.js')) + '</script>');
html = html.replace('<script src="app.js"></script>', '<script>\n' + inline(read('app.js')) + '</script>');
if (/<link rel="stylesheet"|<script src=/.test(html)) throw new Error('外部ファイルの参照が残っています');

fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
fs.writeFileSync(path.join(root, 'dist', 'shift.html'), html);
console.log('dist/shift.html', Buffer.byteLength(html), 'bytes');
