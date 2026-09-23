<p align="center">
  <a href="CONTRIBUTING.md">English</a> · <b>日本語</b>
</p>

# miru へのコントリビューション

miru は、ローカル環境だけで動作する小さなツールで、[スコープ](README.ja.md#スコープ)（md や HTML ドキュメントのレンダリングレビュー）を意図的に狭く絞っています。
生成や共有、コード差分のレビューを志向する変更はスコープ外ですが、それ以外の変更は歓迎します。

## セットアップ

miru は [Bun](https://bun.sh) 上で動作し（CI ではバージョンを **1.4.0** に固定）、他のランタイムは必要ありません。

```sh
bun install        # prepare スクリプトにより、lefthook 経由で git hook も同時に有効化されます
```

リポジトリは、次の 4 つのパッケージで構成される Bun ワークスペースです。

- **`packages/contract`**：zod スキーマと `z.infer` による型。ワイヤ形式と永続化形式の単一の情報源（Single Source of Truth）であり、server と frontend の両方で共有されます。
- **`packages/server`**：Bun 製のレビューサーバーとドメインヘルパー（render、inject、store、watch）。CLI から利用されます。
- **`packages/cli`**：`miru` CLI 本体（`miru review`、`next`、`comment` など）。`@miru/server` を基盤として構築されています。
- **`packages/frontend`**：React 製の UI。バンドルした上で `miru` バイナリに埋め込まれます。

## 開発

```sh
bun run dev review examples/sample.md   # ソースから CLI を実行
bun run build:front                     # packages/frontend/src → packages/frontend/dist/miru.{js,css}
bun run build                           # 単一バイナリ ./miru をコンパイル（アセットを埋め込み）
```

frontend のバンドルは、ビルド時に CLI へ埋め込まれます（`packages/frontend/dist` を text import で読み込み）。
そのため、frontend を変更したときは、バイナリや `miru review` で動作を確認する前に `build:front` を再実行してください。

`build:front` の実体は `packages/cli/src/build-front.ts` です。
`bun build` コマンドはプラグインを受け付けないため、このスクリプトでは React Compiler のプラグイン（`react-compiler.ts`。Oxc による Rust 移植版の `oxc-transform-react`）を指定して `Bun.build` を実行しています。
コンパイラが適用されるのはバンドル時だけであり、frontend のテストはコンパイル前のソースに対して実行されます（プラグイン自体のテストは `packages/cli` にあります）。
そのため、パネルの変更をコンパイル済みのコードで確認するには、ブラウザ上で動作させる必要があります（`bun run dev review …` または後述の開発ループを使用）。
特定の関数をコンパイラの適用対象から外したいときは、`"use no memo"` ディレクティブを使います。

### フロントエンド開発ループ

パネルはサーバーがレンダリングした文書に注入される構造のため、フロントエンドの開発は実際のレビューサーバーに対して行います。
次の 1 コマンドで、サーバーとパネルの両方をソースから直接起動できます。

```sh
bun run dev:front                     # examples/sample.html のスクラッチコピー → http://127.0.0.1:4400
bun run dev:front path/to/doc.md      # 特定の文書をレビュー（サイドカーは通常どおり永続化）
```

`packages/cli/src/dev-server.ts` は、パネルをインプロセスの `Bun.build` でバンドルし、`packages/frontend/src` 配下のファイルが変更されるたびに再ビルドします。
バンドル時には、dev 用の define、`build:front` と同じ React Compiler プラグイン、インラインソースマップを使用します。
なお、Bun のプラグイン API はソースマップを受け渡せないため、ソースマップが指すのは `.tsx` ではなくコンパイラの出力です。
接続中のブラウザは、サーバー自身の SSE チャンネル経由でリロードされます。
`build:front` の実行、埋め込みアセット、追加のツールはいずれも不要です。
また、ページには本番と同じ CSP が適用されるため、dev 環境でもバイナリと同じ挙動になります。
指定できるフラグ（`--` の後に指定）は、`--port N`（デフォルトは 4400）と `--no-open` です。
ただし、最終確認は引き続き埋め込みバンドル（`build:front` を実行してから再起動）で行ってください。

## PR を開く前に

CI は PR ごとに次の 4 つのチェックを実行するため、事前にローカルでも実行してください。

```sh
bun run typecheck      # tsc -b
bun run lint           # oxlint
bun run fmt:check      # oxfmt --check（pre-commit hook がステージ済みのファイルを整形します）
bun run test           # bun run --filter '*' test（パッケージごとに別プロセスで実行。frontend の happy-dom を server のテストに混入させないため）
```

PR の内容は単一の関心事に絞り、CI が通過した状態（green）にしてください。
新しいテストは、`*.test.ts` または `*.test.tsx` として対象ユニットのファイルと並べて配置します。

## 規約

パッケージごとのコーディング規約とテスト規約は [`.claude/rules/`](.claude/rules) にあります（規約はパスごとに適用範囲が区切られており、AI エージェントにも提供されます）。
ここでは、最初に共有しておく不変条件を 2 つ挙げます。

- **contract を単一の情報源にする**：新しいワイヤ形式や永続化形式は、素の TypeScript インターフェースではなく、`@miru/contract` の zod スキーマとして追加してください。リクエストボディは手書きでパースせず、`safeParse` で検証してください（検証に失敗したときは 400 を返します）。
- **セキュリティ境界を弱めない**：miru は `127.0.0.1` だけにバインドし、`/api/*` へのアクセスを起動ごとに発行されるトークンで制限しています。また、Host ヘッダーと Origin ヘッダーを検証し、厳格な CSP を適用しています。レンダリングした HTML はすべてサーバー側でサニタイズしており、デフォルトの層では表現（CSS・SVG・メディア）を許可しつつ実行可能な要素を除去し、`--strict` ではタイポグラフィのみを許可します。サニタイズを無効化する手段は `--unsafe-raw` だけです。
