/* =========================================================
   loper - IdeaShare  /  script
   ※ サーバーを持たないため、データはこの端末の
     localStorage にのみ保存されます。

   投稿のカウンター
     緑 = 完成した数（done）  … そのアイデアを作り終えた人の数
     黄 = 開発中の数（dev）    … そのアイデアを開発中の人の数
     赤 = いいね（like）       … そのアイデアが欲しい人の数
   ========================================================= */

'use strict';

const KEY_POSTS   = 'loper_ideas';
const KEY_PROFILE = 'loper_profile';
const KEY_NOTICES = 'loper_notices';
const KEY_PREFS   = 'loper_prefs';
const KEY_SEEDED  = 'loper_seeded';
const MAX_TEXT    = 300;

const AVATAR_COLORS = [
  '#ffffff', '#6fd3e2', '#35d43f', '#d6c62c',
  '#f98080', '#c79bf0', '#8fa8ff', '#ffb26b'
];

let posts   = [];
let notices = [];
let profile = { name: 'name', color: '#ffffff' };
let prefs   = { showAds: true };
let currentView = 'home';

const els = {};

/* ================= 起動 ================= */
document.addEventListener('DOMContentLoaded', () => {
  cacheElements();
  loadAll();
  buildSwatches();
  bindNav();
  bindComposer();
  bindSearch();
  bindSettings();
  applyProfile();
  applyPrefs();
  renderFeed();
  renderNotices();
});

function cacheElements() {
  els.myAvatar       = document.getElementById('myAvatar');
  els.myName         = document.getElementById('myName');
  els.composerAvatar = document.getElementById('composerAvatar');
  els.composerOpen   = document.getElementById('composerOpen');
  els.composerCancel = document.getElementById('composerCancel');
  els.form           = document.getElementById('ideaForm');
  els.textInput      = document.getElementById('ideaTextInput');
  els.charCounter    = document.getElementById('charCounter');
  els.feed           = document.getElementById('feed');
  els.searchInput    = document.getElementById('searchInput');
  els.searchResults  = document.getElementById('searchResults');
  els.searchHint     = document.getElementById('searchHint');
  els.noticeList     = document.getElementById('noticeList');
  els.noticeBadge    = document.getElementById('noticeBadge');
  els.nameInput      = document.getElementById('nameInput');
  els.swatches       = document.getElementById('swatches');
  els.saveProfile    = document.getElementById('saveProfile');
  els.savedMsg       = document.getElementById('savedMsg');
  els.toggleAds      = document.getElementById('toggleAds');
  els.clearData      = document.getElementById('clearData');
  els.adRail         = document.getElementById('adRail');
}

/* ================= 保存・読み込み ================= */
function read(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch (e) {
    return fallback;
  }
}

function write(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (e) {
    /* 保存領域が使えない環境では黙って続行する */
  }
}

function loadAll() {
  posts   = read(KEY_POSTS, null);
  notices = read(KEY_NOTICES, []);
  profile = Object.assign({ name: 'name', color: '#ffffff' }, read(KEY_PROFILE, {}));
  prefs   = Object.assign({ showAds: true }, read(KEY_PREFS, {}));

  let seeded = false;
  try { seeded = !!localStorage.getItem(KEY_SEEDED); } catch (e) { /* noop */ }

  /* 初回、または以前のバージョンの空データが残っている場合はダミー投稿を入れる */
  if (!Array.isArray(posts) || (posts.length === 0 && !seeded)) {
    posts = seedPosts();
    write(KEY_POSTS, posts);
    try { localStorage.setItem(KEY_SEEDED, '1'); } catch (e) { /* noop */ }
  } else {
    posts = posts.map(normalizePost);
  }
}

function normalizePost(post) {
  return {
    id:       post.id,
    name:     post.name || 'name',
    color:    post.color || '#ffffff',
    text:     post.text || '',
    date:     post.date || '',
    done:     typeof post.done === 'number' ? post.done : 0,
    dev:      typeof post.dev === 'number' ? post.dev : 0,
    like:     typeof post.like === 'number' ? post.like : 0,
    myDone:   !!post.myDone,
    myDev:    !!post.myDev,
    myLike:   !!post.myLike,
    comments: Array.isArray(post.comments) ? post.comments : [],
    mine:     !!post.mine
  };
}

/* ---- ダミー投稿 ---- */
function seedPosts() {
  /* [名前, 色, 本文, 日時, 完成, 開発中, いいね, コメント] */
  const data = [
    ['ルナ｜個人開発', '#ffffff', '最強のローカルLLMほしいです', '2026年08月17日 21:40', 1, 4, 27,
      [['こう', '#6fd3e2', '量子化すればノートPCでも動きますよ'],
       ['たかし', '#ffffff', 'メモリどれくらい要りますか？']]],
    ['たかし', '#ffffff', '誰かUnrealのを日本語表記にするやつ作ってくれ', '2026年08月17日 18:12', 0, 6, 41,
      [['ルナ｜個人開発', '#ffffff', 'ブループリントのノード名だけでも需要ありそう']]],
    ['みなと', '#8fa8ff', 'Discordの通知をまとめて要約してくれるBotがほしい。\n未読が溜まると追うのが大変なので。', '2026年08月16日 23:05', 3, 2, 18, []],
    ['あおい', '#c79bf0', 'Gitのコミットメッセージを自動で日本語にするCLIツール', '2026年08月16日 12:30', 2, 1, 12,
      [['みなと', '#8fa8ff', 'それ普通にほしい']]],
    ['けんと', '#ffb26b', 'スマホで撮ったホワイトボードの写真を、きれいなMarkdownに変換するアプリ', '2026年08月15日 19:48', 5, 3, 33, []],
    ['さくら', '#f98080', '積みゲー管理アプリ。積んだ日数とクリア率が見えると罪悪感で進むと思う。', '2026年08月14日 09:15', 1, 0, 9, []]
  ];

  return data.map((row, i) => ({
    id:    1000 + (data.length - i),
    name:  row[0],
    color: row[1],
    text:  row[2],
    date:  row[3],
    done:  row[4],
    dev:   row[5],
    like:  row[6],
    myDone: false,
    myDev:  false,
    myLike: false,
    comments: row[7].map((c) => ({ name: c[0], color: c[1], text: c[2] })),
    mine:  false
  }));
}

const savePosts   = () => write(KEY_POSTS, posts);
const saveNotices = () => write(KEY_NOTICES, notices);

/* ================= 共通ユーティリティ ================= */
function formatDate(date) {
  const p = (n) => String(n).padStart(2, '0');
  return date.getFullYear() + '年' + p(date.getMonth() + 1) + '月' +
         p(date.getDate()) + '日 ' + p(date.getHours()) + ':' + p(date.getMinutes());
}

function initialOf(name) {
  return (name || '?').trim().charAt(0) || '?';
}

function makeAvatar(name, color, small) {
  const el = document.createElement('span');
  el.className = 'avatar' + (small ? ' avatar-sm' : '');
  el.style.background = color || '#ffffff';
  el.textContent = initialOf(name);
  return el;
}

function shorten(text) {
  return text.length > 16 ? text.slice(0, 16) + '…' : text;
}

/* ================= 画面切り替え ================= */
function bindNav() {
  document.querySelectorAll('[data-view]').forEach((btn) => {
    btn.addEventListener('click', () => showView(btn.dataset.view));
  });
}

function showView(view) {
  currentView = view;

  document.querySelectorAll('.view').forEach((section) => {
    section.classList.toggle('is-active', section.id === 'view-' + view);
  });

  document.querySelectorAll('.nav-item, .mnav-item').forEach((btn) => {
    const on = btn.dataset.view === view;
    btn.classList.toggle('is-active', on);
    if (btn.classList.contains('nav-item')) {
      if (on) { btn.setAttribute('aria-current', 'page'); }
      else    { btn.removeAttribute('aria-current'); }
    }
  });

  /* スクロールの滑らかさは CSS の scroll-behavior に任せる。
     JS 側で behavior:'smooth' を指定すると、環境によって
     まったくスクロールしないことがあるため使わない。 */
  window.scrollTo(0, 0);

  if (view === 'notice') { markNoticesRead(); }
  if (view === 'search') { els.searchInput.focus(); }
}

/* ================= 投稿フォーム ================= */
function bindComposer() {
  els.composerOpen.addEventListener('click', () => openComposer(true));
  els.composerCancel.addEventListener('click', () => {
    els.form.reset();
    resetCounter();
    openComposer(false);
  });

  els.textInput.addEventListener('input', () => {
    const len = els.textInput.value.length;
    els.charCounter.textContent = len + ' / ' + MAX_TEXT;
    els.charCounter.className = 'char-counter' +
      (len >= MAX_TEXT ? ' at-limit' : len >= MAX_TEXT - 50 ? ' near-limit' : '');
  });

  els.form.addEventListener('submit', (e) => {
    e.preventDefault();
    const text = els.textInput.value.trim();
    if (!text) { return; }

    posts.unshift({
      id: Date.now(),
      name: profile.name || 'name',
      color: profile.color,
      text: text,
      date: formatDate(new Date()),
      done: 0,
      dev: 0,
      like: 0,
      myDone: false,
      myDev: false,
      myLike: false,
      comments: [],
      mine: true
    });

    savePosts();
    addNotice('system', 'アイデアを投稿しました。');
    renderFeed();

    els.form.reset();
    resetCounter();
    openComposer(false);
  });
}

function openComposer(open) {
  els.composerOpen.hidden = open;
  els.form.hidden = !open;
  if (open) { els.textInput.focus(); }
}

function resetCounter() {
  els.charCounter.textContent = '0 / ' + MAX_TEXT;
  els.charCounter.className = 'char-counter';
}

/* ================= フィード描画 ================= */
function renderFeed() {
  paintPosts(els.feed, posts, 'まだアイデアが投稿されていません。\n最初の投稿者になりましょう。');
  if (currentView === 'search') { runSearch(); }
}

function paintPosts(container, list, emptyText) {
  container.innerHTML = '';

  if (list.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty';
    empty.textContent = emptyText;
    empty.style.whiteSpace = 'pre-line';
    container.appendChild(empty);
    return;
  }

  list.forEach((post) => container.appendChild(createPost(post)));
}

function createPost(post) {
  const card = document.createElement('article');
  card.className = 'post';

  /* --- ヘッダー --- */
  const head = document.createElement('div');
  head.className = 'post-head';
  head.appendChild(makeAvatar(post.name, post.color));

  const name = document.createElement('span');
  name.className = 'post-name';
  name.textContent = post.name;
  head.appendChild(name);

  const date = document.createElement('span');
  date.className = 'post-date';
  date.textContent = post.date;
  head.appendChild(date);

  card.appendChild(head);

  /* --- 本文 --- */
  const text = document.createElement('p');
  text.className = 'post-text';
  text.textContent = post.text;
  card.appendChild(text);

  /* --- カウンター --- */
  const actions = document.createElement('div');
  actions.className = 'post-actions';

  const doneBtn = makeReact('done', post.done, post.myDone, '完成した数（クリックで自分の完成を登録）');
  const devBtn  = makeReact('dev',  post.dev,  post.myDev,  '開発中の数（クリックで自分の開発中を登録）');
  const likeBtn = makeReact('like', post.like, post.myLike, 'いいね（このアイデアが欲しい）');
  actions.appendChild(doneBtn);
  actions.appendChild(devBtn);
  actions.appendChild(likeBtn);

  const commentBtn = document.createElement('button');
  commentBtn.type = 'button';
  commentBtn.className = 'react-text';
  commentBtn.textContent = 'コメント ' + post.comments.length;
  actions.appendChild(commentBtn);

  card.appendChild(actions);

  /* --- コメント欄 --- */
  const comments = document.createElement('div');
  comments.className = 'comments';
  comments.hidden = true;
  card.appendChild(comments);

  /* 完成 / 開発中 は排他。完成にすると開発中は外れる */
  doneBtn.addEventListener('click', () => {
    post.myDone = !post.myDone;
    post.done += post.myDone ? 1 : -1;
    if (post.done < 0) { post.done = 0; }

    if (post.myDone && post.myDev) {
      post.myDev = false;
      post.dev = Math.max(0, post.dev - 1);
      updateReact(devBtn, post.dev, false);
    }

    updateReact(doneBtn, post.done, post.myDone);
    savePosts();
    if (post.myDone) {
      addNotice('done', '「' + shorten(post.text) + '」を完成として登録しました。');
    }
  });

  devBtn.addEventListener('click', () => {
    post.myDev = !post.myDev;
    post.dev += post.myDev ? 1 : -1;
    if (post.dev < 0) { post.dev = 0; }

    if (post.myDev && post.myDone) {
      post.myDone = false;
      post.done = Math.max(0, post.done - 1);
      updateReact(doneBtn, post.done, false);
    }

    updateReact(devBtn, post.dev, post.myDev);
    savePosts();
    if (post.myDev) {
      addNotice('dev', '「' + shorten(post.text) + '」を開発中として登録しました。');
    }
  });

  /* いいねは完成・開発中とは独立して押せる */
  likeBtn.addEventListener('click', () => {
    post.myLike = !post.myLike;
    post.like += post.myLike ? 1 : -1;
    if (post.like < 0) { post.like = 0; }

    updateReact(likeBtn, post.like, post.myLike);
    savePosts();
    if (post.myLike && post.mine === false) {
      addNotice('like', '「' + shorten(post.text) + '」にいいねしました。');
    }
  });

  commentBtn.addEventListener('click', () => {
    const open = comments.hidden;
    comments.hidden = !open;
    if (open) { renderComments(post, comments, commentBtn); }
  });

  /* --- 削除（自分の投稿のみ） --- */
  if (post.mine) {
    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'post-delete';
    del.textContent = '削除';
    del.addEventListener('click', () => {
      if (!confirm('この投稿を削除しますか？')) { return; }
      posts = posts.filter((p) => p.id !== post.id);
      savePosts();
      renderFeed();
    });
    actions.appendChild(del);
  }

  return card;
}

function makeReact(kind, count, on, label) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'react react-' + kind + (on ? ' is-on' : '');
  btn.title = label;
  btn.setAttribute('aria-label', label);

  const dot = document.createElement('span');
  dot.className = 'react-dot';
  btn.appendChild(dot);

  const num = document.createElement('span');
  num.className = 'react-count';
  num.textContent = count;
  btn.appendChild(num);

  return btn;
}

function updateReact(btn, count, on) {
  btn.querySelector('.react-count').textContent = count;
  btn.classList.toggle('is-on', on);
}

/* ================= コメント ================= */
function renderComments(post, container, commentBtn) {
  container.innerHTML = '';

  post.comments.forEach((c) => {
    const row = document.createElement('div');
    row.className = 'comment';
    row.appendChild(makeAvatar(c.name, c.color, true));

    const body = document.createElement('div');
    body.className = 'comment-body';

    const name = document.createElement('div');
    name.className = 'comment-name';
    name.textContent = c.name;
    body.appendChild(name);

    const text = document.createElement('div');
    text.className = 'comment-text';
    text.textContent = c.text;
    body.appendChild(text);

    row.appendChild(body);
    container.appendChild(row);
  });

  const form = document.createElement('form');
  form.className = 'comment-form';

  const input = document.createElement('input');
  input.type = 'text';
  input.maxLength = 140;
  input.placeholder = 'コメントを書く';
  form.appendChild(input);

  const submit = document.createElement('button');
  submit.type = 'submit';
  submit.textContent = '送信';
  form.appendChild(submit);

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text) { return; }

    post.comments.push({
      name: profile.name || 'name',
      color: profile.color,
      text: text
    });

    savePosts();
    commentBtn.textContent = 'コメント ' + post.comments.length;
    renderComments(post, container, commentBtn);
  });

  container.appendChild(form);
  input.focus();
}

/* ================= 検索 ================= */
function bindSearch() {
  els.searchInput.addEventListener('input', runSearch);
}

function runSearch() {
  const q = els.searchInput.value.trim().toLowerCase();

  if (!q) {
    els.searchHint.textContent = 'キーワードを入力すると投稿を絞り込みます。';
    els.searchResults.innerHTML = '';
    return;
  }

  const hits = posts.filter((p) =>
    p.text.toLowerCase().includes(q) || p.name.toLowerCase().includes(q)
  );

  els.searchHint.textContent = hits.length + ' 件見つかりました。';
  paintPosts(els.searchResults, hits, '一致する投稿はありません。');
}

/* ================= 通知 ================= */
function addNotice(kind, text) {
  notices.unshift({
    id: Date.now() + Math.random(),
    kind: kind,
    text: text,
    date: formatDate(new Date()),
    unread: true
  });
  notices = notices.slice(0, 50);
  saveNotices();
  renderNotices();
}

function renderNotices() {
  els.noticeList.innerHTML = '';

  if (notices.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty';
    empty.textContent = '通知はまだありません。';
    els.noticeList.appendChild(empty);
  } else {
    notices.forEach((n) => {
      const row = document.createElement('div');
      row.className = 'notice' + (n.unread ? ' is-unread' : '');

      const icon = document.createElement('span');
      icon.className = 'notice-icon ' + n.kind;
      row.appendChild(icon);

      const body = document.createElement('div');

      const text = document.createElement('div');
      text.className = 'notice-text';
      text.textContent = n.text;
      body.appendChild(text);

      const date = document.createElement('div');
      date.className = 'notice-date';
      date.textContent = n.date;
      body.appendChild(date);

      row.appendChild(body);
      els.noticeList.appendChild(row);
    });
  }

  updateBadge();
}

function updateBadge() {
  const unread = notices.filter((n) => n.unread).length;
  els.noticeBadge.hidden = unread === 0;
  els.noticeBadge.textContent = unread;
}

function markNoticesRead() {
  if (!notices.some((n) => n.unread)) { return; }
  notices.forEach((n) => { n.unread = false; });
  saveNotices();
  renderNotices();
}

/* ================= 設定 ================= */
function buildSwatches() {
  AVATAR_COLORS.forEach((color) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'swatch';
    btn.style.background = color;
    btn.dataset.color = color;
    btn.setAttribute('aria-label', 'アバターの色 ' + color);
    btn.addEventListener('click', () => {
      profile.color = color;
      highlightSwatch();
      previewProfile();
    });
    els.swatches.appendChild(btn);
  });
}

function highlightSwatch() {
  els.swatches.querySelectorAll('.swatch').forEach((s) => {
    s.classList.toggle('is-on', s.dataset.color === profile.color);
  });
}

function bindSettings() {
  els.nameInput.addEventListener('input', previewProfile);

  els.saveProfile.addEventListener('click', () => {
    profile.name = els.nameInput.value.trim() || 'name';
    write(KEY_PROFILE, profile);
    applyProfile();

    els.savedMsg.hidden = false;
    setTimeout(() => { els.savedMsg.hidden = true; }, 2000);
  });

  els.toggleAds.addEventListener('change', () => {
    prefs.showAds = els.toggleAds.checked;
    write(KEY_PREFS, prefs);
    applyPrefs();
  });

  els.clearData.addEventListener('click', () => {
    if (!confirm('投稿・通知・プロフィールをすべて削除します。よろしいですか？')) { return; }
    [KEY_POSTS, KEY_NOTICES, KEY_PROFILE, KEY_PREFS, KEY_SEEDED].forEach((k) => {
      try { localStorage.removeItem(k); } catch (e) { /* noop */ }
    });
    location.reload();
  });
}

function previewProfile() {
  const name = els.nameInput.value.trim() || 'name';
  els.myAvatar.textContent = initialOf(name);
  els.myAvatar.style.background = profile.color;
  els.composerAvatar.textContent = initialOf(name);
  els.composerAvatar.style.background = profile.color;
  els.myName.textContent = name;
}

function applyProfile() {
  els.nameInput.value = profile.name === 'name' ? '' : profile.name;
  els.myName.textContent = profile.name;
  els.myAvatar.textContent = initialOf(profile.name);
  els.myAvatar.style.background = profile.color;
  els.composerAvatar.textContent = initialOf(profile.name);
  els.composerAvatar.style.background = profile.color;
  highlightSwatch();
}

function applyPrefs() {
  els.toggleAds.checked = prefs.showAds;
  els.adRail.hidden = !prefs.showAds;
}
