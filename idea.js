/* =========================================================
   loper - IdeaShare  /  script

   アイデアの投稿は Firestore に保存され、全員で共有される。
   ログインは匿名ログイン（登録なしで書き込めるようにするため）。
   表示名・通知・広告の設定だけは端末内（localStorage）に保存する。

   投稿のカウンター
     緑 = 完成した数（doneBy）  … そのアイデアを作り終えた人
     黄 = 開発中の数（devBy）    … そのアイデアを開発中の人
     赤 = いいね（likeBy）       … そのアイデアが欲しい人
   件数は配列の長さで数える。こうするとルール側で
   「自分のUIDを1つ足す／外す」以外を弾けるので、水増しできない。
   ========================================================= */

'use strict';

const KEY_PROFILE = 'loper_profile';
const KEY_REPORTS = 'loper_reports';
/* loperへの誘いを出した投稿（同じアイデアでは一度きりにするため） */
const KEY_INVITED = 'loper_invited';

/* loper 本体の投稿フォームは ?title=...&desc=... を受け取る。
   category は送らない（IdeaShare にカテゴリの情報がないため、
   loper 側で選んでもらう）。 */
const LOPER_URL   = 'https://11kawauso.github.io/loper/';
const LOPER_TITLE_MAX = 30;
/* 右下の誘いを出しておく時間（ミリ秒） */
const TOAST_MS = 9000;
const LOPER_DESC_MAX  = 500;
const MAX_TEXT    = 300;

/* 無限スクロールで一度に読み込む件数と、
   末尾がこの距離まで近づいたら次を読み込む（px） */
const PAGE_SIZE    = 10;
const LOAD_MARGIN  = 300;

/* 検索は Firestore で部分一致ができないため、
   直近この件数だけ取ってきて画面側で絞り込む */
const SEARCH_LIMIT = 300;

/* 一度に取得する通知の件数 */
const NOTICE_LIMIT = 100;

/* アイコン画像は正方形に切り抜いてこの大きさに縮小する。
   投稿ごとに複製して保存するため、軽さを優先している。 */
const AVATAR_SIZE    = 96;
const AVATAR_QUALITY = 0.7;
const AVATAR_MAX_IN  = 12 * 1024 * 1024;   /* 読み込む元画像の上限 */
const AVATAR_MAX_OUT = 200000;             /* 保存する文字数の上限（ルールと合わせる） */

const AVATAR_COLORS = [
  '#ffffff', '#6fd3e2', '#35d43f', '#d6c62c',
  '#f98080', '#c79bf0', '#8fa8ff', '#ffb26b'
];

let posts   = [];
let notices = [];
let profile = { name: 'name', color: '#ffffff', avatar: '' };
let currentView = 'home';
let backView    = 'home';   /* 他人のプロフィールから戻る先 */

/* Firestore の読み込み状態 */
let fb        = null;   /* window._fb */
let myUid     = null;
let lastDoc   = null;   /* 続きを読むための位置 */
let allLoaded = false;
let loading   = false;
let loadError = false;
let searchCache = null;

const els = {};

/* ================= 起動 =================
   画面の準備（DOMContentLoaded）と Firebase の準備
   （firebase-ready）は順番が前後しうるので、両方
   揃ってから開始する。                              */

let domReady = false;
let fbReady  = false;

document.addEventListener('DOMContentLoaded', () => {
  domReady = true;
  start();
});

document.addEventListener('firebase-ready', () => {
  fbReady = true;
  start();
});

function start() {
  if (!domReady || !fbReady || els.feed) { return; }

  cacheElements();
  loadLocal();
  buildSwatches();
  bindNav();
  bindComposer();
  bindSearch();
  bindSettings();
  bindPostMenuDismiss();
  els.userBack.addEventListener('click', () => showView(backView));
  els.ideaBack.addEventListener('click', () => showView('home'));
  applyProfile();
  renderNotices();
  setupInfiniteScroll();

  connect();
}

/* 匿名ログインしてから最初のページを読み込む */
function connect() {
  fb = window._fb || null;

  if (!window._fbConfigured) {
    showFeedMessage('Firebase の設定がまだです。\nindex.html の firebaseConfig を設定してください。');
    return;
  }

  if (!fb) {
    showFeedMessage('Firebase を読み込めませんでした。\n通信環境を確認して再読み込みしてください。');
    return;
  }

  showFeedMessage('読み込み中…');

  fb.onAuthStateChanged(fb.auth, (user) => {
    if (!user) { return; }
    if (myUid === user.uid) { return; }

    myUid = user.uid;
    reloadFeed();
    loadNotices();
    openIdeaFromUrl();
  });

  fb.signInAnonymously(fb.auth).catch((e) => {
    console.error(e);
    showFeedMessage('ログインできませんでした。\nFirebaseコンソールで匿名ログインを有効にしてください。');
  });
}

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
  els.feedEnd        = document.getElementById('feedEnd');
  els.searchInput    = document.getElementById('searchInput');
  els.searchResults  = document.getElementById('searchResults');
  els.searchHint     = document.getElementById('searchHint');
  els.noticeList     = document.getElementById('noticeList');
  els.noticeBadge    = document.getElementById('noticeBadge');
  els.likedFeed      = document.getElementById('likedFeed');
  els.likedHint      = document.getElementById('likedHint');
  els.devFeed        = document.getElementById('devFeed');
  els.devHint        = document.getElementById('devHint');
  els.doneFeed       = document.getElementById('doneFeed');
  els.doneHint       = document.getElementById('doneHint');
  els.ideaBack       = document.getElementById('ideaBack');
  els.ideaFeed       = document.getElementById('ideaFeed');
  els.userBack       = document.getElementById('userBack');
  els.userAvatar     = document.getElementById('userAvatar');
  els.userName       = document.getElementById('userName');
  els.userCount      = document.getElementById('userCount');
  els.userFeed       = document.getElementById('userFeed');
  els.profileAvatar  = document.getElementById('profileAvatar');
  els.profilePreviewName = document.getElementById('profilePreviewName');
  els.nameInput      = document.getElementById('nameInput');
  els.avatarFile     = document.getElementById('avatarFile');
  els.avatarPick     = document.getElementById('avatarPick');
  els.avatarClear    = document.getElementById('avatarClear');
  els.avatarNote     = document.getElementById('avatarNote');
  els.swatches       = document.getElementById('swatches');
  els.saveProfile    = document.getElementById('saveProfile');
  els.savedMsg       = document.getElementById('savedMsg');
  els.clearData      = document.getElementById('clearData');
}

/* ================= 端末内の保存 ================= */
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

function loadLocal() {
  profile = Object.assign({ name: 'name', color: '#ffffff', avatar: '' }, read(KEY_PROFILE, {}));
}

/* ================= Firestore の読み書き ================= */

/* Firestore のドキュメントを、画面が扱いやすい形に変換する */
function toPost(snap) {
  const d = snap.data();
  const likeBy = d.likeBy || [];
  const doneBy = d.doneBy || [];
  const devBy  = d.devBy  || [];

  return {
    id:     snap.id,
    authorUid: d.authorUid,
    name:   d.authorName || 'name',
    color:  d.authorColor || '#ffffff',
    avatar: d.authorAvatar || '',
    text:   d.text || '',
    /* 投稿直後はサーバー時刻がまだ入っていないことがある */
    date:   d.createdAt && d.createdAt.toDate ? formatDate(d.createdAt.toDate()) : 'たった今',
    /* 画面側で並び替えるための日時（数値） */
    at:     d.createdAt && d.createdAt.toDate ? d.createdAt.toDate().getTime() : 0,
    likeBy: likeBy,
    doneBy: doneBy,
    devBy:  devBy,
    like:   likeBy.length,
    done:   doneBy.length,
    dev:    devBy.length,
    myLike: likeBy.indexOf(myUid) !== -1,
    myDone: doneBy.indexOf(myUid) !== -1,
    myDev:  devBy.indexOf(myUid) !== -1,
    mine:   d.authorUid === myUid
  };
}

function ideasQuery(after) {
  const base = [fb.collection(fb.db, 'ideas'), fb.orderBy('createdAt', 'desc')];
  if (after) { base.push(fb.startAfter(after)); }
  base.push(fb.limit(PAGE_SIZE));
  return fb.query.apply(null, base);
}

/* 先頭から読み直す */
function reloadFeed() {
  posts = [];
  lastDoc = null;
  allLoaded = false;
  loadError = false;
  searchCache = null;
  els.feed.innerHTML = '';
  loadNextPage();
}

async function loadNextPage() {
  if (!fb || !myUid || loading || allLoaded || loadError) { return; }

  loading = true;
  updateFeedEnd();

  try {
    const snap = await fb.getDocs(ideasQuery(lastDoc));

    if (snap.empty) {
      allLoaded = true;
    } else {
      lastDoc = snap.docs[snap.docs.length - 1];
      if (snap.docs.length < PAGE_SIZE) { allLoaded = true; }

      const fresh = snap.docs.map(toPost);
      posts = posts.concat(fresh);
      appendPosts(fresh);
    }
  } catch (e) {
    console.error(e);
    loadError = true;
  }

  loading = false;

  if (posts.length === 0 && !loadError) {
    showFeedMessage('まだアイデアが投稿されていません。\n最初の投稿者になりましょう。');
  }

  updateFeedEnd();
  fillFeed();
}

/* ================= 共通ユーティリティ ================= */
function formatDate(date) {
  const p = (n) => String(n).padStart(2, '0');
  return date.getFullYear() + '年' + p(date.getMonth() + 1) + '月' +
         p(date.getDate()) + '日 ' + p(date.getHours()) + ':' + p(date.getMinutes());
}

function initialOf(name) {
  return (name || '?').trim().charAt(0) || '?';
}

function makeAvatar(name, color, small, avatar) {
  const el = document.createElement('span');
  el.className = 'avatar' + (small ? ' avatar-sm' : '');
  paintAvatarEl(el, name, color, avatar);
  return el;
}

/* 画像があれば画像を、無ければ色＋頭文字を表示する */
function paintAvatarEl(el, name, color, avatar) {
  if (avatar) {
    el.classList.add('has-image');
    el.textContent = '';
    el.style.background = '';
    /* データURLをそのまま入れるので、念のため文字列として囲む */
    el.style.backgroundImage = 'url(' + JSON.stringify(avatar) + ')';
  } else {
    el.classList.remove('has-image');
    el.style.backgroundImage = '';
    el.style.background = color || '#ffffff';
    el.textContent = initialOf(name);
  }
}

function shorten(text) {
  return text.length > 16 ? text.slice(0, 16) + '…' : text;
}

/* ================= 画面切り替え ================= */
function bindNav() {
  document.querySelectorAll('[data-view]').forEach((btn) => {
    /* ロゴを押したときだけ、滑らかに先頭へ戻す */
    const smooth = btn.classList.contains('brand');
    btn.addEventListener('click', () => showView(btn.dataset.view, smooth));
  });
}

/* 先頭へスクロールする。
   smooth = true でも、環境によっては behavior:'smooth' が
   無視されてまったく動かないことがある。その場合に
   途中で止まったままにならないよう、少し待って
   位置がまったく変わっていなければ即座に移動させる。   */
function scrollToTop(smooth) {
  const startY = window.scrollY;

  const reduceMotion = window.matchMedia &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  if (!smooth || reduceMotion || startY === 0) {
    window.scrollTo(0, 0);
    return;
  }

  try {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  } catch (e) {
    window.scrollTo(0, 0);
    return;
  }

  setTimeout(() => {
    /* まったく動いていなければ smooth が効いていない */
    if (window.scrollY === startY && startY > 0) {
      window.scrollTo(0, 0);
    }
  }, 250);
}

function showView(view, smooth) {
  currentView = view;

  document.querySelectorAll('.view').forEach((section) => {
    section.classList.toggle('is-active', section.id === 'view-' + view);
  });

  document.querySelectorAll('.nav-item, .mnav-item, .profile-chip').forEach((btn) => {
    const on = btn.dataset.view === view;
    btn.classList.toggle('is-active', on);
    if (btn.classList.contains('nav-item') || btn.classList.contains('profile-chip')) {
      if (on) { btn.setAttribute('aria-current', 'page'); }
      else    { btn.removeAttribute('aria-current'); }
    }
  });

  scrollToTop(smooth);

  if (view === 'home')   { fillFeed(); }
  if (view === 'notice') { loadNotices().then(markNoticesRead); }
  if (REACTED[view])     { loadReacted(view); }
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

  els.form.addEventListener('submit', async (e) => {
    e.preventDefault();

    const text = els.textInput.value.trim();
    if (!text) { return; }

    if (!fb || !myUid) {
      alert('サーバーに接続できていません。少し待ってから試してください。');
      return;
    }

    const submitBtn = els.form.querySelector('button[type="submit"]');
    submitBtn.disabled = true;

    try {
      await fb.addDoc(fb.collection(fb.db, 'ideas'), {
        authorUid:   myUid,
        authorName:  profile.name || 'name',
        authorColor: profile.color,
        authorAvatar: profile.avatar || '',
        text:        text,
        createdAt:   fb.serverTimestamp(),
        likeBy:      [],
        doneBy:      [],
        devBy:       []
      });

      els.form.reset();
      resetCounter();
      openComposer(false);

      searchCache = null;
      reloadFeed();
      scrollToTop(false);
    } catch (err) {
      console.error(err);
      alert('投稿できませんでした。通信環境を確認してください。');
    }

    submitBtn.disabled = false;
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

/* ================= フィード描画 =================
   Firestore から PAGE_SIZE 件ずつ取得し、末尾（feedEnd）が
   画面に近づいたら続きを読み込む（無限スクロール）。   */

function appendPosts(list) {
  /* メッセージだけが入っている状態なら消す */
  const msg = els.feed.querySelector('.empty');
  if (msg) { msg.remove(); }

  const frag = document.createDocumentFragment();
  list.forEach((post) => frag.appendChild(createPost(post)));
  els.feed.appendChild(frag);
}

function showFeedMessage(text) {
  els.feed.innerHTML = '';
  const empty = document.createElement('div');
  empty.className = 'empty';
  empty.style.whiteSpace = 'pre-line';
  empty.textContent = text;
  els.feed.appendChild(empty);
  updateFeedEnd();
}

function updateFeedEnd() {
  if (loadError) {
    els.feedEnd.textContent = '読み込みに失敗しました';
    return;
  }
  if (posts.length === 0) {
    els.feedEnd.textContent = '';
    return;
  }
  els.feedEnd.textContent = loading ? '読み込み中…'
    : allLoaded ? 'すべての投稿を表示しました'
    : '';
}

/* 末尾が画面に近づいていれば続きを読み込む */
function fillFeed() {
  if (currentView !== 'home') { return; }
  if (!fb || !myUid || loading || allLoaded || loadError) { return; }

  const top = els.feedEnd.getBoundingClientRect().top;
  if (top > window.innerHeight + LOAD_MARGIN) { return; }

  loadNextPage();
}

function setupInfiniteScroll() {
  /* スクロール監視と IntersectionObserver の両方から fillFeed を呼ぶ。
     fillFeed は何度呼ばれても安全なので、片方が動かない環境でも
     もう片方で読み込みが続く。 */
  window.addEventListener('scroll', fillFeed, { passive: true });
  window.addEventListener('resize', fillFeed);

  if (typeof IntersectionObserver !== 'undefined') {
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) { fillFeed(); }
    }, { rootMargin: LOAD_MARGIN + 'px 0px' });
    observer.observe(els.feedEnd);
  }
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

/* ================= 投稿メニュー（…） ================= */

/* 投稿の右上に置く「…」メニュー。
   自分の投稿なら「削除する」、他人の投稿なら「通報する」を出す。 */
function makePostMenu(post, card) {
  const wrap = document.createElement('div');
  wrap.className = 'post-menu-wrap';

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'post-menu-btn';
  btn.title = 'メニュー';
  btn.setAttribute('aria-label', 'この投稿のメニュー');
  btn.setAttribute('aria-haspopup', 'true');
  btn.setAttribute('aria-expanded', 'false');
  btn.innerHTML = '<svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true">' +
    '<circle cx="4" cy="10" r="1.7"/><circle cx="10" cy="10" r="1.7"/><circle cx="16" cy="10" r="1.7"/></svg>';

  const menu = document.createElement('div');
  menu.className = 'post-menu';
  menu.hidden = true;
  menu.setAttribute('role', 'menu');

  const item = document.createElement('button');
  item.type = 'button';
  item.className = 'post-menu-item is-danger';
  item.setAttribute('role', 'menuitem');
  item.textContent = post.mine ? '削除する' : '通報する';
  item.addEventListener('click', () => {
    closeAllPostMenus();
    if (post.mine) { deletePost(post, card); }
    else           { reportPost(post); }
  });
  menu.appendChild(item);

  btn.addEventListener('click', () => {
    const willOpen = menu.hidden;
    closeAllPostMenus();
    menu.hidden = !willOpen;
    btn.setAttribute('aria-expanded', String(willOpen));
    if (willOpen) { item.focus(); }
  });

  wrap.appendChild(btn);
  wrap.appendChild(menu);
  return wrap;
}

/* 自分の投稿を削除する */
async function deletePost(post, card) {
  if (!confirm('この投稿を削除しますか？')) { return; }

  try {
    await fb.deleteDoc(fb.doc(fb.db, 'ideas', post.id));
  } catch (e) {
    console.error(e);
    alert('削除できませんでした。通信環境を確認してください。');
    return;
  }

  posts = posts.filter((p) => p.id !== post.id);
  searchCache = null;
  card.remove();

  if (posts.length === 0) {
    showFeedMessage('まだアイデアが投稿されていません。\n最初の投稿者になりましょう。');
  }
  fillFeed();
}

function closeAllPostMenus() {
  document.querySelectorAll('.post-menu').forEach((m) => { m.hidden = true; });
  document.querySelectorAll('.post-menu-btn').forEach((b) => {
    b.setAttribute('aria-expanded', 'false');
  });
}

/* メニューの外側を押す・Escapeキーで閉じる */
function bindPostMenuDismiss() {
  document.addEventListener('click', (e) => {
    if (!e.target.closest || !e.target.closest('.post-menu-wrap')) {
      closeAllPostMenus();
    }
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { closeAllPostMenus(); }
  });
}

/* 通報。二重通報を防ぐため、通報済みの投稿は端末内にも記録しておく
   （reports コレクションはクライアントから読めないため） */
async function reportPost(post) {
  const reports = read(KEY_REPORTS, []);

  if (reports.some((r) => r.ideaId === post.id)) {
    alert('この投稿は既に通報済みです。');
    return;
  }

  const label = 'この投稿を通報しますか？' + String.fromCharCode(10, 10) + '「' + shorten(post.text) + '」';
  if (!confirm(label)) { return; }

  try {
    await fb.addDoc(fb.collection(fb.db, 'reports'), {
      reporterUid: myUid,
      ideaId:      post.id,
      authorUid:   post.authorUid,
      text:        post.text,
      createdAt:   fb.serverTimestamp()
    });
  } catch (e) {
    console.error(e);
    alert('通報を送信できませんでした。通信環境を確認してください。');
    return;
  }

  reports.unshift({ ideaId: post.id, date: formatDate(new Date()) });
  write(KEY_REPORTS, reports.slice(0, 200));

  alert('通報を受け付けました。ご協力ありがとうございます。');
}

function createPost(post) {
  const card = document.createElement('article');
  card.className = 'post';

  /* --- ヘッダー --- */
  const head = document.createElement('div');
  head.className = 'post-head';

  /* アイコンと名前を押すと、その人のプロフィールへ */
  const author = document.createElement('button');
  author.type = 'button';
  author.className = 'post-author';
  author.title = post.name + ' のプロフィール';
  author.appendChild(makeAvatar(post.name, post.color, false, post.avatar));

  const name = document.createElement('span');
  name.className = 'post-name';
  name.textContent = post.name;
  author.appendChild(name);

  author.addEventListener('click', () => openUserProfile(post));
  head.appendChild(author);

  const date = document.createElement('span');
  date.className = 'post-date';
  date.textContent = post.date;
  head.appendChild(date);

  head.appendChild(makePostMenu(post, card));

  card.appendChild(head);

  /* --- 本文 --- */
  const text = document.createElement('p');
  text.className = 'post-text';
  text.textContent = post.text;
  card.appendChild(text);

  /* --- カウンター --- */
  const actions = document.createElement('div');
  actions.className = 'post-actions';

  addReactCounters(actions, post);

  card.appendChild(actions);

  return card;
}

/* 完成・開発中・いいねの3つを actions に入れる。
   自分の投稿は自分で押せてしまうため、数字を見るだけの表示にする。 */
function addReactCounters(actions, post) {
  if (post.mine) {
    actions.appendChild(makeReact('done', post.done, false, '完成した数', false));
    actions.appendChild(makeReact('dev',  post.dev,  false, '開発中の数', false));
    actions.appendChild(makeReact('like', post.like, false, 'いいね',     false));
    return;
  }

  const doneBtn = makeReact('done', post.done, post.myDone, '完成した数（クリックで自分の完成を登録）');
  const devBtn  = makeReact('dev',  post.dev,  post.myDev,  '開発中の数（クリックで自分の開発中を登録）');
  const likeBtn = makeReact('like', post.like, post.myLike, 'いいね（このアイデアが欲しい）');

  actions.appendChild(doneBtn);
  actions.appendChild(devBtn);
  actions.appendChild(likeBtn);

  const redraw = () => {
    updateReact(doneBtn, post.done, post.myDone);
    updateReact(devBtn,  post.dev,  post.myDev);
    updateReact(likeBtn, post.like, post.myLike);
  };

  /* 完成 / 開発中 は排他。完成にすると開発中は外れる */
  doneBtn.addEventListener('click', () => {
    const backup = snapshotReaction(post);
    const wasDev = post.myDev;
    const changes = {};

    post.myDone = !post.myDone;
    changes.doneBy = post.myDone ? fb.arrayUnion(myUid) : fb.arrayRemove(myUid);

    if (post.myDone && wasDev) {
      post.myDev = false;
      changes.devBy = fb.arrayRemove(myUid);
    }

    applyCounts(post);
    redraw();
    saveReaction(post, changes, redraw, backup);

    if (post.myDone) { sendNotice(post, 'done'); }
  });

  devBtn.addEventListener('click', () => {
    const backup = snapshotReaction(post);
    const wasDone = post.myDone;
    const changes = {};

    post.myDev = !post.myDev;
    changes.devBy = post.myDev ? fb.arrayUnion(myUid) : fb.arrayRemove(myUid);

    if (post.myDev && wasDone) {
      post.myDone = false;
      changes.doneBy = fb.arrayRemove(myUid);
    }

    applyCounts(post);
    redraw();
    saveReaction(post, changes, redraw, backup);

    /* 「開発中」は相手に通知しない。
       代わりに、loper で仲間を募集する誘いをその場に出す。 */
    if (post.myDev) { showLoperToast(post); }
  });

  /* いいねは完成・開発中とは独立して押せる */
  likeBtn.addEventListener('click', () => {
    const backup = snapshotReaction(post);
    post.myLike = !post.myLike;

    applyCounts(post);
    redraw();
    saveReaction(post,
      { likeBy: post.myLike ? fb.arrayUnion(myUid) : fb.arrayRemove(myUid) },
      redraw, backup);

    if (post.myLike) { sendNotice(post, 'like'); }
  });
}

/* 自分の反応の有無に合わせて、手元のUID一覧と件数を作り直す */
function applyCounts(post) {
  const setMine = (arr, on) => {
    const without = arr.filter((uid) => uid !== myUid);
    return on ? without.concat([myUid]) : without;
  };

  post.likeBy = setMine(post.likeBy, post.myLike);
  post.doneBy = setMine(post.doneBy, post.myDone);
  post.devBy  = setMine(post.devBy,  post.myDev);

  post.like = post.likeBy.length;
  post.done = post.doneBy.length;
  post.dev  = post.devBy.length;
}

/* 押す前の状態を控えておく。保存に失敗したときの戻し先になる。 */
function snapshotReaction(post) {
  return {
    myLike: post.myLike, myDone: post.myDone, myDev: post.myDev,
    likeBy: post.likeBy.slice(), doneBy: post.doneBy.slice(), devBy: post.devBy.slice()
  };
}

/* 反応を保存する。画面はすでに更新済みなので、
   失敗したときだけ押す前の状態に戻す。            */
async function saveReaction(post, changes, redraw, backup) {
  try {
    await fb.updateDoc(fb.doc(fb.db, 'ideas', post.id), changes);
  } catch (e) {
    console.error(e);
    Object.assign(post, backup);
    post.like = post.likeBy.length;
    post.done = post.doneBy.length;
    post.dev  = post.devBy.length;
    redraw();
    alert('反応を保存できませんでした。通信環境を確認してください。');
  }
}

/* interactive に false を渡すと、押せない表示専用の要素を作る */
function makeReact(kind, count, on, label, interactive) {
  const isButton = interactive !== false;
  const el = document.createElement(isButton ? 'button' : 'span');

  if (isButton) { el.type = 'button'; }
  el.className = 'react react-' + kind +
    (on ? ' is-on' : '') +
    (isButton ? '' : ' is-static');
  el.title = label;
  el.setAttribute('aria-label', label + ' ' + count);

  const dot = document.createElement('span');
  dot.className = 'react-dot';
  el.appendChild(dot);

  const num = document.createElement('span');
  num.className = 'react-count';
  num.textContent = count;
  el.appendChild(num);

  return el;
}

function updateReact(btn, count, on) {
  btn.querySelector('.react-count').textContent = count;
  btn.classList.toggle('is-on', on);
}

/* ================= 投稿者のプロフィール =================
   アイコンや名前を押したときに開く。その人の投稿を一覧する。
   並び替えを Firestore 側で行うと複合インデックスが必要になるため、
   取得してから画面側で新しい順に並べている。                     */

function openUserProfile(post) {
  /* 自分の投稿なら、編集できる自分のプロフィールへ */
  if (post.mine) { showView('profile'); return; }

  backView = (currentView === 'user') ? backView : currentView;

  paintAvatarEl(els.userAvatar, post.name, post.color, post.avatar);
  els.userName.textContent = post.name;
  els.userCount.textContent = '読み込み中…';
  els.userFeed.innerHTML = '';

  showView('user');
  loadUserPosts(post.authorUid);
}

async function loadUserPosts(uid) {
  if (!fb || !myUid) { return; }

  try {
    const snap = await fb.getDocs(fb.query(
      fb.collection(fb.db, 'ideas'),
      fb.where('authorUid', '==', uid),
      fb.limit(SEARCH_LIMIT)
    ));

    /* 取得順は不定なので、投稿日時で新しい順に並べ直す */
    const list = snap.docs.map(toPost).sort((a, b) => b.at - a.at);

    els.userCount.textContent = list.length + ' 件のアイデアを投稿しています。';
    paintPosts(els.userFeed, list, 'まだアイデアを投稿していません。');
  } catch (e) {
    console.error(e);
    els.userCount.textContent = '投稿を読み込めませんでした。';
  }
}

/* ================= 検索 =================
   Firestore は本文の部分一致検索ができないため、
   直近 SEARCH_LIMIT 件を取ってきて画面側で絞り込む。 */
function bindSearch() {
  els.searchInput.addEventListener('input', runSearch);
}

async function runSearch() {
  const q = els.searchInput.value.trim().toLowerCase();

  if (!q) {
    els.searchHint.textContent = 'キーワードを入力すると投稿を絞り込みます。';
    els.searchResults.innerHTML = '';
    return;
  }

  if (!fb || !myUid) {
    els.searchHint.textContent = 'サーバーに接続できていません。';
    return;
  }

  if (!searchCache) {
    els.searchHint.textContent = '検索中…';
    try {
      const snap = await fb.getDocs(fb.query(
        fb.collection(fb.db, 'ideas'),
        fb.orderBy('createdAt', 'desc'),
        fb.limit(SEARCH_LIMIT)
      ));
      searchCache = snap.docs.map(toPost);
    } catch (e) {
      console.error(e);
      els.searchHint.textContent = '検索できませんでした。';
      return;
    }
  }

  /* 検索中に入力が変わっていたら、新しい方を優先する */
  if (els.searchInput.value.trim().toLowerCase() !== q) { return; }

  const hits = searchCache.filter((p) =>
    p.text.toLowerCase().includes(q) || p.name.toLowerCase().includes(q)
  );

  els.searchHint.textContent = hits.length + ' 件見つかりました。';
  paintPosts(els.searchResults, hits, '一致する投稿はありません。');
}

/* ================= 単体のアイデア =================
   ?idea=<FirestoreのドキュメントID> で1件だけ開く。
   loper の募集から「元のアイデア」を辿るときや、
   アイデア単体を人に見せるときに使う。              */

/* そのアイデアを指す URL を組み立てる */
function ideaUrl(id) {
  return location.origin + location.pathname + '?idea=' + encodeURIComponent(id);
}

function openIdeaFromUrl() {
  let id = null;
  try {
    id = new URLSearchParams(location.search).get('idea');
  } catch (e) { return; }

  if (!id) { return; }
  openIdeaById(id);
}

async function openIdeaById(id) {
  if (!fb || !myUid) { return; }

  els.ideaFeed.innerHTML = '';
  showView('idea');

  const msg = document.createElement('div');
  msg.className = 'empty';
  msg.textContent = '読み込み中…';
  els.ideaFeed.appendChild(msg);

  try {
    const snap = await fb.getDoc(fb.doc(fb.db, 'ideas', id));

    if (!snap.exists()) {
      msg.textContent = 'このアイデアは見つかりませんでした。' + String.fromCharCode(10) + '削除された可能性があります。';
      msg.style.whiteSpace = 'pre-line';
      return;
    }

    els.ideaFeed.innerHTML = '';
    els.ideaFeed.appendChild(createPost(toPost(snap)));
  } catch (e) {
    console.error(e);
    msg.textContent = 'アイデアを読み込めませんでした。';
  }
}

/* ================= loper への誘い =================
   「開発中」を押した直後にだけ、その投稿の下へ一行出す。
   モーダルにはしない（開発中に切り替えたいだけの人の邪魔になるため）。
   スクロールすれば消え、同じアイデアでは一度きり。            */

/* 本文の1行目を、loper のタイトルとして使える形に整える */
function ideaTitle(text) {
  const first = (text.split(String.fromCharCode(10))[0] || '').trim() || text.trim();
  return first.length > LOPER_TITLE_MAX
    ? first.slice(0, LOPER_TITLE_MAX - 1) + '…'
    : first;
}

/* loper の募集フォームを開く URL を組み立てる */
function loperRecruitUrl(post) {
  const desc = (post.text + String.fromCharCode(10, 10) +
                '元のアイデア: ' + ideaUrl(post.id)).slice(0, LOPER_DESC_MAX);

  return LOPER_URL + '?title=' + encodeURIComponent(ideaTitle(post.text)) +
         '&desc=' + encodeURIComponent(desc);
}

/* 同じアイデアで二度目を出さないよう、出した投稿を覚えておく */
function alreadyInvited(id) {
  return read(KEY_INVITED, []).indexOf(id) !== -1;
}

function rememberInvited(id) {
  const list = read(KEY_INVITED, []);
  list.unshift(id);
  write(KEY_INVITED, list.slice(0, 200));
}

/* 画面右下に出す。表示は1つだけで、しばらくすると勝手に消える。
   読んでいる・押そうとしている最中に消えないよう、
   カーソルを乗せている間は時間を止める。                    */
let toastTimer = null;

function showLoperToast(post) {
  if (alreadyInvited(post.id)) { return; }
  rememberInvited(post.id);

  /* 前のものが残っていれば片付ける */
  const old = document.querySelector('.loper-toast');
  if (old) { old.remove(); }
  clearTimeout(toastTimer);

  const box = document.createElement('div');
  box.className = 'loper-toast';
  box.setAttribute('role', 'status');

  const dot = document.createElement('span');
  dot.className = 'nav-dot dev';
  box.appendChild(dot);

  const body = document.createElement('div');

  const head = document.createElement('div');
  head.className = 'loper-toast-head';
  head.textContent = '開発中にしました';
  body.appendChild(head);

  const line = document.createElement('div');
  line.className = 'loper-toast-line';
  line.appendChild(document.createTextNode('一人では大変ですか？ '));

  const link = document.createElement('a');
  link.href = loperRecruitUrl(post);
  link.target = '_blank';
  link.rel = 'noopener';
  link.textContent = 'loperで仲間を募集する →';
  line.appendChild(link);
  body.appendChild(line);

  box.appendChild(body);
  document.body.appendChild(box);

  /* 追加した直後に付けると滑り込みが起きないので、一拍置く */
  setTimeout(() => box.classList.add('is-open'), 20);

  const hide = () => {
    box.classList.remove('is-open');
    setTimeout(() => box.remove(), 400);
  };

  const startTimer = () => {
    clearTimeout(toastTimer);
    toastTimer = setTimeout(hide, TOAST_MS);
  };

  box.addEventListener('mouseenter', () => clearTimeout(toastTimer));
  box.addEventListener('mouseleave', startTimer);
  /* リンクを押したら役目は終わり */
  link.addEventListener('click', hide);

  startTimer();
}

/* ================= 反応した投稿の一覧 =================
   いいね・開発中・完成のそれぞれについて、自分のUIDが
   入っている投稿を集める。array-contains は単独の絞り込みなので
   複合インデックスは要らないが、並び替えはできないため
   取得してから画面側で新しい順にしている。                    */

const REACTED = {
  liked: { field: 'likeBy', label: 'いいねした投稿' },
  dev:   { field: 'devBy',  label: '開発中の投稿' },
  done:  { field: 'doneBy', label: '完成した投稿' }
};

async function loadReacted(view) {
  const conf = REACTED[view];
  if (!conf || !fb || !myUid) { return; }

  const feed = els[view + 'Feed'];
  const hint = els[view + 'Hint'];
  hint.textContent = '読み込み中…';

  try {
    const snap = await fb.getDocs(fb.query(
      fb.collection(fb.db, 'ideas'),
      fb.where(conf.field, 'array-contains', myUid),
      fb.limit(SEARCH_LIMIT)
    ));

    const list = snap.docs.map(toPost).sort((a, b) => b.at - a.at);
    hint.textContent = list.length + ' 件';
    paintPosts(feed, list, conf.label + 'はまだありません。');
  } catch (e) {
    console.error(e);
    hint.textContent = '読み込めませんでした。';
  }
}

/* ================= 通知 =================
   他人のアイデアに「いいね」「完成」を押すと、
   押した人が投稿者あての通知を作る。
   （「開発中」は通知しない）

   ドキュメントIDを「アイデアID_自分のUID_種類」に固定しているので、
   付け外しを繰り返しても通知は増えず、上書きになる。      */

function noticeId(ideaId, kind) {
  return ideaId + '_' + myUid + '_' + kind;
}

async function sendNotice(post, kind) {
  if (!fb || !myUid || post.mine) { return; }

  try {
    await fb.setDoc(fb.doc(fb.db, 'notifications', noticeId(post.id, kind)), {
      toUid:     post.authorUid,
      fromUid:   myUid,
      fromName:  profile.name || 'name',
      fromColor: profile.color,
      kind:      kind,
      ideaId:    post.id,
      ideaText:  post.text,
      createdAt: fb.serverTimestamp(),
      read:      false
    });
  } catch (e) {
    /* 通知が送れなくても反応自体は成立しているので、画面には出さない */
    console.error(e);
  }
}

/* 自分あての通知を取得する。
   並び替えを Firestore 側で行うと複合インデックスが必要になるため、
   取得後に画面側で新しい順に並べている。                        */
async function loadNotices() {
  if (!fb || !myUid) { return; }

  try {
    const snap = await fb.getDocs(fb.query(
      fb.collection(fb.db, 'notifications'),
      fb.where('toUid', '==', myUid),
      fb.limit(NOTICE_LIMIT)
    ));

    notices = snap.docs.map((d) => {
      const n = d.data();
      return {
        id:        d.id,
        kind:      n.kind,
        fromName:  n.fromName || 'name',
        fromColor: n.fromColor || '#ffffff',
        ideaText:  n.ideaText || '',
        at:        n.createdAt && n.createdAt.toDate ? n.createdAt.toDate() : new Date(0),
        unread:    n.read === false
      };
    }).sort((a, b) => b.at - a.at);
  } catch (e) {
    console.error(e);
    notices = [];
  }

  renderNotices();
}

function noticeLabel(kind) {
  return kind === 'done' ? 'あなたのアイデアを完成させました' : 'あなたのアイデアにいいねしました';
}

function renderNotices() {
  els.noticeList.innerHTML = '';

  if (notices.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty';
    empty.textContent = '通知はまだありません。';
    els.noticeList.appendChild(empty);
    updateBadge();
    return;
  }

  notices.forEach((n) => {
    const row = document.createElement('div');
    row.className = 'notice' + (n.unread ? ' is-unread' : '');

    const icon = document.createElement('span');
    icon.className = 'notice-icon ' + n.kind;
    row.appendChild(icon);

    const body = document.createElement('div');
    body.className = 'notice-body';

    const text = document.createElement('div');
    text.className = 'notice-text';

    const who = document.createElement('span');
    who.className = 'notice-who';
    who.textContent = n.fromName;
    text.appendChild(who);
    text.appendChild(document.createTextNode(' さんが' + noticeLabel(n.kind)));
    body.appendChild(text);

    const idea = document.createElement('div');
    idea.className = 'notice-idea';
    idea.textContent = '「' + shorten(n.ideaText) + '」';
    body.appendChild(idea);

    const date = document.createElement('div');
    date.className = 'notice-date';
    date.textContent = n.at.getTime() ? formatDate(n.at) : '';
    body.appendChild(date);

    row.appendChild(body);
    els.noticeList.appendChild(row);
  });

  updateBadge();
}

function updateBadge() {
  const unread = notices.filter((n) => n.unread).length;
  els.noticeBadge.hidden = unread === 0;
  els.noticeBadge.textContent = unread;
}

/* 通知画面を開いたら既読にする */
async function markNoticesRead() {
  const unread = notices.filter((n) => n.unread);
  if (unread.length === 0 || !fb) { return; }

  unread.forEach((n) => { n.unread = false; });
  renderNotices();

  try {
    await Promise.all(unread.map((n) =>
      fb.updateDoc(fb.doc(fb.db, 'notifications', n.id), { read: true })
    ));
  } catch (e) {
    console.error(e);
  }
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
  bindAvatarPicker();

  els.saveProfile.addEventListener('click', () => {
    profile.name = els.nameInput.value.trim() || 'name';
    write(KEY_PROFILE, profile);
    applyProfile();

    els.avatarNote.textContent = '中央を正方形に切り抜いて縮小して保存します。';
    els.savedMsg.hidden = false;
    setTimeout(() => { els.savedMsg.hidden = true; }, 2000);
  });

  els.clearData.addEventListener('click', () => {
    const msg = 'この端末に保存されている表示名とアイコンを削除します。'
      + String.fromCharCode(10) + '投稿したアイデアは消えません。'
      + String.fromCharCode(10, 10) + 'よろしいですか？';
    if (!confirm(msg)) { return; }

    [KEY_PROFILE, KEY_REPORTS].forEach((k) => {
      try { localStorage.removeItem(k); } catch (e) { /* noop */ }
    });
    location.reload();
  });
}

/* ---- アイコン画像 ---- */
function bindAvatarPicker() {
  els.avatarPick.addEventListener('click', () => els.avatarFile.click());

  els.avatarClear.addEventListener('click', () => {
    profile.avatar = '';
    els.avatarFile.value = '';
    els.avatarNote.textContent = '画像を外しました。保存すると反映されます。';
    previewProfile();
  });

  els.avatarFile.addEventListener('change', async () => {
    const file = els.avatarFile.files && els.avatarFile.files[0];
    if (!file) { return; }

    if (file.type.indexOf('image/') !== 0) {
      els.avatarNote.textContent = '画像ファイルを選んでください。';
      return;
    }
    if (file.size > AVATAR_MAX_IN) {
      els.avatarNote.textContent = 'ファイルが大きすぎます（12MBまで）。';
      return;
    }

    els.avatarNote.textContent = '読み込み中…';

    try {
      const dataUrl = await shrinkImage(file, AVATAR_SIZE, AVATAR_QUALITY);

      if (dataUrl.length > AVATAR_MAX_OUT) {
        els.avatarNote.textContent = 'この画像は保存できませんでした。別の画像でお試しください。';
        return;
      }

      profile.avatar = dataUrl;
      els.avatarNote.textContent = '画像を読み込みました。保存すると反映されます。';
      previewProfile();
    } catch (e) {
      console.error(e);
      els.avatarNote.textContent = '画像を読み込めませんでした。別の画像でお試しください。';
    }
  });
}

/* 画像の中央を正方形に切り抜き、size×size に縮小して
   データURL（文字列）にする。この文字列をそのまま保存する。 */
function shrinkImage(file, size, quality) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onerror = () => reject(new Error('ファイルを読めません'));
    reader.onload = () => {
      const img = new Image();

      img.onerror = () => reject(new Error('画像として読めません'));
      img.onload = () => {
        try {
          const canvas = document.createElement('canvas');
          canvas.width = size;
          canvas.height = size;

          const ctx = canvas.getContext('2d');
          /* 短い辺を基準に中央を切り抜く（縦横比を崩さない） */
          const side = Math.min(img.width, img.height);
          const sx = (img.width - side) / 2;
          const sy = (img.height - side) / 2;
          ctx.drawImage(img, sx, sy, side, side, 0, 0, size, size);

          resolve(canvas.toDataURL('image/jpeg', quality));
        } catch (e) {
          reject(e);
        }
      };

      img.src = reader.result;
    };

    reader.readAsDataURL(file);
  });
}

/* 入力中の内容を、サイドバー・投稿欄・プロフィール画面に映す */
function previewProfile() {
  paintProfile(els.nameInput.value.trim() || 'name', profile.color);
}

function paintProfile(name, color) {
  [els.myAvatar, els.composerAvatar, els.profileAvatar].forEach((el) => {
    paintAvatarEl(el, name, color, profile.avatar);
  });
  els.myName.textContent = name;
  els.profilePreviewName.textContent = name;
  els.avatarClear.hidden = !profile.avatar;
}

function applyProfile() {
  els.nameInput.value = profile.name === 'name' ? '' : profile.name;
  paintProfile(profile.name, profile.color);
  highlightSwatch();
}

/* ================= 動作確認用 =================
   ブラウザの開発者コンソールで seedIdeas() と打つと、
   ダミーのアイデアをまとめて投稿できる。
   ※ 投稿者は実行した人のUIDになるため、これらは
     「自分の投稿」として表示される。他人の投稿として
     試したいときは、別のブラウザ（シークレットウィンドウ）
     から実行すること。                                    */
window.seedIdeas = async function () {
  const samples = [
    '最強のローカルLLMほしいです',
    '誰かUnrealのを日本語表記にするやつ作ってくれ',
    'Discordの通知をまとめて要約してくれるBotがほしい',
    'Gitのコミットメッセージを自動で日本語にするCLIツール',
    'スマホで撮ったホワイトボードの写真を、きれいなMarkdownに変換するアプリ',
    '積みゲー管理アプリ。積んだ日数とクリア率が見えると罪悪感で進むと思う。',
    'ドット絵を1枚描いたら、歩行アニメのコマを自動生成してくれるやつ',
    '個人開発の進捗を晒すだけのSNSが欲しい',
    'タブが増えすぎたときに自動でグループ分けしてくれるブラウザ拡張',
    'レシートを撮るだけで全部入力してくれる家計簿アプリ'
  ];

  if (!fb || !myUid) { console.warn('まだ接続できていません'); return; }

  for (const text of samples) {
    await fb.addDoc(fb.collection(fb.db, 'ideas'), {
      authorUid:   myUid,
      authorName:  profile.name || 'name',
      authorColor: profile.color,
      authorAvatar: profile.avatar || '',
      text:        text,
      createdAt:   fb.serverTimestamp(),
      likeBy:      [],
      doneBy:      [],
      devBy:       []
    });
  }

  console.log(samples.length + ' 件のダミー投稿を作成しました');
  reloadFeed();
};
