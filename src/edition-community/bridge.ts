import type {
  ActivateResult,
  Entitlement,
  ParticleSkinId,
  SkinInk,
  SkinListItem,
  SkinProfile,
} from "../edition/contract";
import type { AccountSession, AuthPurpose, AuthResult } from "../edition/account";

/** Community build: Classic only — nothing else ships in the bundle. */
export const PROFILES: Partial<Record<ParticleSkinId, SkinProfile>> = {
  classic: {
    mode: "draw",
    colors: ["#d9f99d", "#a3e635", "#fde047", "#f9a8d4", "#93c5fd", "#ffffff"],
    count: [12, 20],
    speed: [1.2, 4.2],
    gravity: 0.12,
    drag: 0.99,
    kinds: ["dot", "cross"],
    size: [1, 2],
    upwardBias: 1.1,
  },
};

export const PARTICLE_SKINS: SkinListItem[] = [
  { id: "classic", label: "Classic", premium: false },
];

export const SKIN_INK: Partial<Record<ParticleSkinId, SkinInk>> = {};

/** Community: no Effects nav — Basic key sound only, no visual skin shop. */
export const showSkinsNav = false;
export const showAccountPage = false;

export function isParticleSkinId(raw: string): raw is ParticleSkinId {
  return PARTICLE_SKINS.some((s) => s.id === raw);
}

export function isSkinAllowed(id: ParticleSkinId): boolean {
  return id === "classic";
}

export function getEntitlement(): Entitlement {
  return {
    edition: "community",
    tier: "community",
    licensed: false,
    licenseKey: null,
  };
}

export function subscribeEntitlement(_cb: () => void): () => void {
  return () => {};
}

export async function activateLicense(
  _key: string,
  _email?: string,
): Promise<ActivateResult> {
  return { ok: false, message: "Community build has no license unlock." };
}

export function clearLicense(): void {}

export function paddleCheckoutUrl(): string {
  return "";
}

export function proCheckoutUrl(): string {
  return "";
}

export function getAccountSession(): AccountSession {
  return { kind: "none" };
}

export function subscribeAccount(_cb: () => void): () => void {
  return () => {};
}

export function isValidEmail(_value: string) {
  return false;
}

export function passwordOk(_value: string) {
  return false;
}

export async function sendVerificationCode(
  _email: string,
  _purpose: AuthPurpose,
): Promise<AuthResult> {
  return { ok: false, message: "no_auth" };
}

export async function loginWithPassword(
  _email: string,
  _password: string,
): Promise<AuthResult> {
  return { ok: false, message: "no_auth" };
}

export async function registerWithCode(
  _email: string,
  _code: string,
  _password: string,
): Promise<AuthResult> {
  return { ok: false, message: "no_auth" };
}

export function signOut(): void {}

export function signOutLocal(): void {}

export function signInLocal(_displayName: string): void {}

export const DEV_VERIFY_CODE = "";
