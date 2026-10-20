// 訳文のテキストバッチを data/ja/CAPEC-<id>.json に取り込む。
// 使い方: node scripts/import.mjs data/ja-src/<バッチ>.txt ...
//
// バッチの書式（1行1項目。空行と「//」始まりの行は無視）:
//   ## 66                          項目の開始
//   name: 日本語名                  キー: 訳文
//   Q execution_flow/0/techniques/0/0        訳さず原文を引用ブロックで示す（原文はスクリプトが写す）
//   Q key: 日本語の前置き           前置きを付けて引用ブロックにする
//   R key: 要確認の理由             その箇所に「要確認」の印を付ける
//   s.summary: …                    初学者向けの補足(AI)
//   s.term: 用語 | English | 説明 | 例(省略可)
//   s.fact: 事実 | 根拠となる原典の欄
//   s.analogy: …   s.example: …   s.interp: …(複数可)   s.learn: …(複数可)
//
// 原文が既に訳された文と完全に同じ場合は、書かなくても訳(または引用)が自動で入る。
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const data = JSON.parse(fs.readFileSync(path.join(ROOT, "data/capec.en.json"), "utf8"));
const byId = new Map(data.entries.map((e) => [e.id, e]));
const jaDir = path.join(ROOT, "data/ja");
fs.mkdirSync(jaDir, { recursive: true });

export function segs(e) {
  const o = {};
  (function w(x) {
    if (Array.isArray(x)) x.forEach(w);
    else if (x && typeof x === "object") {
      if (x.k && x.en != null) o[x.k] = x.en;
      Object.values(x).forEach(w);
    }
  })(e);
  return o;
}

// 翻訳メモリ: 英文 → 訳 または 引用
export function loadTM() {
  const tm = new Map();
  for (const f of fs.readdirSync(jaDir)) {
    if (!f.endsWith(".json")) continue;
    const t = JSON.parse(fs.readFileSync(path.join(jaDir, f), "utf8"));
    const e = byId.get(String(t.id));
    if (!e) continue;
    for (const [k, en] of Object.entries(segs(e))) {
      if (tm.has(en)) continue;
      if (t.quotes?.[k] != null && !(t.seg?.[k])) tm.set(en, { q: true });
      else if (t.seg?.[k]) tm.set(en, { ja: t.seg[k], q: t.quotes?.[k] != null });
    }
  }
  return tm;
}

function parse(text) {
  const entries = [];
  let cur = null;
  text.split("\n").forEach((raw, i) => {
    const line = raw.replace(/\s+$/, "");
    if (!line || line.startsWith("//")) return;
    let m;
    if ((m = line.match(/^## (\d+)\s*$/))) { cur = { id: m[1], seg: {}, quotes: {}, review: [], sup: {}, errs: [] }; entries.push(cur); return; }
    if (!cur) throw new Error(`行${i + 1}: 項目の開始(## ID)の前に内容がある`);
    if ((m = line.match(/^Q ([A-Za-z0-9_/]+)(?::\s*(.*))?$/))) { cur.quotes[m[1]] = true; if (m[2]) cur.seg[m[1]] = m[2]; return; }
    if ((m = line.match(/^R ([A-Za-z0-9_/]+):\s*(.*)$/))) { cur.review.push({ k: m[1], note: m[2] }); return; }
    if ((m = line.match(/^s\.(summary|term|fact|analogy|example|interp|learn):\s*(.*)$/))) {
      const [, kind, v] = m;
      const s = cur.sup;
      if (kind === "term") { const p = v.split(" | "); (s.terms ||= []).push({ term: p[0], en: p[1] || "", explain: p[2] || "", ...(p[3] ? { example: p[3] } : {}) }); }
      else if (kind === "fact") { const p = v.split(" | "); (s.facts ||= []).push({ text: p[0], source: p[1] || "" }); }
      else if (kind === "interp") (s.interpretation ||= []).push(v);
      else if (kind === "learn") (s.learn ||= []).push(v);
      else s[kind] = v;
      return;
    }
    if ((m = line.match(/^([A-Za-z0-9_/]+):\s*(.*)$/))) { cur.seg[m[1]] = m[2]; return; }
    cur.errs.push(`行${i + 1}: 解釈できない行: ${line.slice(0, 40)}`);
  });
  return entries;
}

function main() {
  const files = process.argv.slice(2);
  if (!files.length) { console.error("使い方: node scripts/import.mjs <バッチ.txt> ..."); process.exit(1); }
  const tm = loadTM();
  let ok = 0, ng = 0, tmFilled = 0;
  for (const f of files) {
    for (const ent of parse(fs.readFileSync(f, "utf8"))) {
      const e = byId.get(ent.id);
      const errs = [...ent.errs];
      if (!e) { console.log(`✗ CAPEC-${ent.id}: 公式データに無い`); ng++; continue; }
      const src = segs(e);
      const seg = {}, quotes = {};
      for (const k of Object.keys(src)) {
        if (ent.quotes[k]) { quotes[k] = src[k]; if (ent.seg[k]) seg[k] = ent.seg[k]; continue; }
        if (ent.seg[k]) { seg[k] = ent.seg[k]; continue; }
        const hit = tm.get(src[k]);
        if (hit) { tmFilled++; if (hit.q) quotes[k] = src[k]; if (hit.ja) seg[k] = hit.ja; continue; }
        errs.push(`訳が無い: ${k}`);
      }
      for (const k of [...Object.keys(ent.seg), ...Object.keys(ent.quotes)]) if (!(k in src)) errs.push(`存在しないキー: ${k}`);
      for (const r of ent.review) if (!(r.k in src)) errs.push(`存在しないキーへの印: ${r.k}`);
      if (e.kind === "attack_pattern" && e.status !== "Deprecated" && e.status !== "Obsolete" && !ent.sup.summary) errs.push("初学者向けの補足(s.summary)が無い");
      if (seg.name && /[A-Za-z]{5,}/.test(seg.name.replace(/[（(][^）)]*[）)]/g, "").replace(/XPath|XQuery|HTTPS|CISA|CAPEC|WASC|OWASP|JavaScript|Java|Cookie|Wi-Fi|Bluetooth|Android|Windows|Linux|Active|Directory|Office|Google|Apple|Cisco|Microsoft|REST|RESTful/g, "")) ) errs.push(`名前に英語が残っている疑い: ${seg.name}`);
      if (errs.length) { console.log(`✗ CAPEC-${ent.id}: ${errs.slice(0, 6).join(" / ")}${errs.length > 6 ? ` ほか${errs.length - 6}件` : ""}`); ng++; continue; }
      const out = { id: ent.id, source_sha: e.source_sha, status: "done", seg, ...(Object.keys(quotes).length ? { quotes } : {}), review: ent.review, redacted: [], ...(Object.keys(ent.sup).length ? { supplement: ent.sup } : {}) };
      fs.writeFileSync(path.join(jaDir, `CAPEC-${ent.id}.json`), JSON.stringify(out, null, 1) + "\n");
      for (const [k, en] of Object.entries(src)) if (!tm.has(en) && (seg[k] || quotes[k])) tm.set(en, { ja: seg[k], q: quotes[k] != null });
      ok++;
    }
  }
  console.log(`取り込み: 成功 ${ok}件、失敗 ${ng}件（原文一致で自動補完した箇所 ${tmFilled}件）`);
  process.exit(ng ? 1 : 0);
}
if (process.argv[1] === fileURLToPath(import.meta.url)) main();
