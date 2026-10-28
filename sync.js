/*
 * どの端末からでも同じデータを見られるようにする（Firebase の REST API を直接使う。外部ライブラリなし）
 *   - ログイン: Firebase Authentication（メールとパスワード）
 *   - 保存先:  Firestore の shift/main という1つの文書に、アプリのデータをJSON文字列で入れる
 * 設定（apiKey・projectId）が空なら enabled が false になり、アプリはこれまでどおりブラウザ内だけに保存する。
 *
 * ShiftSync.create(config, { fetch, storage, now }) → {
 *   enabled, signedIn(), email(), signIn(email, password), signOut(),
 *   load()  → { exists, json, updateTime }
 *   save(json, updateTime) → { updateTime }   updateTime が null なら新規作成。他で更新されていたら { conflict: true } を投げる
 * }
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ShiftSync = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const SESSION_KEY = 'shift-work-session';
  const DOC = 'shift/main';

  // 画面に出すエラー文。code は Error.code に入る
  const AUTH_MESSAGES = {
    INVALID_LOGIN_CREDENTIALS: 'メールアドレスかパスワードが違います',
    INVALID_PASSWORD: 'メールアドレスかパスワードが違います',
    EMAIL_NOT_FOUND: 'メールアドレスかパスワードが違います',
    INVALID_EMAIL: 'メールアドレスの形式が正しくありません',
    MISSING_PASSWORD: 'パスワードを入力してください',
    USER_DISABLED: 'このアカウントは無効になっています',
    TOO_MANY_ATTEMPTS_TRY_LATER: '試行回数が多すぎます。しばらく待ってからやり直してください',
  };

  function fail(code, message, extra) {
    const e = new Error(message);
    e.code = code;
    return Object.assign(e, extra);
  }

  function create(config, deps) {
    const cfg = config || {};
    const d = Object.assign({}, deps);
    const doFetch = d.fetch || ((...a) => fetch(...a));
    const store = d.storage || (typeof localStorage !== 'undefined' ? localStorage : null);
    const now = d.now || (() => Date.now());
    const enabled = !!(cfg.apiKey && cfg.projectId);

    let session = null; // { refreshToken, email }
    let idToken = null;
    let expiresAt = 0;

    try {
      const s = store && JSON.parse(store.getItem(SESSION_KEY));
      if (s && s.refreshToken) session = s;
    } catch (e) { /* ログイン情報が無い・壊れている場合は未ログイン */ }

    const remember = () => {
      try {
        if (!store) return;
        if (session) store.setItem(SESSION_KEY, JSON.stringify(session));
        else store.removeItem(SESSION_KEY);
      } catch (e) { /* 保存できなくても動作は続ける */ }
    };

    async function json(res) {
      try { return await res.json(); } catch (e) { return {}; }
    }

    async function signIn(email, password) {
      if (!enabled) throw fail('disabled', '同期の設定がありません');
      let res;
      try {
        res = await doFetch('https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=' + encodeURIComponent(cfg.apiKey), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: String(email).trim(), password, returnSecureToken: true }),
        });
      } catch (e) {
        throw fail('network', '通信できませんでした。ネットワークを確認してください');
      }
      const body = await json(res);
      if (!res.ok) {
        const key = String((body.error && body.error.message) || '').split(' ')[0];
        throw fail(key || 'auth', AUTH_MESSAGES[key] || 'ログインできませんでした（' + (key || res.status) + '）');
      }
      session = { refreshToken: body.refreshToken, email: body.email || String(email).trim() };
      idToken = body.idToken;
      expiresAt = now() + (Number(body.expiresIn) || 3600) * 1000 - 60000;
      remember();
    }

    function signOut() {
      session = null;
      idToken = null;
      expiresAt = 0;
      remember();
    }

    async function token() {
      if (!session) throw fail('signedout', 'ログインしていません');
      if (idToken && now() < expiresAt) return idToken;
      let res;
      try {
        res = await doFetch('https://securetoken.googleapis.com/v1/token?key=' + encodeURIComponent(cfg.apiKey), {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: 'grant_type=refresh_token&refresh_token=' + encodeURIComponent(session.refreshToken),
        });
      } catch (e) {
        throw fail('network', '通信できませんでした');
      }
      const body = await json(res);
      if (!res.ok) {
        // 無効になったログイン（パスワード変更など）は、ログインし直してもらう
        signOut();
        throw fail('signedout', 'ログインの有効期限が切れました。もう一度ログインしてください');
      }
      idToken = body.id_token;
      if (body.refresh_token) session.refreshToken = body.refresh_token;
      expiresAt = now() + (Number(body.expires_in) || 3600) * 1000 - 60000;
      remember();
      return idToken;
    }

    const docUrl = () => 'https://firestore.googleapis.com/v1/projects/' + encodeURIComponent(cfg.projectId) + '/databases/(default)/documents/' + DOC;

    async function request(url, init) {
      const t = await token();
      let res;
      try {
        res = await doFetch(url, Object.assign({}, init, { headers: Object.assign({ Authorization: 'Bearer ' + t }, init && init.headers) }));
      } catch (e) {
        throw fail('network', '通信できませんでした');
      }
      return res;
    }

    function check(res, body) {
      if (res.ok) return;
      const status = (body.error && body.error.status) || '';
      if (res.status === 401) {
        idToken = null; // 次回は取り直す
        throw fail('auth', 'ログインし直してください');
      }
      if (res.status === 403 || status === 'PERMISSION_DENIED') throw fail('denied', 'このアカウントには保存の権限がありません（Firestoreのルールを確認してください）');
      throw fail('server', '保存先でエラーが起きました（' + (status || res.status) + '）');
    }

    async function load() {
      const res = await request(docUrl(), { method: 'GET' });
      if (res.status === 404) return { exists: false, json: null, updateTime: null };
      const body = await json(res);
      check(res, body);
      const f = body.fields && body.fields.json;
      return { exists: true, json: f && f.stringValue !== undefined ? f.stringValue : null, updateTime: body.updateTime || null };
    }

    async function save(text, updateTime) {
      const precondition = updateTime ? 'currentDocument.updateTime=' + encodeURIComponent(updateTime) : 'currentDocument.exists=false';
      const res = await request(docUrl() + '?updateMask.fieldPaths=json&' + precondition, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fields: { json: { stringValue: text } } }),
      });
      const body = await json(res);
      if (res.status === 409 || (body.error && (body.error.status === 'ABORTED' || body.error.status === 'FAILED_PRECONDITION' || body.error.status === 'ALREADY_EXISTS'))) {
        throw fail('conflict', '他の端末で先に更新されています', { conflict: true });
      }
      check(res, body);
      return { updateTime: body.updateTime || null };
    }

    return {
      enabled,
      signedIn: () => !!session,
      email: () => (session ? session.email : ''),
      signIn,
      signOut,
      load,
      save,
    };
  }

  return { create };
});
