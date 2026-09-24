import * as XLSX from "xlsx";
import type { Entry } from "../glossary/types";
import type { WordbookPack } from "../wordbook/types";
import {
  HEADER_ALIASES,
  type ImportKind,
  type ImportPreview,
  type ImportRow,
  type TEMPLATE_HEADERS,
} from "./types";

type Canon = (typeof TEMPLATE_HEADERS)[number];

function slugify(raw: string): string {
  const s = raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return s || "diy";
}

function diyId(title: string): string {
  return `diy-${slugify(title)}-${Date.now().toString(36).slice(-4)}`;
}

function normHeader(raw: string): Canon | null {
  const key = raw.trim().toLowerCase().replace(/\s+/g, "_");
  return HEADER_ALIASES[key] ?? HEADER_ALIASES[raw.trim()] ?? null;
}

function cellStr(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return String(value).trim();
}

function mapTableRows(matrix: unknown[][]): { rows: ImportRow[]; warnings: string[] } {
  const warnings: string[] = [];
  if (!matrix.length) return { rows: [], warnings: ["表格为空"] };

  let headerIdx = 0;
  for (let i = 0; i < Math.min(matrix.length, 5); i++) {
    const mapped = (matrix[i] ?? []).map((c) => normHeader(cellStr(c)));
    if (mapped.includes("word")) {
      headerIdx = i;
      break;
    }
  }

  const headerCells = matrix[headerIdx] ?? [];
  const colMap: Partial<Record<Canon, number>> = {};
  headerCells.forEach((cell, i) => {
    const canon = normHeader(cellStr(cell));
    if (canon && colMap[canon] == null) colMap[canon] = i;
  });

  if (colMap.word == null) {
    return { rows: [], warnings: ["找不到「单词」列。请用模板，或把第一列写成 word"] };
  }

  const rows: ImportRow[] = [];
  for (let r = headerIdx + 1; r < matrix.length; r++) {
    const line = matrix[r] ?? [];
    const word = cellStr(line[colMap.word!]);
    if (!word) continue;
    const exampleRaw = colMap.example != null ? cellStr(line[colMap.example]) : "";
    let example = exampleRaw;
    let exampleTr = colMap.example_tr != null ? cellStr(line[colMap.example_tr]) : "";
    if (!exampleTr && example.includes("\n")) {
      const parts = example.split(/\n+/).map((s) => s.trim()).filter(Boolean);
      example = parts[0] ?? "";
      exampleTr = parts[1] ?? "";
    }
    rows.push({
      word,
      phonetic: colMap.phonetic != null ? cellStr(line[colMap.phonetic]) : "",
      gloss: colMap.gloss != null ? cellStr(line[colMap.gloss]) : "",
      example,
      exampleTr,
    });
  }

  if (!rows.length) warnings.push("表格里没有填单词或句子");
  return { rows, warnings };
}

function titleFromFileName(fileName: string): string {
  return fileName.replace(/\.[^.]+$/, "").trim() || "我的词书";
}

export function parseTableBuffer(
  bytes: ArrayBuffer,
  fileName: string,
): ImportPreview {
  const book = XLSX.read(bytes, { type: "array", codepage: 65001 });
  const sheetName =
    book.SheetNames.find((n) => /词表|words|sheet1/i.test(n)) ?? book.SheetNames[0];
  if (!sheetName) {
    return {
      kind: "table",
      fileName,
      title: titleFromFileName(fileName),
      lang: "en",
      glossLang: "",
      rows: [],
      warnings: ["工作簿里没有表格"],
    };
  }
  const sheet = book.Sheets[sheetName];
  const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    defval: "",
    raw: false,
  }) as unknown[][];
  const { rows, warnings } = mapTableRows(matrix);
  return {
    kind: "table",
    fileName,
    title: titleFromFileName(fileName),
    lang: "en",
    glossLang: "",
    rows,
    warnings,
  };
}

export function parseCsvText(text: string, fileName: string): ImportPreview {
  const book = XLSX.read(text, { type: "string" });
  const sheet = book.Sheets[book.SheetNames[0]];
  const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    defval: "",
    raw: false,
  }) as unknown[][];
  const { rows, warnings } = mapTableRows(matrix);
  return {
    kind: "table",
    fileName,
    title: titleFromFileName(fileName),
    lang: "en",
    glossLang: "",
    rows,
    warnings,
  };
}

export function parseQueueText(text: string, fileName: string): ImportPreview {
  const warnings: string[] = [];
  let title = titleFromFileName(fileName);
  let lang = "en";
  const rows: ImportRow[] = [];

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const meta = line.match(/^(title|lang|mode)\s*:\s*(.+)$/i);
    if (meta) {
      const key = meta[1].toLowerCase();
      const val = meta[2].trim();
      if (key === "title") title = val;
      if (key === "lang") lang = val;
      continue;
    }
    const pipe = line.indexOf("|");
    if (pipe >= 0) {
      const word = line.slice(0, pipe).trim();
      const gloss = line.slice(pipe + 1).trim();
      if (word) rows.push({ word, phonetic: "", gloss, example: "", exampleTr: "" });
    } else {
      rows.push({ word: line, phonetic: "", gloss: "", example: "", exampleTr: "" });
    }
  }

  if (!rows.length) warnings.push("文本里没有可读的句子（每行一句，或「原文 | 译文」）");
  return {
    kind: "queue",
    fileName,
    title,
    lang,
    glossLang: "",
    rows,
    warnings,
  };
}

export function parsePackJson(text: string, fileName: string): ImportPreview {
  const warnings: string[] = [];
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch (err) {
    return {
      kind: "pack",
      fileName,
      title: titleFromFileName(fileName),
      lang: "en",
      glossLang: "",
      rows: [],
      warnings: [`JSON 解析失败: ${String(err)}`],
    };
  }

  const pack = data as WordbookPack;
  if (!pack?.manifest || (!pack.lemmas?.length && !pack.items?.length)) {
    warnings.push("这个 JSON 不像 BubType 词书（需要单词列表）");
  }

  const rows: ImportRow[] = [];
  if (pack.items?.length) {
    for (const item of pack.items) {
      const word = item.text?.trim();
      if (!word) continue;
      rows.push({
        word,
        phonetic: "",
        gloss: item.hint?.trim() || "",
        example: "",
        exampleTr: "",
      });
    }
  } else if (pack.lemmas?.length) {
    const byLemma = new Map((pack.entries ?? []).map((e) => [e.lemma.toLowerCase(), e]));
    for (const lemma of pack.lemmas) {
      const word = lemma.trim();
      if (!word) continue;
      const entry = byLemma.get(word.toLowerCase());
      const gloss = entry?.senses?.[0]?.gloss?.trim() || "";
      const ex = entry?.examples?.[0];
      rows.push({
        word,
        phonetic: entry?.ipa?.trim() || "",
        gloss,
        example: ex?.src?.trim() || "",
        exampleTr: ex?.tr?.trim() || "",
      });
    }
  }

  return {
    kind: "pack",
    fileName,
    title: pack.manifest?.title?.trim() || titleFromFileName(fileName),
    lang: pack.manifest?.lang || "en",
    glossLang: pack.manifest?.glossLang || "",
    rows,
    packJson: data,
    warnings,
  };
}

export function detectAndParse(fileName: string, bytes: Uint8Array): ImportPreview {
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".json")) {
    return parsePackJson(new TextDecoder("utf-8").decode(bytes), fileName);
  }
  if (lower.endsWith(".txt")) {
    return parseQueueText(new TextDecoder("utf-8").decode(bytes), fileName);
  }
  if (lower.endsWith(".csv")) {
    // Strip BOM
    let text = new TextDecoder("utf-8").decode(bytes);
    if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
    return parseCsvText(text, fileName);
  }
  if (lower.endsWith(".xlsx") || lower.endsWith(".xls")) {
    const copy = bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength,
    ) as ArrayBuffer;
    return parseTableBuffer(copy, fileName);
  }
  return {
    kind: "table",
    fileName,
    title: titleFromFileName(fileName),
    lang: "en",
    glossLang: "",
    rows: [],
    warnings: ["还不支持这种文件。请用 Excel / CSV，或一行一句的文本，或 BubType 的 JSON"],
  };
}

export function previewToPack(preview: ImportPreview, titleOverride?: string): WordbookPack {
  const title = (titleOverride ?? preview.title).trim() || "我的词书";

  if (preview.kind === "pack" && preview.packJson) {
    const pack = structuredClone(preview.packJson) as WordbookPack;
    pack.manifest = {
      ...pack.manifest,
      id: pack.manifest?.id?.startsWith("diy-")
        ? pack.manifest.id
        : diyId(title),
      title,
      version: pack.manifest?.version || "1.0.0",
      lang: pack.manifest?.lang || preview.lang || "en",
      glossLang: pack.manifest?.glossLang || preview.glossLang || "",
      source: "diy",
      lemmaCount: pack.lemmas?.length || pack.items?.length || preview.rows.length,
    };
    return pack;
  }

  if (preview.kind === "queue") {
    return {
      manifest: {
        id: diyId(title),
        title,
        version: "1.0.0",
        lang: preview.lang || "en",
        glossLang: preview.glossLang || "",
        source: "diy",
        lemmaCount: preview.rows.length,
        description: "Imported sentences",
      },
      lemmas: [],
      items: preview.rows.map((r) => ({
        text: r.word,
        hint: r.gloss || null,
        kind: "sentence",
      })),
      entries: [],
      phrases: [],
    };
  }

  const lemmas: string[] = [];
  const entries: Entry[] = [];
  const seen = new Set<string>();

  for (const row of preview.rows) {
    const key = row.word.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    lemmas.push(row.word);

    const senses = row.gloss
      ? [{ pos: "", gloss: row.gloss }]
      : [];
    const examples =
      row.example
        ? [{ src: row.example, tr: row.exampleTr || undefined }]
        : undefined;

    if (row.phonetic || senses.length || examples) {
      entries.push({
        lemma: row.word,
        ipa: row.phonetic || undefined,
        senses,
        examples,
        glossLang: preview.glossLang || undefined,
        lang: preview.lang || "en",
      });
    }
  }

  return {
    manifest: {
      id: diyId(title),
      title,
      version: "1.0.0",
      lang: preview.lang || "en",
      glossLang: preview.glossLang || "",
      source: "diy",
      lemmaCount: lemmas.length,
      description: "Imported table",
    },
    lemmas,
    items: [],
    entries,
    phrases: [],
  };
}

export function kindLabel(kind: ImportKind): string {
  switch (kind) {
    case "table":
      return "table";
    case "pack":
      return "pack";
    case "queue":
      return "queue";
  }
}
