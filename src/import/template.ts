import * as XLSX from "xlsx";
import { invoke } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";
import { TEMPLATE_HEADERS } from "./types";

const SAMPLE_ROWS: string[][] = [
  ["hello", "/həˈləʊ/", "你好；问候", "Hello, everyone!", "大家好！"],
  ["coffee", "/ˈkɒfi/", "咖啡", "Can I have a coffee?", "我能来杯咖啡吗？"],
  ["morning", "/ˈmɔːnɪŋ/", "早晨；上午", "Good morning.", "早上好。"],
];

const README_LINES = [
  ["BubType 词书模板说明"],
  [""],
  ["三步"],
  ["1. 在「词表」里按样例填写（第一行列名不要改）。"],
  ["2. 保存文件。"],
  ["3. 回到 App → 发现 → 导入 → 选择这个文件。"],
  [""],
  ["各列含义"],
  ["word", "单词或句子（必填）"],
  ["phonetic", "音标（可空）"],
  ["gloss", "释义 / 译文（可空）"],
  ["example", "例句原文（可空）"],
  ["example_tr", "例句译文（可空）"],
  [""],
  ["其他文件"],
  ["CSV", "和 Excel 同一套列，用记事本也能改"],
  ["TXT", "一行一句；也可以写成：原文 | 译文"],
  ["JSON", "别人用 BubType 分享的词书文件"],
];

export function buildTemplateWorkbook(): ArrayBuffer {
  const book = XLSX.utils.book_new();
  const sheet = XLSX.utils.aoa_to_sheet([
    [...TEMPLATE_HEADERS],
    ...SAMPLE_ROWS,
  ]);
  sheet["!cols"] = [
    { wch: 16 },
    { wch: 14 },
    { wch: 24 },
    { wch: 32 },
    { wch: 24 },
  ];
  XLSX.utils.book_append_sheet(book, sheet, "词表");
  const readme = XLSX.utils.aoa_to_sheet(README_LINES);
  readme["!cols"] = [{ wch: 14 }, { wch: 42 }];
  XLSX.utils.book_append_sheet(book, readme, "说明");
  return XLSX.write(book, { bookType: "xlsx", type: "array" }) as ArrayBuffer;
}

export function buildTemplateCsv(): string {
  const lines = [
    TEMPLATE_HEADERS.join(","),
    ...SAMPLE_ROWS.map((row) =>
      row.map((cell) => csvEscape(cell)).join(","),
    ),
  ];
  return `\uFEFF${lines.join("\n")}`;
}

function csvEscape(value: string): string {
  if (/[",\n\r]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

export async function downloadTemplate(kind: "xlsx" | "csv"): Promise<boolean> {
  if (kind === "xlsx") {
    const buf = buildTemplateWorkbook();
    const path = await save({
      defaultPath: "bubtype-wordbook-template.xlsx",
      filters: [{ name: "Excel", extensions: ["xlsx"] }],
    });
    if (!path) return false;
    await invoke("write_bytes", { path, contents: Array.from(new Uint8Array(buf)) });
    return true;
  }
  const csv = buildTemplateCsv();
  const path = await save({
    defaultPath: "bubtype-wordbook-template.csv",
    filters: [{ name: "CSV", extensions: ["csv"] }],
  });
  if (!path) return false;
  const bytes = new TextEncoder().encode(csv);
  await invoke("write_bytes", { path, contents: Array.from(bytes) });
  return true;
}
