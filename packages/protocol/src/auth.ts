import { z } from "zod";

export const USERNAME_MIN_LENGTH = 3;
export const USERNAME_MAX_LENGTH = 32;
export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 128;

/** Locale-independent fold for the protocol's ASCII-only usernames. */
export function normalizeUsername(username: string): string {
  return username.replace(/[A-Z]/gu, (letter) => letter.toLowerCase());
}

export type AuthErrorCode =
  | "internal_error"
  | "invalid_credentials"
  | "rate_limited"
  | "temporarily_unavailable"
  | "unauthenticated"
  | "username_taken";

export interface AuthUser {
  readonly id: string;
  readonly username: string;
}

export interface RegisterRequest {
  readonly username: string;
  readonly password: string;
}

export interface LoginRequest {
  readonly username: string;
  readonly password: string;
}

export interface AuthSessionResponse {
  readonly user: AuthUser;
}

export interface AuthErrorResponse {
  readonly code: AuthErrorCode;
  readonly message: string;
}

export const UsernameSchema: z.ZodType<string> = z
  .string()
  .min(USERNAME_MIN_LENGTH)
  .max(USERNAME_MAX_LENGTH)
  .regex(/^[A-Za-z0-9_]+$/, "Username may contain only letters, numbers, and underscores");

export const PasswordSchema: z.ZodType<string> = z
  .string()
  .min(PASSWORD_MIN_LENGTH)
  .max(PASSWORD_MAX_LENGTH);

export const RegisterRequestSchema: z.ZodType<RegisterRequest> = z.strictObject({
  username: UsernameSchema,
  password: PasswordSchema,
});

export const LoginRequestSchema: z.ZodType<LoginRequest> = z.strictObject({
  username: UsernameSchema,
  password: PasswordSchema,
});

export const AuthUserSchema: z.ZodType<AuthUser> = z.strictObject({
  id: z.uuid(),
  username: UsernameSchema,
});

export const AuthSessionResponseSchema: z.ZodType<AuthSessionResponse> = z.strictObject({
  user: AuthUserSchema,
});

export const AuthErrorResponseSchema: z.ZodType<AuthErrorResponse> = z.strictObject({
  code: z.enum([
    "internal_error",
    "invalid_credentials",
    "rate_limited",
    "temporarily_unavailable",
    "unauthenticated",
    "username_taken",
  ]),
  message: z.string().min(1),
});
