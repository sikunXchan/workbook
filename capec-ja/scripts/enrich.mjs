// data/ja/CAPEC-<id>.json の supplement を、JSON パッチファイルで上書き・拡充する。
// 使い方: node scripts/enrich.mjs data/ja-enrich/<id>.json [<id>.json ...]
// パッチファイルの中身は supplement オブジェクトそのもの（summary/terms/facts/analogy/learn/interpretation）。
// 既存の supplement を丸ごと置き換える（部分マージではない。毎回フルセットを書く）。
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const jaDir = path.join(ROOT, "data/ja");

const files = process.argv.slice(2);
if (!files.length) {
  console.error("使い方: node scripts/enrich.mjs data/ja-enrich/<id>.json [...]");
  process.exit(1);
}

let ok = 0, err = 0;
for (const f of files) {
  const base = path.basename(f, ".json");
  const id = base;
  const target = path.join(jaDir, `CAPEC-${id}.json`);
  if (!fs.existsSync(target)) {
    console.error(`✗ CAPEC-${id}: data/ja/CAPEC-${id}.json が無い`);
    err++;
    continue;
  }
  const patch = JSON.parse(fs.readFileSync(f, "utf8"));
  const required = ["summary", "terms", "facts", "analogy", "learn", "interpretation"];
  const missing = required.filter((k) => patch[k] == null);
  if (missing.length) {
    console.error(`✗ CAPEC-${id}: パッチに無い項目: ${missing.join(", ")}`);
    err++;
    continue;
  }
  const d = JSON.parse(fs.readFileSync(target, "utf8"));
  d.supplement = patch;
  fs.writeFileSync(target, JSON.stringify(d, null, 1) + "\n");
  console.log(`✓ CAPEC-${id}: 補足を拡充`);
  ok++;
}
console.log(`\n完了 ${ok}件、失敗 ${err}件`);
