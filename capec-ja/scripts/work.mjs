// 日本語化の作業を管理する(中断しても続きから再開できる)。
// 進み具合は data/ja/ の訳文ファイルから毎回計算し、progress.json に書き出す。
// 使い方:
//   node scripts/work.mjs status        … 進み具合を表示し progress.json を更新
//   node scripts/work.mjs next 10       … 次に訳す10件のIDを表示(完了済みは除く)
//   node scripts/work.mjs show 66       … 訳す対象の文字列を、キー付きで表示(安全確認が必要な箇所に印)
//   node scripts/work.mjs validate 66   … 訳文ファイルに欠けや余分が無いか確かめる
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const data = JSON.parse(fs.readFileSync(path.join(ROOT, "data/capec.en.json"), "utf8"));
const byId = new Map(data.entries.map((e) => [e.id, e]));
const jaPath = (id) => path.join(ROOT, "data/ja", `CAPEC-${id}.json`);
const loadTr = (id) => (fs.existsSync(jaPath(id)) ? JSON.parse(fs.readFileSync(jaPath(id), "utf8")) : null);
const segs = (e) => { const o = {}; (function w(x) { if (Array.isArray(x)) x.forEach(w); else if (x && typeof x === "object") { if (x.k && x.en != null) o[x.k] = x.en; Object.values(x).forEach(w); } })(e); return o; };

// 攻撃パターンをID順に先に、その後にカテゴリ、ビュー
const order = [...data.entries].sort((a, b) => {
  const r = { attack_pattern: 0, category: 1, view: 2 };
  return r[a.kind] - r[b.kind] || Number(a.id) - Number(b.id);
});
const isDone = (e) => { const t = loadTr(e.id); return t && t.status === "done" && t.source_sha === e.source_sha; };

// 安全確認が必要そうな箇所(コード、記号の多い文字列、命令らしき語)
function risky(s) {
  const reasons = [];
  if (/`[^`]+`/.test(s)) reasons.push("コード表記");
  if (/[<>{};|$]{1,}.*[<>{};|$]/.test(s)) reasons.push("記号が多い");
  if (/["'][^"']*[=<>;%()][^"']*["']/.test(s)) reasons.push("引用符内に記号");
  if (/\b(SELECT|UNION|INSERT|DROP|script|exec|cmd|bash|powershell|wget|curl|nc|chmod|sudo|eval)\b/i.test(s)) reasons.push("命令らしき語");
  if (/%[0-9A-F]{2}|\\x[0-9a-f]{2}|\.\.\//i.test(s)) reasons.push("符号化・パス表記");
  return reasons;
}

const [cmd, arg] = process.argv.slice(2);
if (cmd === "status" || !cmd) {
  const done = order.filter(isDone);
  const stale = order.filter((e) => { const t = loadTr(e.id); return t && t.source_sha !== e.source_sha; });
  const byKind = (list, k) => list.filter((e) => e.kind === k).length;
  const prog = {
    updated: new Date().toISOString(), data_version: data.meta.version,
    total: order.length, done: done.length, remaining: order.length - done.length,
    attack_pattern: { total: byKind(order, "attack_pattern"), done: byKind(done, "attack_pattern") },
    category: { total: byKind(order, "category"), done: byKind(done, "category") },
    view: { total: byKind(order, "view"), done: byKind(done, "view") },
    stale: stale.map((e) => e.id),
    done_ids: done.map((e) => e.id),
  };
  fs.writeFileSync(path.join(ROOT, "progress.json"), JSON.stringify(prog, null, 1) + "\n");
  console.log(`完了 ${prog.done} / ${prog.total}（攻撃パターン ${prog.attack_pattern.done}/${prog.attack_pattern.total}、カテゴリ ${prog.category.done}/${prog.category.total}、ビュー ${prog.view.done}/${prog.view.total}）、再訳が必要 ${stale.length}件`);
} else if (cmd === "next") {
  console.log(order.filter((e) => !isDone(e)).slice(0, Number(arg) || 10).map((e) => e.id).join(" "));
} else if (cmd === "show") {
  const e = byId.get(String(arg));
  if (!e) { console.error(`CAPEC-${arg} はデータにありません`); process.exit(1); }
  console.log(`# CAPEC-${e.id} (${e.kind}) source_sha=${e.source_sha}`);
  for (const [k, en] of Object.entries(segs(e))) {
    const r = risky(en);
    console.log(`\n[${k}]${r.length ? `  ⚠安全確認: ${r.join("・")}` : ""}\n${en}`);
  }
} else if (cmd === "validate") {
  const e = byId.get(String(arg));
  const t = loadTr(arg);
  if (!e || !t) { console.error("項目または訳文がありません"); process.exit(1); }
  const keys = Object.keys(segs(e));
  const quoted = new Set(Object.keys(t.quotes || {}));
  const missing = keys.filter((k) => !quoted.has(k) && (t.seg?.[k] == null || t.seg[k] === ""));
  const extra = Object.keys(t.seg || {}).filter((k) => !keys.includes(k));
  for (const k of quoted) if (!keys.includes(k)) extra.push("quotes:" + k);
  const problems = [];
  if (t.source_sha !== e.source_sha) problems.push("source_sha が一致しない");
  if (missing.length) problems.push(`訳の欠け: ${missing.join(", ")}`);
  if (extra.length) problems.push(`余分なキー: ${extra.join(", ")}`);
  for (const r of [...(t.review || []), ...(t.redacted || [])]) if (!keys.includes(r.k)) problems.push(`存在しないキーへの印: ${r.k}`);
  if (e.kind === "attack_pattern" && !t.supplement) problems.push("初学者向けの補足が無い");
  console.log(problems.length ? `CAPEC-${arg}: 問題あり\n- ${problems.join("\n- ")}` : `CAPEC-${arg}: OK（${keys.length}箇所）`);
  process.exit(problems.length ? 1 : 0);
} else {
  console.error("使い方: node scripts/work.mjs status | next N | show ID | validate ID");
  process.exit(1);
}
