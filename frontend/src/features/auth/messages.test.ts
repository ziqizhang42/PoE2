import { describe, expect, it } from "vitest";

import { httpError, networkError, protocolError } from "../../auth/errors.ts";
import { describeAuthError, validatePassword, validateUsername } from "./messages.ts";

function http(
  code: Parameters<typeof httpError>[0]["code"],
  retryAfterSeconds: number | null = null,
) {
  return httpError({ status: 400, code, message: "server wording", retryAfterSeconds });
}

describe("credential validation", () => {
  it("applies the shared username rule", () => {
    expect(validateUsername("Player_One")).toBeNull();
    expect(validateUsername("ab")).not.toBeNull();
    expect(validateUsername("has spaces")).not.toBeNull();
  });

  it("applies the shared password rule", () => {
    expect(validatePassword("correct horse battery staple")).toBeNull();
    expect(validatePassword("short")).not.toBeNull();
  });
});

describe("describeAuthError", () => {
  it("passes network and protocol failures through unchanged", () => {
    expect(describeAuthError(networkError(), "login")).toContain("could not be reached");
    expect(describeAuthError(protocolError(500), "login")).toContain("unexpected response");
  });

  it("never reveals whether an account exists", () => {
    expect(describeAuthError(http("invalid_credentials"), "login")).toBe(
      "That username and password do not match an account.",
    );
  });

  it("carries the retry hint when the server sent one", () => {
    expect(describeAuthError(http("rate_limited", 60), "login")).toContain("60 seconds");
    expect(describeAuthError(http("rate_limited"), "login")).not.toContain("undefined");
  });

  it("says something different for registering and signing in", () => {
    expect(describeAuthError(http("internal_error"), "register")).toContain("account could not");
    expect(describeAuthError(http("internal_error"), "login")).toContain("Sign in failed");
    expect(describeAuthError(http("username_taken"), "register")).toContain("taken");
  });
});
