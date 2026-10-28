const test = require('node:test');
const assert = require('node:assert');
const { create } = require('../sync.js');

// 偽の Firebase（ログイン・トークン更新・Firestore の1文書）
function fakeServer(opts = {}) {
  const s = { doc: null, updateTime: null, tick: 0, calls: [], password: 'pw', tokenOk: true, ...opts };
  const res = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
  s.fetch = async (url, init = {}) => {
    s.calls.push({ url, init });
    if (s.offline) throw new TypeError('offline');
    if (url.includes('accounts:signInWithPassword')) {
      const b = JSON.parse(init.body);
      if (b.password !== s.password) return res(400, { error: { message: 'INVALID_LOGIN_CREDENTIALS' } });
      return res(200, { idToken: 'id1', refreshToken: 'r1', expiresIn: '3600', email: b.email });
    }
    if (url.includes('securetoken.googleapis.com')) {
      return s.tokenOk ? res(200, { id_token: 'id2', refresh_token: 'r2', expires_in: '3600' }) : res(400, { error: { message: 'TOKEN_EXPIRED' } });
    }
    assert.ok(/^Bearer id\d$/.test(init.headers.Authorization), '認証ヘッダが付く');
    if (s.deny) return res(403, { error: { status: 'PERMISSION_DENIED' } });
    const u = new URL(url);
    if ((init.method || 'GET') === 'GET') {
      if (!s.doc) return res(404, { error: { status: 'NOT_FOUND' } });
      return res(200, { fields: { json: { stringValue: s.doc } }, updateTime: s.updateTime });
    }
    const exists = u.searchParams.get('currentDocument.exists');
    const ut = u.searchParams.get('currentDocument.updateTime');
    if ((exists === 'false' && s.doc) || (ut && ut !== s.updateTime)) return res(409, { error: { status: 'ABORTED' } });
    s.doc = JSON.parse(init.body).fields.json.stringValue;
    s.updateTime = '2026-10-28T00:00:0' + ++s.tick + 'Z';
    return res(200, { updateTime: s.updateTime });
  };
  return s;
}
const memStore = () => {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), m };
};
const cfg = { apiKey: 'KEY', projectId: 'proj' };
const make = (srv, storage = memStore(), extra = {}) => create(cfg, { fetch: srv.fetch, storage, ...extra });

test('設定が空なら同期は無効', () => {
  assert.strictEqual(create({ apiKey: '', projectId: '' }).enabled, false);
  assert.strictEqual(create(undefined).enabled, false);
  assert.strictEqual(create(cfg).enabled, true);
});

test('ログインするとログイン情報を保存し、次回は保存済みのログインを使う', async () => {
  const srv = fakeServer();
  const storage = memStore();
  const a = make(srv, storage);
  assert.strictEqual(a.signedIn(), false);
  await a.signIn(' me@example.com ', 'pw');
  assert.strictEqual(a.signedIn(), true);
  assert.strictEqual(a.email(), 'me@example.com');
  assert.ok(JSON.parse(storage.getItem('shift-work-session')).refreshToken);
  const b = make(srv, storage); // 別の読み込み（再訪）
  assert.strictEqual(b.signedIn(), true);
  assert.strictEqual(b.email(), 'me@example.com');
});

test('パスワードが違うと分かりやすい文言で失敗し、ログイン情報は残らない', async () => {
  const srv = fakeServer();
  const storage = memStore();
  const a = make(srv, storage);
  await assert.rejects(a.signIn('me@example.com', 'bad'), /メールアドレスかパスワードが違います/);
  assert.strictEqual(a.signedIn(), false);
  assert.strictEqual(storage.getItem('shift-work-session'), null);
});

test('通信できないときは通信エラーになる', async () => {
  const srv = fakeServer({ offline: true });
  await assert.rejects(make(srv).signIn('a@b.c', 'pw'), (e) => e.code === 'network');
});

test('保存先が空なら exists=false。新規作成→読み込み→更新ができる', async () => {
  const srv = fakeServer();
  const a = make(srv);
  await a.signIn('me@example.com', 'pw');
  assert.deepStrictEqual(await a.load(), { exists: false, json: null, updateTime: null });
  const first = await a.save('{"v":1}', null);
  const got = await a.load();
  assert.strictEqual(got.json, '{"v":1}');
  assert.strictEqual(got.updateTime, first.updateTime);
  const second = await a.save('{"v":2}', got.updateTime);
  assert.notStrictEqual(second.updateTime, first.updateTime);
  assert.strictEqual((await a.load()).json, '{"v":2}');
});

test('他の端末が先に更新していたら conflict になり、上書きしない', async () => {
  const srv = fakeServer();
  const a = make(srv);
  const b = make(srv);
  await a.signIn('me@example.com', 'pw');
  await b.signIn('me@example.com', 'pw');
  const t0 = (await a.save('{"v":1}', null)).updateTime;
  await b.save('{"v":"b"}', t0); // b が先に更新
  await assert.rejects(a.save('{"v":"a"}', t0), (e) => e.conflict === true);
  assert.strictEqual(srv.doc, '{"v":"b"}');
  // すでにある文書を「新規作成」しようとしても同じ
  await assert.rejects(a.save('{"v":"x"}', null), (e) => e.conflict === true);
});

test('トークンの期限が切れたら、保存済みのログイン情報で取り直す', async () => {
  const srv = fakeServer();
  let t = 0;
  const a = make(srv, memStore(), { now: () => t });
  await a.signIn('me@example.com', 'pw');
  await a.load();
  assert.strictEqual(srv.calls.filter((c) => c.url.includes('securetoken')).length, 0);
  t += 2 * 3600 * 1000;
  await a.load();
  assert.strictEqual(srv.calls.filter((c) => c.url.includes('securetoken')).length, 1);
  assert.strictEqual(a.signedIn(), true);
});

test('ログイン情報が無効になっていたら未ログインに戻る', async () => {
  const srv = fakeServer();
  let t = 0;
  const a = make(srv, memStore(), { now: () => t });
  await a.signIn('me@example.com', 'pw');
  srv.tokenOk = false;
  t += 2 * 3600 * 1000;
  await assert.rejects(a.load(), (e) => e.code === 'signedout');
  assert.strictEqual(a.signedIn(), false);
});

test('権限がないアカウントは、権限エラーとして分かる', async () => {
  const srv = fakeServer({ deny: true });
  const a = make(srv);
  await a.signIn('other@example.com', 'pw');
  await assert.rejects(a.load(), (e) => e.code === 'denied');
});

test('ログアウトするとログイン情報が消える', async () => {
  const srv = fakeServer();
  const storage = memStore();
  const a = make(srv, storage);
  await a.signIn('me@example.com', 'pw');
  a.signOut();
  assert.strictEqual(a.signedIn(), false);
  assert.strictEqual(storage.getItem('shift-work-session'), null);
  await assert.rejects(a.load(), (e) => e.code === 'signedout');
});
