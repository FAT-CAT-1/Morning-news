---
name: morning-news
description: 毎朝5:30に自動生成される個人向けニュースレター（朝ニュース）を新規構築・保守する。GitHub Actions + Node.js + GitHub Pages の構成で、LLMを使わずRSSを集約して静的HTMLを生成する。ソースの追加・変更、RSS取得の不具合修正、表示の調整、アーカイブ運用のときに使う。「朝ニュース」「ニュースレター」「morning news」「RSSが取れない」「ソースを足したい」と言われたら起動する。夏休みダイヤ（summer-schedule）と同じリポジトリの /news/ 配下で動く。
---

# 朝ニュース ニュースレター構築スキル

`朝ニュース_要件定義書.md` の第2部（技術要件定義）を実装するためのスキル。
**要件定義書が正、このスキルは手順**。両者が食い違ったら要件定義書に従い、その旨をユーザーに伝える。

---

## 0. 最初に必ず読むもの

作業前に以下を確認する。省略しない。

1. `朝ニュース_要件定義書.md` の第2部（第9〜15章）
2. 既存の `news/sources.js`（あれば）
3. `.github/workflows/morning-news.yml`（あれば）

**要件定義書が見つからない場合は、実装を始める前にユーザーに場所を尋ねる。** 推測で作らない。

---

## 1. この仕組みの目的（実装判断の基準）

ユーザーは就活に向けて、毎朝6:00から20〜30分ニュースを読み、最も引っかかった1本をPREP法300字でObsidianに書く習慣を作ろうとしている。

**成功指標は「読んだ本数」ではなく「Obsidianに貯まった意見ノートの本数」。**

だから実装判断はすべてこの基準で行う。

| 迷ったら | こう判断する |
|---|---|
| 記事を増やすか減らすか | **減らす。** 25件を超えると読み切れず、書く5分が消える |
| 要約を付けるか | **こちらで作らない。** ただし**RSSのリード文（媒体が書いたもの）はそのまま出す**。この2つを混同しない |
| 機能を足すか | **足さない。** 既読管理も星付けも入力欄も不要。Obsidian側で完結する |
| 凝ったデザインにするか | **しない。** 寝起きの6時に読む。大きな文字と少ない要素が正解 |

---

## 1.5 確定している前提（2026年8月1日）

以下はユーザーと合意済み。**変更を提案する前に理由を確認する。**

| 項目 | 確定内容 |
|---|---|
| 実行環境 | **GitHub Actions**（PC不要）。ローカルcronは却下済み |
| 閲覧端末 | **スマホ**。PCでの閲覧は考慮するが最適化はしない |
| 書き込み先 | **スマホのObsidian**。`obsidian://` URIで**枠だけ**生成する |
| 意見文を書く場所 | **Obsidianの中**。ニュースレター画面に入力欄を作ってはいけない（B案として却下済み） |
| AI技術のソース | **Google News RSS**で代替。Perplexity Discoverはリンクのみ |
| 生成時刻 | 05:30 JST（読むのは06:00） |
| LLM | 使わない |

## 2. 絶対に守る制約

- **APIキーを使わない。** GitHub Secretsの設定を要求する実装をしてはいけない
- **LLMを呼ばない。** 生成時にAnthropic APIもOpenAI APIも使わない
- **外部ライブラリはRSSパーサ1つまで。** それ以外はNode標準機能で書く
- **1つのソースが落ちても全体を止めない。** try/catchで囲み、失敗は画面に明示する
- **沈黙しない。** 取得0件のソースは「本日取得できず」と表示する。空欄で誤魔化さない
- **ニュースレター内にテキスト入力欄を作らない。** 意見文はObsidianで書く。転送するのは枠だけ

---

## 3. 新規構築の手順

### Step 1｜RSSの可用性を実際に検証する（最重要）

**ここを飛ばすと後で必ず壊れる。** 推測で `feed:` を書かない。

要件定義書に `<要検証>` と書かれたソースについて、実際にアクセスして確認する。

```bash
# よくあるRSSの場所を順に試す
for path in /feed /rss /feed.xml /rss.xml /atom.xml /index.xml; do
  echo "--- $path"
  curl -sL -o /dev/null -w "%{http_code} %{content_type}\n" "https://example.com$path"
done
```

`200` かつ `content_type` が `xml` 系なら採用。

**見つからない場合はGoogle News RSSでフォールバックする。**

```
https://news.google.com/rss/search?q=<検索語>&hl=ja&gl=JP&ceid=JP:ja
```

例：`q=ドローン when:1d`、`q=ロイター 国際 when:1d`

**AI技術は最初からGoogle News RSSで実装する。** Perplexity Discoverは日替わりで固定URLがなく自動取得できないため、代替として確定済み。

```js
{ domain: "AI技術", name: "AI技術動向（Google News）",
  feed: "https://news.google.com/rss/search?q=AI+%E6%8A%80%E8%A1%93+when:1d&hl=ja&gl=JP&ceid=JP:ja" },
```

Discoverへのリンクは画面に常設し、深掘り用の導線として残す。

検証結果は `sources.js` のコメントに残す。次に誰が触っても再調査しなくて済むように。

```js
// 2026-08-xx 検証：公式RSSなし → Google News RSSで代替
{ domain: "世界情勢", name: "Reuters", feed: "https://news.google.com/rss/search?q=..." },
```

### Step 2｜ディレクトリを作る

```
summer-schedule/
├── .github/workflows/morning-news.yml
├── news/
│   ├── build.js          ← 生成スクリプト
│   ├── sources.js        ← ソース定義（ここだけ直せば変更できる）
│   ├── template.js       ← HTML生成
│   ├── index.html        ← 最新号（自動生成・commit対象）
│   └── 2026-08-01.html   ← アーカイブ（自動生成・commit対象）
└── index.html            ← 既存の夏休みダイヤ
```

### Step 3｜build.js を書く

処理の順序：

1. `sources.js` を読む
2. 全ソースを **並列で** 取得（`Promise.allSettled`。1つの失敗で全体を止めない）
3. タイムアウト10秒（`AbortController` を使う）
4. 期間フィルタ：直近24時間。**月曜のみ72時間**
5. 重複排除：URL正規化（`?utm_*` などのクエリを除去）＋タイトル完全一致
6. 分野ごとに**最大5件、全体25件以内**に切る
6b. **リードを抽出する。** `description` / `summary` / `content:encoded` の順に見て、最初に取れたものを使う
   - **HTMLタグを除去**（`<a>` `<img>` `<p>` などが必ず混ざる）
   - HTMLエンティティをデコード（`&amp;` `&quot;` `&#039;` など）
   - **全角100字で打ち切り、末尾に `…` を付ける**
   - Google News RSSの `description` はリンクの羅列になることがある。タグ除去後に本文が20字未満なら**リードなしとして扱う**（無理に出さない）
7. `template.js` でHTMLを生成
8. `news/index.html` と `news/YYYY-MM-DD.html` の両方に書き出す

**失敗したソースは `errors` 配列に残し、HTMLに表示する。** 握りつぶさない。

### Step 4｜template.js を書く

配色は夏休みダイヤと揃える。

```
背景 #0E1319 ／ カード #161D26 ／ 罫線 #2A3644
文字 #EDF2F7 ／ 補助 #9AAABA ／ アクセント #2DD4BF
分野色：ドローン #6EE07A ／ AI #B088F7 ／ 世界 #4BA6F0
        国内 #FFB13D ／ 物価株価 #F5D76E
```

必須の要素：

- ページ冒頭に **「全N件／想定N分」**（読む前に量が分かる）
- 各記事は **見出し → リード（100字まで・補助色）→ ボタン** の順。リードがない記事は見出しのみで、欠落を詫びる文言は出さない
- 分野ごとのセクション。**0件なら「本日取得できず」を明示**
- AI技術セクションには **Perplexity Discoverへのリンクを常設**（自動取得できないため）
- 各記事に **「PREPを書く」ボタン** → クリップボードにMarkdownをコピー
- ページ末尾に **「テンプレートをコピー」**（記事を選ばず自分で書く場合用）

**「Obsidianに書く」ボタンの実装（主）**

ユーザーは**スマホで読み、スマホのObsidianに書く**と確定している。クリップボード経由で手貼りさせない。

```js
const uri = "obsidian://new"
  + "?vault=" + encodeURIComponent(vaultName)     // localStorageに保存済みの値
  + "&file="  + encodeURIComponent("news/" + date + "_" + domain + ".md")
  + "&content=" + encodeURIComponent(markdown);
location.href = uri;
```

- **Vault名は初回に画面上で設定させ、`localStorage` に保存する。** 毎朝入力させない
- `content` は必ず `encodeURIComponent()` を通す
- **URIが開かない環境ではクリップボードにフォールバック**（`navigator.clipboard.writeText()`、さらに失敗したら `<textarea>` 選択）
- **実機で必ず確認する。** Obsidian URIはバージョンやOSで挙動が変わる。`file` が効かない場合は `name` パラメータを試す

**生成されるMarkdown**（日付・分野・媒体・URL・見出しを埋めた状態にする）：

```markdown
---
date: {YYYY-MM-DD}
domain: {分野}
source: {媒体名}
url: {記事URL}
tags: [news, 就活ネタ]
---

# {見出し}

## 事実
（何が起きたか。2〜3行。自分の解釈を混ぜない）

## 意見（PREP・300字）
**P：**
**R：**
**E：**
**P：**

## 面接での使いどころ
```

**ボタンは2つ並べる。** 主が「Obsidianに書く」、副が「コピー」。副はPC閲覧時とURI失敗時の保険。

### Step 5｜GitHub Actions を書く

```yaml
name: morning-news
on:
  schedule:
    - cron: "30 20 * * *"   # 20:30 UTC = 翌 05:30 JST
  workflow_dispatch:         # 手動実行も可能にする
permissions:
  contents: write
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: "20" }
      - run: npm ci --prefix news || npm install --prefix news
      - run: node news/build.js
      - name: commit
        run: |
          git config user.name  "morning-news-bot"
          git config user.email "bot@users.noreply.github.com"
          git add news/
          git diff --cached --quiet || git commit -m "news: $(date -u +%Y-%m-%d)"
          git push
```

**cronはUTCで書く。** JST 5:30 は UTC 20:30（前日）。ここを間違えると9時間ずれる。

⚠️ GitHub Actionsのcronは**混雑時に数分〜十数分遅延する**。5:30に設定しておけば6:00には間に合うが、ぴったりの時刻は保証されない。要件上は問題ない。

### Step 6｜PWAのキャッシュ対象に加える

既存の `sw.js` の `FILES` に `./news/` と `./news/index.html` を足し、`CACHE` の版数を上げる。

ただし **ニュースは毎日変わるのでネットワーク優先にする。** アプリシェル（夏休みダイヤ）はキャッシュ優先のまま、`/news/` だけ network-first にする分岐を入れる。

---

## 4. 検証

実装したら必ず以下を確認する。ユーザーに「できました」と言う前に。

```bash
node news/build.js          # ローカルで生成できるか
```

- [ ] 5分野すべてにセクションがある
- [ ] 全体25件以内
- [ ] リードが表示され、**HTMLタグが混入していない**（`<a href=` などが生で出ていないか目視）
- [ ] `sources.js` の1つを壊しても他分野が表示される（**実際に壊して試す**）
- [ ] 「Obsidianに書く」で**実機のスマホ**にノートが生成される
- [ ] Vault名がlocalStorageに保存され、2回目以降は聞かれない
- [ ] URI失敗時にクリップボードへフォールバックする
- [ ] スマホ幅（375px）で横スクロールが出ない
- [ ] GitHub Secretsを1つも使っていない
- [ ] アーカイブが日付ファイルで残る

**Actionsは `workflow_dispatch` で手動実行して確認する。** 翌朝まで待たない。

---

## 5. 保守の手順

### ソースを追加・変更したい

`news/sources.js` だけを編集する。他のファイルは触らない。
追加前に必ず **Step 1のRSS検証** を行い、結果をコメントに残す。

### RSSが取れなくなった

1. 手動実行して `errors` の内容を見る
2. `curl -I` でHTTPステータスを確認
3. 404ならフィードのURLが変わった → 探し直す
4. 見つからなければ Google News RSS に切り替える

**サイト側の仕様変更は日常茶飯事なので、壊れたこと自体を問題視しない。** 復旧手順が回ることが重要。

### 記事が多すぎる／少なすぎる

`sources.js` の `MAX_PER_DOMAIN`（既定5）と `MAX_TOTAL`（既定25）を調整する。

**多いと感じたら減らす方向に倒す。** 読み切れない号が続くと習慣そのものが壊れる。

### 2ちゃんねるを追加したい（2026年12月以降）

要件定義書の第1部に**導入時期の根拠**が書いてある。12月より前に追加を求められたら、実装する前に要件定義書の該当箇所をユーザーに示して確認する。

---

## 6. 段階2（LLM要約）を求められたら

**まず「本当に必要か」を確認する。** 要件定義書は意図的にLLMを外している。

導入すると次が発生する。

- Anthropic APIキーをGitHub Secretsに置く運用
- 従量課金（毎日実行なので積み上がる）
- **要約を読んで原文を開かなくなるリスク**（PREPの質が落ちる）

3か月運用して「見出しだけでは判断できない記事が多い」と実感してからで遅くない。

導入する場合も、**要約は付けず「この記事は読む価値があるか」の1行判定だけ**に留めるのが、当初の目的に沿う。
