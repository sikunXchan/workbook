# CAPEC 日本語版（非公式）

MITREの攻撃パターン辞典「CAPEC」を、日本語で読める静的サイトにするためのフォルダです。
このサイトはAIによる日本語訳で、公式の日本語訳ではありません。MITREの公式サイトではなく、MITREの承認も受けていません。

## フォルダの中身

| 場所 | 中身 |
|---|---|
| `source/` | capec.mitre.org から取得した公式XML（取得したまま） |
| `source/attack/` | MITRE ATT&CKの公式STIXデータ（取得したまま。50MB超のためコミットしない） |
| `data/capec.en.json` | XMLから取り出した英語データ（`scripts/extract.py` が作る） |
| `data/ja/CAPEC-<ID>.json` | 1項目ごとの日本語訳 |
| `data/attack.<domain>.json` | ATT&CKのSTIXデータから取り出した英語データ（`scripts/attack-extract.mjs` が作る。domainは`enterprise-attack`など） |
| `data/attack-ja/<domain>/<ID>.json` | ATT&CKの戦術・技術1件ごとの日本語訳（IDは`TA0001`や`T1566`など） |
| `data/glossary.json` | 用語集（訳語の統一） |
| `data/labels.json` | データの決まった値（抽象度・ステータスなど）の訳語 |
| `data/license.json` | 著作権表示とライセンス文（原文） |
| `progress.json` | 日本語化の進み具合（`scripts/work.mjs status` が作る） |
| `scripts/` | 取り出し・生成・検証・作業管理のスクリプト |
| `assets/` | CSSとJavaScript |
| `reports/` | 要確認の一覧、訳さなかった箇所の一覧、品質チェックの結果 |
| `dist/` | 生成されたサイト（コミットしない。Vercelがビルド時に作る） |

### MITRE ATT&CKについて

CAPECが「攻撃パターンの種類」の辞典であるのに対し、ATT&CKは「攻撃者が実際にどう行動するか」（戦術・技術・手口の実例）を記録した辞典。既存のCAPECサイトに統合する形で、同じビルドパイプライン・デザイン・AI補足の方針で日本語化する。

- 対象は**Enterprise行列の戦術(Tactic)・技術・サブ技術(Technique)のみ**（まずここから。Mobile・ICS行列は今後の段階）。技術ページには、その技術に効く対策（Mitigation）の適用ノートと、実際の攻撃グループ・ソフトウェアによる使用例（Procedure Example）も訳す。
- 攻撃グループ・ソフトウェア（Group/Software、合計2,800件超）は、CAPECにおけるCWE・CVEと同じ扱いとし、**専用の訳文ページは作らず、公式サイト（attack.mitre.org）へのリンクのみ**とする。
- 技術（Technique）1件あたりの使用例（Procedure Example）が極端に多い場合（数十〜数百件。例：T1016は278件）、**代表的な20〜25件程度を訳出し、残りは訳さない**（サイト上では「〔未翻訳：原典を参照〕」と表示される）。対策（Mitigation）は件数が少ないため、常に全件訳出する。これは翻訳の量と質のバランスをとるための、意図的な範囲の決定であり、欠落ではない。
- 原文の`(Citation: ...)`インライン引用は除き、出典は項目ごとのReferences欄にまとめる。`[語](url)`形式のMarkdownリンクは語だけを残す（Phase 1の簡略化。関連情報は戦術・サブ技術・対策・使用例など、構造化されたデータとして別途保持されている）。

## 手順

```sh
# 1. 公式XMLから英語データを作る（取得日を指定）
python3 -I scripts/extract.py source/<ファイル名>.xml data/capec.en.json YYYY-MM-DD

# 1'. ATT&CKの場合：公式STIXデータから英語データを作る
node scripts/attack-extract.mjs source/attack/<domain>.json <domain> YYYY-MM-DD

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
