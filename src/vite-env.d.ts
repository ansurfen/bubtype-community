/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_EDITION: "community" | "pro";
  readonly VITE_PRO_CHECKOUT_URL?: string;
  readonly VITE_PADDLE_CHECKOUT_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
