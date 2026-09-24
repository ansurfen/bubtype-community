#!/usr/bin/env python3
"""Export Oxford 3000/5000 as unified BubType Packs (practice lemmas + glossary entries/phrases).

Usage:
  python tools/export-oxford-pack.py
  python tools/export-oxford-pack.py --lists 3000 --gloss zh,en,ja

Reads Oxford JSON + VocReel lexicon SQLite, writes samples/wordbooks/*.json and updates catalog.
"""

from __future__ import annotations

import argparse
import json
import re
import sqlite3
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT_DIR = ROOT / "samples" / "wordbooks"
DEFAULT_OXFORD_DIR = Path(r"C:\Users\LENOVO\Documents\New project\output")
CMS_DB = Path(r"D:\voya\cms\data\cms.db")
DB = {
    "zh": Path(r"D:\voya\backend\vocreel.db"),
    "en": Path(r"D:\voya\backend\vocreel-en.db"),
    "ja": Path(r"D:\voya\backend\vocreel-ja.db"),
}

POS_DUP = re.compile(
    r"^(interj|abbr|modal|prep|conj|pron|adj|adv|art|aux|det|num|int|vt|vi|pl|n|v|a)\.\s*",
    re.I,
)


def parse_senses(wire: str, fallback_pos: str = "") -> list[dict]:
    text = (wire or "").replace("\r\n", "\n").strip()
    if not text:
        return []
    senses: list[dict] = []
    # ECDICT wire: "n.\tgloss\nadj.\tgloss" or plain definition lines
    for raw_line in text.split("\n"):
        line = raw_line.strip()
        if not line:
            continue
        pos = ""
        gloss = line
        if "\t" in line:
            left, right = line.split("\t", 1)
            pos = left.strip().rstrip(".")
            gloss = right.strip()
        else:
            m = POS_DUP.match(line)
            if m:
                pos = m.group(1).lower()
                gloss = line[m.end() :].strip()
        gloss = POS_DUP.sub("", gloss).strip()
        if not gloss:
            continue
        if not pos:
            pos = (fallback_pos or "").strip().rstrip(".")
        # split multi gloss "a; b; c" into one sense line (keep together for UI)
        senses.append({"pos": pos, "gloss": gloss})
    return senses


def norm_lemma(raw: str) -> str:
    return raw.strip().lower()


def load_oxford_lemmas(path: Path, list_kind: str) -> list[str]:
    data = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(data, list):
        raise SystemExit(f"expected list in {path}")
    out: list[str] = []
    seen: set[str] = set()
    for row in data:
        word = (row.get("word") or "").strip()
        if not word:
            continue
        key = norm_lemma(word)
        if key in seen:
            continue
        if list_kind == "3000":
            if row.get("in_oxford3000") is False:
                continue
        else:
            if row.get("in_oxford5000") is False:
                continue
        seen.add(key)
        out.append(word)
    return out


def table_exists(db: sqlite3.Connection, name: str) -> bool:
    row = db.execute(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name=? LIMIT 1", (name,)
    ).fetchone()
    return row is not None


def fetch_entries(db: sqlite3.Connection, lemmas: list[str], gloss: str) -> dict[str, dict]:
    """Map lower(headword) -> raw row bits."""
    out: dict[str, dict] = {}
    if not table_exists(db, "dictionary_entries"):
        return out
    chunk = 400
    for i in range(0, len(lemmas), chunk):
        part = [norm_lemma(x) for x in lemmas[i : i + chunk]]
        placeholders = ",".join("?" * len(part))
        q = f"""
          SELECT LOWER(headword), headword, phonetic, definition, translation, part_of_speech
          FROM dictionary_entries
          WHERE LOWER(headword) IN ({placeholders})
        """
        for row in db.execute(q, part):
            key, headword, phonetic, definition, translation, pos = row
            out[key] = {
                "headword": headword,
                "phonetic": phonetic or "",
                "definition": definition or "",
                "translation": translation or "",
                "pos": pos or "",
            }
    return out


def fetch_phrases(db: sqlite3.Connection, lemmas: list[str]) -> list[dict]:
    if not table_exists(db, "word_book_phrases"):
        return []
    keys = [norm_lemma(x) for x in lemmas]
    keyset = set(keys)
    phrases: list[dict] = []
    seen: set[str] = set()
    chunk = 400
    for i in range(0, len(keys), chunk):
        part = keys[i : i + chunk]
        placeholders = ",".join("?" * len(part))
        q = f"""
          SELECT headword, phrase, translation
          FROM word_book_phrases
          WHERE LOWER(headword) IN ({placeholders})
        """
        for headword, phrase, translation in db.execute(q, part):
            text = (phrase or "").strip()
            if not text:
                continue
            nk = norm_lemma(text)
            if nk in seen:
                continue
            seen.add(nk)
            senses = parse_senses(translation or "")
            if not senses and translation:
                senses = [{"pos": "", "gloss": translation.strip()}]
            lemmas_for = [norm_lemma(headword)] if headword else []
            # also attach if phrase words intersect pack (already filtered by headword)
            phrases.append(
                {
                    "text": text,
                    "senses": senses,
                    "lemmas": lemmas_for,
                }
            )
    # keep only phrases whose headword is in pack
    return [p for p in phrases if any(l in keyset for l in p.get("lemmas") or [])]


def fetch_synonyms(db: sqlite3.Connection, lemmas: list[str]) -> dict[str, list[str]]:
    """WordNet-ish synonyms; skip tiny lemmas and long scientific noise."""
    if not table_exists(db, "word_relations"):
        return {}
    out: dict[str, list[str]] = {}
    chunk = 400
    for i in range(0, len(lemmas), chunk):
        part = [norm_lemma(x) for x in lemmas[i : i + chunk]]
        part = [p for p in part if len(p) >= 3]
        if not part:
            continue
        placeholders = ",".join("?" * len(part))
        q = f"""
          SELECT LOWER(source_headword), target_headword
          FROM word_relations
          WHERE relation_type='synonym' AND LOWER(source_headword) IN ({placeholders})
        """
        for src, tgt in db.execute(q, part):
            t = (tgt or "").strip()
            if not t or " " in t or len(t) > 24:
                continue
            out.setdefault(src, [])
            if t not in out[src] and len(out[src]) < 6:
                out[src].append(t)
    return out


def word_in_sentence(lemma: str, sentence: str) -> bool:
    if not lemma or not sentence:
        return False
    return re.search(rf"(?i)\b{re.escape(lemma)}\b", sentence) is not None


def fetch_examples(
    cms_db: Path,
    lemmas: list[str],
    gloss: str,
    per: int = 3,
) -> dict[str, list[dict]]:
    """CMS word_featured_sentences → content_sentences (+ translation)."""
    if not cms_db.exists():
        return {}
    locale = {"zh": "zh-CN", "ja": "ja-JP", "en": None}.get(gloss)
    db = sqlite3.connect(str(cms_db))
    out: dict[str, list[dict]] = {}
    try:
        tables = {
            r[0]
            for r in db.execute("SELECT name FROM sqlite_master WHERE type='table'")
        }
        if "word_featured_sentences" not in tables or "content_sentences" not in tables:
            return {}
        chunk = 300
        for i in range(0, len(lemmas), chunk):
            part = [norm_lemma(x) for x in lemmas[i : i + chunk]]
            placeholders = ",".join("?" * len(part))
            if locale and "content_sentence_translations" in tables:
                q = f"""
                  SELECT LOWER(wf.headword), cs.text, tr.text, wf.rank
                  FROM word_featured_sentences wf
                  JOIN content_sentences cs ON cs.id = wf.sentence_id
                  LEFT JOIN content_sentence_translations tr
                    ON tr.sentence_id = cs.id AND tr.known_locale = ?
                  WHERE LOWER(wf.headword) IN ({placeholders})
                  ORDER BY wf.rank ASC
                """
                rows = db.execute(q, [locale, *part]).fetchall()
            else:
                q = f"""
                  SELECT LOWER(wf.headword), cs.text, NULL, wf.rank
                  FROM word_featured_sentences wf
                  JOIN content_sentences cs ON cs.id = wf.sentence_id
                  WHERE LOWER(wf.headword) IN ({placeholders})
                  ORDER BY wf.rank ASC
                """
                rows = db.execute(q, part).fetchall()
            for key, en, zh, _rank in rows:
                if not en or not word_in_sentence(key, en):
                    continue
                bucket = out.setdefault(key, [])
                if any(x["src"] == en for x in bucket):
                    continue
                item: dict = {"src": en.strip()}
                if zh and str(zh).strip():
                    item["tr"] = str(zh).strip()
                # Prefer translated examples: insert ahead of untranslated until full.
                if item.get("tr"):
                    bucket.insert(0, item)
                else:
                    bucket.append(item)
                # trim after insert
                if len(bucket) > per:
                    # keep translated first
                    bucket.sort(key=lambda x: 0 if x.get("tr") else 1)
                    del bucket[per:]
                out[key] = bucket
    finally:
        db.close()
    return out


def fetch_etymology(db: sqlite3.Connection, lemmas: list[str]) -> dict[str, str]:
    if not table_exists(db, "word_etymologies"):
        return {}
    out: dict[str, str] = {}
    chunk = 400
    for i in range(0, len(lemmas), chunk):
        part = [norm_lemma(x) for x in lemmas[i : i + chunk]]
        placeholders = ",".join("?" * len(part))
        q = f"""
          SELECT LOWER(headword), etymology, root
          FROM word_etymologies
          WHERE LOWER(headword) IN ({placeholders})
        """
        for key, ety, root in db.execute(q, part):
            parts = []
            if ety and str(ety).strip():
                parts.append(str(ety).strip())
            if root and str(root).strip():
                parts.append(f"root: {str(root).strip()}")
            if parts:
                out[key] = " ".join(parts)
    return out


def build_pack(
    list_kind: str,
    gloss: str,
    lemmas: list[str],
    entry_db: Path,
    enrich_db: Path | None,
) -> dict:
    title = f"Oxford {list_kind}"
    pack_id = f"oxford-{list_kind}-{gloss}"
    db = sqlite3.connect(str(entry_db))
    try:
        raw = fetch_entries(db, lemmas, gloss)
        phrases = fetch_phrases(db, lemmas)
        ety = fetch_etymology(db, lemmas)
        syn: dict[str, list[str]] = {}
        if table_exists(db, "word_relations"):
            syn = fetch_synonyms(db, lemmas)
    finally:
        db.close()

    # Synonyms / etymology may live on another lexicon DB; phrases stay on the gloss DB
    # so en/ja packs don't inherit Chinese phrase glosses.
    if enrich_db and enrich_db.exists() and enrich_db != entry_db:
        edb = sqlite3.connect(str(enrich_db))
        try:
            if not syn:
                syn = fetch_synonyms(edb, lemmas)
            if not ety:
                ety = fetch_etymology(edb, lemmas)
        finally:
            edb.close()

    examples = fetch_examples(CMS_DB, lemmas, gloss, per=3)

    entries: list[dict] = []
    missing = 0
    for word in lemmas:
        key = norm_lemma(word)
        row = raw.get(key)
        if not row:
            missing += 1
            entries.append({"lemma": key, "display": word, "senses": []})
            continue
        if gloss == "en":
            senses = parse_senses(row["definition"] or row["translation"], row["pos"])
        else:
            senses = parse_senses(row["translation"] or row["definition"], row["pos"])
        if not senses and (row["definition"] or row["translation"]):
            senses = parse_senses(row["definition"] or row["translation"], row["pos"])
        entry: dict = {
            "lemma": key,
            "display": row["headword"] or word,
            "senses": senses,
        }
        ipa = (row["phonetic"] or "").strip()
        if ipa:
            if not ipa.startswith("/"):
                ipa = f"/{ipa.strip('/')}/"
            entry["ipa"] = ipa
        if examples.get(key):
            entry["examples"] = examples[key]
        if syn.get(key):
            entry["synonyms"] = syn[key]
        if ety.get(key):
            entry["etymology"] = ety[key]
        entries.append(entry)

    desc = {
        "zh": "牛津核心词表 · 中文释义",
        "en": "Oxford core list · English definitions",
        "ja": "Oxford コア語彙 · 日本語訳",
    }.get(gloss, "")

    with_ex = sum(1 for e in entries if e.get("examples"))
    return {
        "manifest": {
            "id": pack_id,
            "title": title,
            "version": "1.1.0",
            "lang": "en",
            "glossLang": gloss,
            "lemmaCount": len(lemmas),
            "description": desc,
        },
        "lemmas": [norm_lemma(w) for w in lemmas],
        "entries": entries,
        "phrases": phrases,
        "_meta": {
            "missingEntries": missing,
            "phraseCount": len(phrases),
            "exampleLemmas": with_ex,
        },
    }


def update_catalog(out_dir: Path, packs: list[dict]) -> None:
    catalog_path = out_dir / "catalog.json"
    existing = {"version": 1, "source": "mock", "books": []}
    if catalog_path.exists():
        existing = json.loads(catalog_path.read_text(encoding="utf-8"))
    # drop previous oxford-* entries, keep scene packs
    books = [
        b
        for b in existing.get("books", [])
        if not str(b.get("id", "")).startswith("oxford-")
    ]
    for pack in packs:
        m = pack["manifest"]
        books.append(
            {
                "id": m["id"],
                "title": m["title"],
                "version": m["version"],
                "lang": m["lang"],
                "glossLang": m["glossLang"],
                "lemmaCount": m["lemmaCount"],
                "description": m.get("description") or "",
                "asset": f"{m['id']}-v{m['version'].split('.')[0]}.json",
            }
        )
    existing["books"] = books
    catalog_path.write_text(
        json.dumps(existing, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--oxford-dir", type=Path, default=DEFAULT_OXFORD_DIR)
    ap.add_argument("--lists", default="3000,5000", help="3000,5000")
    ap.add_argument("--gloss", default="zh,en,ja", help="zh,en,ja")
    ap.add_argument("--out", type=Path, default=OUT_DIR)
    args = ap.parse_args()
    args.out.mkdir(parents=True, exist_ok=True)

    lists = [x.strip() for x in args.lists.split(",") if x.strip()]
    glosses = [x.strip() for x in args.gloss.split(",") if x.strip()]
    exported: list[dict] = []

    for kind in lists:
        src = args.oxford_dir / f"oxford{kind}.json"
        if not src.exists():
            raise SystemExit(f"missing {src}")
        lemmas = load_oxford_lemmas(src, kind)
        print(f"Oxford {kind}: {len(lemmas)} lemmas", flush=True)
        for gloss in glosses:
            entry_db = DB.get(gloss)
            if not entry_db or not entry_db.exists():
                print(f"  skip {gloss}: no db", flush=True)
                continue
            enrich = DB["zh"] if gloss != "zh" else DB["en"]
            print(f"  building {kind}-{gloss} …", flush=True)
            pack = build_pack(kind, gloss, lemmas, entry_db, enrich)
            meta = pack.pop("_meta", {})
            asset = f"{pack['manifest']['id']}-v1.json"
            path = args.out / asset
            path.write_text(
                json.dumps(pack, ensure_ascii=False, separators=(",", ":")),
                encoding="utf-8",
            )
            size_mb = path.stat().st_size / (1024 * 1024)
            print(
                f"  wrote {asset} ({size_mb:.1f} MB) missing={meta.get('missingEntries')} phrases={meta.get('phraseCount')} examples={meta.get('exampleLemmas')}",
                flush=True,
            )
            exported.append(pack)

    update_catalog(args.out, exported)
    print(f"catalog updated ({len(exported)} oxford packs)", flush=True)


if __name__ == "__main__":
    main()
