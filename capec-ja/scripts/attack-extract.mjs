// MITRE ATT&CK の公式STIXデータ(source/attack/*.json)から、サイト生成に必要な分だけを
// data/attack.en.json に抜き出す。生データ(50MB超)はリポジトリに入れず、このスクリプトで
// 都度抜き出した、軽量なJSONだけをコミットする。
// 使い方: node scripts/attack-extract.mjs <STIXファイル> <domain:enterprise-attack|mobile-attack|ics-attack> <取得日YYYY-MM-DD>
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import crypto from "node:crypto";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const [, , srcPath, domain, retrieved] = process.argv;
if (!srcPath || !domain || !retrieved) {
  console.error("使い方: node scripts/attack-extract.mjs <STIXファイル> <domain> <取得日YYYY-MM-DD>");
  process.exit(1);
}

const bundle = JSON.parse(fs.readFileSync(srcPath, "utf8"));
const objects = bundle.objects;
const byStixId = new Map(objects.map((o) => [o.id, o]));
const sha = (s) => crypto.createHash("sha256").update(s).digest("hex").slice(0, 16);

const extId = (o) => o.external_references?.find((r) => r.source_name === "mitre-attack")?.external_id || null;
const active = (o) => !o.revoked && !o.x_mitre_deprecated;

// ---------- 文章の整形：見出し語の抜き出しに使う箇所だけを軽く処理する ----------
// ATT&CKの説明文はMarkdown風。(Citation: ...)は除き、出典は別途References欄にまとめる。
// [語](url) はリンク先の区別（技術・戦術か、それ以外か）をせず、まず語だけを残す(Phase 1の簡略化)。
function cleanText(s) {
  if (!s) return "";
  return s
    .replace(/\(Citation:[^)]*\)/g, "")
    .replace(/\[([^\]]+)\]\(https?:\/\/[^)]+\)/g, "$1")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}
function toParagraphs(text, prefix) {
  const cleaned = cleanText(text);
  if (!cleaned) return [];
  return cleaned.split(/\n\s*\n/).map((p, i) => ({ k: `${prefix}/${i}`, en: p.trim() })).filter((p) => p.en);
}

function refsOf(o) {
  return (o.external_references || [])
    .filter((r) => r.source_name !== "mitre-attack")
    .map((r) => ({ source_name: r.source_name, description: r.description || "", url: r.url || "" }));
}

// ---------- 戦術(Tactic) ----------
const tactics = objects
  .filter((o) => o.type === "x-mitre-tactic" && active(o) && (o.x_mitre_domains || []).includes(domain))
  .map((o) => {
    const id = extId(o);
    const description = toParagraphs(o.description, "description");
    return {
      id,
      shortname: o.x_mitre_shortname,
      name: o.name,
      description,
      source_sha: sha(JSON.stringify({ name: o.name, description })),
    };
  })
  .sort((a, b) => a.id.localeCompare(b.id));
const tacticByShortname = new Map(tactics.map((t) => [t.shortname, t]));

// ---------- 対策(Mitigation)・攻撃グループ(Group)・ソフトウェア(Software)：名前だけ ----------
const coaById = new Map();
for (const o of objects) if (o.type === "course-of-action") coaById.set(o.id, o);
const actorById = new Map();
for (const o of objects) if (o.type === "intrusion-set" || o.type === "malware" || o.type === "tool") actorById.set(o.id, o);

// ---------- 関係(Relationship) ----------
const mitigatesByTarget = new Map(); // attack-pattern stixId -> [{coa, rel}]
const usesByTarget = new Map(); // attack-pattern stixId -> [{actor, rel}]
const subOf = new Map(); // sub stixId -> parent stixId
for (const o of objects) {
  if (o.type !== "relationship" || !active(o)) continue;
  if (o.relationship_type === "mitigates") {
    const coa = coaById.get(o.source_ref);
    if (!coa || !active(coa)) continue;
    (mitigatesByTarget.get(o.target_ref) || mitigatesByTarget.set(o.target_ref, []).get(o.target_ref)).push({ coa, rel: o });
  } else if (o.relationship_type === "uses") {
    const actor = actorById.get(o.source_ref);
    const target = byStixId.get(o.target_ref);
    if (!actor || !active(actor) || !target || target.type !== "attack-pattern") continue;
    if (!o.description || !o.description.trim()) continue;
    (usesByTarget.get(o.target_ref) || usesByTarget.set(o.target_ref, []).get(o.target_ref)).push({ actor, rel: o });
  } else if (o.relationship_type === "subtechnique-of") {
    subOf.set(o.source_ref, o.target_ref);
  }
}

// ---------- 技術・サブ技術(Technique) ----------
const techniquesRaw = objects.filter((o) => o.type === "attack-pattern" && active(o) && (o.x_mitre_domains || []).includes(domain));
const techniques = techniquesRaw.map((o) => {
  const id = extId(o);
  const description = toParagraphs(o.description, "description");
  // kill_chain_name はドメインごとに異なる(Enterprise: mitre-attack、Mobile: mitre-mobile-attack、
  // ICS: mitre-ics-attack)。"mitre-attack"固定だとEnterprise以外で戦術との対応が空になるため、
  // "mitre-"で始まるものすべてを対象にする。
  const tacticShortnames = (o.kill_chain_phases || []).filter((p) => p.kill_chain_name?.startsWith("mitre-")).map((p) => p.phase_name);
  const parentStix = subOf.get(o.id);
  const parent = parentStix ? byStixId.get(parentStix) : null;

  const mitigations = (mitigatesByTarget.get(o.id) || [])
    .map(({ coa, rel }) => ({
      id: extId(coa),
      name: coa.name,
      note: toParagraphs(rel.description, `mitigation/${extId(coa)}`),
    }))
    .filter((m) => m.id)
    .sort((a, b) => a.id.localeCompare(b.id));

  const procedures = (usesByTarget.get(o.id) || [])
    .map(({ actor, rel }) => ({
      actor_type: actor.type === "intrusion-set" ? "group" : actor.type === "tool" ? "tool" : "malware",
      actor_id: extId(actor),
      actor_name: actor.name,
      text: toParagraphs(rel.description, `procedure/${extId(actor)}`),
    }))
    .filter((p) => p.actor_id && p.text.length)
    .sort((a, b) => a.actor_id.localeCompare(b.actor_id));

  const subIds = techniquesRaw.filter((s) => subOf.get(s.id) === o.id).map((s) => extId(s)).filter(Boolean).sort();

  const content = { name: o.name, description, mitigations, procedures };
  return {
    id,
    name: o.name,
    is_subtechnique: !!o.x_mitre_is_subtechnique,
    parent_id: parent ? extId(parent) : null,
    sub_technique_ids: subIds,
    tactics: tacticShortnames,
    platforms: o.x_mitre_platforms || [],
    description,
    mitigations,
    procedures,
    references: refsOf(o),
    source_sha: sha(JSON.stringify(content)),
  };
}).filter((t) => t.id).sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }));

const out = {
  meta: {
    source: "https://github.com/mitre-attack/attack-stix-data",
    domain,
    retrieved,
    counts: { tactic: tactics.length, technique: techniques.filter((t) => !t.is_subtechnique).length, subtechnique: techniques.filter((t) => t.is_subtechnique).length },
  },
  tactics,
  techniques,
};
fs.mkdirSync(path.join(ROOT, "data"), { recursive: true });
fs.writeFileSync(path.join(ROOT, `data/attack.${domain}.json`), JSON.stringify(out, null, 1));
console.log(`抽出完了（${domain}）: 戦術 ${tactics.length}件 / 技術 ${out.meta.counts.technique}件 / サブ技術 ${out.meta.counts.subtechnique}件`);
