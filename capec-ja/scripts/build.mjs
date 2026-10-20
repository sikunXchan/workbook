// 英語データ(data/capec.en.json)と日本語訳(data/ja/*.json)から静的サイトを dist/ に生成する。
// 使い方: node scripts/build.mjs
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DIST = path.join(ROOT, "dist");
const readJson = (p) => JSON.parse(fs.readFileSync(path.join(ROOT, p), "utf8"));

// 公式データをまだ取り込んでいない間は、ビルドを失敗させずに「準備中」のページだけを出す
if (!fs.existsSync(path.join(ROOT, "data/capec.en.json"))) {
  const lic = readJson("data/license.json");
  const e = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const note = "AIによる日本語訳です。公式の日本語訳ではなく、MITREの公式サイトでも、MITREの承認を受けたものでもありません。誤りがありえるため、重要な点は原典（英語）で確認してください。";
  const html = `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>準備中 | CAPEC 攻撃パターン辞典 日本語版（非公式）</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=BIZ+UDPGothic:wght@400;700&family=Zen+Maru+Gothic:wght@500;700;900&display=swap">
<link rel="stylesheet" href="/assets/style.css">
</head>
<body>
<header class="head"><div class="wrap head-row"><a class="brand" href="/"><span class="stamp" aria-hidden="true">攻</span><span><b>CAPEC 攻撃パターン辞典</b><small>日本語版・非公式の学習用サイト</small></span></a></div></header>
<div class="notice" data-disclaimer-top><div class="wrap notice-row"><b>ご注意</b><span>${e(note)}</span></div></div>
<div class="wrap"><main id="main" class="page">
<h1 class="page-h">ただいま準備中です</h1>
<p>MITREが公開している攻撃パターンの辞典「CAPEC」を、日本語で読めるようにするサイトです。公式データの取り込みと日本語化が済みしだい、ここに公開します。</p>
<p>原典（英語）は <a href="https://capec.mitre.org/">capec.mitre.org</a> で読めます。</p>
</main></div>
<footer class="foot"><div class="wrap foot-grid"><div><h2>ご注意</h2><p data-disclaimer>${e(note)}</p><p lang="en" data-copyright>${e(lic.copyright)}</p></div><div><h2>ライセンス文（原文）</h2><p class="license pending">ライセンス文は、公式データとあわせて取り込みます。</p></div></div></footer>
</body>
</html>
`;
  const dist = path.join(ROOT, "dist");
  fs.rmSync(dist, { recursive: true, force: true });
  fs.mkdirSync(dist, { recursive: true });
  fs.cpSync(path.join(ROOT, "assets"), path.join(dist, "assets"), { recursive: true });
  fs.writeFileSync(path.join(dist, "index.html"), html);
  fs.writeFileSync(path.join(dist, "404.html"), html);
  console.log("公式データ(data/capec.en.json)が無いため、準備中のページだけを生成しました。");
  process.exit(0);
}

const data = readJson("data/capec.en.json");
const labels = readJson("data/labels.json");
const glossary = readJson("data/glossary.json");
const license = readJson("data/license.json");
const meta = data.meta;
const entries = data.entries;
const byId = new Map(entries.map((e) => [e.id, e]));
const warnings = [];

// ---------- 訳文の読み込み ----------
const translations = new Map();
const jaDir = path.join(ROOT, "data/ja");
if (fs.existsSync(jaDir)) {
  for (const f of fs.readdirSync(jaDir)) {
    if (!f.endsWith(".json")) continue;
    const t = JSON.parse(fs.readFileSync(path.join(jaDir, f), "utf8"));
    translations.set(String(t.id), t);
  }
}
for (const [id, t] of translations) {
  const e = byId.get(id);
  if (!e) warnings.push(`訳文があるが公式データに無い: CAPEC-${id}`);
  else if (t.source_sha !== e.source_sha) warnings.push(`原典が更新されている(要再訳): CAPEC-${id}`);
}
const tr = (id) => translations.get(String(id)) || { seg: {}, review: [], redacted: [] };
const nameJa = (id) => tr(id).seg?.name || "";
const nameEn = (id) => byId.get(String(id))?.name.en || "";

// ---------- 文字列の整形 ----------
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fmt = (s) => esc(s).replace(/`([^`]+)`/g, "<code>$1</code>").replace(/\n/g, "<br>");
const rel = (depth) => (depth === 0 ? "./" : "../".repeat(depth));
const capecUrl = (id) => `https://capec.mitre.org/data/definitions/${encodeURIComponent(id)}.html`;
const cweUrl = (id) => `https://cwe.mitre.org/data/definitions/${encodeURIComponent(id)}.html`;
const attackUrl = (id) => {
  const m = String(id).replace(/^T/, "").match(/^(\d+)(?:\.(\d+))?$/);
  return m ? `https://attack.mitre.org/techniques/T${m[1]}/${m[2] ? m[2] + "/" : ""}` : null;
};

const MISSING = "〔未翻訳：原典を参照〕";

const QUOTE_LABEL = "具体的な手口・文字列（原文のまま。防御側の学習のために引用）";
// 具体的な攻撃の細部は訳さず、原典の原文を引用ブロックで示す。lang=en と data-pagefind-ignore で、訳・検索から除く。
function quoteHtml(entry, k) {
  const q = tr(entry.id).quotes?.[k];
  if (q == null) return "";
  return `<figure class="specific" data-pagefind-ignore><figcaption>${QUOTE_LABEL}</figcaption><blockquote lang="en">${fmt(q)}</blockquote></figure>`;
}
// 引用ブロックに添える、訳者による日本語の前置き(あれば)
function jaLead(entry, k) {
  const ja = tr(entry.id).seg?.[k];
  return ja != null && ja !== "" ? `<p>${fmt(ja)}</p>` : "";
}

// 訳すべき文字列1つを表示する。訳が無ければ英文は出さず「未翻訳」と示す(安全側)。
function seg(entry, obj) {
  if (!obj || obj.en == null) return "";
  const t = tr(entry.id);
  const ja = t.seg?.[obj.k];
  let html;
  if (ja == null || ja === "") html = `<span class="untranslated" data-untranslated="${esc(obj.k)}">${MISSING}</span>`;
  else html = fmt(ja);
  const rv = (t.review || []).find((r) => r.k === obj.k);
  if (rv) html += ` <span class="review" data-review><span class="review-mark">要確認</span>${rv.note ? `<span class="review-note">${esc(rv.note)}</span>` : ""}</span>`;
  return html;
}

function blocks(entry, list) {
  if (!list || !list.length) return "";
  return list.map((b) => {
    if (b.type === "p") {
      const q = quoteHtml(entry, b.k);
      if (q) return jaLead(entry, b.k) + q;
      return `<p>${seg(entry, b)}</p>`;
    }
    if (b.type === "ul" || b.type === "ol") return `<${b.type}>${b.items.map((i) => { const q = quoteHtml(entry, i.k); return `<li>${q ? jaLead(entry, i.k) + q : seg(entry, i)}</li>`; }).join("")}</${b.type}>`;
    if (b.type === "table") {
      return `<div class="table-wrap"><table>${b.rows.map((r) => `<tr>${r.map((c) => (c.th ? `<th scope="col">${seg(entry, c)}</th>` : `<td>${seg(entry, c)}</td>`)).join("")}</tr>`).join("")}</table></div>`;
    }
    if (b.type === "code") {
      const q = quoteHtml(entry, b.k);
      if (q) return jaLead(entry, b.k) + q;
      const ja = tr(entry.id).seg?.[b.k];
      // 訳者が「安全で原文のまま残す」と判断したコード片だけを整形済みで表示する
      if (ja != null && ja === b.en) return `<pre lang="en"><code>${esc(b.en)}</code></pre>`;
      return `<p>${seg(entry, b)}</p>`;
    }
    return "";
  }).join("\n");
}

function lab(group, value, { both = true } = {}) {
  if (value == null || value === "") return "";
  const ja = labels[group]?.[value];
  if (!ja) {
    warnings.push(`訳語表に無い値: ${group} = ${value}`);
    return `<span lang="en" data-label-missing>${esc(value)}</span>`;
  }
  // 訳語が固有名詞(英字のみ)の場合は英語として扱う
  if (/^[\x00-\x7F]+$/.test(ja)) return `<span lang="en">${esc(ja)}</span>`;
  if (!both || ja.includes(`（${value}）`)) return esc(ja);
  return `${esc(ja)}<span class="en-label" lang="en">（${esc(value)}）</span>`;
}

const entryLink = (id, depth) => {
  const e = byId.get(String(id));
  if (!e) return `<span>CAPEC-${esc(id)}（データに無い項目）</span>`;
  const ja = nameJa(id);
  const nm = ja ? esc(ja) : `<span lang="en">${esc(e.name.en)}</span>`;
  return `<a href="${rel(depth)}capec/${esc(id)}/">CAPEC-${esc(id)} ${nm}</a>`;
};

// ---------- 分類(カテゴリ・ビュー)の計算 ----------
const parents = new Map();
const kids = new Map();
for (const e of entries) {
  if (e.kind !== "attack_pattern") continue;
  for (const r of e.related_attack_patterns) {
    if (r.nature === "ChildOf") {
      (parents.get(e.id) || parents.set(e.id, []).get(e.id)).push(r.id);
      (kids.get(r.id) || kids.set(r.id, []).get(r.id)).push(e.id);
    }
  }
}
function descendants(id, seen = new Set()) {
  for (const k of kids.get(id) || []) if (!seen.has(k)) { seen.add(k); descendants(k, seen); }
  return seen;
}
const closureCache = new Map();
// カテゴリに含まれる攻撃パターン(下位のパターンや入れ子のカテゴリも含む)
function catClosure(catId, seen = new Set()) {
  if (closureCache.has(catId)) return closureCache.get(catId);
  const out = new Set();
  const c = byId.get(catId);
  for (const m of c?.members || []) {
    const me = byId.get(m);
    if (!me) continue;
    if (me.kind === "attack_pattern") { out.add(m); for (const d of descendants(m)) out.add(d); }
    else if (me.kind === "category" && !seen.has(m)) { seen.add(m); for (const x of catClosure(m, seen)) out.add(x); }
  }
  closureCache.set(catId, out);
  return out;
}
const viewTopCats = (viewId) => (byId.get(viewId)?.members || []).filter((m) => byId.get(m)?.kind === "category");
const MECH_VIEW = "1000"; // Mechanisms of Attack(攻撃の仕組み)
const DOMAIN_VIEW = "3000"; // Domains of Attack(攻撃の領域)
for (const v of [MECH_VIEW, DOMAIN_VIEW]) if (!byId.get(v)) warnings.push(`ビュー CAPEC-${v} がデータに無い(分類での絞り込みが空になる)`);
const mechCats = viewTopCats(MECH_VIEW);
const domainCats = viewTopCats(DOMAIN_VIEW);
const catsOf = (cats, apId) => cats.filter((c) => catClosure(c).has(apId));

const attackPatterns = entries.filter((e) => e.kind === "attack_pattern").sort((a, b) => a.id - b.id);
const categories = entries.filter((e) => e.kind === "category").sort((a, b) => a.id - b.id);
const views = entries.filter((e) => e.kind === "view").sort((a, b) => a.id - b.id);


// ---------- 共通レイアウト ----------
const SITE_NAME = "CAPEC 攻撃パターン辞典 日本語版（非公式）";
const DISCLAIMER = "AIによる日本語訳です。公式の日本語訳ではなく、MITREの公式サイトでも、MITREの承認を受けたものでもありません。誤りがありえるため、重要な点は原典（英語）で確認してください。";
const FONTS = "https://fonts.googleapis.com/css2?family=BIZ+UDPGothic:wght@400;700&family=Zen+Maru+Gothic:wght@500;700;900&family=Klee+One:wght@600&display=swap";

function footer() {
  const lic = license.status === "verified" && license.text
    ? `<blockquote class="license" lang="en" data-license>${fmt(license.text)}</blockquote>`
    : `<p class="license pending" data-license-pending>【未取得】ライセンス文は、capec.mitre.org に接続できないため、まだ取得していません。公開前に ${esc(license.source_url)} から原文を一字一句そのまま入れます。</p>`;
  return `<footer class="foot">
<div class="wrap foot-grid">
<div>
<h2>ご注意</h2>
<p data-disclaimer>${esc(DISCLAIMER)}</p>
<p lang="en" data-copyright>${esc(license.copyright)}</p>
<p>出典：MITRE CAPEC <a href="https://capec.mitre.org/" lang="en">https://capec.mitre.org/</a>（データ版 ${esc(meta.version)}、取得日 ${esc(meta.retrieved)}）</p>
</div>
<div>
<h2>ライセンス文（原文）</h2>
${lic}
</div>
</div>
</footer>`;
}

function page({ title, depth, body, current = "", description = "" }) {
  const r = rel(depth);
  const cur = (k) => (k === current ? ' aria-current="page"' : "");
  return `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} | ${esc(SITE_NAME)}</title>
${description ? `<meta name="description" content="${esc(description)}">` : ""}
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="${esc(FONTS)}">
<link rel="stylesheet" href="${r}assets/style.css">
<script src="${r}assets/site.js" defer></script>
</head>
<body data-root="${r}">
<a class="skip" href="#main">本文へ移動</a>
<header class="head">
<div class="wrap head-row">
<a class="brand" href="${r}"><span class="stamp" aria-hidden="true">攻</span><span><b>CAPEC 攻撃パターン辞典</b><small>日本語版・非公式の学習用サイト</small></span></a>
<form class="search" action="${r}search/" method="get" role="search" data-search>
<label for="q-head" class="vh">キーワード、または番号で探す</label>
<input id="q-head" name="q" type="search" placeholder="キーワード、または番号（例：66）" autocomplete="off">
<button type="submit">探す</button>
<span class="search-msg" role="status" data-search-msg></span>
</form>
<nav class="links" aria-label="案内">
<a href="${r}guide/"${cur("guide")}>はじめに</a>
<a href="${r}categories/"${cur("categories")}>索引</a>
<a href="${r}glossary/"${cur("glossary")}>用語集</a>
<a href="${r}favorites/"${cur("favorites")}>お気に入り</a>
<a href="${r}about/"${cur("about")}>このサイトについて</a>
</nav>
</div>
</header>
<div class="notice" data-disclaimer-top><div class="wrap notice-row"><b>ご注意</b><span>${esc(DISCLAIMER)}</span></div></div>
<div class="wrap">
${body}
</div>
${footer()}
</body>
</html>
`;
}

function writePage(rp, html) {
  const p = path.join(DIST, rp);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, html);
}

const crumbs = (items) => `<nav class="crumbs" aria-label="現在位置"><ol>${items.map(([href, label]) => (href ? `<li><a href="${href}">${label}</a></li>` : `<li aria-current="page">${label}</li>`)).join("")}</ol></nav>`;

// CAPEC → CWE → CVE の関係図(いま読んでいる位置を強調)
function chain(depth, cweCount) {
  return `<figure class="map">
<ol aria-label="CAPEC（攻撃パターン）、CWE（弱点の種類）、CVE（個別の脆弱性）の関係">
<li class="here" aria-current="true"><span class="pin">いまここ</span><b lang="en">CAPEC</b>攻撃の手口の型</li>
<li><b lang="en">CWE</b>突かれる弱点の種類${cweCount != null ? `<br>この項目では${cweCount}件` : ""}</li>
<li><b lang="en">CVE</b>製品ごとに見つかった脆弱性</li>
</ol>
<figcaption>攻撃の手口（CAPEC）は弱点（CWE）を突き、弱点は製品ごとの脆弱性（CVE）として見つかります。<a href="${rel(depth)}guide/#chain">この図の説明</a></figcaption>
</figure>`;
}

function section(id, title, en, body, cls = "") {
  if (!body || !body.trim()) return null;
  const box = cls.includes("box");
  const head = box
    ? `<span class="lbl">${en}</span><h2 id="${id}-h">${title}</h2>`
    : `<h2 id="${id}-h"><span class="mk">${title}</span>${en ? `<small>${en}</small>` : ""}</h2>`;
  return { id, title, html: `<section id="${id}" class="sec ${cls}" aria-labelledby="${id}-h">${head}\n${body}\n</section>` };
}

function referencesHtml(entry) {
  if (!entry.references?.length) return "";
  return `<ol class="refs" lang="en">${entry.references.map((r) => {
    const x = data.external_references[r.ref_id] || {};
    const parts = [x.authors?.join(", "), x.Title && `“${x.Title}”`, x.Publication, x.Publisher, x.Edition,
      [x.Publication_Year, x.Publication_Month, x.Publication_Day].filter(Boolean).join("-") || null,
      r.section && `Section: ${r.section}`].filter(Boolean).map(esc).join(". ");
    const url = x.URL ? ` <a href="${esc(x.URL)}" rel="noopener">${esc(x.URL)}</a>` : "";
    const acc = x.URL_Date ? ` <span lang="ja">（URL確認日 ${esc(x.URL_Date)}）</span>` : "";
    return `<li>[${esc(r.ref_id)}] ${parts}${url}${acc}</li>`;
  }).join("")}</ol>`;
}

function taxonomyHtml(entry) {
  if (!entry.taxonomy_mappings?.length) return "";
  const rows = entry.taxonomy_mappings.map((m) => {
    const isAttack = m.taxonomy === "ATTACK";
    const u = isAttack && m.entry_id ? attackUrl(m.entry_id) : null;
    const idTxt = m.entry_id ? (isAttack ? `T${String(m.entry_id).replace(/^T/, "")}` : m.entry_id) : "—";
    return `<tr><td>${lab("taxonomy", m.taxonomy, { both: false })}</td><td>${u ? `<a href="${esc(u)}" rel="noopener">${esc(idTxt)}</a>` : esc(idTxt)}</td><td lang="en">${esc(m.entry_name || "—")}</td><td>${m.fit ? lab("mapping_fit", m.fit) : "—"}</td></tr>`;
  }).join("");
  return `<p class="small">分類の名前は、それぞれの分類の原文（英語）のまま示します。</p><div class="table-wrap"><table><thead><tr><th scope="col">分類</th><th scope="col">ID</th><th scope="col">名前（原文）</th><th scope="col">対応の程度</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}

function notesHtml(entry) {
  if (!entry.notes?.length) return "";
  return entry.notes.map((n) => `<div class="cnote"><h3>${lab("note_type", n.type)}</h3>${blocks(entry, n.text)}</div>`).join("");
}

function historyHtml(entry) {
  if (!entry.content_history?.length) return "";
  const rows = entry.content_history.map((h) => {
    const f = h.fields || {};
    const date = Object.entries(f).find(([k]) => k.endsWith("_Date"))?.[1] || h.attrs?.Date || "";
    const name = Object.entries(f).filter(([k]) => /_(Name|Organization)$/.test(k)).map(([, v]) => v).join(" / ") || f.value || "";
    const comment = Object.entries(f).find(([k]) => k.endsWith("_Comment"))?.[1] || "";
    return `<tr><td>${lab("history", h.type, { both: false })}</td><td>${esc(date)}</td><td lang="en">${esc(name)}</td><td lang="en">${esc(comment)}</td></tr>`;
  }).join("");
  return `<details class="history" data-pagefind-ignore><summary>更新履歴を表示（${entry.content_history.length}件・人名や組織名、変更内容の記録は原文のまま）</summary><div class="table-wrap"><table><thead><tr><th scope="col">種類</th><th scope="col">日付</th><th scope="col">名前・組織</th><th scope="col">記録（原文）</th></tr></thead><tbody>${rows}</tbody></table></div></details>`;
}

function unknownHtml(entry) {
  if (!entry.unknown?.length) return "";
  for (const u of entry.unknown) warnings.push(`未対応の欄を汎用表示: CAPEC-${entry.id} ${u.tag}`);
  return entry.unknown.map((u) => `<div class="cnote"><h3 lang="en">${esc(u.tag)}</h3>${blocks(entry, u.text)}</div>`).join("");
}

// 初学者向けの補足(AI)。罫線ノートへの手書きの「書き込み」として、原典の訳と見た目で区別する
function supplementHtml(entry) {
  const s = tr(entry.id).supplement;
  if (!s) return "";
  const memo = (who, inner) => `<div class="memo"><span class="who">${who}</span>${inner}</div>`;
  const parts = [];
  if (s.summary) parts.push(memo("ひとことで（AIの要約）", `<p>${fmt(s.summary)}</p>`));
  if (s.terms?.length) parts.push(memo("用語", `<dl>${s.terms.map((t) => `<dt>${esc(t.term)}${t.en ? `（<span lang="en">${esc(t.en)}</span>）` : ""}</dt><dd>${fmt(t.explain)}${t.example ? `<br>例：${fmt(t.example)}` : ""}</dd>`).join("")}</dl>`));
  if (s.facts?.length) parts.push(memo("原典から読める事実", `<ul>${s.facts.map((f) => `<li>${fmt(f.text)}<span class="src">根拠：${fmt(f.source)}</span></li>`).join("")}</ul>`));
  if (s.analogy) parts.push(memo("たとえ話（AIの解釈）", `<p>${fmt(s.analogy)}</p>`));
  if (s.example) parts.push(memo("具体例（AIの解釈）", `<p>${fmt(s.example)}</p>`));
  if (s.interpretation?.length) parts.push(memo("AIの解釈", `<ul>${s.interpretation.map((x) => `<li>${fmt(x)}</li>`).join("")}</ul>`));
  if (s.learn?.length) parts.push(memo("この項目で学べること", `<ul>${s.learn.map((x) => `<li>${fmt(x)}</li>`).join("")}</ul>`));
  return `<aside id="supplement" class="memos" aria-labelledby="supplement-h">
<h2 id="supplement-h" class="memos-h">初学者向けの補足<small>AIの書き込みです。原典の訳ではありません。</small></h2>
${parts.join("\n")}
</aside>`;
}

function flowHtml(entry) {
  if (!entry.execution_flow?.length) return "";
  const order = ["Explore", "Experiment", "Exploit"];
  const phases = [...new Set(entry.execution_flow.map((s) => s.phase || ""))].sort((a, b) => (order.indexOf(a) + 1 || 9) - (order.indexOf(b) + 1 || 9));
  const cols = phases.map((ph) => {
    const steps = entry.execution_flow.filter((s) => (s.phase || "") === ph).map((s) => {
      const tech = s.techniques.filter((t) => t.length).map((t) => `<li>${blocks(entry, t)}</li>`).join("");
      return `<li><span class="n">手順 ${esc(s.step || "")}</span>${blocks(entry, s.description)}${tech ? `<p class="tech-h">手法</p><ul class="tech">${tech}</ul>` : ""}</li>`;
    }).join("");
    const note = labels.phase_note[ph];
    return `<li class="st"><h3>${ph ? lab("phase", ph, { both: false }) : "段階の指定なし"}${ph ? `<small lang="en">${esc(ph)}</small>` : ""}</h3>${note ? `<p class="q">${esc(note)}</p>` : ""}<ol class="steps">${steps}</ol></li>`;
  }).join("");
  return `<p class="small">攻撃の流れは概念レベルで訳しています。具体的な手口や文字列は訳さず、原典の原文をそのまま引用ブロックで示します（防御側の学習のため）。</p><ol class="flow">${cols}</ol>`;
}

function listOfBlocks(entry, arr) {
  if (!arr?.length) return "";
  return `<ul>${arr.map((b) => `<li>${blocks(entry, b)}</li>`).join("")}</ul>`;
}

// 程度(深刻度・可能性・スキル)を目盛りで示す
const LEVEL5 = { "Very Low": 1, Low: 2, Medium: 3, High: 4, "Very High": 5 };
const LEVEL3 = { Low: 1, Medium: 2, High: 3 };
function meter(label, value, scale) {
  const n = value ? scale[value] : null;
  const max = Math.max(...Object.values(scale));
  const dots = n ? `<span class="dots" aria-hidden="true">${"●".repeat(n)}<em>${"●".repeat(max - n)}</em></span>` : "";
  return `<div class="meter"><span class="meter-l">${label}</span><b>${value ? lab("level", value, { both: false }) : "記載なし"}</b>${dots}</div>`;
}

function headBlock(e, kindLabel, chips, depth) {
  const ja = nameJa(e.id);
  return `<div class="chips">${chips}</div>
<p class="cid">CAPEC-${esc(e.id)}<span class="kind">${kindLabel}</span></p>
<h1 data-pagefind-meta="title">${ja ? esc(ja) : `<span lang="en">${esc(e.name.en)}</span>`}</h1>
<p class="en" lang="en">${esc(e.name.en)}</p>`;
}

const chip = (href, label) => `<a class="chip" href="${href}">${label}</a>`;
const plainChip = (label) => `<span class="chip plain">${label}</span>`;
const catName = (c) => (nameJa(c) ? esc(nameJa(c)) : `<span lang="en">${esc(nameEn(c))}</span>`);

function tocHtml(secs, extra = "") {
  if (!secs.length) return "";
  return `<nav class="toc" aria-label="このページの内容"><span>このページ：</span>${secs.map((s) => `<a href="#${s.id}">${s.title}</a>`).join("")}${extra}</nav>`;
}

// ---------- 攻撃パターンのページ ----------
function attackPatternPage(e) {
  const depth = 2;
  const ja = nameJa(e.id);
  const mech = catsOf(mechCats, e.id);
  const dom = catsOf(domainCats, e.id);
  const chips = [
    ...mech.map((c) => chip(`../${esc(c)}/`, catName(c))),
    ...dom.map((c) => chip(`../${esc(c)}/`, catName(c))),
    e.abstraction ? plainChip(`抽象度：${lab("abstraction", e.abstraction, { both: false })}`) : "",
    e.status ? plainChip(`ステータス：${lab("status", e.status, { both: false })}`) : "",
  ].join("");
  const skillLv = e.skills.map((s) => s.level).filter((l) => LEVEL3[l]).sort((a, b) => LEVEL3[b] - LEVEL3[a])[0];
  const skills = e.skills.map((s) => `<li><b>${lab("level", s.level)}</b>：${blocks(e, s.text)}</li>`).join("");
  const conseq = e.consequences.length ? `<div class="table-wrap"><table><thead><tr><th scope="col">影響を受ける範囲</th><th scope="col">影響</th><th scope="col">起こる可能性</th><th scope="col">補足</th></tr></thead><tbody>${e.consequences.map((c) => `<tr><td>${c.scopes.map((x) => lab("scope", x)).join("、") || "—"}</td><td>${c.impacts.map((x) => lab("impact", x)).join("、") || "—"}</td><td>${c.likelihood ? lab("level", c.likelihood) : "—"}</td><td>${blocks(e, c.note) || "—"}</td></tr>`).join("")}</tbody></table></div>` : "";
  const related = e.related_attack_patterns.length ? `<div class="table-wrap"><table><thead><tr><th scope="col">関係</th><th scope="col">項目</th></tr></thead><tbody>${e.related_attack_patterns.map((r) => `<tr><td>${lab("nature", r.nature)}</td><td>${entryLink(r.id, depth)}${r.exclude?.length ? `<br><span class="small">除外：${r.exclude.map((x) => `CAPEC-${esc(x)}`).join("、")}</span>` : ""}</td></tr>`).join("")}</tbody></table></div>` : "";
  const cwes = e.related_weaknesses.length ? `<ul class="inline-list">${e.related_weaknesses.map((c) => `<li><a href="${cweUrl(c)}" rel="noopener" lang="en">CWE-${esc(c)}</a></li>`).join("")}</ul><p class="small">リンク先はMITREのCWEサイト（英語）です。</p>` : "";
  const alt = e.alternate_terms.length ? `<dl class="alt">${e.alternate_terms.map((a) => `<dt>${seg(e, a.term)}</dt><dd>${blocks(e, a.description)}</dd>`).join("")}</dl>` : "";
  const source = `<p><a href="${capecUrl(e.id)}" rel="noopener" lang="en">${capecUrl(e.id)}</a><br><span class="small">データ版 ${esc(meta.version)}（${esc(meta.catalog_date)}）・取得日 ${esc(meta.retrieved)}</span></p>`;

  const secs = [
    section("extended", "詳しい説明", "Extended Description", blocks(e, e.extended_description)),
    section("alternate", "別名", "Alternate Terms", alt),
    section("flow", "攻撃の流れ", "Execution Flow", flowHtml(e)),
    section("prerequisites", "なぜ成立する？", "前提条件", listOfBlocks(e, e.prerequisites), "box cond"),
    section("skills", "必要なスキル", "Skills Required", skills ? `<ul>${skills}</ul>` : ""),
    section("resources", "必要な資源", "Resources Required", listOfBlocks(e, e.resources)),
    section("indicators", "兆候", "Indicators", listOfBlocks(e, e.indicators)),
    section("consequences", "起こりうる影響", "Consequences", conseq),
    section("mitigations", "どう守る？", "対策（緩和策）", listOfBlocks(e, e.mitigations), "box def"),
    section("examples", "攻撃の例", "Example Instances", listOfBlocks(e, e.examples)),
    section("related", "関連する攻撃パターン", "Related Attack Patterns", related),
    section("cwe", "突かれる弱点（CWE）", "Related Weaknesses", cwes),
    section("taxonomy", "ATT&amp;CKなど他の分類との対応", "Taxonomy Mappings", taxonomyHtml(e)),
    section("notes", "注記", "Notes", notesHtml(e)),
    section("other", "その他の欄", "", unknownHtml(e)),
    section("references", "参考文献", "References", referencesHtml(e)),
    section("source", "原典", "Source", source),
    section("history", "更新履歴", "Content History", historyHtml(e)),
  ].filter(Boolean);
  const sup = supplementHtml(e);

  const body = `${crumbs([["../../", "ホーム"], ...(mech[0] ? [[`../${esc(mech[0])}/`, `攻撃の仕組み：${catName(mech[0])}`]] : []), [null, `CAPEC-${esc(e.id)}`]])}
<main id="main" class="entry${sup ? " has-memos" : ""}" tabindex="-1" data-pagefind-body>
<div class="entry-head">
${headBlock(e, "攻撃パターン", chips, depth)}
<button type="button" class="fav" data-fav="${esc(e.id)}" aria-pressed="false">お気に入りに追加</button>
${chain(depth, e.related_weaknesses.length)}
<section id="description" class="lead" aria-labelledby="description-h"><h2 id="description-h" class="vh">説明</h2>${blocks(e, e.description) || `<p class="small">データに説明の記載はありません。</p>`}</section>
<div class="meters">
${meter("深刻度", e.severity, LEVEL5)}
${meter("攻撃される可能性", e.likelihood, LEVEL5)}
${meter("必要なスキル", skillLv, LEVEL3)}
</div>
${tocHtml(secs, sup ? `<a href="#supplement">補足（AI）</a>` : "")}
</div>
${sup}
<div class="entry-body">
${secs.map((s) => s.html).join("\n")}
</div>
</main>`;
  return page({ title: `CAPEC-${e.id} ${ja || e.name.en}`, depth, body, description: `CAPEC-${e.id}（${e.name.en}）の日本語訳（非公式・AI訳）` });
}

// ---------- カテゴリ・ビューのページ ----------
function memberList(ids, depth) {
  return `<ul class="entry-list">${ids.map((m) => `<li>${entryLink(m, depth)}${byId.get(m) ? ` <span class="small">${lab("kind", byId.get(m).kind, { both: false })}</span>` : ""}</li>`).join("")}</ul>`;
}

function categoryPage(e) {
  const depth = 2;
  const ja = nameJa(e.id);
  const all = [...catClosure(e.id)].sort((a, b) => a - b);
  const direct = e.members || [];
  const chips = [plainChip("カテゴリ（攻撃パターンをまとめる分類）"), e.status ? plainChip(`ステータス：${lab("status", e.status, { both: false })}`) : ""].join("");
  const secs = [
    section("summary", "概要", "Summary", blocks(e, e.summary)),
    section("members", `直接含まれる項目（${direct.length}件）`, "Members", direct.length ? memberList(direct, depth) : ""),
    all.length !== direct.length ? section("all", `下位を含むすべての攻撃パターン（${all.length}件）`, "", memberList(all, depth)) : null,
    section("taxonomy", "他の分類との対応", "Taxonomy Mappings", taxonomyHtml(e)),
    section("notes", "注記", "Notes", notesHtml(e)),
    section("other", "その他の欄", "", unknownHtml(e)),
    section("references", "参考文献", "References", referencesHtml(e)),
    section("source", "原典", "Source", `<p><a href="${capecUrl(e.id)}" rel="noopener" lang="en">${capecUrl(e.id)}</a></p>`),
    section("history", "更新履歴", "Content History", historyHtml(e)),
  ].filter(Boolean);
  const sup = supplementHtml(e);
  const body = `${crumbs([["../../", "ホーム"], ["../../categories/", "索引"], [null, `CAPEC-${esc(e.id)}`]])}
<main id="main" class="entry${sup ? " has-memos" : ""}" tabindex="-1" data-pagefind-body>
<div class="entry-head">${headBlock(e, "カテゴリ", chips, depth)}${tocHtml(secs)}</div>
${sup}
<div class="entry-body">${secs.map((s) => s.html).join("\n")}</div>
</main>`;
  return page({ title: `CAPEC-${e.id} ${ja || e.name.en}`, depth, body, current: "categories" });
}

function viewPage(e) {
  const depth = 2;
  const ja = nameJa(e.id);
  const aud = e.audience?.length ? `<dl class="alt">${e.audience.map((a) => `<dt lang="en">${esc(a.type)}</dt><dd>${blocks(e, a.description)}</dd>`).join("")}</dl>` : "";
  const chips = [plainChip(`ビュー：${lab("view_type", e.view_type, { both: false }) || "—"}`), e.status ? plainChip(`ステータス：${lab("status", e.status, { both: false })}`) : ""].join("");
  const secs = [
    section("objective", "目的", "Objective", blocks(e, e.objective)),
    section("audience", "想定する読者", "Audience", aud),
    section("filter", "選び方の条件（原文）", "Filter", e.filter ? `<pre lang="en"><code>${esc(e.filter)}</code></pre>` : ""),
    section("members", `含まれる項目（${(e.members || []).length}件）`, "Members", (e.members || []).length ? memberList(e.members, depth) : ""),
    section("notes", "注記", "Notes", notesHtml(e)),
    section("other", "その他の欄", "", unknownHtml(e)),
    section("references", "参考文献", "References", referencesHtml(e)),
    section("source", "原典", "Source", `<p><a href="${capecUrl(e.id)}" rel="noopener" lang="en">${capecUrl(e.id)}</a></p>`),
    section("history", "更新履歴", "Content History", historyHtml(e)),
  ].filter(Boolean);
  const body = `${crumbs([["../../", "ホーム"], ["../../categories/", "索引"], [null, `CAPEC-${esc(e.id)}`]])}
<main id="main" class="entry" tabindex="-1" data-pagefind-body>
<div class="entry-head">${headBlock(e, "ビュー（ある観点で項目を選んで並べた一覧）", chips, depth)}${tocHtml(secs)}</div>
<div class="entry-body">${secs.map((s) => s.html).join("\n")}</div>
</main>`;
  return page({ title: `CAPEC-${e.id} ${ja || e.name.en}`, depth, body, current: "categories" });
}

// ---------- トップページ ----------
function catTabs(ids, depth) {
  return `<ul class="tabs">${ids.map((c) => `<li><a href="${rel(depth)}capec/${esc(c)}/"><span>${catName(c)}</span><b>${catClosure(c).size}</b></a></li>`).join("")}</ul>`;
}

function indexPage() {
  const opt = (ids) => ids.map((c) => `<option value="${esc(c)}">${esc(nameJa(c) || nameEn(c))}</option>`).join("");
  const optLab = (group, vals) => [...new Set(vals.filter(Boolean))].sort().map((v) => `<option value="${esc(v)}">${esc(labels[group]?.[v] || v)}</option>`).join("");
  const absCls = { Meta: "m", Standard: "s", Detailed: "d" };
  const rows = attackPatterns.map((e) => {
    const ja = nameJa(e.id);
    const dep = e.status === "Deprecated" || e.status === "Obsolete";
    return `<tr${dep ? ' class="dep"' : ""} data-abs="${esc(e.abstraction || "")}" data-status="${esc(e.status || "")}" data-mech="${catsOf(mechCats, e.id).join(" ")}" data-dom="${catsOf(domainCats, e.id).join(" ")}">
<td class="id">CAPEC-${esc(e.id)}</td><td class="ja"><a href="capec/${esc(e.id)}/">${ja ? esc(ja) : `<span lang="en">${esc(e.name.en)}</span><span class="small">（${MISSING}）</span>`}</a></td><td class="en" lang="en">${esc(e.name.en)}</td><td>${e.abstraction ? `<span class="lv ${absCls[e.abstraction] || "d"}">${esc(labels.abstraction[e.abstraction] || e.abstraction)}</span>` : "—"}</td><td>${esc(labels.status[e.status] || e.status || "—")}</td></tr>`;
  }).join("\n");
  const done = attackPatterns.filter((e) => translations.get(e.id)?.status === "done").length;
  const body = `<section class="hero">
<div>
<h1 class="hero-h">攻撃は、<br><span class="mk">なぜ成立する</span>のか。</h1>
<p class="sub">MITREが公開している攻撃パターンの辞典「CAPEC」を、日本語で読めるようにしました。手口の型と、それが成り立つ条件、守るための対策を、1項目ずつ引けます。攻撃の実行手引きではありません。</p>
</div>
<form class="find" action="search/" method="get" role="search" data-search>
<label for="q-top">引いてみる</label>
<div class="find-row"><input id="q-top" name="q" type="search" placeholder="例：なりすまし、SQLインジェクション、66" autocomplete="off"><button type="submit">探す</button></div>
<p class="small">番号だけ入れると、その項目へ直接移動します。</p>
<span class="search-msg" role="status" data-search-msg></span>
</form>
</section>
<div class="figs">
<span class="fig">攻撃パターン<b>${meta.counts.attack_pattern}</b>件</span>
<span class="fig">カテゴリ<b>${meta.counts.category}</b>件</span>
<span class="fig">ビュー<b>${meta.counts.view}</b>件</span>
<span class="fig">データの版<b>${esc(meta.version)}</b></span>
<span class="fig">公式データの日付<b>${esc(meta.catalog_date)}</b></span>
<span class="fig">取得日<b>${esc(meta.retrieved)}</b></span>
<span class="fig">日本語訳が済んだ攻撃パターン<b>${done}</b>件</span>
</div>
<p class="small">件数は、MITREの公式ダウンロードデータ（XML）から数えたものです。</p>
<div class="top-body">
<nav aria-labelledby="mech-h">
<h2 id="mech-h"><span class="mk">仕組みで引く</span></h2>
${mechCats.length ? catTabs(mechCats, 0) : `<p class="small">分類のデータがありません。</p>`}
<p><a href="categories/">索引をすべて見る</a></p>
</nav>
<main id="main" tabindex="-1">
<section id="list" aria-labelledby="list-h">
<h2 id="list-h"><span class="mk">すべての攻撃パターン</span></h2>
<form class="filters" data-filters>
<div><label for="f-abs">抽象度</label><select id="f-abs" data-key="abs"><option value="">すべて</option>${optLab("abstraction", attackPatterns.map((e) => e.abstraction))}</select></div>
<div><label for="f-status">ステータス</label><select id="f-status" data-key="status"><option value="">すべて</option>${optLab("status", attackPatterns.map((e) => e.status))}</select></div>
<div><label for="f-mech">攻撃の仕組み</label><select id="f-mech" data-key="mech" data-multi><option value="">すべて</option>${opt(mechCats)}</select></div>
<div><label for="f-dom">攻撃の領域</label><select id="f-dom" data-key="dom" data-multi><option value="">すべて</option>${opt(domainCats)}</select></div>
<p class="count" role="status" data-filter-count>${attackPatterns.length}件</p>
</form>
<div class="table-wrap"><table class="list"><thead><tr><th scope="col">番号</th><th scope="col">日本語名</th><th scope="col">英語名</th><th scope="col">抽象度</th><th scope="col">ステータス</th></tr></thead><tbody>
${rows}
</tbody></table></div>
<p class="small">抽象度：メタ（もっとも抽象的な手口の型）、標準（特定の技術に寄った型）、詳細（具体的な技術や手順まで絞った型）。</p>
<p class="small">ステータス：MITRE側での、項目の検討の進み具合を表す（このサイトの日本語訳の進み具合とは無関係）。草案（検討・改訂の途中）、安定（検討が進み大きな変更が見込まれない）、利用可能（実用に耐えるが改善の余地が残る）、非推奨（他の項目に統合・置き換えられ、参考として残されている）、廃止（完全に使われなくなった）。</p>
</section>
</main>
</div>`;
  return page({ title: "ホーム", depth: 0, body, current: "home" });
}

function categoriesPage() {
  const depth = 1;
  const block = (title, viewId, ids) => ids.length ? `<section class="sec" aria-labelledby="v${viewId}"><h2 id="v${viewId}"><span class="mk">${title}</span><small>${entryLink(viewId, depth)}</small></h2>${catTabs(ids, depth)}</section>` : "";
  const body = `${crumbs([["../", "ホーム"], [null, "索引"]])}
<main id="main" class="page" tabindex="-1">
<h1 class="page-h">索引</h1>
<p>CAPECでは、攻撃パターンを「カテゴリ」でまとめ、カテゴリを「ビュー」（ある観点で選んで並べた一覧）で整理しています。数字は、下位の項目を含めた攻撃パターンの数です。</p>
${block("攻撃の仕組みで引く", MECH_VIEW, mechCats)}
${block("攻撃の領域で引く", DOMAIN_VIEW, domainCats)}
<section class="sec" aria-labelledby="allv"><h2 id="allv"><span class="mk">すべてのビュー</span><small>${views.length}件</small></h2>${memberList(views.map((v) => v.id), depth)}</section>
<section class="sec" aria-labelledby="allc"><h2 id="allc"><span class="mk">すべてのカテゴリ</span><small>${categories.length}件</small></h2>${memberList(categories.map((c) => c.id), depth)}</section>
</main>`;
  return page({ title: "索引", depth, body, current: "categories" });
}

function searchPage() {
  const body = `${crumbs([["../", "ホーム"], [null, "検索"]])}
<main id="main" class="page" tabindex="-1">
<h1 class="page-h">探す</h1>
<form class="find" data-search-form role="search">
<label for="q">キーワード</label>
<div class="find-row"><input id="q" name="q" type="search" autocomplete="off"><button type="submit">探す</button></div>
<p class="small">日本語・英語のどちらでも探せます。動詞の活用形（例：「騙して」）では見つからないことがあり、その場合は漢字やカタカナの部分だけで探し直します（例：「騙」）。</p>
</form>
<p role="status" class="search-status" data-search-status></p>
<ol class="search-results" data-search-results></ol>
<noscript><p>検索にはJavaScriptが必要です。<a href="../">トップページの一覧</a>から探すこともできます。</p></noscript>
</main>
<script src="../assets/search.js" defer></script>`;
  return page({ title: "探す", depth: 1, body, current: "search" });
}

function favoritesPage() {
  const body = `${crumbs([["../", "ホーム"], [null, "お気に入り"]])}
<main id="main" class="page" tabindex="-1">
<h1 class="page-h">お気に入り</h1>
<p>項目ページの「お気に入りに追加」で登録した項目です。登録は、このブラウザの中だけに保存されます（サーバーには送られません）。</p>
<ul class="entry-list" data-fav-list></ul>
<p data-fav-empty hidden>まだ登録された項目はありません。</p>
</main>`;
  return page({ title: "お気に入り", depth: 1, body, current: "favorites" });
}

function glossaryPage() {
  const groupName = { abstraction: "抽象度", status: "ステータス", level: "程度（深刻度・可能性・スキル）", phase: "攻撃の段階", nature: "攻撃パターン同士の関係", scope: "影響を受ける範囲", impact: "影響", note_type: "注記の種類", view_type: "ビューの種類", mapping_fit: "他の分類との対応の程度", taxonomy: "他の分類の名前", history: "更新履歴の種類", kind: "項目の種類" };
  const body = `${crumbs([["../", "ホーム"], [null, "用語集"]])}
<main id="main" class="page" tabindex="-1">
<h1 class="page-h">用語集</h1>
<p>このサイトで使う訳語の一覧です。訳語はサイト全体でそろえています。説明の欄は、AIの書き込み（原典の訳ではありません）です。</p>
<dl class="glossary" data-pagefind-body>${glossary.terms.map((t) => `<div><dt id="g-${esc(t.en.replace(/\s+/g, "-"))}">${esc(t.ja)}<span class="en-label" lang="en">${esc(t.en)}</span></dt><dd class="memo-inline">${fmt(t.explain || "")}</dd></div>`).join("")}</dl>
<section class="sec" aria-labelledby="lab-h"><h2 id="lab-h"><span class="mk">データの決まった値の訳語</span></h2>
${Object.entries(labels).filter(([k]) => !k.startsWith("_") && k !== "phase_note").map(([g, m]) => `<h3>${esc(groupName[g] || g)}</h3><div class="table-wrap"><table><thead><tr><th scope="col">原文</th><th scope="col">訳語</th></tr></thead><tbody>${Object.entries(m).map(([en, ja]) => `<tr><td lang="en">${esc(en)}</td><td${/^[\x00-\x7F]+$/.test(ja) ? ' lang="en"' : ""}>${esc(ja)}</td></tr>`).join("")}</tbody></table></div>`).join("")}
</section>
</main>`;
  return page({ title: "用語集", depth: 1, body, current: "glossary" });
}

// おすすめの学習順（レッスン形式）。「攻撃の仕組み」ビュー(CAPEC-1000)の
// 直下の9分類を、初学者が無理なく進められるよう並べ替えたもの。
// 並び順そのものは原典にはなく、このサイトが独自に付けた学習上の目安。
const LESSON_STEPS = [
  { id: "118", blurb: "攻撃は、まず相手を調べることから始まります。偵察・情報収集の手口を知ることが、すべての土台になります。" },
  { id: "156", blurb: "次は、技術ではなく「人の心」を狙う手口。なりすましやフィッシングなど、だますことで始まる攻撃です。" },
  { id: "225", blurb: "ログインや権限の仕組み（アクセス制御）を、どうやって突破・回避するかを学びます。" },
  { id: "152", blurb: "入力欄などに「想定外のもの」を混ぜ込む手口。SQLインジェクションなどが含まれます。" },
  { id: "255", blurb: "XMLやシリアライズされたデータなど、データの「構造」そのものを狂わせる手口です。" },
  { id: "172", blurb: "処理の順番やタイミングのわずかな隙を突く、少し高度な手口に進みます。" },
  { id: "223", blurb: "推測や総当たりのような、確率に頼る手口。根気と試行回数がものを言う攻撃です。" },
  { id: "262", blurb: "メモリやCPU、ネットワーク帯域といった「資源」を使い果たさせる手口です。" },
  { id: "210", blurb: "最後は、壊すのではなく「正規の機能をそのまま、想定外の使い方で」悪用する、応用的な手口です。" },
];
function lessonSection(depth) {
  const steps = LESSON_STEPS.map((s, i) => {
    const e = byId.get(s.id);
    const ja = nameJa(s.id);
    const n = e?.members?.length ?? 0;
    return `<li class="lesson-step"><span class="lesson-n" aria-hidden="true">レッスン${i + 1}</span>
<h3>${entryLink(s.id, depth)}</h3>
<p>${esc(s.blurb)}</p>
<p class="small">${ja ? "" : `<span lang="en">${esc(e?.name?.en || "")}</span>・`}含まれる項目 ${n}件</p>
</li>`;
  }).join("");
  const domainChips = domainCats.map((id) => chip(`${rel(depth)}capec/${esc(id)}/`, catName(id))).join("");
  return `<section id="lesson" class="sec" aria-labelledby="lesson-h"><h2 id="lesson-h"><span class="mk">どの順で読む？（おすすめの学習順）</span></h2>
<p>706件は多すぎて、どれから読むか迷うと思います。まずは「攻撃の仕組み」という分け方（CAPEC-1000）に沿って、レッスン1から順に読んでいくことをおすすめします。各レッスンの分類ページには、関連する攻撃パターンが一覧になっています。</p>
<ol class="lesson-list">${steps}</ol>
<p>人への攻撃（ソーシャルエンジニアリング）だけを先に読みたい場合は、レッスン2（${entryLink("156", depth)}）よりも、分野別の${entryLink("403", depth)}の分類から読み始めると、まとまって学べます。</p>
<div class="memo"><span class="who">補足（AI）</span><p>この並び順は、MITREの原典にあるものではなく、このサイトが初学者向けに独自に付けた目安です。興味のある分類から読んでも構いません。</p></div>
</section>
<section class="sec" aria-labelledby="domain-h"><h2 id="domain-h"><span class="mk">分野（ドメイン）別に読みたい場合</span></h2>
<p>「ソフトウェアの攻撃だけ知りたい」「物理的な侵入だけ知りたい」というように、分野で絞って読むこともできます（CAPEC-3000）。</p>
<div class="chips">${domainChips}</div>
</section>`;
}

function guidePage() {
  const body = `${crumbs([["../", "ホーム"], [null, "はじめに"]])}
<main id="main" class="page" tabindex="-1">
<h1 class="page-h">はじめに</h1>
<p>このサイトの読み方の案内です。用語の正式な定義は、各リンク先の公式サイト（英語）で確認してください。</p>
${lessonSection(1)}
<section id="chain" class="sec" aria-labelledby="chain-h"><h2 id="chain-h"><span class="mk">CAPEC・CWE・CVEの関係</span></h2>
${chain(1, null)}
<ul>
<li><b lang="en">CAPEC</b>（攻撃パターン）：攻撃によく見られる手口を、型として整理した一覧。MITREが公開しています。<a href="https://capec.mitre.org/" rel="noopener">capec.mitre.org</a></li>
<li><b lang="en">CWE</b>（弱点の種類）：ソフトウェアやハードウェアの弱点の種類を整理した一覧。MITREが公開しています。<a href="https://cwe.mitre.org/" rel="noopener">cwe.mitre.org</a></li>
<li><b lang="en">CVE</b>（個別の脆弱性）：公に知られた個々の脆弱性に付けられる識別番号。<a href="https://www.cve.org/" rel="noopener">www.cve.org</a></li>
</ul>
<div class="memo"><span class="who">たとえ話（AIの解釈）</span><p>CAPECが「空き巣の手口の型（例：鍵の閉め忘れを狙う）」だとすると、CWEは「家の造りの弱点の種類（例：外から開けられる窓の鍵）」、CVEは「ある会社のある型番の窓の鍵に見つかった具体的な欠陥」にあたります。</p></div>
<p>CAPECの各項目には「関連するCWE」の欄があり、このサイトではCWEの原典ページへリンクしています。CVEは個々の製品の問題なので、このサイトでは扱いません。</p>
</section>
<section class="sec" aria-labelledby="read-h"><h2 id="read-h"><span class="mk">項目ページの読み方</span></h2>
<ol>
<li><b>説明</b>：どんな手口かの概要。</li>
<li><b>攻撃の流れ</b>：探索（調べる）→ 試行（試す）→ 悪用（使う）の段階。概念レベルで訳しています。</li>
<li><b>なぜ成立する？（前提条件）</b>：攻撃が成り立つために必要な条件。</li>
<li><b>どう守る？（対策）</b>：前提条件を崩したり、被害を小さくしたりする方法。</li>
<li><b>初学者向けの補足</b>：AIの書き込み。手書きの文字と罫線で、原典の訳と区別しています。</li>
</ol>
<p>本文中の「要確認」の印は、訳が不確かな箇所です。「（具体的な内容は原典を参照）」は、安全のために訳さなかった箇所です。</p>
</section>
</main>`;
  return page({ title: "はじめに", depth: 1, body, current: "guide" });
}

function aboutPage() {
  const body = `${crumbs([["../", "ホーム"], [null, "このサイトについて"]])}
<main id="main" class="page" tabindex="-1">
<h1 class="page-h">このサイトについて</h1>
<section class="sec box cond" aria-labelledby="d-h"><span class="lbl">ご注意</span><h2 id="d-h">非公式のAI訳です</h2><p>${esc(DISCLAIMER)}</p></section>
<section class="sec" aria-labelledby="p-h"><h2 id="p-h"><span class="mk">目的と方針</span></h2>
<ul>
<li>日本語を母語とする、プログラミングを知らない学習者が、攻撃が成立する仕組みを理解するための資料です。</li>
<li>防御する側の理解のための資料であり、攻撃の実行手引きではありません。</li>
<li>原典にある具体的な攻撃用の文字列、命令、手順の再現に使える細部は訳さず、「（具体的な内容は原典を参照）」としています。</li>
<li>防御に必要な「前提条件」「影響」「対策」は省略していません。</li>
<li>訳が不確かな箇所には「要確認」の印を付けています。</li>
<li>「初学者向けの補足」はAIの書き込みで、原典の訳ではありません。</li>
</ul></section>
<section class="sec" aria-labelledby="s-h"><h2 id="s-h"><span class="mk">データ</span></h2>
<dl class="kv">
<dt>出典</dt><dd>MITRE CAPEC（<a href="https://capec.mitre.org/" lang="en">https://capec.mitre.org/</a>）の公式ダウンロードデータ（XML）</dd>
<dt>データの版</dt><dd>${esc(meta.version)}</dd>
<dt>公式データの日付</dt><dd>${esc(meta.catalog_date)}</dd>
<dt>取得日</dt><dd>${esc(meta.retrieved)}</dd>
<dt>ファイルのSHA-256</dt><dd><code>${esc(meta.source_sha256)}</code></dd>
</dl></section>
<section class="sec" aria-labelledby="l-h"><h2 id="l-h"><span class="mk">著作権とライセンス</span></h2><p>著作権表示とライセンス文（原文）は、各ページの下部に掲載しています。原文は <a href="${esc(license.source_url)}">${esc(license.source_url)}</a> から引用しています。</p></section>
</main>`;
  return page({ title: "このサイトについて", depth: 1, body, current: "about" });
}

function notFoundPage() {
  // 404はどの階層のURLでも表示されるため、リンクは絶対パスにする
  return page({ title: "ページが見つかりません", depth: 0, body: `<main id="main" class="page" tabindex="-1"><h1 class="page-h">ページが見つかりません</h1><p>URLが正しいか確認してください。<a href="./">トップページへ</a></p></main>` })
    .replaceAll('href="./', 'href="/').replaceAll('src="./', 'src="/').replaceAll('action="./', 'action="/').replace('data-root="./"', 'data-root="/"');
}

// ---------- 出力 ----------
fs.rmSync(DIST, { recursive: true, force: true });
fs.mkdirSync(DIST, { recursive: true });
fs.cpSync(path.join(ROOT, "assets"), path.join(DIST, "assets"), { recursive: true });
writePage("index.html", indexPage());
writePage("categories/index.html", categoriesPage());
writePage("search/index.html", searchPage());
writePage("favorites/index.html", favoritesPage());
writePage("glossary/index.html", glossaryPage());
writePage("guide/index.html", guidePage());
writePage("about/index.html", aboutPage());
writePage("404.html", notFoundPage());
for (const e of entries) {
  const html = e.kind === "attack_pattern" ? attackPatternPage(e) : e.kind === "category" ? categoryPage(e) : viewPage(e);
  writePage(`capec/${e.id}/index.html`, html);
}
const ids = Object.fromEntries(entries.map((e) => [e.id, [e.kind, nameJa(e.id), e.name.en]]));
fs.writeFileSync(path.join(DIST, "assets/ids.json"), JSON.stringify(ids));

fs.mkdirSync(path.join(ROOT, "reports"), { recursive: true });
const uniq = [...new Set(warnings)];
fs.writeFileSync(path.join(ROOT, "reports/build-warnings.txt"), uniq.join("\n") + "\n");
console.log(`生成: 項目ページ ${entries.length}件（攻撃パターン ${attackPatterns.length} / カテゴリ ${categories.length} / ビュー ${views.length}）、訳文 ${translations.size}件、警告 ${uniq.length}件`);
