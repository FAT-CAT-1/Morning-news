"use strict";
/**
 * HTML生成。表示に関わることはこのファイルに閉じる。
 *
 * 前提（NFR-T-05）：6:00に寝起きのスマホで読む。
 *   本文16px以上／タップ領域44px以上／ダークテーマ（夏休みダイヤと同配色）／375pxで横スクロールなし。
 *
 * 画面にテキスト入力欄は作らない（要件定義書 5.5節でB案として却下済み）。
 * 意見文はObsidianの中で書く。ここから転送するのは枠だけ。
 */

const { DOMAIN_COLORS, PERPLEXITY_DISCOVER_URL } = require("./sources.js");

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** <script type="application/json"> に安全に埋める。 */
function embedJson(value) {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")        // </script> による脱出を防ぐ
    .replace(/\u2028/g, "\\u2028")  // JSONでは合法だがJSでは行区切りになる
    .replace(/\u2029/g, "\\u2029");
}

/**
 * 想定所要時間。要件定義書12章の例（全24件＝想定22分）に合わせた係数。
 * 読む時間 ＋ PREPを書く5分。
 */
function estimateMinutes(total) {
  return Math.round(total * 0.7) + 5;
}

function renderArticle(article, index) {
  const lead = article.lead
    ? `<p class="lead">${escapeHtml(article.lead)}</p>`
    : ""; // リードが取れない記事は見出しのみ。欠落を詫びない（FR-T-06b）
  return `
        <li class="article">
          <a class="headline" href="${escapeHtml(article.url)}" target="_blank" rel="noopener">${escapeHtml(article.title)}</a>
          <p class="meta">${escapeHtml(article.publisher)}・${escapeHtml(article.time)}</p>
          ${lead}
          <div class="actions">
            <button type="button" class="btn btn-primary" data-act="obsidian" data-idx="${index}">Obsidianに書く</button>
            <button type="button" class="btn btn-ghost" data-act="copy" data-idx="${index}">コピー</button>
          </div>
        </li>`;
}

function renderSection(section, startIndex) {
  const color = DOMAIN_COLORS[section.domain] || "#2DD4BF";
  let idx = startIndex;

  let body;
  if (section.articles.length > 0) {
    body = `<ol class="articles">${section.articles.map((a) => renderArticle(a, idx++)).join("")}
      </ol>`;
  } else {
    // 沈黙しない（FR-T-09）。空欄で誤魔化さず、取得できなかったことを明示する。
    const reasons = section.sources
      .map((s) => `${escapeHtml(s.source)}：${escapeHtml(s.status === "error" ? s.detail : "新着なし")}`)
      .join("<br>");
    body = `<p class="empty">本日取得できず</p><p class="empty-detail">${reasons}</p>`;
  }

  // 自動取得できないソースへの導線（FR-T-10）
  const discover =
    section.domain === "AI技術"
      ? `<a class="external" href="${PERPLEXITY_DISCOVER_URL}" target="_blank" rel="noopener">Perplexity Discover で深掘りする ↗</a>`
      : "";

  return {
    html: `
      <section class="domain" style="--domain:${color}">
        <h2 class="domain-title">${escapeHtml(section.domain)}<span class="count">${section.articles.length}</span></h2>
        ${body}
        ${discover}
      </section>`,
    nextIndex: idx,
  };
}

function renderSourceStatus(sourceStatus) {
  const rows = sourceStatus
    .map((s) => {
      const cls = s.status === "ok" ? "st-ok" : s.status === "empty" ? "st-empty" : "st-error";
      const label = s.status === "ok" ? `${s.count}件` : s.status === "empty" ? "本日取得できず" : "取得失敗";
      const detail = s.status === "error" ? `<span class="st-detail">${escapeHtml(s.detail)}</span>` : "";
      return `<li class="${cls}"><span class="st-name">${escapeHtml(s.source)}</span><span class="st-label">${label}</span>${detail}</li>`;
    })
    .join("");
  return `
      <section class="status">
        <h2 class="status-title">ソースの状態</h2>
        <ul class="status-list">${rows}</ul>
      </section>`;
}

function renderArchives(archives) {
  if (!archives.length) return "";
  const links = archives
    .map((d) => `<a href="./${escapeHtml(d)}.html">${escapeHtml(d)}</a>`)
    .join("");
  return `
      <section class="archive">
        <h2 class="status-title">過去の号</h2>
        <nav class="archive-links">${links}</nav>
      </section>`;
}

function renderPage({ dateKey, dateLabel, sections, sourceStatus, total, windowHours, archives }) {
  // ボタンから使う記事データ。HTML属性に長文を埋めるとエスケープ事故を起こすのでJSONで渡す。
  const payload = [];
  let index = 0;
  const sectionHtml = sections
    .map((section) => {
      const rendered = renderSection(section, index);
      for (const a of section.articles) {
        payload.push({
          title: a.title,
          url: a.url,
          domain: a.domain,
          source: a.publisher,
        });
      }
      index = rendered.nextIndex;
      return rendered.html;
    })
    .join("");

  const summary =
    total > 0
      ? `全${total}件 ／ 想定 ${estimateMinutes(total)}分`
      : `全0件（${windowHours}時間以内の新着なし）`;

  return `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#0E1319">
<meta name="robots" content="noindex">
<title>朝ニュース ${escapeHtml(dateKey)}</title>
<style>
  :root{
    --bg:#0E1319; --card:#161D26; --line:#2A3644;
    --text:#EDF2F7; --sub:#9AAABA; --accent:#2DD4BF;
  }
  *{box-sizing:border-box;}
  html,body{margin:0;padding:0;overflow-x:hidden;}
  body{
    background:var(--bg); color:var(--text);
    font-family:-apple-system,BlinkMacSystemFont,"Hiragino Kaku Gothic ProN","Noto Sans JP","Yu Gothic",sans-serif;
    font-size:16px; line-height:1.7;
    padding:env(safe-area-inset-top) 0 calc(32px + env(safe-area-inset-bottom));
    -webkit-text-size-adjust:100%;
  }
  .wrap{max-width:640px;margin:0 auto;padding:0 14px;}
  a{color:inherit;}

  header{padding:20px 0 14px;border-bottom:1px solid var(--line);}
  .date{font-size:20px;font-weight:700;margin:0;}
  .summary{margin:6px 0 0;color:var(--accent);font-size:16px;font-weight:600;}
  .vault{
    margin:12px 0 0;display:flex;align-items:center;gap:8px;flex-wrap:wrap;
    color:var(--sub);font-size:14px;
  }
  .vault button{
    min-height:44px;padding:0 14px;border-radius:10px;
    background:transparent;border:1px solid var(--line);color:var(--sub);
    font-size:14px;cursor:pointer;
  }

  .domain{margin:26px 0 0;}
  .domain-title{
    display:flex;align-items:center;gap:10px;
    margin:0 0 10px;font-size:18px;font-weight:700;color:var(--domain);
    border-left:4px solid var(--domain);padding-left:10px;
  }
  .count{
    margin-left:auto;font-size:13px;font-weight:600;color:var(--sub);
    border:1px solid var(--line);border-radius:999px;padding:2px 10px;
  }

  .articles{list-style:none;margin:0;padding:0;}
  .article{
    background:var(--card);border:1px solid var(--line);border-radius:14px;
    padding:14px;margin:0 0 12px;
  }
  .headline{
    display:block;font-size:17px;font-weight:700;line-height:1.55;
    text-decoration:none;overflow-wrap:anywhere;
  }
  .meta{margin:6px 0 0;color:var(--sub);font-size:13px;}
  .lead{margin:8px 0 0;color:var(--sub);font-size:16px;line-height:1.75;overflow-wrap:anywhere;}

  .actions{display:flex;gap:10px;margin-top:12px;}
  .btn{
    min-height:44px;flex:1;border-radius:12px;font-size:15px;font-weight:700;
    cursor:pointer;border:1px solid var(--line);
  }
  .btn-primary{background:var(--accent);color:#08201D;border-color:var(--accent);}
  .btn-ghost{background:transparent;color:var(--sub);flex:0 0 96px;}
  .btn:active{opacity:.75;}

  .empty{
    margin:0;padding:16px 14px;background:var(--card);
    border:1px dashed var(--line);border-radius:14px;
    color:var(--sub);font-weight:700;
  }
  .empty-detail{margin:8px 0 0;color:var(--sub);font-size:13px;line-height:1.7;}

  .external{
    display:block;min-height:44px;line-height:44px;margin-top:6px;
    text-align:center;border:1px solid var(--domain);border-radius:12px;
    color:var(--domain);text-decoration:none;font-size:15px;font-weight:600;
  }

  .prep{margin:30px 0 0;padding:16px 14px;background:var(--card);border:1px solid var(--line);border-radius:14px;}
  .prep h2{margin:0 0 6px;font-size:17px;}
  .prep p{margin:0 0 12px;color:var(--sub);font-size:14px;}

  .status,.archive{margin:28px 0 0;}
  .status-title{margin:0 0 8px;font-size:14px;color:var(--sub);font-weight:600;}
  .status-list{list-style:none;margin:0;padding:0;font-size:13px;}
  .status-list li{
    display:flex;flex-wrap:wrap;gap:8px;align-items:baseline;
    padding:7px 0;border-bottom:1px solid var(--line);color:var(--sub);
  }
  .st-name{flex:1 1 auto;overflow-wrap:anywhere;}
  .st-label{font-weight:600;}
  .st-ok .st-label{color:var(--accent);}
  .st-empty .st-label{color:var(--sub);}
  .st-error .st-label{color:#FF6B7C;}
  .st-detail{flex:1 0 100%;color:#FF6B7C;}

  .archive-links{display:flex;flex-wrap:wrap;gap:8px;}
  .archive-links a{
    min-height:44px;line-height:44px;padding:0 12px;
    border:1px solid var(--line);border-radius:10px;
    color:var(--sub);text-decoration:none;font-size:14px;
  }

  footer{margin:26px 0 0;color:var(--sub);font-size:12px;line-height:1.8;}

  .toast{
    position:fixed;left:50%;bottom:24px;transform:translateX(-50%) translateY(20px);
    background:var(--card);border:1px solid var(--accent);color:var(--text);
    padding:12px 18px;border-radius:12px;font-size:14px;font-weight:600;
    opacity:0;pointer-events:none;transition:opacity .2s,transform .2s;
    max-width:calc(100vw - 32px);text-align:center;z-index:10;
  }
  .toast.show{opacity:1;transform:translateX(-50%) translateY(0);}
</style>
</head>
<body>
<div class="wrap">
  <header>
    <h1 class="date">${escapeHtml(dateLabel)} 朝ニュース</h1>
    <p class="summary">${escapeHtml(summary)}</p>
    <p class="vault">
      <span id="vault-label">Vault: 未設定</span>
      <button type="button" id="vault-set">変更</button>
    </p>
  </header>

  <main>${sectionHtml}

    <section class="prep">
      <h2>今日のPREPノート</h2>
      <p>記事を選ばず自分で書くときはこちら。日付だけ入った枠を作る。</p>
      <div class="actions">
        <button type="button" class="btn btn-primary" data-act="obsidian" data-idx="blank">Obsidianに書く</button>
        <button type="button" class="btn btn-ghost" data-act="copy" data-idx="blank">コピー</button>
      </div>
    </section>

    ${renderSourceStatus(sourceStatus)}
    ${renderArchives(archives)}
  </main>

  <footer>
    生成：${escapeHtml(dateKey)} 05:30 JST ／ 期間フィルタ ${escapeHtml(String(windowHours))}時間<br>
    見出しの下の文章は各媒体が書いたリードです。こちらで作った要約ではありません。
  </footer>
</div>

<div class="toast" id="toast" role="status" aria-live="polite"></div>

<script type="application/json" id="news-data">${embedJson(payload)}</script>
<script>
(function () {
  "use strict";
  var DATE = ${embedJson(dateKey)};
  var ARTICLES = JSON.parse(document.getElementById("news-data").textContent);
  var VAULT_KEY = "morning-news:vault";

  // ── Vault名（初回だけ聞いて localStorage に残す） ────────────────
  function getVault() {
    try { return localStorage.getItem(VAULT_KEY) || ""; } catch (e) { return ""; }
  }
  function setVault(v) {
    try { localStorage.setItem(VAULT_KEY, v); } catch (e) {}
  }
  function paintVault() {
    var v = getVault();
    document.getElementById("vault-label").textContent = "Vault: " + (v || "未設定");
  }
  function askVault(force) {
    var current = getVault();
    if (current && !force) return current;
    // 画面に入力欄は置かない方針なので prompt で受ける
    var v = window.prompt("ObsidianのVault名を入力してください（初回のみ）", current || "");
    if (v === null) return current;
    v = v.trim();
    if (v) { setVault(v); paintVault(); }
    return v || current;
  }

  // ── Obsidianに生成するMarkdown（枠だけ。中身はObsidianで書く） ──
  function buildMarkdown(a) {
    return [
      "---",
      "date: " + DATE,
      "domain: " + (a ? a.domain : ""),
      "source: " + (a ? a.source : ""),
      "url: " + (a ? a.url : ""),
      "tags: [news, 就活ネタ]",
      "---",
      "",
      "# " + (a ? a.title : ""),
      "",
      "## 事実",
      "（何が起きたか。2〜3行。自分の解釈を混ぜない）",
      "",
      "## 意見（PREP・300字）",
      "**P：**",
      "**R：**",
      "**E：**",
      "**P：**",
      "",
      "## 面接での使いどころ",
      ""
    ].join("\\n");
  }

  function fileName(a) {
    return a ? "news/" + DATE + "_" + a.domain + ".md" : "news/" + DATE + ".md";
  }

  // ── トースト ────────────────────────────────────────────────
  var toastEl = document.getElementById("toast");
  var toastTimer = null;
  function toast(msg) {
    toastEl.textContent = msg;
    toastEl.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastEl.classList.remove("show"); }, 2400);
  }

  // ── クリップボード（保険。URI失敗時とPC閲覧時） ──────────────
  function copyText(text) {
    if (navigator.clipboard && window.isSecureContext) {
      return navigator.clipboard.writeText(text);
    }
    return new Promise(function (resolve, reject) {
      var ta = document.createElement("textarea");
      ta.value = text;
      ta.setAttribute("readonly", "");
      ta.style.position = "fixed";
      ta.style.top = "-1000px";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      ta.setSelectionRange(0, ta.value.length);
      var ok = false;
      try { ok = document.execCommand("copy"); } catch (e) { ok = false; }
      document.body.removeChild(ta);
      ok ? resolve() : reject(new Error("copy failed"));
    });
  }

  function copyWithToast(md, okMsg) {
    copyText(md).then(
      function () { toast(okMsg); },
      function () { toast("コピーできませんでした"); }
    );
  }

  // ── Obsidianを開く。開けなければクリップボードへ落とす ────────
  function openObsidian(a) {
    var vault = askVault(false);
    var md = buildMarkdown(a);
    if (!vault) {
      copyWithToast(md, "Vault未設定のためコピーしました");
      return;
    }
    var uri = "obsidian://new"
      + "?vault=" + encodeURIComponent(vault)
      + "&file=" + encodeURIComponent(fileName(a))
      + "&content=" + encodeURIComponent(md);

    // アプリに切り替わったかを可視状態で判定する。
    // 切り替わらなければURIが効かない環境（PCブラウザ等）なのでコピーに落とす。
    var left = false;
    function onHide() { if (document.hidden) left = true; }
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("pagehide", onHide);

    try {
      window.location.href = uri;
    } catch (e) {
      left = false;
    }

    setTimeout(function () {
      document.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("pagehide", onHide);
      if (!left && !document.hidden) {
        copyWithToast(md, "Obsidianを開けないためコピーしました");
      }
    }, 1500);
  }

  // ── ボタン（イベント委譲） ──────────────────────────────────
  document.addEventListener("click", function (ev) {
    var btn = ev.target.closest ? ev.target.closest("button[data-act]") : null;
    if (!btn) return;
    var idx = btn.getAttribute("data-idx");
    var a = idx === "blank" ? null : ARTICLES[Number(idx)];
    if (idx !== "blank" && !a) return;

    if (btn.getAttribute("data-act") === "obsidian") {
      openObsidian(a);
    } else {
      copyWithToast(buildMarkdown(a), "コピーしました");
    }
  });

  document.getElementById("vault-set").addEventListener("click", function () { askVault(true); });
  paintVault();

  // 直接 /news/ を開いた場合でもオフラインで読めるようにSWを登録する（NFR-T-04）
  if ("serviceWorker" in navigator) {
    window.addEventListener("load", function () {
      navigator.serviceWorker.register("../sw.js").catch(function () {});
    });
  }
})();
</script>
</body>
</html>
`;
}

module.exports = { renderPage, estimateMinutes };
