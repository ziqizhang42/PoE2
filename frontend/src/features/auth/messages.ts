import {
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  PasswordSchema,
  USERNAME_MAX_LENGTH,
  USERNAME_MIN_LENGTH,
  UsernameSchema,
} from "@poe2/protocol";

import type { AuthRequestError } from "../../auth/errors.ts";

export type AuthMode = "login" | "register";

export const USERNAME_RULE = `${USERNAME_MIN_LENGTH}–${USERNAME_MAX_LENGTH} characters: letters, numbers, and underscores.`;
export const PASSWORD_RULE = `${PASSWORD_MIN_LENGTH}–${PASSWORD_MAX_LENGTH} characters. A short phrase beats a short password.`;

export function validateUsername(username: string): string | null {
  return UsernameSchema.safeParse(username).success ? null : USERNAME_RULE;
}

export function validatePassword(password: string): string | null {
  return PasswordSchema.safeParse(password).success ? null : PASSWORD_RULE;
}

function retryHint(seconds: number | null): string {
  return seconds === null ? "" : ` Try again in ${seconds} seconds.`;
}

/** Wording is selected only from schema-validated codes and messages. */
export function describeAuthError(error: AuthRequestError, mode: AuthMode): string {
  if (error.kind !== "http") {
    return error.message;
  }

  switch (error.code) {
    case "invalid_credentials":
      return "That username and password do not match an account.";
    case "username_taken":
      return "That username is taken. Choose another one.";
    case "rate_limited":
      return `Too many attempts.${retryHint(error.retryAfterSeconds)}`;
    case "temporarily_unavailable":
      return `The server is busy and refused the request.${retryHint(error.retryAfterSeconds)}`;
    case "unauthenticated":
      return "That session has ended. Sign in again.";
    case "internal_error":
      return mode === "register"
        ? "The account could not be created. Try again."
        : "Sign in failed on the server. Try again.";
    default:
      return error.message;
  }
}
