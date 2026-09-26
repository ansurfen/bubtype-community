/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_EDITION: "community" | "pro";
  readonly VITE_PRO_CHECKOUT_URL?: string;
  /** Lifetime fulfillment Worker (activate / validate). */
  readonly VITE_FULFILLMENT_URL?: string;
  readonly VITE_PADDLE_CHECKOUT_URL?: string;
  readonly VITE_PADDLE_ENV?: string;
  readonly VITE_PADDLE_PRICE_ID?: string;
  readonly VITE_PADDLE_PRODUCT_ID?: string;
  readonly VITE_PADDLE_CLIENT_TOKEN?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
