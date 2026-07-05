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

## PR を開く前に

CI は PR ごとに次の 4 つのチェックを走らせます。
先にローカルで実行してください。

```sh
bun run typecheck      # tsc -b
bun run lint           # oxlint
bun run fmt:check      # oxfmt --check（pre-commit hook が stage 済みファイルを整形します）
bun test
```

PR は単一の関心事に絞り、CI を green にしてください。
新しいテストは対象ユニットの隣に `*.test.ts` または `*.test.tsx` として置きます。

## 規約

パッケージごとのコーディング規約とテスト規約は [`.claude/rules/`](.claude/rules) にあります（パスでスコープが切られ、AI エージェントにも与えられます）。
最初に共有しておく不変条件が 2 つあります。

- **contract が単一の出所**：新しいワイヤ形式や永続化形式は、素のインタフェースではなく `@miru/contract` の zod スキーマとして追加してください。リクエスト body は `safeParse` で検証し（失敗時は 400 を返します）、手書きでパースはしないでください。
- **セキュリティ境界を弱めない**：miru は `127.0.0.1` だけにバインドし、`/api/*` は起動ごとのトークンでゲートし、Host と Origin を検証し、厳格な CSP を適用し、レンダリングした HTML はすべてサーバー側でサニタイズしています。サニタイズを無効化する手段は `--unsafe-raw` だけです。
