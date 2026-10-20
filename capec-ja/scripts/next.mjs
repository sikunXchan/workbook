// 次に訳す項目を、取込み用バッチと同じ書式で表示する。
// 使い方: node scripts/next.mjs [文字数の目安=12000] [最大件数=14]
//   原文が訳済みの文と完全に同じ箇所は「=自動」と表示する（書かなくてよい）。
//   ⚠ は、コードや具体的な文字列らしき箇所（引用ブロックにするかの判断が必要）。
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { segs, loadTM } from "./import.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const data = JSON.parse(fs.readFileSync(path.join(ROOT, "data/capec.en.json"), "utf8"));
const budget = Number(process.argv[2]) || 12000;
const maxN = Number(process.argv[3]) || 14;
const onlyKind = process.argv[4] || "";
const rank = { attack_pattern: 0, category: 1, view: 2 };
const order = [...data.entries].sort((a, b) => rank[a.kind] - rank[b.kind] || Number(a.id) - Number(b.id));
const done = (e) => {
  const p = path.join(ROOT, "data/ja", `CAPEC-${e.id}.json`);
  if (!fs.existsSync(p)) return false;
  const t = JSON.parse(fs.readFileSync(p, "utf8"));
  return t.status === "done" && t.source_sha === e.source_sha;
};
function risky(s) {
  if (/`[^`]+`/.test(s)) return true;
  if (/[<>{};|$]+.*[<>{};|$]/.test(s)) return true;
  if (/["'][^"']*[=<>;%()][^"']*["']/.test(s)) return true;
  if (/\b(SELECT|UNION|INSERT|DROP|exec|cmd|bash|powershell|wget|curl|chmod|sudo|eval|netcat|nc)\b/i.test(s)) return true;
  if (/%[0-9A-F]{2}|\\x[0-9a-f]{2}|\.\.\/|https?:\/\//i.test(s)) return true;
  return false;
}
const tm = loadTM();
const deferred = new Set(JSON.parse(fs.readFileSync(path.join(ROOT, "data/deferred.json"), "utf8")).ids);
const holdIds = new Set(process.env.HOLD ? [] : JSON.parse(fs.readFileSync(path.join(ROOT, "data/hold.json"), "utf8")).ids);
const pending = order.filter((e) => !done(e) && !deferred.has(e.id) && !holdIds.has(e.id) && (!onlyKind || e.kind === onlyKind));
let used = 0, n = 0;
for (const e of pending) {
  const s = segs(e);
  const chars = Object.values(s).filter((en) => !tm.has(en)).reduce((a, b) => a + b.length, 0);
  if (n > 0 && (used + chars > budget || n >= maxN)) break;
  used += chars; n++;
  const extra = e.kind === "attack_pattern" ? ` ${e.abstraction || ""} ${e.status || ""} CWE=${e.related_weaknesses.length}` : ` ${e.status || ""}${e.kind === "category" ? ` members=${(e.members || []).length}` : ""}`;
  console.log(`\n## ${e.id}   // ${e.kind}${extra}  sha=${e.source_sha}`);
  for (const [k, en] of Object.entries(s)) {
    if (tm.has(en)) { console.log(`${k}: =自動`); continue; }
    console.log(`${k}${risky(en) ? " ⚠" : ""}: ${en}`);
  }
}
console.log(`\n// このバッチ: ${n}件、約${used}文字。残り ${pending.length - n}件`);
