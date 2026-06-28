<p align="center">
  <img src="assets/logo.svg" alt="miru" width="88">
</p>

<p align="center">
  <a href="README.md">English</a> · <b>日本語</b>
</p>

# miru

AI が生成した Markdown / HTML を、ブラウザでレンダリングした状態のままインラインレビューするローカルツールです。
本文を選択するか、要素を `Alt`+クリックすると、その場にコメントを残せます。
完全にローカルで動作し、外部には何も送信しません。

## 特長

- **Bun 製の単一バイナリ**：利用者は Bun などのランタイムを用意する必要がありません（`bun build --compile` でランタイムごとバンドルされます）
- **2 種類のアンカー**：テキスト範囲（`text`）と要素（`element`）。元ファイルへの軽微な編集を越えて追従し、復元できない場合は `stale` として退避します
- **suggestion（修正提案）**：コメントに修正案（置換テキスト）を添えられ、そのまま LLM への修正指示として渡せます
- **人間↔AI レビューループ**：`miru review` は「Approve」が押されるまでブロックし、未解決コメントを JSON として出力します。返信や解決はブラウザからもヘッドレス CLI からも行え、ファイル変更時には開いているページが SSE で自動リロードされます。キーボードショートカットは、`j` / `k` で移動、`r` で解決、`Esc` で下書きをキャンセル
- **Markdown エクスポート**：未解決コメントと修正提案をまとめて、LLM に渡せる修正指示の markdown に変換します（`miru export`、またはパネルの **Export** ボタン）
- **セキュリティ**：`127.0.0.1` のみにバインドし、`/api/*` は起動ごとのトークンで保護します（SSE フィード `/api/events` のみ例外で、内容を持たないリロードヒントを流すだけ）。Host と Origin の検証で CSRF と DNS リバインディングを防ぎ、厳格な CSP を適用し、入力 HTML はサーバー側でサニタイズします
- **完全ローカル**：コメントは `<file>.miru.json` に保存されます。共有も外部送信もテレメトリも一切ありません

## インストール

### バイナリ

GitHub Releases から OS とアーキテクチャ別のバイナリ（win / macOS / linux）をダウンロードして実行します。

### スキル

miru は、コメント → 修正 → 返信のループを AI エージェント（Claude Code など）に教える[スキル](skills/miru/SKILL.md)を同梱しています。次のいずれかでインストールできます。

```sh
# gh skill 拡張経由
gh skill install 22mb/miru

# miru 自身経由
miru install
```

どちらも `SKILL.md` を `~/.claude/skills/miru/SKILL.md` に配置します。現状サポートしているのは `claude-code` のみです。

## 使い方

```sh
miru review <file.md|.html>
```

ブラウザが開きます。
本文を選択してコメントするか、画像やコードブロックなどの要素を `Alt`+クリックしてコメントします。
コメントは対象ファイルと同じ場所の `<file>.miru.json` に保存されます。

| オプション | 説明 |
|---|---|
| `--port <n>` | ポートを指定する（デフォルトはランダム） |
| `--no-open` | ブラウザを自動で開かない |
| `--unsafe-raw` | 入力 HTML のサニタイズを無効化する（信頼できる入力のみ） |
| `--lang <code>` | レンダリング文書の `lang` 属性（デフォルトは `en`） |

### コマンド

| コマンド | 説明 |
|---|---|
| `miru review <file>` | ブラウザレビューを開く。「Approve」までブロックし、`{ approved, comments }` の JSON を stdout に出力する（人間↔AI ループの 1 ラウンド分）。 |
| `miru comments <file> [--json]` | サーバーを起動せず未解決コメントを表示する。 |
| `miru comment <file> --reply-to <id> "<body>"` | コメントに返信する。 |
| `miru comment <file> --resolve <id>` | コメントを解決済みにする。 |
| `miru next <file>` | コメントがエージェント待ちになるか、ユーザーが承認するまでブロックし、JSON として出力する（`next` → 修正 → 返信のエージェントループ）。 |
| `miru export <file>` | 未解決コメントと修正提案を、LLM に渡せる修正指示 markdown として出力する。 |
| `miru install [claude-code]` | 同梱スキルを `~/.claude/skills/miru/SKILL.md` にインストールする。 |

### AI エージェントから利用する

[スキル](skills/miru/SKILL.md)をインストールしておけば（[スキル](#スキル)節を参照）、エージェントが `miru review` を実行し、JSON を読み、修正を適用して返信します。これを、コメントがゼロで承認されるまで繰り返します。

## 代替ツール

**コードレビュー（git diff）を主目的とする場合**は [difit](https://github.com/yoshiko-pg/difit) が適しています。
**よりリッチな機能を求める場合**は [crit](https://crit.md/) を検討してください。
miru はレンダリングされた md / HTML のインラインレビューに絞った設計で、生成・共有・PR 連携は持ちません。

## ライセンス

[MIT](LICENSE)
