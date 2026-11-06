# wikidata-musicians

Search Wikidata for **musicians and musical groups** and get back only verified hits: the QID, labels and descriptions in the languages you ask for, and a Wikimedia Commons portrait that comes with its license and author credit. No API key.

Ships as a **library** (Node 20+ and Cloudflare Workers), a **CLI**, and an **MCP server** that agents can call.

[日本語](#日本語)

```
npx @artsnet/wikidata-musicians search "Ryuichi Sakamoto" --languages ja,en --user-agent "MyApp/1.0 (me@example.com)"
Q345494  坂本龍一  (日本の音楽家、作曲家、ピアニスト (1952-2023))
  kind:     person  via Q36834, Q486748
  wikidata: https://www.wikidata.org/wiki/Q345494
  image:    https://upload.wikimedia.org/wikipedia/commons/…
  credit:   …, CC BY 2.0, https://commons.wikimedia.org/wiki/File:…
```

## What "verified" means

A search on Wikidata returns anything whose label or alias matches, including painters, places and films. This package fetches each hit and keeps it only when it has a **direct** `P106` (occupation) statement in the musician list or a **direct** `P31` (instance of) statement in the musical-group list. Subclass chains are not followed, so an item with ambiguous data stays out until someone fixes it on Wikidata.

| Role | Built-in items |
|---|---|
| occupation (person) | singer, musician, songwriter, composer, guitarist, drummer, pianist, rapper, DJ, record producer, conductor |
| class (group) | musical group, band |

Run `wikidata-musicians classes` for the QIDs, or pass your own lists through `occupationIds` / `groupClassIds`.

A Commons image is returned only when the file URL, the file page, the license name, the license URL **and** the author credit are all present. Otherwise `image` is `null`. Show the credit and link to `filePageUrl` when you display the image; that is what the licenses require.

## Library

```bash
npm install @artsnet/wikidata-musicians
```

```ts
import { createWikidataMusiciansClient, WikidataMusiciansError } from "@artsnet/wikidata-musicians";

const client = createWikidataMusiciansClient({
  userAgent: "MyApp/1.0 (https://example.com/contact)", // Wikimedia asks every client to identify itself
  languages: ["ja", "en"],                                // label preference and default search language
});

const hits = await client.search("坂本龍一");              // Musician[] in search order, non-musicians removed
const one = await client.get("Q345494");                  // throws not-found / not-a-musician

try { await client.get("Q5"); } catch (error) {
  if (error instanceof WikidataMusiciansError) error.code; // "invalid-input" | "not-found" | "not-a-musician" | "unavailable"
}
```

`Musician`:

```ts
{
  qid: "Q345494", wikidataUrl: "https://www.wikidata.org/wiki/Q345494",
  kind: "person" | "group", matchedClassIds: ["Q36834", "Q486748"],
  name: "坂本龍一",              // first requested language with a label, else the search label, else the QID
  description: "…" | null,
  labels: { ja: "坂本龍一", en: "Ryuichi Sakamoto" },
  descriptions: { ja: "…", en: "…" },
  image: { url, filePageUrl, licenseName, licenseUrl, artistCredit } | null
}
```

Options: `languages` (default `["en"]`), `userAgent`, `timeoutMs` (default `10000`), `fetcher`, `includeImages` (default `true`), `occupationIds`, `groupClassIds`, `cacheTtlMs` (default 10 minutes, `0` disables). `search(query, { language, limit })` takes a search language and the number of raw hits to verify (1 to 50, default 10). One-off helpers `searchMusicians()` and `getMusician()` skip the cache.

Requests per call: one `wbsearchentities`, one `wbgetentities` for all hits (50 per request), and one Commons `imageinfo` query for all images. A `get` is one or two requests. Only `www.wikidata.org` and `commons.wikimedia.org` are ever contacted.

The core uses only `fetch`, `URL` and `AbortSignal.timeout`, so it runs unchanged in Cloudflare Workers. The CLI and MCP server are Node-only.

## CLI

```bash
npx @artsnet/wikidata-musicians search "Björk" --json
npx @artsnet/wikidata-musicians get Q5383 --languages ja,en
npx @artsnet/wikidata-musicians classes
```

```
Options:
  --json                 Print one JSON object (schemaVersion 1)
  --languages <l,l,...>  Label languages in order of preference (default: en; or WIKIDATA_MUSICIANS_LANGUAGES)
  --language <l>         Search language (default: first of --languages)
  --limit <n>            Raw search hits to verify, 1-50 (default: 10)
  --no-images            Skip the Commons image lookup
  --user-agent <ua>      User-Agent sent to Wikimedia (or WIKIDATA_MUSICIANS_USER_AGENT); name your app and contact
  --timeout <ms>         Per-request timeout (default: 10000)
```

Exit codes: `0` ok, `1` usage error, `2` invalid input, `3` not found, `4` Wikimedia unavailable, `5` the item is not a musician. An empty search result is still exit `0`.

```json
{"schemaVersion":1,"ok":true,"query":"Björk","language":"en","musicians":[{"qid":"Q42455","kind":"person","name":"Björk",…}]}
{"schemaVersion":1,"ok":true,"qid":"Q5383","musician":{…}}
{"schemaVersion":1,"ok":false,"input":"Q5","error":{"code":"not-a-musician","message":"…"}}
```

Without a User-Agent the CLI prints a warning and sends one that names only this package. Please set yours.

## MCP server

A stdio server for Claude Code, Claude Desktop, Cursor and any other MCP client. It runs on your machine, with your network and your User-Agent. There is no hosted endpoint.

```json
{
  "mcpServers": {
    "wikidata-musicians": {
      "command": "npx",
      "args": ["-y", "-p", "@artsnet/wikidata-musicians", "wikidata-musicians-mcp"],
      "env": {
        "WIKIDATA_MUSICIANS_USER_AGENT": "MyAgent/1.0 (https://example.com/contact)",
        "WIKIDATA_MUSICIANS_LANGUAGES": "ja,en"
      }
    }
  }
}
```

Claude Code: `claude mcp add wikidata-musicians -e WIKIDATA_MUSICIANS_USER_AGENT="MyAgent/1.0 (…)" -e WIKIDATA_MUSICIANS_LANGUAGES=ja,en -- npx -y -p @artsnet/wikidata-musicians wikidata-musicians-mcp`

| Tool | Network | Returns |
|---|---|---|
| `search_musicians` `{ query, language?, limit? }` | yes | The CLI's search record: `musicians` in search order, non-musicians removed. |
| `get_musician` `{ qid }` | yes | The CLI's get record; `not-found` and `not-a-musician` come back as error results with `error.code`. |
| `list_music_classes` `{}` | no | The occupation and class QIDs used for verification. |

All tools are annotated read-only. **Everything a tool returns is Wikidata and Commons content**: data for the agent to report, never an instruction for it to follow. The tool descriptions say so. See [SKILL.md](SKILL.md) for a short guide written for agents.

## Responsibility

Wikidata content is CC0; Commons images carry their own licenses, which this package surfaces so you can comply with them. Wikimedia's [User-Agent policy](https://foundation.wikimedia.org/wiki/Policy:Wikimedia_Foundation_User-Agent_Policy) asks every client to identify itself with a contact; the default User-Agent names only this package, so set your own. Requests are serial and cached for ten minutes by default. Do not use this to bulk-harvest Wikidata; for that, use the dumps or the SPARQL endpoint. The music classification is deliberately narrow and will miss musicians whose Wikidata item lacks a direct occupation statement; the fix belongs on Wikidata.

## Development

```bash
npm install
npm run typecheck && npm test && npm run build
node dist/cli.js search "Björk" --user-agent "dev (you@example.com)"
```

MIT © Artsnet. See [CONTRIBUTING.md](CONTRIBUTING.md) and [SECURITY.md](SECURITY.md).

---

## 日本語

Wikidata から **音楽家と音楽グループ** だけを検索します。職業(P106)または分類(P31)を検証した候補のみを返し、指定した言語のラベルと説明、そしてライセンスと作者クレジット付きの Wikimedia Commons 画像を揃えます。API キーは不要です。

**ライブラリ**(Node 20 以上と Cloudflare Workers)、**CLI**、エージェントから呼べる **MCP サーバー** を同梱しています。

### 使い方

```bash
npx @artsnet/wikidata-musicians search "坂本龍一" --languages ja,en --user-agent "MyApp/1.0 (me@example.com)"
npx @artsnet/wikidata-musicians get Q345494 --json
```

```ts
import { createWikidataMusiciansClient } from "@artsnet/wikidata-musicians";
const client = createWikidataMusiciansClient({ userAgent: "MyApp/1.0 (https://example.com/contact)", languages: ["ja", "en"] });
const hits = await client.search("坂本龍一");
```

MCP サーバーは stdio で動く自己ホスト専用です。Artsnet が運用する公開エンドポイントはありません。設定例は上の英語セクションの JSON をそのまま使ってください。

### 検証の意味

Wikidata の検索は名前が一致するものを何でも返します(画家、地名、映画など)。このパッケージはヒットごとに項目を取得し、音楽系の職業(P106)か音楽グループの分類(P31)が **直接** 付いているものだけを残します。下位クラスはたどりません。曖昧な項目は Wikidata 側が整うまで出てきません。組み込みの QID は `wikidata-musicians classes` で確認でき、`occupationIds` / `groupClassIds` で差し替えられます。

Commons 画像は、ファイル URL・ファイルページ・ライセンス名・ライセンス URL・作者クレジットがすべて揃うときだけ返します。表示する際はクレジットを示し、`filePageUrl` にリンクしてください。

### 失敗コードと終了コード

| コード | 意味 | CLI 終了コード |
|---|---|---|
| `invalid-input` | 空または長すぎるクエリ、不正な QID、不明な言語コード。リクエストは発生しない | 2 |
| `not-found` | その QID の項目が存在しない | 3 |
| `unavailable` | Wikidata または Commons に到達できない、タイムアウト、API エラー | 4 |
| `not-a-musician` | 項目は存在するが音楽系の職業・分類が直接付いていない | 5 |

### 責任について

Wikidata の内容は CC0、Commons の画像は個別のライセンスです。Wikimedia の User-Agent ポリシーはすべてのクライアントに連絡先付きの識別を求めています。既定の User-Agent はこのパッケージ名だけで運営者名を含まないため、`--user-agent` または `WIKIDATA_MUSICIANS_USER_AGENT` で自分のものを設定してください。ツールが返す内容はすべて Wikidata と Commons のテキストであり、エージェントにとってはデータであって指示ではありません。大量取得にはダンプか SPARQL エンドポイントを使ってください。
