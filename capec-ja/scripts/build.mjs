// 英語データ(data/capec.en.json)と日本語訳(data/ja/*.json)から静的サイトを dist/ に生成する。
// 使い方: node scripts/build.mjs
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DIST = path.join(ROOT, "dist");
const readJson = (p) => JSON.parse(fs.readFileSync(path.join(ROOT, p), "utf8"));

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
    if (b.type === "p") return `<p>${seg(entry, b)}</p>`;
    if (b.type === "ul" || b.type === "ol") return `<${b.type}>${b.items.map((i) => `<li>${seg(entry, i)}</li>`).join("")}</${b.type}>`;
    if (b.type === "table") {
      return `<div class="table-wrap"><table>${b.rows.map((r) => `<tr>${r.map((c) => (c.th ? `<th scope="col">${seg(entry, c)}</th>` : `<td>${seg(entry, c)}</td>`)).join("")}</tr>`).join("")}</table></div>`;
    }
    if (b.type === "code") {
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
const SITE_NAME = "CAPEC 日本語版（非公式）";
const DISCLAIMER = "このサイトはAIによる日本語訳で、公式の日本語訳ではありません。MITREの公式サイトではなく、MITREの承認も受けていません。誤りがありえるので、重要な点は原典（英語）で確認してください。";

function footer() {
  const lic = license.status === "verified" && license.text
    ? `<blockquote class="license" lang="en" data-license>${fmt(license.text)}</blockquote>`
    : `<p class="license pending" data-license-pending>【未取得】ライセンス文は、capec.mitre.org に接続できないため、まだ取得していません。公開前に ${esc(license.source_url)} から原文を一字一句そのまま入れます。</p>`;
  return `<footer class="site-footer">
  <div class="footer-inner">
    <p class="disclaimer" data-disclaimer>${esc(DISCLAIMER)}</p>
    <p class="copyright" lang="en" data-copyright>${esc(license.copyright)}</p>
    <h2 class="footer-h">ライセンス文（原文）</h2>
    ${lic}
    <p>出典：MITRE CAPEC <a href="https://capec.mitre.org/" lang="en">https://capec.mitre.org/</a>（データ版 ${esc(meta.version)}、取得日 ${esc(meta.retrieved)}）</p>
  </div>
</footer>`;
}

function leftNav(depth, current) {
  const r = rel(depth);
  const cur = (k) => (k === current ? ' aria-current="page"' : "");
  const cats = mechCats.map((c) => {
    const n = catClosure(c).size;
    const nm = nameJa(c) || byId.get(c).name.en;
    return `<li><a href="${r}capec/${esc(c)}/"><span>${esc(nm)}</span><span class="count">${n}</span></a></li>`;
  }).join("");
  return `<nav class="side-nav" aria-label="サイト内の移動">
  <ul class="nav-main">
    <li><a href="${r}"${cur("home")}>ホーム</a></li>
    <li><a href="${r}search/"${cur("search")}>攻撃パターンを検索</a></li>
    <li><a href="${r}categories/"${cur("categories")}>カテゴリ一覧</a></li>
    <li><a href="${r}#list"${cur("list")}>すべての攻撃パターン</a></li>
    <li><a href="${r}favorites/"${cur("favorites")}>お気に入り</a></li>
    <li><a href="${r}glossary/"${cur("glossary")}>用語集</a></li>
  </ul>
  ${cats ? `<h2 class="nav-h">攻撃の仕組みから探す</h2><ul class="nav-cats">${cats}</ul>` : ""}
  <div class="nav-about">
    <h2 class="nav-h">このサイトについて</h2>
    <p>MITREのCAPECを、日本語で読めるようにした学習用サイトです。攻撃の仕組みを理解し、守る側の理解を深めることが目的です。攻撃の実行手順は載せていません。</p>
    <p><a href="${r}about/">詳しく見る</a></p>
  </div>
</nav>`;
}

function page({ title, depth, main, right = "", current = "", description = "" }) {
  const r = rel(depth);
  return `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} | ${esc(SITE_NAME)}</title>
${description ? `<meta name="description" content="${esc(description)}">` : ""}
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@400;700&family=Shippori+Mincho+B1:wght@600;800&display=swap">
<link rel="stylesheet" href="${r}assets/style.css">
<script src="${r}assets/site.js" defer></script>
</head>
<body data-root="${r}">
<a class="skip" href="#main">本文へ移動</a>
<header class="site-header">
  <div class="header-inner">
    <a class="site-name" href="${r}">CAPEC <span>日本語版</span><small>非公式</small></a>
    <p class="tagline">攻撃パターン辞典 ── 攻撃の仕組みを知り、守りを強くする</p>
    <form class="header-search" action="${r}search/" method="get" role="search">
      <label for="q-header" class="vh">攻撃パターンを検索</label>
      <input id="q-header" name="q" type="search" placeholder="検索（例：認証情報、SQLインジェクション）">
      <button type="submit">検索</button>
    </form>
    <form class="idjump" data-idjump>
      <label for="idjump-input">IDで移動</label>
      <span class="idjump-prefix" aria-hidden="true">CAPEC-</span>
      <input id="idjump-input" inputmode="numeric" autocomplete="off" size="5" aria-describedby="idjump-msg">
      <button type="submit">移動</button>
      <span id="idjump-msg" class="idjump-msg" role="status"></span>
    </form>
    <nav class="header-nav" aria-label="案内">
      <a href="${r}guide/">はじめに</a>
      <a href="${r}about/">このサイトについて</a>
      <a href="${r}glossary/">用語集</a>
    </nav>
  </div>
  <p class="notice-bar" data-disclaimer-top>${esc(DISCLAIMER)}</p>
</header>
<div class="layout${right ? " has-right" : ""}">
${leftNav(depth, current)}
<main id="main" tabindex="-1">
${main}
</main>
${right ? `<aside class="side-right" aria-label="関連情報">${right}</aside>` : ""}
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

// CAPEC → CWE → CVE の関係図(いま読んでいる位置を強調)
function chain(depth, cweCount) {
  return `<figure class="chain" aria-labelledby="chain-cap">
  <ol>
    <li class="here" aria-current="true"><span class="chain-code" lang="en">CAPEC</span><span>攻撃パターン（手口の型）</span><span class="chain-here">いま読んでいる位置</span></li>
    <li><span class="chain-code" lang="en">CWE</span><span>弱点の種類</span><span class="chain-sub">${cweCount != null ? `この項目に関連：${cweCount}件` : ""}</span></li>
    <li><span class="chain-code" lang="en">CVE</span><span>個別の製品の脆弱性</span></li>
  </ol>
  <figcaption id="chain-cap">攻撃パターン（CAPEC）は弱点（CWE）を突き、弱点は個々の製品の脆弱性（CVE）として見つかる。<a href="${rel(depth)}guide/#chain">図の説明</a></figcaption>
</figure>`;
}

function section(id, title, body, cls = "") {
  if (!body || !body.trim()) return "";
  return `<section id="${id}" class="sec ${cls}" aria-labelledby="${id}-h"><h2 id="${id}-h">${title}</h2>\n${body}\n</section>`;
}

function referencesHtml(entry) {
  if (!entry.references?.length) return "";
  return `<ol class="refs" lang="en">${entry.references.map((r) => {
    const x = data.external_references[r.ref_id] || {};
    const parts = [x.authors?.join(", "), x.Title && `“${x.Title}”`, x.Publication, x.Publisher, x.Edition,
      [x.Publication_Year, x.Publication_Month, x.Publication_Day].filter(Boolean).join("-") || null,
      r.section && `Section: ${r.section}`].filter(Boolean).map(esc).join(". ");
    const url = x.URL ? ` <a href="${esc(x.URL)}" rel="noopener">${esc(x.URL)}</a>` : "";
    const acc = x.URL_Date ? ` <span class="ja" lang="ja">（URL確認日 ${esc(x.URL_Date)}）</span>` : "";
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
  return entry.notes.map((n) => `<div class="note"><h3>${lab("note_type", n.type)}</h3>${blocks(entry, n.text)}</div>`).join("");
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
  return entry.unknown.map((u) => `<div class="note"><h3 lang="en">${esc(u.tag)}</h3>${blocks(entry, u.text)}</div>`).join("");
}

function supplementHtml(entry) {
  const s = tr(entry.id).supplement;
  if (!s) return "";
  const parts = [];
  if (s.summary) parts.push(`<h3>ひとことで言うと（AIの要約）</h3><p>${fmt(s.summary)}</p>`);
  if (s.terms?.length) parts.push(`<h3>用語の説明</h3><dl class="terms">${s.terms.map((t) => `<dt>${esc(t.term)}${t.en ? `<span class="en-label" lang="en">（${esc(t.en)}）</span>` : ""}</dt><dd>${fmt(t.explain)}${t.example ? `<br><span class="ex">例：${fmt(t.example)}</span>` : ""}</dd>`).join("")}</dl>`);
  if (s.facts?.length) parts.push(`<h3>原典から読み取れる事実</h3><ul>${s.facts.map((f) => `<li>${fmt(f.text)} <span class="src">根拠：${fmt(f.source)}</span></li>`).join("")}</ul>`);
  if (s.analogy) parts.push(`<h3>たとえ話（AIの解釈）</h3><p>${fmt(s.analogy)}</p>`);
  if (s.example) parts.push(`<h3>具体例（AIの解釈）</h3><p>${fmt(s.example)}</p>`);
  if (s.interpretation?.length) parts.push(`<h3>AIの解釈</h3><ul>${s.interpretation.map((x) => `<li>${fmt(x)}</li>`).join("")}</ul>`);
  return `<section id="supplement" class="sec ai-box" aria-labelledby="supplement-h">
<h2 id="supplement-h">初学者向けの補足<span class="ai-label">AIによる補足・原典の訳ではありません</span></h2>
<p class="small">この欄は、原典の訳ではなく、AIが学習用に書いた補足です。「事実」には根拠となる原典の欄を示し、それ以外は「AIの解釈」として区別しています。</p>
${parts.join("\n")}
</section>`;
}

function flowHtml(entry) {
  if (!entry.execution_flow?.length) return "";
  const order = ["Explore", "Experiment", "Exploit"];
  const phases = [...new Set(entry.execution_flow.map((s) => s.phase || ""))].sort((a, b) => (order.indexOf(a) + 1 || 9) - (order.indexOf(b) + 1 || 9));
  const cols = phases.map((ph, i) => {
    const steps = entry.execution_flow.filter((s) => (s.phase || "") === ph).map((s) => {
      const tech = s.techniques.filter((t) => t.length).map((t) => `<li>${blocks(entry, t)}</li>`).join("");
      return `<li class="step"><span class="step-no">手順 ${esc(s.step || "")}</span>${blocks(entry, s.description)}${tech ? `<p class="tech-h">手法</p><ul class="tech">${tech}</ul>` : ""}</li>`;
    }).join("");
    const note = labels.phase_note[ph];
    return `<li class="phase"><h3><span class="phase-no" aria-hidden="true">${i + 1}</span>${ph ? lab("phase", ph, { both: false }) : "段階の指定なし"}</h3><p class="phase-note">${ph ? `<span lang="en">${esc(ph)}</span>${note ? "：" + esc(note) : ""}` : ""}</p><ol class="steps">${steps}</ol></li>`;
  }).join("");
  return `<p class="small safety">攻撃の流れは、仕組みを理解するための概念レベルで訳しています。具体的な攻撃用の文字列や、手順の再現に使える細部は訳さず「（具体的な内容は原典を参照）」としています。</p><ol class="flow">${cols}</ol>`;
}

function listOfBlocks(entry, arr, cls = "") {
  if (!arr?.length) return "";
  return `<ul class="${cls}">${arr.map((b) => `<li>${blocks(entry, b)}</li>`).join("")}</ul>`;
}

// ---------- 攻撃パターンのページ ----------
function attackPatternPage(e) {
  const depth = 2;
  const t = tr(e.id);
  const ja = t.seg?.name;
  const mech = catsOf(mechCats, e.id);
  const dom = catsOf(domainCats, e.id);
  const catName = (c) => nameJa(c) || nameEn(c);
  const skills = e.skills.map((s) => `<li>${lab("level", s.level)}：${blocks(e, s.text)}</li>`).join("");
  const conseq = e.consequences.length ? `<div class="table-wrap"><table><thead><tr><th scope="col">影響を受ける範囲</th><th scope="col">影響</th><th scope="col">起こる可能性</th><th scope="col">補足</th></tr></thead><tbody>${e.consequences.map((c) => `<tr><td>${c.scopes.map((x) => lab("scope", x)).join("、") || "—"}</td><td>${c.impacts.map((x) => lab("impact", x)).join("、") || "—"}</td><td>${c.likelihood ? lab("level", c.likelihood) : "—"}</td><td>${blocks(e, c.note) || "—"}</td></tr>`).join("")}</tbody></table></div>` : "";
  const related = e.related_attack_patterns.length ? `<div class="table-wrap"><table><thead><tr><th scope="col">関係</th><th scope="col">項目</th></tr></thead><tbody>${e.related_attack_patterns.map((r) => `<tr><td>${lab("nature", r.nature)}</td><td>${entryLink(r.id, depth)}${r.exclude?.length ? `<br><span class="small">除外：${r.exclude.map((x) => `CAPEC-${esc(x)}`).join("、")}</span>` : ""}</td></tr>`).join("")}</tbody></table></div>` : "";
  const cwes = e.related_weaknesses.length ? `<ul class="inline-list">${e.related_weaknesses.map((c) => `<li><a href="${cweUrl(c)}" rel="noopener" lang="en">CWE-${esc(c)}</a></li>`).join("")}</ul><p class="small">リンク先はMITREのCWEサイト（英語）です。</p>` : "";
  const alt = e.alternate_terms.length ? `<dl>${e.alternate_terms.map((a) => `<dt>${seg(e, a.term)}</dt><dd>${blocks(e, a.description)}</dd>`).join("")}</dl>` : "";

  const sections = [
    section("description", "説明", blocks(e, e.description)),
    section("extended", "詳細な説明", blocks(e, e.extended_description)),
    section("alternate", "別名", alt),
    section("flow", "攻撃の流れ", flowHtml(e)),
    section("prerequisites", "なぜ成立するのか ── 成立するための前提条件", listOfBlocks(e, e.prerequisites), "box-warn"),
    section("skills", "必要なスキル", skills ? `<ul>${skills}</ul>` : ""),
    section("resources", "必要な資源", listOfBlocks(e, e.resources)),
    section("indicators", "兆候", listOfBlocks(e, e.indicators)),
    section("consequences", "起こりうる影響", conseq),
    section("mitigations", "防御のポイント ── 対策（緩和策）", listOfBlocks(e, e.mitigations), "box-defense"),
    section("examples", "攻撃の例", listOfBlocks(e, e.examples)),
    section("related", "関連する攻撃パターン", related),
    section("cwe", "関連するCWE（弱点の分類）", cwes),
    section("taxonomy", "ATT&amp;CKなど他の分類との対応", taxonomyHtml(e)),
    section("notes", "注記", notesHtml(e)),
    section("other", "その他の欄", unknownHtml(e)),
    section("references", "参考文献", referencesHtml(e)),
    section("history", "更新履歴", historyHtml(e)),
  ].filter(Boolean);
  const toc = sections.map((s) => s.match(/id="([^"]+)"[^>]*><h2 id="[^"]+">(.*?)<\/h2>/)).filter(Boolean)
    .map((m) => `<li><a href="#${m[1]}">${m[2].replace(/<[^>]+>/g, "")}</a></li>`).join("");
  const sup = supplementHtml(e);

  const main = `<nav class="crumbs" aria-label="現在位置"><ol><li><a href="../../">ホーム</a></li>${mech[0] ? `<li><a href="../../categories/">カテゴリ一覧</a></li><li><a href="../${esc(mech[0])}/">${esc(catName(mech[0]))}</a></li>` : ""}<li aria-current="page">CAPEC-${esc(e.id)}</li></ol></nav>
${chain(depth, e.related_weaknesses.length)}
<div data-pagefind-body>
<header class="entry-head">
  ${mech.map((c) => `<a class="tag" href="../${esc(c)}/">${esc(catName(c))}</a>`).join("")}
  <h1 data-pagefind-meta="title">CAPEC-${esc(e.id)} ${ja ? esc(ja) : `<span lang="en">${esc(e.name.en)}</span>`}${ja ? `<span class="h1-en" lang="en">（${esc(e.name.en)}）</span>` : ""}</h1>
  <button type="button" class="fav" data-fav="${esc(e.id)}" aria-pressed="false">お気に入りに追加</button>
</header>
<p class="zone-label">ここから原典の日本語訳（AIによる翻訳）</p>
<div class="table-wrap"><table class="summary">
<tr><th scope="row">ID</th><td>CAPEC-${esc(e.id)}</td></tr>
<tr><th scope="row">英語名</th><td lang="en">${esc(e.name.en)}</td></tr>
<tr><th scope="row">日本語名</th><td>${ja ? esc(ja) : MISSING}</td></tr>
<tr><th scope="row">ステータス</th><td>${lab("status", e.status) || "—"}</td></tr>
<tr><th scope="row">抽象度</th><td>${lab("abstraction", e.abstraction) || "—"}</td></tr>
<tr><th scope="row">深刻度</th><td>${lab("level", e.severity) || "データに記載なし"}</td></tr>
<tr><th scope="row">攻撃される可能性</th><td>${lab("level", e.likelihood) || "データに記載なし"}</td></tr>
<tr><th scope="row">必要なスキル</th><td>${e.skills.map((s) => lab("level", s.level)).join("、") || "データに記載なし"}</td></tr>
<tr><th scope="row">攻撃の仕組み</th><td>${mech.map((c) => `<a href="../${esc(c)}/">${esc(catName(c))}</a>`).join("、") || "—"}</td></tr>
<tr><th scope="row">攻撃の領域</th><td>${dom.map((c) => `<a href="../${esc(c)}/">${esc(catName(c))}</a>`).join("、") || "—"}</td></tr>
<tr><th scope="row">原典（英語）</th><td><a href="${capecUrl(e.id)}" rel="noopener" lang="en">${capecUrl(e.id)}</a></td></tr>
</table></div>
<nav class="toc" aria-label="このページの内容"><h2 class="toc-h">このページの内容</h2><ol>${toc}${sup ? `<li><a href="#supplement">初学者向けの補足（AI）</a></li>` : ""}</ol></nav>
${sections.join("\n")}
</div>
${sup}`;

  const rel1 = e.related_attack_patterns.slice(0, 8).map((r) => `<li>${entryLink(r.id, depth)}<span class="small">${lab("nature", r.nature)}</span></li>`).join("");
  const learn = t.supplement?.learn?.length ? `<section class="side-box ai-box"><h2>この攻撃パターンで学べること<span class="ai-label">AIによる補足</span></h2><ul class="check">${t.supplement.learn.map((x) => `<li>${fmt(x)}</li>`).join("")}</ul></section>` : "";
  const right = `${rel1 ? `<section class="side-box"><h2>関連するパターン</h2><ul class="rel">${rel1}</ul>${e.related_attack_patterns.length > 8 ? `<p class="small"><a href="#related">すべて見る（${e.related_attack_patterns.length}件）</a></p>` : ""}</section>` : ""}
<section class="side-box"><h2>このパターンの出典</h2><p lang="en">MITRE CAPEC<br>Common Attack Pattern Enumeration and Classification</p><p><a href="${capecUrl(e.id)}" rel="noopener">原典（英語）を開く</a></p><p class="small">データ版 ${esc(meta.version)}（${esc(meta.catalog_date)}）</p></section>
${learn}
${studyBox(depth)}`;
  return page({ title: `CAPEC-${e.id} ${ja || e.name.en}`, depth, main, right, description: `CAPEC-${e.id}（${e.name.en}）の日本語訳（非公式・AI訳）` });
}

function studyBox(depth) {
  return `<section class="side-box"><h2>学習の進め方</h2><ol>
<li>「説明」を読み、どんな手口かをつかむ</li>
<li>「なぜ成立するのか（前提条件）」で、攻撃が成り立つ条件を確かめる</li>
<li>「攻撃の流れ」で、全体の段階を見る</li>
<li>「防御のポイント（対策）」を、前提条件のどれを崩すものかと結びつけて読む</li>
</ol><p class="small">この学習の手順はAIによる提案です。<a href="${rel(depth)}guide/">はじめに</a></p></section>
<section class="side-box"><h2>このサイトは学習用です</h2><p class="small">攻撃の実行手順や、具体的な攻撃用の文字列は載せていません。</p></section>`;
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
  const main = `<nav class="crumbs" aria-label="現在位置"><ol><li><a href="../../">ホーム</a></li><li><a href="../../categories/">カテゴリ一覧</a></li><li aria-current="page">CAPEC-${esc(e.id)}</li></ol></nav>
<div data-pagefind-body>
<header class="entry-head"><span class="tag">カテゴリ</span>
<h1 data-pagefind-meta="title">CAPEC-${esc(e.id)} ${ja ? esc(ja) : `<span lang="en">${esc(e.name.en)}</span>`}${ja ? `<span class="h1-en" lang="en">（${esc(e.name.en)}）</span>` : ""}</h1></header>
<p class="zone-label">ここから原典の日本語訳（AIによる翻訳）</p>
<div class="table-wrap"><table class="summary">
<tr><th scope="row">ID</th><td>CAPEC-${esc(e.id)}</td></tr>
<tr><th scope="row">英語名</th><td lang="en">${esc(e.name.en)}</td></tr>
<tr><th scope="row">種類</th><td>カテゴリ（攻撃パターンをまとめる分類）</td></tr>
<tr><th scope="row">ステータス</th><td>${lab("status", e.status) || "—"}</td></tr>
<tr><th scope="row">原典（英語）</th><td><a href="${capecUrl(e.id)}" rel="noopener" lang="en">${capecUrl(e.id)}</a></td></tr>
</table></div>
${section("summary", "概要", blocks(e, e.summary))}
${section("members", `直接含まれる項目（${direct.length}件）`, direct.length ? memberList(direct, depth) : "")}
${all.length !== direct.length ? section("all", `下位の項目を含むすべての攻撃パターン（${all.length}件）`, memberList(all, depth)) : ""}
${section("taxonomy", "他の分類との対応", taxonomyHtml(e))}
${section("notes", "注記", notesHtml(e))}
${section("other", "その他の欄", unknownHtml(e))}
${section("references", "参考文献", referencesHtml(e))}
${section("history", "更新履歴", historyHtml(e))}
</div>
${supplementHtml(e)}`;
  return page({ title: `CAPEC-${e.id} ${ja || e.name.en}`, depth, main, current: "categories" });
}

function viewPage(e) {
  const depth = 2;
  const ja = nameJa(e.id);
  const aud = e.audience?.length ? `<dl>${e.audience.map((a) => `<dt lang="en">${esc(a.type)}</dt><dd>${blocks(e, a.description)}</dd>`).join("")}</dl>` : "";
  const main = `<nav class="crumbs" aria-label="現在位置"><ol><li><a href="../../">ホーム</a></li><li><a href="../../categories/">カテゴリ一覧</a></li><li aria-current="page">CAPEC-${esc(e.id)}</li></ol></nav>
<div data-pagefind-body>
<header class="entry-head"><span class="tag">ビュー</span>
<h1 data-pagefind-meta="title">CAPEC-${esc(e.id)} ${ja ? esc(ja) : `<span lang="en">${esc(e.name.en)}</span>`}${ja ? `<span class="h1-en" lang="en">（${esc(e.name.en)}）</span>` : ""}</h1></header>
<p class="zone-label">ここから原典の日本語訳（AIによる翻訳）</p>
<div class="table-wrap"><table class="summary">
<tr><th scope="row">ID</th><td>CAPEC-${esc(e.id)}</td></tr>
<tr><th scope="row">英語名</th><td lang="en">${esc(e.name.en)}</td></tr>
<tr><th scope="row">種類</th><td>ビュー（ある観点で項目を選んで並べた一覧）：${lab("view_type", e.view_type) || "—"}</td></tr>
<tr><th scope="row">ステータス</th><td>${lab("status", e.status) || "—"}</td></tr>
<tr><th scope="row">原典（英語）</th><td><a href="${capecUrl(e.id)}" rel="noopener" lang="en">${capecUrl(e.id)}</a></td></tr>
</table></div>
${section("objective", "目的", blocks(e, e.objective))}
${section("audience", "想定する読者", aud)}
${section("filter", "選び方の条件（原文）", e.filter ? `<pre lang="en"><code>${esc(e.filter)}</code></pre>` : "")}
${section("members", `含まれる項目（${(e.members || []).length}件）`, (e.members || []).length ? memberList(e.members, depth) : "")}
${section("notes", "注記", notesHtml(e))}
${section("other", "その他の欄", unknownHtml(e))}
${section("references", "参考文献", referencesHtml(e))}
${section("history", "更新履歴", historyHtml(e))}
</div>`;
  return page({ title: `CAPEC-${e.id} ${ja || e.name.en}`, depth, main, current: "categories" });
}

// ---------- トップページ ----------
function indexPage() {
  const opt = (ids) => ids.map((c) => `<option value="${esc(c)}">${esc(nameJa(c) || nameEn(c))}</option>`).join("");
  const optLab = (group, vals) => [...new Set(vals.filter(Boolean))].sort().map((v) => `<option value="${esc(v)}">${esc(labels[group]?.[v] || v)}</option>`).join("");
  const rows = attackPatterns.map((e) => {
    const ja = nameJa(e.id);
    return `<tr data-abs="${esc(e.abstraction || "")}" data-status="${esc(e.status || "")}" data-mech="${catsOf(mechCats, e.id).join(" ")}" data-dom="${catsOf(domainCats, e.id).join(" ")}">
<td><a href="capec/${esc(e.id)}/">CAPEC-${esc(e.id)}</a></td><td>${ja ? `<a href="capec/${esc(e.id)}/">${esc(ja)}</a>` : `<span class="small">${MISSING}</span>`}</td><td lang="en">${esc(e.name.en)}</td><td>${esc(labels.abstraction[e.abstraction] || e.abstraction || "—")}</td><td>${esc(labels.status[e.status] || e.status || "—")}</td></tr>`;
  }).join("\n");
  const done = attackPatterns.filter((e) => translations.get(e.id)?.status === "done").length;
  const main = `<h1>CAPEC 攻撃パターン辞典 日本語版（非公式）</h1>
<p class="lead">MITREが公開している攻撃パターンの辞典「CAPEC」を、日本語で読めるようにしたサイトです。攻撃が<strong>なぜ成立するのか</strong>という仕組みを理解し、守る側の理解に役立てることを目的にしています。攻撃の実行手引きではありません。</p>
${chain(0, null)}
<section class="stats" aria-labelledby="stats-h"><h2 id="stats-h">公式データの概要</h2>
<dl>
<div><dt>攻撃パターン</dt><dd>${meta.counts.attack_pattern}件</dd></div>
<div><dt>カテゴリ</dt><dd>${meta.counts.category}件</dd></div>
<div><dt>ビュー</dt><dd>${meta.counts.view}件</dd></div>
<div><dt>データの版</dt><dd>${esc(meta.version)}</dd></div>
<div><dt>公式データの日付</dt><dd>${esc(meta.catalog_date)}</dd></div>
<div><dt>取得日</dt><dd>${esc(meta.retrieved)}</dd></div>
<div><dt>日本語訳が済んだ攻撃パターン</dt><dd>${done}件</dd></div>
</dl>
<p class="small">件数は、MITREの公式ダウンロードデータ（XML）から数えたものです。</p></section>
<section id="list" aria-labelledby="list-h"><h2 id="list-h">すべての攻撃パターン</h2>
<form class="filters" data-filters>
<div><label for="f-abs">抽象度</label><select id="f-abs" data-key="abs"><option value="">すべて</option>${optLab("abstraction", attackPatterns.map((e) => e.abstraction))}</select></div>
<div><label for="f-status">ステータス</label><select id="f-status" data-key="status"><option value="">すべて</option>${optLab("status", attackPatterns.map((e) => e.status))}</select></div>
<div><label for="f-mech">攻撃の仕組み</label><select id="f-mech" data-key="mech" data-multi><option value="">すべて</option>${opt(mechCats)}</select></div>
<div><label for="f-dom">攻撃の領域</label><select id="f-dom" data-key="dom" data-multi><option value="">すべて</option>${opt(domainCats)}</select></div>
</form>
<p class="filter-count" role="status" data-filter-count>${attackPatterns.length}件を表示</p>
<div class="table-wrap"><table class="list"><thead><tr><th scope="col">ID</th><th scope="col">日本語名</th><th scope="col">英語名</th><th scope="col">抽象度</th><th scope="col">ステータス</th></tr></thead><tbody>
${rows}
</tbody></table></div>
<p class="small">抽象度：メタ（もっとも抽象的な手口の型）、標準（特定の技術に寄った型）、詳細（具体的な技術や手順まで絞った型）。</p>
</section>`;
  return page({ title: "ホーム", depth: 0, main, current: "home" });
}

function categoriesPage() {
  const depth = 1;
  const block = (title, viewId, ids) => ids.length ? `<section class="sec" aria-labelledby="v${viewId}"><h2 id="v${viewId}">${title}（${entryLink(viewId, depth)}）</h2><ul class="entry-list">${ids.map((c) => `<li>${entryLink(c, depth)} <span class="small">${catClosure(c).size}件</span></li>`).join("")}</ul></section>` : "";
  const main = `<nav class="crumbs" aria-label="現在位置"><ol><li><a href="../">ホーム</a></li><li aria-current="page">カテゴリ一覧</li></ol></nav>
<h1>カテゴリ一覧</h1>
<p>CAPECでは、攻撃パターンを「カテゴリ」でまとめ、カテゴリを「ビュー」（ある観点で選んで並べた一覧）で整理しています。件数は、下位の項目を含めた攻撃パターンの数です。</p>
${block("攻撃の仕組みで分ける", MECH_VIEW, mechCats)}
${block("攻撃の領域で分ける", DOMAIN_VIEW, domainCats)}
<section class="sec" aria-labelledby="allv"><h2 id="allv">すべてのビュー（${views.length}件）</h2>${memberList(views.map((v) => v.id), depth)}</section>
<section class="sec" aria-labelledby="allc"><h2 id="allc">すべてのカテゴリ（${categories.length}件）</h2>${memberList(categories.map((c) => c.id), depth)}</section>`;
  return page({ title: "カテゴリ一覧", depth, main, current: "categories" });
}

function searchPage() {
  const main = `<nav class="crumbs" aria-label="現在位置"><ol><li><a href="../">ホーム</a></li><li aria-current="page">検索</li></ol></nav>
<h1>攻撃パターンを検索</h1>
<form class="search-form" data-search-form role="search">
<label for="q">キーワード</label>
<input id="q" name="q" type="search" autocomplete="off">
<button type="submit">検索</button>
</form>
<p class="small">日本語・英語のどちらでも検索できます。動詞の活用形（例：「騙して」）では見つからないことがあり、その場合は漢字やカタカナの部分だけで検索し直します（例：「騙」）。</p>
<p role="status" class="search-status" data-search-status></p>
<ol class="search-results" data-search-results></ol>
<noscript><p>検索にはJavaScriptが必要です。<a href="../">トップページの一覧</a>から探すこともできます。</p></noscript>
<script src="../assets/search.js" defer></script>`;
  return page({ title: "検索", depth: 1, main, current: "search" });
}

function favoritesPage() {
  const main = `<nav class="crumbs" aria-label="現在位置"><ol><li><a href="../">ホーム</a></li><li aria-current="page">お気に入り</li></ol></nav>
<h1>お気に入り</h1>
<p>項目ページの「お気に入りに追加」で登録した項目です。登録は、このブラウザの中だけに保存されます（サーバーには送られません）。</p>
<ul class="entry-list" data-fav-list></ul>
<p data-fav-empty hidden>まだ登録された項目はありません。</p>`;
  return page({ title: "お気に入り", depth: 1, main, current: "favorites" });
}

function glossaryPage() {
  const main = `<nav class="crumbs" aria-label="現在位置"><ol><li><a href="../">ホーム</a></li><li aria-current="page">用語集</li></ol></nav>
<h1>用語集</h1>
<p>このサイトで使う訳語の一覧です。訳語はサイト全体でそろえています。<strong>説明はAIによる補足で、原典の訳ではありません。</strong></p>
<dl class="glossary" data-pagefind-body>${glossary.terms.map((t) => `<dt id="g-${esc(t.en.replace(/\s+/g, "-"))}">${esc(t.ja)}<span class="en-label" lang="en">（${esc(t.en)}）</span></dt><dd>${fmt(t.explain || "")}</dd>`).join("")}</dl>
<section class="sec" aria-labelledby="lab-h"><h2 id="lab-h">データの決まった値の訳語</h2>
${Object.entries(labels).filter(([k]) => !k.startsWith("_") && k !== "phase_note").map(([g, m]) => `<h3>${esc({ abstraction: "抽象度", status: "ステータス", level: "程度（深刻度・可能性・スキル）", phase: "攻撃の段階", nature: "攻撃パターン同士の関係", scope: "影響を受ける範囲", impact: "影響", note_type: "注記の種類", view_type: "ビューの種類", mapping_fit: "他の分類との対応の程度", taxonomy: "他の分類の名前", history: "更新履歴の種類", kind: "項目の種類" }[g] || g)}</h3><div class="table-wrap"><table><thead><tr><th scope="col">原文</th><th scope="col">訳語</th></tr></thead><tbody>${Object.entries(m).map(([en, ja]) => `<tr><td lang="en">${esc(en)}</td><td${/^[\x00-\x7F]+$/.test(ja) ? ' lang="en"' : ""}>${esc(ja)}</td></tr>`).join("")}</tbody></table></div>`).join("")}
</section>`;
  return page({ title: "用語集", depth: 1, main, current: "glossary" });
}

function guidePage() {
  const main = `<nav class="crumbs" aria-label="現在位置"><ol><li><a href="../">ホーム</a></li><li aria-current="page">はじめに</li></ol></nav>
<h1>はじめに</h1>
<p>このページは、このサイトの読み方をAIがまとめた案内です。用語の正式な定義は、各リンク先の公式サイト（英語）で確認してください。</p>
<section id="chain" class="sec" aria-labelledby="chain-h"><h2 id="chain-h">CAPEC・CWE・CVEの関係</h2>
${chain(1, null)}
<ul>
<li><strong lang="en">CAPEC</strong>（攻撃パターン）：攻撃によく見られる手口を型として整理した一覧。MITREが公開しています。<a href="https://capec.mitre.org/" rel="noopener">capec.mitre.org</a></li>
<li><strong lang="en">CWE</strong>（弱点の種類）：ソフトウェアやハードウェアの弱点の種類を整理した一覧。MITREが公開しています。<a href="https://cwe.mitre.org/" rel="noopener">cwe.mitre.org</a></li>
<li><strong lang="en">CVE</strong>（個別の脆弱性）：公に知られた個々の脆弱性に付けられる識別番号。<a href="https://www.cve.org/" rel="noopener">www.cve.org</a></li>
</ul>
<p>たとえ話（AIの解釈）：CAPECが「空き巣の手口の型（例：鍵の閉め忘れを狙う）」だとすると、CWEは「家の造りの弱点の種類（例：外から開けられる窓の鍵）」、CVEは「ある会社のある型番の窓の鍵に見つかった具体的な欠陥」にあたります。</p>
<p>CAPECの各項目には「関連するCWE」の欄があり、このサイトではCWEの原典ページへリンクしています。CVEは個々の製品の問題なので、このサイトでは扱いません。</p>
</section>
<section class="sec" aria-labelledby="read-h"><h2 id="read-h">項目ページの読み方</h2>
<ol>
<li><strong>説明</strong>：どんな手口かの概要。</li>
<li><strong>攻撃の流れ</strong>：探索（調べる）→ 試行（試す）→ 悪用（使う）の段階。概念レベルで訳しています。</li>
<li><strong>なぜ成立するのか（前提条件）</strong>：攻撃が成り立つために必要な条件。</li>
<li><strong>防御のポイント（対策）</strong>：前提条件を崩したり、被害を小さくしたりする方法。</li>
<li><strong>初学者向けの補足</strong>：AIが書いた補足。原典の訳とは枠と見出しで区別しています。</li>
</ol>
<p>本文中の「要確認」の印は、訳が不確かな箇所です。「（具体的な内容は原典を参照）」は、安全のために訳さなかった箇所です。</p>
</section>`;
  return page({ title: "はじめに", depth: 1, main });
}

function aboutPage() {
  const main = `<nav class="crumbs" aria-label="現在位置"><ol><li><a href="../">ホーム</a></li><li aria-current="page">このサイトについて</li></ol></nav>
<h1>このサイトについて</h1>
<section class="sec box-warn" aria-labelledby="d-h"><h2 id="d-h">ご注意</h2><p>${esc(DISCLAIMER)}</p></section>
<section class="sec" aria-labelledby="p-h"><h2 id="p-h">目的と方針</h2>
<ul>
<li>日本語を母語とする、プログラミングを知らない学習者が、攻撃が成立する仕組みを理解するための資料です。</li>
<li>防御する側の理解のための資料であり、攻撃の実行手引きではありません。</li>
<li>原典にある具体的な攻撃用の文字列、命令、手順の再現に使える細部は訳さず、「（具体的な内容は原典を参照）」としています。</li>
<li>防御に必要な「前提条件」「影響」「対策」は省略していません。</li>
<li>訳が不確かな箇所には「要確認」の印を付けています。</li>
<li>「初学者向けの補足」はAIによる補足で、原典の訳ではありません。</li>
</ul></section>
<section class="sec" aria-labelledby="s-h"><h2 id="s-h">データ</h2>
<dl class="kv">
<dt>出典</dt><dd>MITRE CAPEC（<a href="https://capec.mitre.org/" lang="en">https://capec.mitre.org/</a>）の公式ダウンロードデータ（XML）</dd>
<dt>データの版</dt><dd>${esc(meta.version)}</dd>
<dt>公式データの日付</dt><dd>${esc(meta.catalog_date)}</dd>
<dt>取得日</dt><dd>${esc(meta.retrieved)}</dd>
<dt>ファイルのSHA-256</dt><dd><code>${esc(meta.source_sha256)}</code></dd>
</dl></section>
<section class="sec" aria-labelledby="l-h"><h2 id="l-h">著作権とライセンス</h2><p>著作権表示とライセンス文（原文）は、各ページの下部に掲載しています。原文は <a href="${esc(license.source_url)}">${esc(license.source_url)}</a> から引用しています。</p></section>`;
  return page({ title: "このサイトについて", depth: 1, main });
}

function notFoundPage() {
  // 404はどの階層のURLでも表示されるため、リンクは絶対パスにする
  return page({ title: "ページが見つかりません", depth: 0, main: `<h1>ページが見つかりません</h1><p>URLが正しいか確認してください。<a href="/">トップページへ</a></p>` })
    .replaceAll('href="./', 'href="/').replaceAll('src="./', 'src="/').replace('data-root="./"', 'data-root="/"');
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
