"use strict";
/**
 * ソース定義。ソースの追加・変更・削除はこのファイルだけを直す（NFR-T-08）。
 *
 * feed の可用性は 2026-08-02 に実際に curl / fetch して検証済み。
 * 検証結果は各行のコメントに残してあるので、次に触る人は再調査しなくてよい。
 */

const SOURCES = [
  // ── ドローン ────────────────────────────────────────────────
  // 2026-08-02 検証：200 / application/rss+xml / 15件。週13本前後。
  { domain: "ドローン", name: "DRONE.jp", feed: "https://drone.jp/feed" },

  // 2026-08-02 検証：ドメインは dronepress.jp ではなく www.drone-press.jp（運営：レビジョン）。
  //   dronepress.jp は接続タイムアウトで存在しない。200 / text/xml / 15件。
  //   更新は低頻度（7日で1本）なので 0件の日が多い。リード末尾に「>>続きを読む」が付く。
  { domain: "ドローン", name: "ドローンプレス", feed: "https://www.drone-press.jp/feed" },

  // 2026-08-02 検証：インプレス系。RSSは非標準パスで、トップHTMLの
  //   <link rel="alternate" type="application/rdf+xml"> から発見した。
  //   形式は RDF（RSS 1.0）。日付は <dc:date>、本文は <description> の CDATA。200 / 15件。
  { domain: "ドローン", name: "ドローンジャーナル", feed: "https://drone-journal.impress.co.jp/data/rss/1.0/drone/feed.rdf" },

  // 2026-08-02 検証：/cms/feed は 200 を返すが中身はコメント用フィードで 0件。罠なので使わない。
  //   正しくは /news/feed（200 / 10件）。更新は月1回程度なので 0件の日が大半。
  { domain: "ドローン", name: "KDDIスマートドローン", feed: "https://kddi.smartdrone.co.jp/news/feed" },

  // ── AI技術 ──────────────────────────────────────────────────
  // Perplexity Discover は日替わりで固定URLがなく自動取得できないため、
  // Google News RSS で代替することが確定済み（要件定義書 4章・SKILL.md 1.5節）。
  // 2026-08-02 検証：200 / 52件（24時間内）。
  // なお description は見出しの複製なので、リードは build.js 側で捨てられ見出しのみになる。
  { domain: "AI技術", name: "AI技術動向（Google News）",
    feed: "https://news.google.com/rss/search?q=AI+%E6%8A%80%E8%A1%93+when:1d&hl=ja&gl=JP&ceid=JP:ja" },

  // ── 世界情勢 ────────────────────────────────────────────────
  // 2026-08-02 検証：Reuters の公開RSSは全滅。
  //   https://www.reuters.com/arc/outboundfeeds/rss/?outputType=xml → 404
  //   https://www.reuters.com/tools/rss , https://jp.reuters.com/       → 401（bot遮断）
  //   http://feeds.reuters.com/Reuters/worldNews                        → DNS消滅
  // → Google News の site: 指定で代替。
  //
  // site: の指定先を jp.reuters.com 全体ではなく /world に絞ってある。理由：
  //   全体だと24時間で100件取れるが、中身はゴルフ・サッカーの結果と
  //   「2HL.DE」のような株価ページが大半を占め、5件枠がそれで埋まってしまう。
  //   /world に絞ると24時間で7件・48時間で42件、すべて国際情勢の記事になる
  //   （イラン、ウクライナ、紅海、ウイグルなど）。この分野は面接で最も効くので精度を優先した。
  { domain: "世界情勢", name: "Reuters（Google News経由）",
    feed: "https://news.google.com/rss/search?q=site:jp.reuters.com/world+when:1d&hl=ja&gl=JP&ceid=JP:ja" },

  // ── 国内政治 ────────────────────────────────────────────────
  // 要件定義書のソース定義は cat0.xml（主要）だったが、2026-08-02 検証で cat0 の中身は
  // 熱中症・地震などの一般トップニュースで政治記事がほぼ入らないことを確認した。
  // 分野名「国内政治」と中身を一致させるため cat4（政治）に変更（ユーザー確認済み）。
  // 200 / 89件 / 24時間内6件。リードは良質。
  { domain: "国内政治", name: "NHKニュース 政治", feed: "https://www3.nhk.or.jp/rss/news/cat4.xml" },

  // ── 物価・株価 ──────────────────────────────────────────────
  // 2026-08-02 検証：200 / 68件 / 24時間内3件。仕様どおり。
  { domain: "物価・株価", name: "NHKニュース 経済", feed: "https://www3.nhk.or.jp/rss/news/cat5.xml" },
];

/**
 * ノイズ除外リスト。
 *
 * Google News は「ニュースではないページ」を平気で混ぜてくる。2026-08-02 の実測では
 * 機械翻訳された海外メディア、株価の銘柄ページ、求人広告が上位に入っていた。
 * 25件しか出さない設計なので、1件のゴミが1件の読む価値のある記事を押し出す。
 *
 * 消したい媒体・見出しが出てきたらここに足す。build.js は触らなくてよい。
 */
const EXCLUDE_PUBLISHERS = [
  "Vietnam.vn",        // ベトナム語サイトの機械翻訳
  "벤처스퀘어",           // 韓国語サイトの機械翻訳
  "jp.news.cn",        // 新華社日本語版
  "BigGo",             // 商品価格比較サイト
  "マイナビスカウティング",  // 求人広告
];

const EXCLUDE_TITLE_PATTERNS = [
  /Stock Price/i,                    // 「TTEK.O - | Stock Price & Latest News」形式の銘柄ページ
  /^[A-Z0-9][A-Z0-9.^%_-]{1,13}$/,   // 「2HL.DE」「RJIUF.PK」のような裸のティッカー
  /求人|転職|中途採用/,                 // 求人広告
];

/** 分野の固定表示順（FR-T-05）。この順に上から並ぶ。 */
const DOMAIN_ORDER = ["ドローン", "AI技術", "世界情勢", "国内政治", "物価・株価"];

/** 分野色。夏休みダイヤと同系統（SKILL.md 4節）。 */
const DOMAIN_COLORS = {
  "ドローン": "#6EE07A",
  "AI技術": "#B088F7",
  "世界情勢": "#4BA6F0",
  "国内政治": "#FFB13D",
  "物価・株価": "#F5D76E",
};

/**
 * 件数上限（FR-T-06）。
 * 読み切れない号が続くと習慣そのものが壊れるので、迷ったら減らす方向に倒す。
 */
const MAX_PER_DOMAIN = 5;
const MAX_TOTAL = 25;

/** 取得タイムアウト（FR-T-02）。 */
const FETCH_TIMEOUT_MS = 10_000;

/** 期間フィルタ（FR-T-03）。月曜だけ土日分を拾うため72時間に広げる。 */
const WINDOW_HOURS = 24;
const WINDOW_HOURS_MONDAY = 72;

/** 自動取得できないソースへの導線（FR-T-10）。 */
const PERPLEXITY_DISCOVER_URL = "https://www.perplexity.ai/discover";

module.exports = {
  SOURCES,
  EXCLUDE_PUBLISHERS,
  EXCLUDE_TITLE_PATTERNS,
  DOMAIN_ORDER,
  DOMAIN_COLORS,
  MAX_PER_DOMAIN,
  MAX_TOTAL,
  FETCH_TIMEOUT_MS,
  WINDOW_HOURS,
  WINDOW_HOURS_MONDAY,
  PERPLEXITY_DISCOVER_URL,
};
