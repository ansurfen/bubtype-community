import { invoke } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";
import { buildExcelBytes } from "./excel";
import type { ExcelOptions, ExportRow } from "./types";
import type { TFn } from "../i18n";

export async function saveExcelFile(
  title: string,
  rows: ExportRow[],
  opts: ExcelOptions,
  t: TFn,
) {
  const bytes = buildExcelBytes(title, rows, opts, t);
  const path = await save({
    defaultPath: `${sanitizeFileName(title)}.xlsx`,
    filters: [{ name: "Excel", extensions: ["xlsx"] }],
  });
  if (!path) return false;
  await invoke("write_bytes", { path, contents: Array.from(bytes) });
  return true;
}

export function sanitizeFileName(name: string) {
  const cleaned = name.replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_").trim();
  return cleaned || "export";
}
