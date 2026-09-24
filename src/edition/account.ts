/** Account / identity — Pro has users; Community has none. */

export type AccountSession =
  | { kind: "none" }
  | { kind: "guest" }
  | { kind: "signed_in"; email: string };

export type AuthPurpose = "register" | "login" | "reset_password";

export type AuthResult = {
  ok: boolean;
  message: string;
};
