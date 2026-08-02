"use strict";
/**
 * 朝ニュース 生成スクリプト
 *
 * 使い方: node news/build.js
 *
 * 外部ライブラリは使わない（NFR-T-09「RSSパーサ1つまで」→ 0個で満たす）。
 * APIキーもLLMも使わない（NFR-T-01 / NFR-T-06）。
 * 1つのソースが落ちても全体を止めない（NFR-T-03）。失敗は握りつぶさず画面に出す（FR-T-09）。
 */

const fs = require("fs");
const path = require("path");
const {
  SOURCES,
  EXCLUDE_PUBLISHERS,
  EXCLUDE_TITLE_PATTERNS,
  DOMAIN_ORDER,
  MAX_PER_DOMAIN,
  MAX_TOTAL,
  FETCH_TIMEOUT_MS,
  WINDOW_HOURS,
  WINDOW_HOURS_MONDAY,
} = require("./sources.js");
const { renderPage } = require("./template.js");

const OUT_DIR = __dirname;
const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

// ───────────────────────── 日付（JST） ─────────────────────────
// 生成はUTC 20:30（＝JST翌05:30）に走るので、日付は必ずJSTで判定する。

/** JSTの壁時計を UTC メソッドで読めるようずらした Date を返す。 */
function toJst(ms) {
  return new Date(ms + JST_OFFSET_MS);
}

function jstDateString(ms) {
  return toJst(ms).toISOString().slice(0, 10); // YYYY-MM-DD
}

const WEEKDAY_JA = ["日", "月", "火", "水", "木", "金", "土"];

function jstDisplayDate(ms) {
  const d = toJst(ms);
  return `${d.getUTCFullYear()}年${d.getUTCMonth() + 1}月${d.getUTCDate()}日(${WEEKDAY_JA[d.getUTCDay()]})`;
}

/** 記事の時刻表示。JSTの HH:MM。 */
function jstTime(ms) {
  const d = toJst(ms);
  return `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
}

// ───────────────────────── 取得 ─────────────────────────

/**
 * Content-Type か XML宣言から文字コードを判定してデコードする（NFR-T-10）。
 * Shift_JIS のフィードが混ざっても壊れないようにする。
 */
function decodeBody(buffer, contentType) {
  const bytes = new Uint8Array(buffer);
  let charset = (String(contentType || "").match(/charset=["']?([\w-]+)/i) || [])[1];
  if (!charset) {
    // XML宣言は必ずASCII互換の範囲に収まるので latin1 で覗いてよい
    const head = Buffer.from(bytes.slice(0, 300)).toString("latin1");
    charset = (head.match(/encoding=["']([\w-]+)["']/i) || [])[1] || "utf-8";
  }
  try {
    return new TextDecoder(charset).decode(bytes);
  } catch {
    return new TextDecoder("utf-8").decode(bytes);
  }
}

/** タイムアウト付きの取得（FR-T-02）。 */
async function fetchFeed(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      redirect: "follow",
      headers: {
        // UAを名乗らないと弾く配信元があるため
        "user-agent": "morning-news/1.0 (+https://github.com/)",
        accept: "application/rss+xml, application/rdf+xml, application/atom+xml, application/xml, text/xml;q=0.9, */*;q=0.8",
      },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return decodeBody(await res.arrayBuffer(), res.headers.get("content-type"));
  } finally {
    clearTimeout(timer);
  }
}

// ───────────────────────── パース ─────────────────────────
// RSS 2.0 / RDF(RSS 1.0) / Atom の3形式に対応する。
// 検証済み: DRONE.jp・ドローンプレス・KDDI・NHK(RSS2.0) / ドローンジャーナル(RDF) / Google News(RSS2.0)

const NAMED_ENTITIES = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ",
};

function decodeEntities(s) {
  return String(s)
    .replace(/&#(\d+);/g, (_, d) => safeCodePoint(Number(d)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => safeCodePoint(parseInt(h, 16)))
    .replace(/&([a-zA-Z]+);/g, (m, n) => (n in NAMED_ENTITIES ? NAMED_ENTITIES[n] : m));
}

function safeCodePoint(n) {
  try {
    return String.fromCodePoint(n);
  } catch {
    return "";
  }
}

/** ブロックから <tag>...</tag> の中身を取り出す。CDATAとエンティティを解く。 */
function pick(block, tagName) {
  const re = new RegExp(`<${tagName}(?:\\s[^>]*)?\\s*/?>([\\s\\S]*?)</${tagName}>`, "i");
  const m = block.match(re);
  if (!m) return "";
  let v = m[1].trim();
  const cdata = v.match(/^<!\[CDATA\[([\s\S]*?)\]\]>$/);
  if (cdata) v = cdata[1];
  return decodeEntities(v).trim();
}

/** Atom の <link href="..."/>。rel="alternate" を優先する。 */
function pickAtomLink(block) {
  const links = block.match(/<link\b[^>]*>/gi) || [];
  let fallback = "";
  for (const tag of links) {
    const href = (tag.match(/href=["']([^"']+)["']/i) || [])[1];
    if (!href) continue;
    const rel = (tag.match(/rel=["']([^"']+)["']/i) || [])[1];
    if (!rel || rel.toLowerCase() === "alternate") return decodeEntities(href);
    if (!fallback) fallback = decodeEntities(href);
  }
  return fallback;
}

/**
 * フィード本文から記事を取り出す。
 * 返すのは { title, link, rawLead, dateMs, publisher } の配列。
 */
function parseFeed(xml) {
  let blocks = xml.match(/<item(?:\s[^>]*)?>[\s\S]*?<\/item>/gi) || [];
  let isAtom = false;
  if (blocks.length === 0) {
    blocks = xml.match(/<entry(?:\s[^>]*)?>[\s\S]*?<\/entry>/gi) || [];
    isAtom = blocks.length > 0;
  }

  const items = [];
  for (const block of blocks) {
    const title = pick(block, "title");
    if (!title) continue;

    // RDF は <link> が本文、RSS2.0 も <link>。Atom は href 属性。
    let link = pick(block, "link");
    if (!link && isAtom) link = pickAtomLink(block);
    if (!link) link = pickAtomLink(block);
    if (!link) continue;

    const dateText =
      pick(block, "pubDate") ||
      pick(block, "dc:date") ||
      pick(block, "updated") ||
      pick(block, "published") ||
      pick(block, "date");
    const dateMs = dateText ? Date.parse(dateText) : NaN;

    const rawLead =
      pick(block, "description") ||
      pick(block, "summary") ||
      pick(block, "content:encoded") ||
      pick(block, "content");

    // Google News は <source url="...">媒体名</source> で実際の発信元を教えてくれる
    const publisher = pick(block, "source");

    items.push({ title, link, rawLead, dateMs, publisher });
  }
  return items;
}

// ───────────────────────── リード整形（FR-T-06b） ─────────────────────────

const LEAD_MAX_CHARS = 100; // 全角100字
const LEAD_MIN_CHARS = 20;  // これ未満はリードなし扱い

/** HTMLタグを落とし、エンティティを解き、空白を潰す。 */
function stripHtml(html) {
  // <script>/<style> は中身ごと捨てる
  let s = String(html)
    .replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, " ")
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<\/(p|div|li|h[1-6])>/gi, " ")
    .replace(/<[^>]*>/g, " ");
  // 実体参照が二重にエスケープされている配信元があるので2回解く
  s = decodeEntities(decodeEntities(s));
  // 解いた結果またタグが現れたら落とす（&lt;a href=...&gt; のケース）
  s = s.replace(/<[^>]*>/g, " ");
  // ゼロ幅スペース・BOM は見えないのに字数を食うので落とす
  return s.replace(/[​-‍﻿]/g, "").replace(/\s+/g, " ").trim();
}

/** 比較用に空白と記号のゆれを落とす。 */
function normalizeForCompare(s) {
  return String(s).replace(/[\s　]/g, "").replace(/[［］\[\]「」【】（）()･・…]/g, "");
}

/** Google News の「見出し - 媒体名」から媒体名の尻尾を落とす。 */
function stripPublisherSuffix(title, publisher) {
  if (!publisher) return title;
  const re = new RegExp(`\\s*[-–—]\\s*${publisher.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*$`);
  return title.replace(re, "").trim() || title;
}

/**
 * 表示に使うリードを作る。使えないと判断したら空文字を返す（＝見出しのみ・欠落を詫びない）。
 *
 * 捨てる条件は3つ。
 *  1. タグを落としたら20字未満（Google News の description はリンクの羅列になることがある）
 *  2. 見出しの複製（Google News は description が「見出し＋媒体名」で中身がない）
 *  3. 空
 */
function buildLead(rawLead, title) {
  let lead = stripHtml(rawLead);
  if (!lead) return "";

  // 配信元が付ける「続きを読む」系の定型句を落とす
  lead = lead
    .split(/(?:>>|＞＞|»|≫)\s*続きを読む/)[0]
    .replace(/この記事の続き.*$/, "")
    .replace(/(?:\[|［)?続きを読む(?:\]|］)?.*$/, "")
    .replace(/Continue reading.*$/i, "")
    .trim();

  if (Array.from(lead).length < LEAD_MIN_CHARS) return "";

  // 見出しの複製なら出す意味がない
  const nLead = normalizeForCompare(lead);
  const nTitle = normalizeForCompare(title);
  if (nTitle && (nLead.includes(nTitle) || nTitle.includes(nLead))) return "";

  const chars = Array.from(lead);
  if (chars.length > LEAD_MAX_CHARS) {
    return chars.slice(0, LEAD_MAX_CHARS).join("") + "…";
  }
  return lead;
}

// ───────────────────────── ノイズ除外 ─────────────────────────

/**
 * ニュースではないものを落とす。除外条件は sources.js に集約してある（NFR-T-08）。
 * 25件しか出さないので、ゴミ1件は読む価値のある記事1件を押し出すことになる。
 */
function isNoise(title, publisher) {
  const p = String(publisher || "");
  if (EXCLUDE_PUBLISHERS.some((x) => p.toLowerCase().includes(x.toLowerCase()))) return true;
  return EXCLUDE_TITLE_PATTERNS.some((re) => re.test(title));
}

// ───────────────────────── 重複排除（FR-T-04） ─────────────────────────

const TRACKING_PARAMS = /^(utm_|ref$|ref_|fbclid$|gclid$|yclid$|mc_cid$|mc_eid$|oc$|cmpid$|spm$)/i;

function normalizeUrl(url) {
  try {
    const u = new URL(url);
    u.hash = "";
    u.hostname = u.hostname.toLowerCase().replace(/^www\./, "");
    for (const key of [...u.searchParams.keys()]) {
      if (TRACKING_PARAMS.test(key)) u.searchParams.delete(key);
    }
    u.protocol = "https:";
    let s = u.toString();
    if (s.endsWith("/")) s = s.slice(0, -1);
    return s;
  } catch {
    return String(url).trim();
  }
}

// ───────────────────────── 本体 ─────────────────────────

async function collect() {
  const nowMs = Date.now();
  const jstWeekday = toJst(nowMs).getUTCDay(); // 0=日, 1=月
  const windowHours = jstWeekday === 1 ? WINDOW_HOURS_MONDAY : WINDOW_HOURS;
  const cutoffMs = nowMs - windowHours * 60 * 60 * 1000;

  // 全ソースを並列取得。1つの失敗で全体を止めない（NFR-T-02 / NFR-T-03）
  const settled = await Promise.allSettled(
    SOURCES.map(async (src) => ({ src, items: parseFeed(await fetchFeed(src.feed)) }))
  );

  /** @type {Array<{source:string,domain:string,status:string,detail:string,count:number}>} */
  const sourceStatus = [];
  const candidates = [];

  settled.forEach((result, i) => {
    const src = SOURCES[i];
    if (result.status === "rejected") {
      const err = result.reason;
      const detail =
        err && err.name === "AbortError"
          ? `タイムアウト（${FETCH_TIMEOUT_MS / 1000}秒）`
          : `${(err && err.message) || err}`;
      sourceStatus.push({ source: src.name, domain: src.domain, status: "error", detail, count: 0 });
      return;
    }

    const { items } = result.value;
    let fresh = 0;
    let excluded = 0;
    for (const item of items) {
      // 日付が読めない記事は期間の判定ができないので採らない（古い記事の混入を防ぐ）
      if (!Number.isFinite(item.dateMs) || item.dateMs < cutoffMs) continue;
      // 未来日付のフィードがまれにあるので、生成時刻より先のものは今に丸める
      const dateMs = Math.min(item.dateMs, nowMs);
      const publisher = item.publisher || src.name;
      const title = stripHtml(stripPublisherSuffix(item.title, item.publisher));
      if (!title) continue;
      if (isNoise(title, publisher)) { excluded++; continue; }
      fresh++;
      candidates.push({
        domain: src.domain,
        sourceName: src.name,
        publisher,
        title,
        url: item.link,
        normalizedUrl: normalizeUrl(item.link),
        lead: buildLead(item.rawLead, title),
        dateMs,
        time: jstTime(dateMs),
      });
    }

    sourceStatus.push({
      source: src.name,
      domain: src.domain,
      status: fresh > 0 ? "ok" : "empty",
      detail: fresh > 0 ? "" : `取得できたが直近${windowHours}時間の記事なし（全${items.length}件）`,
      count: fresh,
      excluded,
    });
  });

  // 重複排除：正規化URL または タイトル完全一致
  const seenUrl = new Set();
  const seenTitle = new Set();
  const deduped = [];
  for (const a of candidates.sort((x, y) => y.dateMs - x.dateMs)) {
    if (seenUrl.has(a.normalizedUrl) || seenTitle.has(a.title)) continue;
    seenUrl.add(a.normalizedUrl);
    seenTitle.add(a.title);
    deduped.push(a);
  }

  // 分野ごとに最大5件、全体25件以内（FR-T-06）
  const byDomain = new Map(DOMAIN_ORDER.map((d) => [d, []]));
  let total = 0;
  for (const a of deduped) {
    if (total >= MAX_TOTAL) break;
    const bucket = byDomain.get(a.domain);
    if (!bucket || bucket.length >= MAX_PER_DOMAIN) continue;
    bucket.push(a);
    total++;
  }

  const sections = DOMAIN_ORDER.map((domain) => ({
    domain,
    articles: byDomain.get(domain) || [],
    sources: sourceStatus.filter((s) => s.domain === domain),
  }));

  return { sections, sourceStatus, total, windowHours, nowMs };
}

/** アーカイブ一覧（新しい順に最大7件）。過去の号へ辿れるようにする。 */
function listArchives(exceptDate) {
  let files = [];
  try {
    files = fs.readdirSync(OUT_DIR);
  } catch {
    return [];
  }
  return files
    .filter((f) => /^\d{4}-\d{2}-\d{2}\.html$/.test(f))
    .map((f) => f.replace(/\.html$/, ""))
    .filter((d) => d !== exceptDate)
    .sort()
    .reverse()
    .slice(0, 7);
}

async function main() {
  const { sections, sourceStatus, total, windowHours, nowMs } = await collect();
  const dateKey = jstDateString(nowMs);

  const html = renderPage({
    dateKey,
    dateLabel: jstDisplayDate(nowMs),
    sections,
    sourceStatus,
    total,
    windowHours,
    archives: listArchives(dateKey),
  });

  // FR-T-08：日付別アーカイブ＋常に最新の index.html。
  // 要件定義書は index.html を「最新へリダイレクト」と書いているが、リダイレクトだと
  // Service Worker がキャッシュした index.html が翌日以降に存在しない日付へ飛ぶことがあり、
  // NFR-T-04（機内モードで直近号が開ける）を満たせない。同じ内容を書き出す方式にした。
  const archivePath = path.join(OUT_DIR, `${dateKey}.html`);
  const indexPath = path.join(OUT_DIR, "index.html");
  fs.writeFileSync(archivePath, html, "utf8");
  fs.writeFileSync(indexPath, html, "utf8");

  // 実行ログ。Actions の画面で何が起きたか分かるようにする（沈黙しない）
  console.log(`朝ニュース ${dateKey}  全${total}件  期間フィルタ ${windowHours}時間`);
  for (const s of sourceStatus) {
    const mark = s.status === "ok" ? "OK  " : s.status === "empty" ? "0件 " : "NG  ";
    const noise = s.excluded ? `／ノイズ除外 ${s.excluded}件` : "";
    console.log(`  ${mark}[${s.domain}] ${s.source}${s.detail ? " — " + s.detail : ` (${s.count}件)`}${noise}`);
  }
  for (const sec of sections) {
    if (sec.articles.length === 0) console.log(`  ※ 分野「${sec.domain}」は本日0件`);
  }
  console.log(`書き出し: ${path.relative(process.cwd(), archivePath)} / ${path.relative(process.cwd(), indexPath)}`);
}

main().catch((err) => {
  // ここに来るのは想定外の失敗のみ。ソース単位の失敗は上で吸収済み。
  console.error("生成に失敗しました:", err);
  process.exit(1);
});
