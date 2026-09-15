import { User } from "./types";

/**
 * MOCK AUTH SERVICE — development only.
 *
 * No network call, no password storage, no real session. This exists so
 * the Sign Up / Log In screens can be fully built and QA'd against every
 * required state before a real backend exists. Replace the bodies of
 * these two functions with real API calls later; screens should not need
 * to change.
 *
 * QA triggers (magic emails) let every server-driven state be previewed
 * without a backend:
 *   exists@renko.dev      → sign up: "email already registered"
 *   ratelimited@renko.dev → rate limited
 *   offline@renko.dev     → network failure
 *   notfound@renko.dev    → log in: invalid credentials
 *   any other valid email → succeeds
 */

export type AuthErrorCode =
  | "email-exists"
  | "invalid-credentials"
  | "rate-limited"
  | "network-failure"
  | "server-error";

export interface AuthResult {
  ok: boolean;
  user?: User;
  errorCode?: AuthErrorCode;
  message?: string;
}

const LATENCY_MS = 700;

function delay<T>(value: T, ms = LATENCY_MS): Promise<T> {
  return new Promise((resolve) => setTimeout(() => resolve(value), ms));
}

export const mockAuthService = {
  async signUp(email: string, _password: string): Promise<AuthResult> {
    void _password; // not used by the mock — kept for API-contract parity with the real signUp call
    const normalized = email.trim().toLowerCase();

    if (normalized === "exists@renko.dev") {
      return delay({
        ok: false,
        errorCode: "email-exists",
        message: "This email is already registered. Log in instead.",
      });
    }
    if (normalized === "ratelimited@renko.dev") {
      return delay({
        ok: false,
        errorCode: "rate-limited",
        message: "Too many attempts. Wait a few minutes and try again.",
      });
    }
    if (normalized === "offline@renko.dev") {
      return delay({
        ok: false,
        errorCode: "network-failure",
        message: "We couldn't reach RENKO. Check your connection and try again.",
      });
    }

    return delay({ ok: true, user: { id: "user_mock_1", email: normalized } });
  },

  async logIn(email: string, password: string): Promise<AuthResult> {
    const normalized = email.trim().toLowerCase();

    if (normalized === "notfound@renko.dev" || password === "wrongpassword") {
      return delay({
        ok: false,
        errorCode: "invalid-credentials",
        message: "Those credentials don't match our records.",
      });
    }
    if (normalized === "ratelimited@renko.dev") {
      return delay({
        ok: false,
        errorCode: "rate-limited",
        message: "Too many attempts. Wait a few minutes and try again.",
      });
    }
    if (normalized === "offline@renko.dev") {
      return delay({
        ok: false,
        errorCode: "network-failure",
        message: "We couldn't reach RENKO. Check your connection and try again.",
      });
    }

    return delay({ ok: true, user: { id: "user_mock_1", email: normalized } });
  },
};
