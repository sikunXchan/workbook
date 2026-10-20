// 補足(supplement)の拡充が済んでいない項目を、IDの昇順で一覧する。
// 「拡充済み」の判定は、learn と interpretation の両方が入っていること。
// 使い方: node scripts/enrich-status.mjs [件数=20]
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const data = JSON.parse(fs.readFileSync(path.join(ROOT, "data/capec.en.json"), "utf8"));
const byId = new Map(data.entries.map((e) => [e.id, e]));
const jaDir = path.join(ROOT, "data/ja");
const n = Number(process.argv[2]) || 20;

const rows = [];
let total = 0, done = 0;
for (const f of fs.readdirSync(jaDir)) {
  if (!f.endsWith(".json")) continue;
  const d = JSON.parse(fs.readFileSync(path.join(jaDir, f), "utf8"));
  const e = byId.get(String(d.id));
  if (!e || e.kind !== "attack_pattern") continue; // 補足はattack_patternのみ
  if (!d.supplement) continue; // 廃止項目など、そもそも補足が無い
  total++;
  const enriched = d.supplement.learn?.length && d.supplement.interpretation?.length;
  if (enriched) done++;
  else rows.push({ id: Number(d.id), name: d.seg?.name || e.name.en });
}
rows.sort((a, b) => a.id - b.id);
console.log(`拡充済み ${done} / ${total}件\n`);
for (const r of rows.slice(0, n)) console.log(`CAPEC-${r.id}\t${r.name}`);
console.log(`\n...残り ${Math.max(0, rows.length - n)}件`);
