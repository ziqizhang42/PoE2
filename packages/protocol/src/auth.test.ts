import { describe, expect, it } from "vitest";

import {
  AuthErrorResponseSchema,
  AuthSessionResponseSchema,
  LoginRequestSchema,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  PasswordSchema,
  RegisterRequestSchema,
  USERNAME_MAX_LENGTH,
  UsernameSchema,
} from "./auth.js";

describe("UsernameSchema", () => {
  it.each(["abc", "Alice_2", "a".repeat(USERNAME_MAX_LENGTH)])("accepts %s", (username) => {
    expect(UsernameSchema.safeParse(username).success).toBe(true);
  });

  it.each(["ab", "a".repeat(USERNAME_MAX_LENGTH + 1), "has space", "has-hyphen", "éclair"])(
    "rejects %s",
    (username) => {
      expect(UsernameSchema.safeParse(username).success).toBe(false);
    },
  );

  it("preserves username casing", () => {
    expect(UsernameSchema.parse("Alice_2")).toBe("Alice_2");
  });
});

describe("PasswordSchema", () => {
  it("accepts passwords at both length limits", () => {
    expect(PasswordSchema.safeParse("a".repeat(PASSWORD_MIN_LENGTH)).success).toBe(true);
    expect(PasswordSchema.safeParse("a".repeat(PASSWORD_MAX_LENGTH)).success).toBe(true);
  });

  it("rejects passwords outside the length limits", () => {
    expect(PasswordSchema.safeParse("a".repeat(PASSWORD_MIN_LENGTH - 1)).success).toBe(false);
    expect(PasswordSchema.safeParse("a".repeat(PASSWORD_MAX_LENGTH + 1)).success).toBe(false);
  });

  it("does not trim passwords", () => {
    const password = "  password phrase  ";
    expect(PasswordSchema.parse(password)).toBe(password);
  });
});

describe("authentication request schemas", () => {
  const credentials = {
    username: "Player_One",
    password: "correct horse battery staple",
  };

  it("accepts registration and login credentials", () => {
    expect(RegisterRequestSchema.parse(credentials)).toEqual(credentials);
    expect(LoginRequestSchema.parse(credentials)).toEqual(credentials);
  });

  it("rejects extra properties", () => {
    expect(RegisterRequestSchema.safeParse({ ...credentials, admin: true }).success).toBe(false);
    expect(LoginRequestSchema.safeParse({ ...credentials, rememberMe: true }).success).toBe(false);
  });
});

describe("authentication response schemas", () => {
  it("accepts a session response", () => {
    expect(
      AuthSessionResponseSchema.safeParse({
        user: {
          id: "e4aa457e-7620-4f14-ae26-6c20f3995ee1",
          username: "Player_One",
        },
      }).success,
    ).toBe(true);
  });

  it("rejects an invalid user ID", () => {
    expect(
      AuthSessionResponseSchema.safeParse({
        user: { id: "not-a-uuid", username: "Player_One" },
      }).success,
    ).toBe(false);
  });

  it.each([
    "internal_error",
    "invalid_credentials",
    "rate_limited",
    "temporarily_unavailable",
    "unauthenticated",
    "username_taken",
  ])("accepts the %s error code", (code) => {
    expect(
      AuthErrorResponseSchema.safeParse({ code, message: "Authentication failed" }).success,
    ).toBe(true);
  });
});
