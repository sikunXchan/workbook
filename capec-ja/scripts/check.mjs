// 品質チェック。結果を reports/check-report.md に書き、問題があれば終了コード1で終わる。
// 使い方: node scripts/check.mjs [--sample 20] [--urls 10]
//   --sample N : 読み直し用に、無作為にN件の攻撃パターンを選んで一覧にする
//   --urls N   : 原典URLを無作為にN件選び、実際に開けるか確かめる(ネット接続が必要)
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DIST = path.join(ROOT, "dist");
const args = process.argv.slice(2);
const argNum = (name) => { const i = args.indexOf(name); return i >= 0 ? Number(args[i + 1]) : 0; };
const data = JSON.parse(fs.readFileSync(path.join(ROOT, "data/capec.en.json"), "utf8"));
const license = JSON.parse(fs.readFileSync(path.join(ROOT, "data/license.json"), "utf8"));
const glossary = JSON.parse(fs.readFileSync(path.join(ROOT, "data/glossary.json"), "utf8"));
const out = [];
let failed = false;
const fail = (msg) => { failed = true; out.push(`- ❌ ${msg}`); };
const ok = (msg) => out.push(`- ✅ ${msg}`);
const info = (msg) => out.push(`- ${msg}`);

function walk(dir, list = []) {
  for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, f.name);
    if (f.isDirectory()) walk(p, list); else list.push(p);
  }
  return list;
}
const htmlFiles = walk(DIST).filter((f) => f.endsWith(".html") && !f.includes(`${path.sep}pagefind${path.sep}`));
const html = new Map(htmlFiles.map((f) => [f, fs.readFileSync(f, "utf8")]));

// ---- 1. ページ数と公式データの項目数 ----
out.push("## 1. ページ数と公式データの項目数");
const srcDir = path.join(ROOT, "source");
const xmlFile = fs.existsSync(srcDir) ? fs.readdirSync(srcDir).find((f) => f.endsWith(".xml")) : null;
const kinds = { attack_pattern: "Attack_Pattern", category: "Category", view: "View" };
const ids = JSON.parse(fs.readFileSync(path.join(DIST, "assets/ids.json"), "utf8"));
if (!xmlFile) fail("source/ に公式XMLが無いため、XMLから直接数えられない");
const xml = xmlFile ? fs.readFileSync(path.join(srcDir, xmlFile), "utf8") : "";
for (const [kind, tag] of Object.entries(kinds)) {
  // XMLを直接数える(抽出スクリプトとは別の方法で数え、取りこぼしを見つける)
  const fromXml = new Set([...xml.matchAll(new RegExp(`<${tag}\\s[^>]*?\\bID="(\\d+)"`, "g"))].map((m) => m[1]));
  const pages = Object.entries(ids).filter(([, v]) => v[0] === kind).map(([id]) => id)
    .filter((id) => fs.existsSync(path.join(DIST, "capec", id, "index.html")));
  const missing = [...fromXml].filter((id) => !pages.includes(id));
  const extra = pages.filter((id) => !fromXml.has(id));
  const msg = `${tag}: 公式XML ${fromXml.size}件 / ページ ${pages.length}件`;
  if (xmlFile && (missing.length || extra.length)) fail(`${msg}（不足: ${missing.join(",") || "なし"}、余分: ${extra.join(",") || "なし"}）`);
  else if (xmlFile) ok(msg);
}

// ---- 2. 内部リンク切れ ----
out.push("", "## 2. 内部リンク切れ");
const idCache = new Map();
const idsOf = (file) => {
  if (!idCache.has(file)) idCache.set(file, new Set([...(html.get(file) || fs.readFileSync(file, "utf8")).matchAll(/\sid="([^"]+)"/g)].map((m) => m[1])));
  return idCache.get(file);
};
const broken = [];
let linkCount = 0;
for (const [file, src] of html) {
  const isNotFound = path.basename(file) === "404.html";
  for (const m of src.matchAll(/\s(?:href|src)="([^"]+)"/g)) {
    const url = m[1].replace(/&amp;/g, "&");
    if (/^(https?:|mailto:|data:)/.test(url)) continue;
    linkCount++;
    const [p, frag] = url.split("#");
    let target;
    if (p === "") target = file;
    else {
      const base = isNotFound || p.startsWith("/") ? DIST : path.dirname(file);
      target = path.join(base, p.split("?")[0]);
      if (p.endsWith("/") || (fs.existsSync(target) && fs.statSync(target).isDirectory())) target = path.join(target, "index.html");
    }
    if (!fs.existsSync(target)) { broken.push(`${path.relative(DIST, file)} → ${url}`); continue; }
    if (frag && target.endsWith(".html") && !idsOf(target).has(decodeURIComponent(frag))) broken.push(`${path.relative(DIST, file)} → ${url}（見出しが無い）`);
  }
}
if (broken.length) { fail(`内部リンク切れ ${broken.length}件（全${linkCount}件中）`); broken.slice(0, 100).forEach((b) => info(`  ${b}`)); }
else ok(`内部リンク切れ 0件（全${linkCount}件を確認）`);

// ---- 3. 英語のまま残っている本文 ----
out.push("", "## 3. 英語のまま残っている本文");
const VOID = new Set(["br", "img", "input", "meta", "link", "hr", "wbr", "source"]);
// lang="en" と明示した箇所(英語名・参考文献・更新履歴など、意図して原文のまま載せる部分)を除いた本文の文字列を返す
function jaText(src) {
  const body = src.split("data-pagefind-body")[1]?.split("</main>")[0];
  if (!body) return "";
  let depthEn = 0;
  const stack = [];
  let text = "";
  for (const m of body.matchAll(/<(\/?)([a-zA-Z0-9]+)([^>]*)>|([^<]+)/g)) {
    if (m[4] != null) { if (!depthEn) text += m[4]; continue; }
    const [, close, tag, attrs] = m;
    const t = tag.toLowerCase();
    if (VOID.has(t)) continue;
    if (!close) {
      const en = /\slang="en"/.test(attrs) || /\sdata-pagefind-ignore/.test(attrs);
      stack.push(en);
      if (en) depthEn++;
    } else {
      const en = stack.pop();
      if (en) depthEn--;
    }
  }
  // 括弧内の英語（初出の英語併記）は意図したものなので除く
  return text.replace(/&[a-z#0-9]+;/g, " ").replace(/[（(][^）)]*[A-Za-z][^）)]*[）)]/g, " ").replace(/https?:\/\/\S+/g, " ");
}
const englishRuns = [];
let untranslated = 0;
let labelMissing = 0;
for (const [file, src] of html) {
  untranslated += (src.match(/data-untranslated=/g) || []).length;
  labelMissing += (src.match(/data-label-missing/g) || []).length;
  const t = jaText(src);
  for (const m of t.matchAll(/[A-Za-z][A-Za-z'’-]*(?:[\s,.;:()"/]+[A-Za-z][A-Za-z'’-]*){3,}/g)) {
    englishRuns.push(`${path.relative(DIST, file)}: ${m[0].slice(0, 80)}`);
  }
}
(untranslated ? fail : ok)(`未翻訳の箇所: ${untranslated}件`);
(labelMissing ? fail : ok)(`訳語表に無い決まった値: ${labelMissing}件`);
if (englishRuns.length) { fail(`本文に残る英語（4語以上連続）: ${englishRuns.length}件`); englishRuns.slice(0, 200).forEach((r) => info(`  ${r}`)); }
else ok("本文に残る英語（4語以上連続）: 0件");
info("※ 英語名、参考文献、更新履歴、他の分類の名前など、lang=\"en\" を付けて意図的に原文のまま載せている部分は対象外。");

// ---- 4. フッターの著作権表示とライセンス文 ----
out.push("", "## 4. 全ページのフッター");
const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
const copyrightHtml = esc(license.copyright);
let noCopy = 0, noLic = 0, noDisc = 0;
for (const [, src] of html) {
  if (!src.includes(copyrightHtml)) noCopy++;
  if (license.status !== "verified" || !src.includes(`data-license>${esc(license.text).replace(/\n/g, "<br>")}</blockquote>`)) noLic++;
  if (!src.includes("data-disclaimer>") || !src.includes("data-disclaimer-top>")) noDisc++;
}
(noCopy ? fail : ok)(`著作権表示が無いページ: ${noCopy}件 / ${html.size}件`);
(noLic ? fail : ok)(`ライセンス文（原文）が無いページ: ${noLic}件 / ${html.size}件${license.status !== "verified" ? "（ライセンス文が未取得）" : ""}`);
(noDisc ? fail : ok)(`「AIによる非公式の訳」の注意書きが無いページ: ${noDisc}件 / ${html.size}件`);

// ---- 5. 要確認・伏せた箇所・用語の統一 ----
out.push("", "## 5. 要確認・伏せた箇所・用語の統一");
const jaDir = path.join(ROOT, "data/ja");
const trs = fs.existsSync(jaDir) ? fs.readdirSync(jaDir).filter((f) => f.endsWith(".json")).map((f) => JSON.parse(fs.readFileSync(path.join(jaDir, f), "utf8"))) : [];
const byId = new Map(data.entries.map((e) => [e.id, e]));
const segOf = (e) => { const o = {}; (function w(x) { if (Array.isArray(x)) x.forEach(w); else if (x && typeof x === "object") { if (x.k && x.en != null) o[x.k] = x.en; Object.values(x).forEach(w); } })(e); return o; };
const reviewLines = [], redactLines = [], glossLines = [], staleLines = [], quoteLines = [];
for (const t of trs) {
  const e = byId.get(String(t.id));
  if (!e) continue;
  if (t.source_sha !== e.source_sha) staleLines.push(`CAPEC-${t.id}`);
  const segs = segOf(e);
  for (const r of t.review || []) reviewLines.push(`| CAPEC-${t.id} | ${r.k} | ${r.note || ""} |`);
  for (const r of t.redacted || []) redactLines.push(`| CAPEC-${t.id} | ${r.k} | ${r.reason || ""} |`);
  for (const k of Object.keys(t.quotes || {})) quoteLines.push(`| CAPEC-${t.id} | ${k} |`);
  for (const [k, en] of Object.entries(segs)) {
    const ja = t.seg?.[k];
    if (!ja) continue;
    for (const g of glossary.terms) {
      if (new RegExp(`\\b${g.en.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "i").test(en) && !ja.includes(g.ja.replace(/（.*$/, ""))) glossLines.push(`| CAPEC-${t.id} | ${k} | ${g.en} → ${g.ja} |`);
    }
  }
}
const missingKeys = [];
for (const t of trs) {
  const e = byId.get(String(t.id));
  if (!e || t.status !== "done") continue;
  const quoted = new Set(Object.keys(t.quotes || {}));
  for (const k of Object.keys(segOf(e))) if (!quoted.has(k) && (t.seg?.[k] == null || t.seg[k] === "")) missingKeys.push(`CAPEC-${t.id} ${k}`);
}
(missingKeys.length ? fail : ok)(`「完了」なのに訳が欠けている箇所: ${missingKeys.length}件`);
missingKeys.slice(0, 50).forEach((x) => info(`  ${x}`));
(staleLines.length ? fail : ok)(`原典が更新されて再訳が必要な項目: ${staleLines.length}件 ${staleLines.join(", ")}`);
info(`要確認の印: ${reviewLines.length}件（reports/needs-review.md）`);
info(`安全のため訳さなかった箇所: ${redactLines.length}件（reports/redactions.md）`);
info(`原文を引用ブロックで示した具体箇所: ${quoteLines.length}件（reports/quotes.md）`);
info(`用語集の訳語が使われていない可能性: ${glossLines.length}件（reports/glossary-check.md、文脈上正しい場合もあるため目視で確認）`);
fs.mkdirSync(path.join(ROOT, "reports"), { recursive: true });
fs.writeFileSync(path.join(ROOT, "reports/needs-review.md"), `# 要確認の一覧\n\n| 項目 | 場所 | 内容 |\n|---|---|---|\n${reviewLines.join("\n")}\n`);
fs.writeFileSync(path.join(ROOT, "reports/redactions.md"), `# 安全のため訳さなかった箇所\n\n| 項目 | 場所 | 理由 |\n|---|---|---|\n${redactLines.join("\n")}\n`);
fs.writeFileSync(path.join(ROOT, "reports/quotes.md"), `# 原文を引用ブロックで示した具体箇所\n\n| 項目 | 場所 |\n|---|---|\n${quoteLines.join("\n")}\n`);
fs.writeFileSync(path.join(ROOT, "reports/glossary-check.md"), `# 用語集の訳語が使われていない可能性\n\n| 項目 | 場所 | 用語 |\n|---|---|---|\n${glossLines.join("\n")}\n`);

// ---- 6. 無作為抽出 ----
const aps = data.entries.filter((e) => e.kind === "attack_pattern").map((e) => e.id);
const pick = (n) => { const a = [...aps]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a.slice(0, n); };
const nSample = argNum("--sample");
if (nSample) { out.push("", `## 6. 読み直し用の無作為抽出（${nSample}件）`); info(pick(nSample).map((i) => `CAPEC-${i}`).join(", ")); }
const nUrls = argNum("--urls");
if (nUrls) {
  out.push("", `## 7. 原典URLの確認（無作為に${nUrls}件）`);
  for (const id of pick(nUrls)) {
    const url = `https://capec.mitre.org/data/definitions/${id}.html`;
    let code = "000";
    try { code = execFileSync("curl", ["-sS", "-o", "/dev/null", "-w", "%{http_code}", "-L", "--max-time", "30", url], { encoding: "utf8" }).trim(); } catch (e) { code = `接続失敗`; }
    (code === "200" ? ok : fail)(`${url} → ${code}`);
  }
}

const report = `# 品質チェックの結果\n\n実行日時: ${new Date().toISOString()}\n\n${out.join("\n")}\n`;
fs.writeFileSync(path.join(ROOT, "reports/check-report.md"), report);
console.log(report);
process.exit(failed ? 1 : 0);
