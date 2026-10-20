"""CAPEC公式XMLから、サイト生成に使う英語データ(JSON)を取り出す。

使い方: python3 -I scripts/extract.py <capec.xml> <出力.json> <取得日 YYYY-MM-DD>

- 訳す対象の文字列は、すべて {"en": ..., "k": キー} の形にする。
  キーは項目内の位置を表す(例: "description/0")。訳文はこのキーで対応づける。
- このスクリプトが扱わない要素が見つかったら "unknown" に入れて、標準出力に報告する。
  (データにあるものをすべて載せるため、黙って捨てない)
"""
import hashlib
import json
import re
import sys
import xml.etree.ElementTree as ET


def local(tag):
    return tag.rsplit("}", 1)[-1] if isinstance(tag, str) else ""


def norm(s):
    return re.sub(r"\s+", " ", s or "").strip()


INLINE_CODE = {"code", "tt", "samp", "kbd", "var"}
BLOCK_TAGS = {"p", "div", "ul", "ol", "table", "pre", "blockquote",
              "h1", "h2", "h3", "h4", "h5", "h6"}


def inline_text(e):
    """インライン要素を平文にする。コード要素は `...` で囲んで残す(安全確認で拾うため)。"""
    out = [e.text or ""]
    for c in e:
        name = local(c.tag)
        if name == "br":
            out.append("\n")
        elif name in INLINE_CODE:
            out.append("`" + norm(inline_text(c)) + "`")
        elif name in ("ul", "ol"):
            out.append(" ".join("・" + norm(inline_text(li)) for li in c))
        else:
            out.append(inline_text(c))
        out.append(c.tail or "")
    return "".join(out)


def clean_inline(s):
    lines = [norm(x) for x in s.split("\n")]
    return "\n".join(x for x in lines if x)


def blocks(e):
    """構造化テキスト(XHTML混在)を、段落・箇条書き・表・コードのブロック列にする。"""
    result = []
    buf = [e.text or ""]

    def flush():
        t = clean_inline("".join(buf))
        if t:
            result.append({"type": "p", "en": t})
        buf.clear()

    for c in e:
        name = local(c.tag)
        if name in BLOCK_TAGS:
            flush()
            if name in ("ul", "ol"):
                items = [{"en": clean_inline(inline_text(li))} for li in c if local(li.tag) == "li"]
                items = [i for i in items if i["en"]]
                if items:
                    result.append({"type": name, "items": items})
            elif name == "table":
                rows = []
                for tr in c.iter():
                    if local(tr.tag) != "tr":
                        continue
                    cells = [{"en": clean_inline(inline_text(td)), "th": local(td.tag) == "th"}
                             for td in tr if local(td.tag) in ("td", "th")]
                    rows.append(cells)
                if rows:
                    result.append({"type": "table", "rows": rows})
            elif name == "pre":
                t = "".join(c.itertext()).strip("\n")
                if t.strip():
                    result.append({"type": "code", "en": t})
            elif name in ("div", "blockquote"):
                result.extend(blocks(c))
            else:  # p, h*
                t = clean_inline(inline_text(c))
                if t:
                    result.append({"type": "p", "en": t})
            buf.append(c.tail or "")
        elif name == "br":
            buf.append("\n")
            buf.append(c.tail or "")
        elif name in INLINE_CODE:
            buf.append("`" + norm(inline_text(c)) + "`")
            buf.append(c.tail or "")
        else:
            buf.append(inline_text(c))
            buf.append(c.tail or "")
    flush()
    return result


def child(e, name):
    for c in e:
        if local(c.tag) == name:
            return c
    return None


def children(e, name):
    return [c for c in e if local(c.tag) == name] if e is not None else []


def text_of(e, name):
    c = child(e, name)
    return norm("".join(c.itertext())) if c is not None else None


def raw_fields(e):
    return {local(c.tag): norm("".join(c.itertext())) for c in e}


def content_history(e):
    if e is None:
        return []
    out = []
    for c in e:
        item = {"type": local(c.tag), "fields": raw_fields(c)}
        if c.attrib:
            item["attrs"] = dict(c.attrib)
        if not len(c):
            item["fields"] = {"value": norm(c.text)}
        out.append(item)
    return out


def taxonomy_mappings(e):
    out = []
    for m in children(e, "Taxonomy_Mapping"):
        out.append({
            "taxonomy": m.get("Taxonomy_Name"),
            "entry_id": text_of(m, "Entry_ID"),
            "entry_name": text_of(m, "Entry_Name"),
            "fit": text_of(m, "Mapping_Fit"),
        })
    return out


def references(e):
    return [{"ref_id": r.get("External_Reference_ID"), "section": r.get("Section")}
            for r in children(e, "Reference")]


def notes(e):
    return [{"type": n.get("Type"), "text": blocks(n)} for n in children(e, "Note")]


def members(e):
    return [m.get("CAPEC_ID") for m in e.iter() if local(m.tag) == "Has_Member"] if e is not None else []


AP_HANDLED = {
    "Description", "Extended_Description", "Alternate_Terms", "Likelihood_Of_Attack",
    "Typical_Severity", "Related_Attack_Patterns", "Execution_Flow", "Prerequisites",
    "Skills_Required", "Resources_Required", "Indicators", "Consequences", "Mitigations",
    "Example_Instances", "Related_Weaknesses", "Taxonomy_Mappings", "References", "Notes",
    "Content_History",
}


def attack_pattern(e):
    d = {
        "id": e.get("ID"), "kind": "attack_pattern",
        "name": {"en": norm(e.get("Name"))},
        "abstraction": e.get("Abstraction"), "status": e.get("Status"),
        "likelihood": text_of(e, "Likelihood_Of_Attack"),
        "severity": text_of(e, "Typical_Severity"),
        "description": blocks(child(e, "Description")) if child(e, "Description") is not None else [],
        "extended_description": blocks(child(e, "Extended_Description")) if child(e, "Extended_Description") is not None else [],
        "alternate_terms": [], "related_attack_patterns": [], "execution_flow": [],
        "prerequisites": [], "skills": [], "resources": [], "indicators": [],
        "consequences": [], "mitigations": [], "examples": [], "related_weaknesses": [],
        "taxonomy_mappings": [], "references": [], "notes": [], "content_history": [],
        "unknown": [],
    }
    for c in e:
        name = local(c.tag)
        if name == "Alternate_Terms":
            for t in children(c, "Alternate_Term"):
                desc = child(t, "Description")
                d["alternate_terms"].append({"term": {"en": text_of(t, "Term")},
                                             "description": blocks(desc) if desc is not None else []})
        elif name == "Related_Attack_Patterns":
            for r in children(c, "Related_Attack_Pattern"):
                d["related_attack_patterns"].append({
                    "nature": r.get("Nature"), "id": r.get("CAPEC_ID"),
                    "exclude": [x.get("Exclude_ID") for x in r.iter() if local(x.tag) == "Exclude_Related"],
                })
        elif name == "Execution_Flow":
            for s in children(c, "Attack_Step"):
                desc = child(s, "Description")
                d["execution_flow"].append({
                    "step": text_of(s, "Step"), "phase": text_of(s, "Phase"),
                    "description": blocks(desc) if desc is not None else [],
                    "techniques": [blocks(t) for t in children(s, "Technique")],
                })
        elif name == "Prerequisites":
            d["prerequisites"] = [blocks(x) for x in children(c, "Prerequisite")]
        elif name == "Skills_Required":
            d["skills"] = [{"level": x.get("Level"), "text": blocks(x)} for x in children(c, "Skill")]
        elif name == "Resources_Required":
            d["resources"] = [blocks(x) for x in children(c, "Resource")]
        elif name == "Indicators":
            d["indicators"] = [blocks(x) for x in children(c, "Indicator")]
        elif name == "Consequences":
            for x in children(c, "Consequence"):
                note = child(x, "Note")
                d["consequences"].append({
                    "scopes": [norm(s.text) for s in children(x, "Scope")],
                    "impacts": [norm(s.text) for s in children(x, "Impact")],
                    "likelihood": text_of(x, "Likelihood"),
                    "note": blocks(note) if note is not None else [],
                })
        elif name == "Mitigations":
            d["mitigations"] = [blocks(x) for x in children(c, "Mitigation")]
        elif name == "Example_Instances":
            d["examples"] = [blocks(x) for x in children(c, "Example")]
        elif name == "Related_Weaknesses":
            d["related_weaknesses"] = [x.get("CWE_ID") for x in children(c, "Related_Weakness")]
        elif name == "Taxonomy_Mappings":
            d["taxonomy_mappings"] = taxonomy_mappings(c)
        elif name == "References":
            d["references"] = references(c)
        elif name == "Notes":
            d["notes"] = notes(c)
        elif name == "Content_History":
            d["content_history"] = content_history(c)
        if name not in AP_HANDLED:
            d["unknown"].append({"tag": name, "attrs": dict(c.attrib), "text": blocks(c)})
    return d


CAT_HANDLED = {"Summary", "Relationships", "Taxonomy_Mappings", "References", "Notes", "Content_History"}


def category(e):
    summ = child(e, "Summary")
    d = {
        "id": e.get("ID"), "kind": "category", "name": {"en": norm(e.get("Name"))},
        "status": e.get("Status"),
        "summary": blocks(summ) if summ is not None else [],
        "members": members(child(e, "Relationships")),
        "taxonomy_mappings": taxonomy_mappings(child(e, "Taxonomy_Mappings")) if child(e, "Taxonomy_Mappings") is not None else [],
        "references": references(child(e, "References")) if child(e, "References") is not None else [],
        "notes": notes(child(e, "Notes")) if child(e, "Notes") is not None else [],
        "content_history": content_history(child(e, "Content_History")),
        "unknown": [{"tag": local(c.tag), "attrs": dict(c.attrib), "text": blocks(c)}
                    for c in e if local(c.tag) not in CAT_HANDLED],
    }
    return d


VIEW_HANDLED = {"Objective", "Audience", "Members", "Filter", "References", "Notes", "Content_History"}


def view(e):
    obj = child(e, "Objective")
    aud = child(e, "Audience")
    d = {
        "id": e.get("ID"), "kind": "view", "name": {"en": norm(e.get("Name"))},
        "view_type": e.get("Type"), "status": e.get("Status"),
        "objective": blocks(obj) if obj is not None else [],
        "audience": [{"type": s_type, "description": blocks(desc) if desc is not None else []}
                     for s in children(aud, "Stakeholder")
                     for s_type, desc in [(text_of(s, "Type"), child(s, "Description"))]],
        "members": members(child(e, "Members")),
        "filter": text_of(e, "Filter"),
        "references": references(child(e, "References")) if child(e, "References") is not None else [],
        "notes": notes(child(e, "Notes")) if child(e, "Notes") is not None else [],
        "content_history": content_history(child(e, "Content_History")),
        "unknown": [{"tag": local(c.tag), "attrs": dict(c.attrib), "text": blocks(c)}
                    for c in e if local(c.tag) not in VIEW_HANDLED],
    }
    return d


def external_references(e):
    out = {}
    for r in children(e, "External_Reference"):
        f = {}
        for c in r:
            n = local(c.tag)
            v = norm("".join(c.itertext()))
            if n == "Author":
                f.setdefault("authors", []).append(v)
            else:
                f[n] = v
        out[r.get("Reference_ID")] = f
    return out


def assign_keys(obj, path):
    """{"en": ...} を持つ要素すべてに、位置を表すキー "k" を付ける。"""
    if isinstance(obj, dict):
        if "en" in obj:
            obj["k"] = "/".join(path)
        for key, val in obj.items():
            if key in ("content_history", "unknown_raw"):
                continue
            assign_keys(val, path + [key])
    elif isinstance(obj, list):
        for i, val in enumerate(obj):
            assign_keys(val, path + [str(i)])


def segments(obj, out):
    if isinstance(obj, dict):
        if "en" in obj and "k" in obj:
            out[obj["k"]] = obj["en"]
        for v in obj.values():
            segments(v, out)
    elif isinstance(obj, list):
        for v in obj:
            segments(v, out)
    return out


def main():
    src, dst, retrieved = sys.argv[1], sys.argv[2], sys.argv[3]
    raw = open(src, "rb").read()
    # 外部実体参照(XXE)や実体の大量展開を防ぐため、DTD/実体宣言を含むXMLは読まない
    if b"<!DOCTYPE" in raw or b"<!ENTITY" in raw:
        sys.exit("DTDまたは実体宣言を含むため中止しました: " + src)
    root = ET.fromstring(raw)
    entries = []
    counts = {"attack_pattern": 0, "category": 0, "view": 0}
    for section in root:
        sname = local(section.tag)
        for e in section:
            n = local(e.tag)
            if n == "Attack_Pattern":
                entries.append(attack_pattern(e))
            elif n == "Category":
                entries.append(category(e))
            elif n == "View":
                entries.append(view(e))
            else:
                continue
            counts[entries[-1]["kind"]] += 1
    ext = {}
    for section in root:
        if local(section.tag) == "External_References":
            ext = external_references(section)
    unknown_report = []
    for d in entries:
        assign_keys(d, [])
        seg = segments(d, {})
        d["source_sha"] = hashlib.sha256(json.dumps(seg, ensure_ascii=False, sort_keys=True).encode()).hexdigest()[:16]
        for u in d.get("unknown", []):
            unknown_report.append(f"CAPEC-{d['id']}: {u['tag']}")
    data = {
        "meta": {
            "catalog_name": root.get("Name"), "version": root.get("Version"),
            "catalog_date": root.get("Date"), "retrieved": retrieved,
            "source_sha256": hashlib.sha256(raw).hexdigest(),
            "counts": counts,
            "top_level_sections": [local(s.tag) for s in root],
        },
        "external_references": ext,
        "entries": entries,
    }
    with open(dst, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=1)
    print(json.dumps(data["meta"], ensure_ascii=False, indent=1))
    print(f"未対応の要素: {len(unknown_report)} 件")
    for line in unknown_report[:50]:
        print("  " + line)


if __name__ == "__main__":
    main()
