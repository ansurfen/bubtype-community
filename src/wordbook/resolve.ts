import type { WordbookCatalog, WordbookPack, WordbookSource } from "./types";

/**
 * Resolve policy (frontend mirror of Rust):
 * - mock: samples/wordbooks (dev) — Rust reads via CARGO_MANIFEST_DIR
 * - release: GitHub Release asset URL (not wired yet)
 * - diy: local file path chosen by user
 *
 * Install/cache always happens in Rust under app_data_dir/wordbooks/.
 */
export type ResolveTarget =
  | { kind: "catalog" }
  | { kind: "asset"; asset: string }
  | { kind: "path"; path: string };

export function sourceLabel(source: WordbookSource | string | undefined): string {
  if (source === "diy") return "DIY";
  if (source === "release") return "Release";
  return "Mock";
}

export function isInstalled(
  id: string,
  installedIds: Iterable<string>,
): boolean {
  const set = installedIds instanceof Set ? installedIds : new Set(installedIds);
  return set.has(id);
}

export type { WordbookCatalog, WordbookPack, WordbookSource };
