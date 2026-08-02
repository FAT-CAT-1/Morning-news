# 朝ニュース ／ 夏休みダイヤ

毎朝6:00にスマホで開き、最も引っかかった1本をPREP法300字でObsidianに書くための仕組み。

**成功指標は「読んだ本数」ではなく「Obsidianに貯まった意見ノートの本数」。**
設計の理由は [`朝ニュース_要件定義書.md`](朝ニュース_要件定義書.md) にある。迷ったらそちらが正。

---

## 構成

```
.
├── index.html                  夏休みダイヤ（既存のPWA）
├── sw.js                       Service Worker（シェルはキャッシュ優先／news はネットワーク優先）
├── manifest.webmanifest
├── icon*.png / icon.svg
├── news/
│   ├── sources.js              ★ソース定義。変更するのはここだけ
│   ├── build.js                取得・整形・生成
│   ├── template.js             HTML生成（配色・レイアウト）
│   ├── index.html             （自動生成）最新号
│   └── YYYY-MM-DD.html        （自動生成）アーカイブ
├── .github/workflows/morning-news.yml   毎日 05:30 JST に生成してcommit
└── .claude/skills/morning-news/SKILL.md 保守用のスキル
```

## 動かし方

```bash
node news/build.js
```

依存パッケージはない。`npm install` は不要（Node 20以上）。
実行すると `news/index.html` と `news/YYYY-MM-DD.html` が更新される。

自動実行はGitHub Actionsの `morning-news` ワークフロー。
**GitHub Secretsは1つも使わない**（APIキーもLLMも使わないため）。
手動実行はActionsタブの `Run workflow`（workflow_dispatch）から。

## 仕様の要点

| 項目 | 値 |
|---|---|
| 生成時刻 | 05:30 JST（cron `30 20 * * *` UTC。読むのは06:00） |
| 期間 | 直近24時間。**月曜だけ72時間**（土日分を拾う） |
| 件数 | 分野ごと最大5件、全体25件以内 |
| 分野 | ドローン → AI技術 → 世界情勢 → 国内政治 → 物価・株価 |
| リード | **媒体自身が書いた文章**を100字で打ち切る。こちらで要約は作らない |
| 書く場所 | Obsidian。画面にテキスト入力欄は作らない |

## Obsidianに書く

各記事の「Obsidianに書く」を押すと、日付・分野・媒体・URL・見出しが埋まった
**枠だけ**のノートが `news/YYYY-MM-DD_分野.md` として生成される。中身はObsidianで書く。

- Vault名は初回だけ聞かれ、`localStorage` に残る
- Obsidianが開けない環境（PCブラウザなど）では**自動でクリップボードに落ちる**
- 隣の「コピー」はいつでもクリップボードにコピーする保険

## よくある保守

**ソースを足す・変える** → `news/sources.js` だけを編集する。
追加前に必ず実際にアクセスして確認し、結果をコメントに残す。

**RSSが取れなくなった** → 手動実行してログを見る。ページ下部の「ソースの状態」にも出る。
404ならURLが変わっている。見つからなければ Google News RSS で代替する。

```
https://news.google.com/rss/search?q=<検索語>&hl=ja&gl=JP&ceid=JP:ja
```

**記事が多い／少ない** → `sources.js` の `MAX_PER_DOMAIN`（既定5）と `MAX_TOTAL`（既定25）。
**多いと感じたら減らす方向に倒す。** 読み切れない号が続くと習慣そのものが壊れる。

**ノイズが混ざる** → `sources.js` の `EXCLUDE_PUBLISHERS` / `EXCLUDE_TITLE_PATTERNS` に足す。
Google Newsは機械翻訳の海外メディアや株価ページを混ぜてくる。

## 保守用スキル

Claude Codeで開いて「朝ニュースのソースを追加したい」などと言うと
[`.claude/skills/morning-news/SKILL.md`](.claude/skills/morning-news/SKILL.md) が手順を持っている。
