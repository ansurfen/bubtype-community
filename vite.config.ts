import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
// @ts-expect-error type error without @types/node package
import process from "node:process";
// @ts-expect-error type error without @types/node package
import { fileURLToPath } from "node:url";

const host = process.env.TAURI_DEV_HOST;

function resolveEdition(mode: string) {
  const fromEnv = String(process.env.VITE_EDITION || "").toLowerCase();
  if (fromEnv === "community" || fromEnv === "pro") return fromEnv;
  if (mode === "community") return "community";
  // Default commercial ship build (what you distribute).
  return "pro";
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const edition = resolveEdition(mode);
  const impl =
    edition === "community"
      ? fileURLToPath(new URL("./src/edition-community", import.meta.url))
      : fileURLToPath(new URL("./src/edition-pro", import.meta.url));

  return {
    plugins: [react()],
    define: {
      "import.meta.env.VITE_EDITION": JSON.stringify(edition),
    },
    resolve: {
      alias: {
        "@edition-impl": impl,
      },
    },
    // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
    clearScreen: false,
    server: {
      port: 1420,
      strictPort: true,
      host: host || false,
      hmr: host
        ? {
            protocol: "ws",
            host,
            port: 1421,
          }
        : undefined,
      watch: {
        ignored: ["**/src-tauri/**", "**/.community-export/**"],
      },
    },
  };
});
