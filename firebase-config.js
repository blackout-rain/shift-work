// 端末をまたいでデータを同期するための Firebase の設定。apiKey と projectId が空の間は同期せず、
// これまでどおりブラウザの中だけに保存する。設定のしかたは README の「データの同期」を参照。
// ここの値は秘密ではない（データはログインと Firestore のルールで守る）。
window.SHIFT_SYNC = window.SHIFT_SYNC || {
  apiKey: '',
  projectId: '',
};
