// index.html・style.css・firebase-config.js・sync.js・solver.js・holidays.js・xlsx.js・app.js を、単体で開ける1つのHTMLにまとめる
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');
const inline = (code) => code.replace(/<\/script>/gi, '<\\/script>');

let html = read('index.html');
html = html.replace('<link rel="stylesheet" href="style.css">', '<style>\n' + read('style.css') + '</style>');
html = html.replace('<script src="firebase-config.js"></script>', '<script>\n' + inline(read('firebase-config.js')) + '</script>');
html = html.replace('<script src="sync.js"></script>', '<script>\n' + inline(read('sync.js')) + '</script>');
html = html.replace('<script src="solver.js"></script>', '<script>\n' + inline(read('solver.js')) + '</script>');
html = html.replace('<script src="holidays.js"></script>', '<script>\n' + inline(read('holidays.js')) + '</script>');
html = html.replace('<script src="xlsx.js"></script>', '<script>\n' + inline(read('xlsx.js')) + '</script>');
html = html.replace('<script src="app.js"></script>', '<script>\n' + inline(read('app.js')) + '</script>');
// 配布用は外部ファイルを読まないので、CSPから 'self' を外してさらに厳しくする（開発用の index.html は外部の .js を読むので 'self' が要る）
html = html.replace("script-src 'self' 'unsafe-inline'", "script-src 'unsafe-inline'").replace("style-src 'self' 'unsafe-inline'", "style-src 'unsafe-inline'");
if (/'self'/.test(html.match(/Content-Security-Policy" content="([^"]*)"/)[1])) throw new Error('CSPを厳しくできませんでした');
if (/<link rel="stylesheet"|<script src=/.test(html)) throw new Error('外部ファイルの参照が残っています');

fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
fs.writeFileSync(path.join(root, 'dist', 'shift.html'), html);
console.log('dist/shift.html', Buffer.byteLength(html), 'bytes');
