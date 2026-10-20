# CAPEC 日本語版（非公式）

MITREの攻撃パターン辞典「CAPEC」を、日本語で読める静的サイトにするためのフォルダです。
このサイトはAIによる日本語訳で、公式の日本語訳ではありません。MITREの公式サイトではなく、MITREの承認も受けていません。

## フォルダの中身

| 場所 | 中身 |
|---|---|
| `source/` | capec.mitre.org から取得した公式XML（取得したまま） |
| `data/capec.en.json` | XMLから取り出した英語データ（`scripts/extract.py` が作る） |
| `data/ja/CAPEC-<ID>.json` | 1項目ごとの日本語訳 |
| `data/glossary.json` | 用語集（訳語の統一） |
| `data/labels.json` | データの決まった値（抽象度・ステータスなど）の訳語 |
| `data/license.json` | 著作権表示とライセンス文（原文） |
| `progress.json` | 日本語化の進み具合（`scripts/work.mjs status` が作る） |
| `scripts/` | 取り出し・生成・検証・作業管理のスクリプト |
| `assets/` | CSSとJavaScript |
| `reports/` | 要確認の一覧、訳さなかった箇所の一覧、品質チェックの結果 |
| `dist/` | 生成されたサイト（コミットしない。Vercelがビルド時に作る） |

## 手順

```sh
# 1. 公式XMLから英語データを作る（取得日を指定）
python3 -I scripts/extract.py source/<ファイル名>.xml data/capec.en.json YYYY-MM-DD

# 2. 日本語化の進み具合・次に訳す項目
node scripts/work.mjs status
node scripts/work.mjs next 10
node scripts/work.mjs show 66        # 訳す対象の文字列（⚠安全確認の印つき）
node scripts/work.mjs validate 66    # 訳文ファイルの欠けを確かめる

# 3. サイトを生成し、検索用の索引を作る
npm install
npm run build

# 4. 品質チェック（結果は reports/check-report.md）
node scripts/check.mjs --sample 20 --urls 10
```

## 訳文ファイルの形

```json
{
  "id": "66",
  "source_sha": "英語データの source_sha と同じ値（原典が更新されたら再訳が必要と分かる）",
  "status": "done",
  "seg": { "name": "日本語名", "description/0": "訳文", "...": "..." },
  "review": [{ "k": "description/0", "note": "要確認の理由" }],
  "redacted": [{ "k": "execution_flow/1/techniques/0/0", "reason": "訳さなかった理由" }],
  "supplement": {
    "summary": "ひとことで言うと（AIの要約）",
    "terms": [{ "term": "用語", "en": "term", "explain": "説明", "example": "例" }],
    "facts": [{ "text": "原典から読み取れる事実", "source": "根拠となる欄" }],
    "analogy": "たとえ話（AIの解釈）",
    "example": "具体例（AIの解釈）",
    "interpretation": ["AIの解釈"],
    "learn": ["この攻撃パターンで学べること"]
  }
}
```

- 訳が無い箇所は、サイトでは英文を出さず「〔未翻訳：原典を参照〕」と表示します（安全側）。
- 具体的な攻撃用の文字列・命令・再現に使える細部は訳さず、「（具体的な内容は原典を参照）」と書き、`redacted` に記録します。
- 原文のコード片を、安全と判断してそのまま残す場合だけ、訳文に原文と同じ文字列を入れます（整形済みで表示されます）。

## Vercel での公開設定

| 項目 | 値 |
|---|---|
| Root Directory | `capec-ja` |
| Build Command | `npm run build` |
| Output Directory | `dist` |
| Install Command | 既定のまま（`npm install`） |
