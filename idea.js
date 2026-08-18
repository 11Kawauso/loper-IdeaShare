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

/* 無限スクロールで一度に追加する件数と、
   末尾がこの距離まで近づいたら次を読み込む（px） */
const PAGE_SIZE    = 10;
const LOAD_MARGIN  = 300;

const AVATAR_COLORS = [
  '#ffffff', '#6fd3e2', '#35d43f', '#d6c62c',
  '#f98080', '#c79bf0', '#8fa8ff', '#ffb26b'
];

let posts   = [];
let notices = [];
let profile = { name: 'name', color: '#ffffff' };
let prefs   = { showAds: true };
let currentView = 'home';
let feedShown   = 0;   /* フィードに描画済みの件数 */

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
  setupInfiniteScroll();
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
  els.feedEnd        = document.getElementById('feedEnd');
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
  const stored = read(KEY_POSTS, null);
  notices = read(KEY_NOTICES, []);
  profile = Object.assign({ name: 'name', color: '#ffffff' }, read(KEY_PROFILE, {}));
  prefs   = Object.assign({ showAds: true }, read(KEY_PREFS, {}));

  let savedSignature = null;
  try { savedSignature = localStorage.getItem(KEY_SEEDED); } catch (e) { /* noop */ }

  const signature = seedSignature();

  if (!Array.isArray(stored)) {
    /* 初回アクセス */
    posts = seedPosts();
  } else if (savedSignature !== signature) {
    /* ダミー投稿の内容が変わっている（＝サイトを更新した）。
       古いダミーが残ったままにならないよう作り直す。 */
    posts = refreshSeed(stored.map(normalizePost));
  } else {
    posts = stored.map(normalizePost);
  }

  if (savedSignature !== signature) {
    write(KEY_POSTS, posts);
    try { localStorage.setItem(KEY_SEEDED, signature); } catch (e) { /* noop */ }
  }
}

/* ダミー投稿の中身から作る短い識別子。
   SEED_DATA を書き換えると自動的に変わるので、
   バージョン番号を手で上げる必要がない。            */
function seedSignature() {
  const src = JSON.stringify(SEED_DATA) + JSON.stringify(NAMES);
  let hash = 0;
  for (let i = 0; i < src.length; i++) {
    hash = (hash * 31 + src.charCodeAt(i)) | 0;
  }
  return 'seed' + hash;
}

/* ダミー投稿を新しいものに入れ替える。
   自分の投稿と、自分が押した反応は引き継ぐ。 */
function refreshSeed(oldPosts) {
  const mine   = oldPosts.filter((p) => p.mine);
  const before = new Map(oldPosts.map((p) => [p.text, p]));

  const fresh = seedPosts().map((post) => {
    const old = before.get(post.text);
    if (!old) { return post; }

    /* 保存されている件数には自分のぶんが含まれていないので、
       押していた反応は +1 して復元する */
    if (old.myDone) { post.myDone = true; post.done += 1; }
    if (old.myDev)  { post.myDev  = true; post.dev  += 1; }
    if (old.myLike) { post.myLike = true; post.like += 1; }
    return post;
  });

  return mine.concat(fresh);
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

/* ================= ダミー投稿 =================
   本番では Firestore から取得する部分。
   投稿者の名前・色は NAMES から番号で参照する。         */

const NAMES = [
  ['ルナ｜個人開発', '#ffffff'], ['たかし', '#ffffff'],     ['みなと', '#8fa8ff'],
  ['あおい', '#c79bf0'],        ['けんと', '#ffb26b'],     ['さくら', '#f98080'],
  ['こう', '#6fd3e2'],          ['ゆい', '#35d43f'],       ['そうた', '#d6c62c'],
  ['りん', '#ff4d63'],          ['はると', '#8fa8ff'],     ['なぎ', '#ffffff'],
  ['しおり', '#c79bf0'],        ['とうま', '#ffb26b'],     ['めい', '#f98080'],
  ['かえで', '#35d43f'],        ['ゆうき', '#6fd3e2'],     ['あさひ', '#8fa8ff'],
  ['のぞみ', '#d6c62c'],        ['ちひろ', '#c79bf0']
];

/* [投稿者, 本文, 何時間前, 完成, 開発中, いいね, コメント] */
const SEED_DATA = [
  [0, '最強のローカルLLMほしいです', 0, 1, 4, 27,
    [[6, '量子化すればノートPCでも動きますよ'], [1, 'メモリどれくらい要りますか？']]],
  [1, '誰かUnrealのを日本語表記にするやつ作ってくれ', 3, 0, 6, 41,
    [[0, 'ブループリントのノード名だけでも需要ありそう']]],
  [2, 'Discordの通知をまとめて要約してくれるBotがほしい。\n未読が溜まると追うのが大変なので。', 22, 3, 2, 18, []],
  [3, 'Gitのコミットメッセージを自動で日本語にするCLIツール', 33, 2, 1, 12,
    [[2, 'それ普通にほしい']]],
  [4, 'スマホで撮ったホワイトボードの写真を、きれいなMarkdownに変換するアプリ', 50, 5, 3, 33, []],
  [5, '積みゲー管理アプリ。積んだ日数とクリア率が見えると罪悪感で進むと思う。', 84, 1, 0, 9, []],
  [7, 'Unityで買ったまま使ってないアセットを一覧にしてくれるツールがほしい', 96, 2, 5, 38,
    [[13, '課金額まで出ると泣きそう']]],
  [8, 'ドット絵を1枚描いたら、歩行アニメのコマを自動生成してくれるやつ', 104, 4, 7, 62, []],
  [9, '個人開発の進捗を晒すだけのSNSが欲しい。完成しなくても許される場所。', 112, 1, 3, 55,
    [[0, 'それこのサイトでは？'], [9, '言われてみれば']]],
  [10, '動画に音声を入れると、字幕とテロップを自動で付けてくれる編集ツール', 126, 6, 4, 47, []],
  [11, 'タブが増えすぎたときに自動でグループ分けしてくれるブラウザ拡張', 138, 8, 2, 29, []],
  [12, '学生向けの時間割アプリ。既存のは広告が多すぎて使う気になれない。', 150, 3, 6, 44,
    [[17, '通知だけでいいから軽いのが欲しい']]],
  [13, 'ゲーム実況の録画から、盛り上がった場面だけ切り抜いてくれるAI', 163, 0, 9, 71, []],
  [14, 'VRChatのワールドをスマホから下見できるサイト', 175, 1, 2, 23, []],
  [15, '締め切りを入れると、勝手に逆算してタスクを刻んでくれるアプリ', 188, 5, 3, 36, []],
  [16, 'RPGツクールの無料素材をまとめて検索できるサイトがほしい', 199, 2, 4, 31,
    [[4, 'ライセンス表記でも絞れると神']]],
  [17, '書いたコードの解説を音声で読み上げてくれるやつ。通学中に復習したい。', 212, 1, 1, 19, []],
  [18, 'レシートを撮るだけで全部入力してくれる家計簿アプリ', 224, 7, 3, 40, []],
  [19, 'Steamのウィッシュリストが値下げされたら通知してくれるやつ、誰か作ってない？', 236, 9, 1, 52,
    [[8, '公式にもあるけど通知が来ないんですよね']]],
  [0, '3Dモデルを読み込むと、自動でポリゴン数を減らしてくれるWebツール', 249, 3, 5, 34, []],
  [2, '個人開発したアプリを晒して感想をもらえる場所がほしい', 261, 2, 2, 26, []],
  [4, '寝落ちを検知して勝手に止まってくれる動画プレイヤー作ってほしい', 273, 4, 2, 58,
    [[15, '毎朝バッテリーが死んでるので切実']]],
  [6, '環境構築の手順を書くと、そのままDockerfileにしてくれるやつ', 286, 6, 4, 37, []],
  [8, 'ゲームジャム用に、お題をランダムで出してくれるサイト', 298, 11, 2, 45, []],
  [10, '読んだ技術書の内容をカード化して、あとで復習できるアプリ', 311, 3, 3, 28, []],
  [12, '配信のコメントを翻訳して読み上げてくれるツール', 323, 2, 6, 39, []],
  [14, '画像からフォントを判別してくれるサイト、日本語対応のやつ', 336, 5, 1, 33, []],
  [16, '自分が書いたコード量の成長がグラフで見えるやつ', 348, 8, 2, 24, []],
  [18, 'Blenderのショートカットを練習できるゲーム', 361, 1, 4, 42,
    [[3, 'タイピングゲームみたいな感じで欲しい']]],
  [1, '一人用のスクラム管理アプリ。チーム用のは重すぎる。', 373, 4, 3, 30, []],
  [3, '音ゲーの譜面を自作して共有できるサイト', 386, 2, 7, 49, []],
  [5, '通学中に見るだけで英単語を覚えられる縦型動画を、自動生成するやつ', 398, 0, 3, 27, []],
  [7, '絵の練習記録を残して、上達が目に見えるアプリ', 411, 6, 2, 35,
    [[13, '比較スライダーがあると嬉しい']]],
  [9, '誰かMinecraftの建築を自動で採寸してくれるMod作って', 423, 1, 1, 21, []],
  [11, '部屋を撮ると家具の配置を提案してくれるアプリ', 436, 3, 4, 32, []],
  [13, 'アイデアを話すだけで仕様書にしてくれるツール', 448, 2, 8, 66, []],
  [15, 'GitHubのIssueをカンバンで見られる、とにかく軽いサイト', 461, 7, 2, 38, []],
  [17, '効果音を口で言うと、近い音を探してくれる検索エンジン', 473, 1, 5, 57,
    [[5, '「ドゥーン」で検索したい']]],
  [19, 'サークルのシフト調整、LINEだけで完結してほしい', 486, 5, 1, 22, []],
  [0, 'ノベルゲームのシナリオを分岐図で書けるエディタ', 498, 4, 6, 51, []],
  [2, '自分の声を学習して、ナレーションにしてくれるやつ', 511, 2, 3, 43, []],
  [4, 'プログラミング初心者用の、エラーメッセージ翻訳サイト', 523, 12, 2, 68,
    [[16, 'これ本当に最初の壁だと思う']]],
  [6, '撮りためた写真から、自動でVlogに繋いでくれるアプリ', 536, 3, 4, 29, []],
  [8, '個人開発の収益を晒し合う掲示板', 548, 6, 1, 25, []],
  [10, 'ゲームのセーブデータをクラウド同期する汎用ツール', 561, 2, 3, 31, []],
  [12, '手書きの数式を読み取ってLaTeXにしてくれるやつ', 573, 9, 2, 46, []],
  [14, '積んだ技術書を管理して、読む順番まで提案してくれるアプリ', 586, 1, 2, 20, []],
  [16, '日本語のフリーフォントだけ集めたサイトが欲しい', 598, 4, 1, 37,
    [[11, '商用可かどうかで絞れると助かる']]]
];

function seedPosts() {
  /* 「今」に依存しない基準日時から、各投稿の日時を逆算する */
  const base = new Date(2026, 7, 17, 21, 40);

  return SEED_DATA.map((row, i) => {
    const author = NAMES[row[0]];
    return {
      id:     2000 + (SEED_DATA.length - i),
      name:   author[0],
      color:  author[1],
      text:   row[1],
      date:   formatDate(new Date(base.getTime() - row[2] * 3600000)),
      done:   row[3],
      dev:    row[4],
      like:   row[5],
      myDone: false,
      myDev:  false,
      myLike: false,
      comments: row[6].map((c) => ({
        name:  NAMES[c[0]][0],
        color: NAMES[c[0]][1],
        text:  c[1]
      })),
      mine: false
    };
  });
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

  if (view === 'home')   { fillFeed(); }
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

/* ================= フィード描画 =================
   フィードは PAGE_SIZE 件ずつ描画し、末尾（feedEnd）が
   画面に入ったら続きを追加する（無限スクロール）。     */

function renderFeed(keepShown) {
  /* keepShown = true のときは、いま表示している件数を保ったまま描き直す。
     削除のあとに先頭まで戻ってしまうのを防ぐため。 */
  const want = Math.min(keepShown ? Math.max(feedShown, PAGE_SIZE) : PAGE_SIZE, posts.length);

  els.feed.innerHTML = '';
  feedShown = 0;

  if (posts.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty';
    empty.style.whiteSpace = 'pre-line';
    empty.textContent = 'まだアイデアが投稿されていません。\n最初の投稿者になりましょう。';
    els.feed.appendChild(empty);
  } else {
    appendPosts(want);
  }

  updateFeedEnd();
  fillFeed();
  if (currentView === 'search') { runSearch(); }
}

/* 続きを count 件ぶん追加する（すでに描画済みのものは触らない） */
function appendPosts(count) {
  const next = posts.slice(feedShown, feedShown + count);
  const frag = document.createDocumentFragment();
  next.forEach((post) => frag.appendChild(createPost(post)));
  els.feed.appendChild(frag);
  feedShown += next.length;
  updateFeedEnd();
}

function updateFeedEnd() {
  if (posts.length === 0) {
    els.feedEnd.textContent = '';
    return;
  }
  els.feedEnd.textContent = feedShown < posts.length
    ? '読み込み中…'
    : 'すべての投稿を表示しました';
}

/* 末尾が画面に近づいている間、続きを読み込む。
   1回の描画で画面が埋まらない場合もあるので、埋まるまで繰り返す。
   （IntersectionObserver は描画が止まっている環境で発火しないことが
     あるため、確実に動くスクロール位置の判定を使っている）        */
function fillFeed() {
  if (currentView !== 'home') { return; }

  /* 想定外の状況で無限ループにならないよう回数を制限する */
  for (let guard = 0; guard < 50; guard++) {
    if (feedShown >= posts.length) { return; }
    const top = els.feedEnd.getBoundingClientRect().top;
    if (top > window.innerHeight + LOAD_MARGIN) { return; }
    appendPosts(PAGE_SIZE);
  }
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

  fillFeed();
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

  addReactCounters(actions, post);

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
      renderFeed(true);
    });
    actions.appendChild(del);
  }

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
    if (post.myLike) {
      addNotice('like', '「' + shorten(post.text) + '」にいいねしました。');
    }
  });
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
