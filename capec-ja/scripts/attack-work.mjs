// ATT&CKの日本語化作業を管理する(中断しても続きから再開できる)。
// 進み具合は data/attack-ja/<domain>/ の訳文ファイルから毎回計算し、attack-progress.<domain>.json に書き出す。
// 使い方:
//   node scripts/attack-work.mjs status [domain]        … 進み具合を表示
//   node scripts/attack-work.mjs next [domain] 10        … 次に訳すID(技術のみ、完了済みは除く)
//   node scripts/attack-work.mjs show [domain] T1566     … 訳す対象の文字列を、キー付きで表示
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const [cmd, domainArg, arg] = process.argv.slice(2);
const domain = domainArg && !/^\d/.test(domainArg) && domainArg !== "status" ? domainArg : "enterprise-attack";
const realArg = (domainArg === domain ? arg : domainArg);

const dataPath = path.join(ROOT, `data/attack.${domain}.json`);
if (!fs.existsSync(dataPath)) { console.error(`${dataPath} が見つかりません`); process.exit(1); }
const data = JSON.parse(fs.readFileSync(dataPath, "utf8"));
const jaDir = path.join(ROOT, "data/attack-ja", domain);
const jaPath = (id) => path.join(jaDir, `${id}.json`);
const loadTr = (id) => (fs.existsSync(jaPath(id)) ? JSON.parse(fs.readFileSync(jaPath(id), "utf8")) : null);
const isDone = (e) => { const t = loadTr(e.id); return t && t.status === "done" && t.source_sha === e.source_sha; };

// 技術はサブ技術を持つ親から先に(親の説明が無いとサブ技術の文脈が分からないため)、ID順
const techOrder = [...data.techniques].sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }));

if (cmd === "status" || !cmd) {
  const doneTactics = data.tactics.filter(isDone);
  const doneTechs = techOrder.filter(isDone);
  const staleTactics = data.tactics.filter((e) => { const t = loadTr(e.id); return t && t.source_sha !== e.source_sha; });
  const staleTechs = techOrder.filter((e) => { const t = loadTr(e.id); return t && t.source_sha !== e.source_sha; });
  console.log(`[${domain}] 戦術 ${doneTactics.length}/${data.tactics.length}、技術 ${doneTechs.length}/${techOrder.length}（再訳が必要: 戦術${staleTactics.length}件・技術${staleTechs.length}件）`);
  fs.writeFileSync(path.join(ROOT, `attack-progress.${domain}.json`), JSON.stringify({
    updated: new Date().toISOString(),
    tactic: { total: data.tactics.length, done: doneTactics.length },
    technique: { total: techOrder.length, done: doneTechs.length },
    stale_tactics: staleTactics.map((e) => e.id),
    stale_techniques: staleTechs.map((e) => e.id),
  }, null, 1) + "\n");
} else if (cmd === "next") {
  console.log(techOrder.filter((e) => !isDone(e)).slice(0, Number(realArg) || 10).map((e) => e.id).join(" "));
} else if (cmd === "show") {
  const e = data.tactics.find((x) => x.id === realArg) || techOrder.find((x) => x.id === realArg);
  if (!e) { console.error(`${realArg} はデータにありません`); process.exit(1); }
  console.log(JSON.stringify(e, null, 1));
} else {
  console.error("使い方: node scripts/attack-work.mjs [status|next|show] [domain] [arg]");
  process.exit(1);
}
