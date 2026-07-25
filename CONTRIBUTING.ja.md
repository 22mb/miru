<p align="center">
  <a href="CONTRIBUTING.md">English</a> · <b>日本語</b>
</p>

# miru へのコントリビューション

miru は、意図的に狭い[スコープ](README.ja.md#スコープ)（md / HTML ドキュメントのレンダリングレビュー）を持つ、ローカルだけで動く小さなツールです。
生成、共有、コード差分のレビューに向かう変更はスコープ外ですが、それ以外は歓迎します。

## セットアップ

miru は [Bun](https://bun.sh) で動きます（CI では **1.3.14** に固定）。
他のランタイムは要りません。

```sh
bun install        # lefthook 経由で git hook も同時に有効化されます（prepare スクリプト）
```

リポジトリは 4 つのパッケージを持つ Bun ワークスペースです。

- **`packages/contract`**：zod スキーマと `z.infer` 型。ワイヤ形式と永続化形式の単一の出所であり、server と frontend の両方で共有します
- **`packages/server`**：Bun 製のレビューサーバーとドメインヘルパー（render、inject、store、watch）。CLI から利用されます
- **`packages/cli`**：`miru` CLI 本体（`miru review` / `next` / `comment` など）。`@miru/server` の上に構築されています
- **`packages/frontend`**：React 製の UI。バンドルして `miru` バイナリに埋め込みます

## 開発

```sh
bun run dev review examples/sample.md   # ソースから CLI を実行
bun run build:front                     # packages/frontend/src → packages/frontend/dist/miru.{js,css}
bun run build                           # 単一バイナリ ./miru をコンパイル（アセット埋め込み）
```

frontend のバンドルはビルド時に CLI へ埋め込まれます（`packages/frontend/dist` の text import）。
そのため、frontend を変更したら、バイナリや `miru review` で確認する前に `build:front` を再実行してください。

### フロントエンド開発ループ

パネルはサーバーがレンダリングした文書に注入される構造のため、フロントエンドの開発は本物の
レビューサーバー相手に行います — 次の 1 コマンドで両方をソースから直接起動できます。

```sh
bun run dev:front                     # examples/sample.html のスクラッチコピー → http://127.0.0.1:4400
bun run dev:front path/to/doc.md      # 特定の文書をレビュー（サイドカーは通常どおり永続化）
```

`packages/cli/src/dev-server.ts` がパネルをインプロセスの `Bun.build` でバンドルし（dev 用
define、インラインソースマップ）、`packages/frontend/src` 配下の変更のたびに再ビルドします。
接続中のブラウザはサーバー自身の SSE チャンネル経由でリロードされます。`build:front` も
埋め込みアセットも追加ツールも不要で、ページには本番と同じ CSP が付くため、dev でもバイナリと
同じ挙動になります。フラグ（`--` の後に指定）: `--port N`（デフォルト 4400）、`--no-open`。
最終確認は引き続き埋め込みバンドル（`build:front` + 再起動）で行ってください。

## PR を開く前に

CI は PR ごとに次の 4 つのチェックを走らせます。
先にローカルで実行してください。

```sh
bun run typecheck      # tsc -b
bun run lint           # oxlint
bun run fmt:check      # oxfmt --check（pre-commit hook が stage 済みファイルを整形します）
bun run test           # bun run --filter '*' test（パッケージごとに別プロセス。frontend の happy-dom を server テストに漏らさないため）
```

PR は単一の関心事に絞り、CI を green にしてください。
新しいテストは対象ユニットの隣に `*.test.ts` または `*.test.tsx` として置きます。

## 規約

パッケージごとのコーディング規約とテスト規約は [`.claude/rules/`](.claude/rules) にあります（パスでスコープが切られ、AI エージェントにも与えられます）。
最初に共有しておく不変条件が 2 つあります。

- **contract が単一の出所**：新しいワイヤ形式や永続化形式は、素のインタフェースではなく `@miru/contract` の zod スキーマとして追加してください。リクエスト body は `safeParse` で検証し（失敗時は 400 を返します）、手書きでパースはしないでください。
- **セキュリティ境界を弱めない**：miru は `127.0.0.1` だけにバインドし、`/api/*` は起動ごとのトークンでゲートし、Host と Origin を検証し、厳格な CSP を適用し、レンダリングした HTML はすべてサーバー側でサニタイズしています（デフォルト層は表現 — CSS / SVG / メディア — を通しつつ実行可能なものを除去し、`--strict` はタイポグラフィのみ）。サニタイズを無効化する手段は `--unsafe-raw` だけです。
