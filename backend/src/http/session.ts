/** Reads cookies outside the scoped cookie plugin and delegates authentication. */

import { fastifyCookie } from "@fastify/cookie";
import type { AuthUser } from "@poe2/protocol";
import type { FastifyRequest } from "fastify";

import type { AuthService } from "../auth/service.js";

export interface SessionReaderOptions {
  readonly sessionCookieName: string;
  readonly authService: AuthService;
}

export function readSessionCookie(request: FastifyRequest, cookieName: string): string | null {
  const header = request.headers.cookie;

  if (header === undefined) {
    return null;
  }

  const token = fastifyCookie.parse(header)[cookieName];

  return token === undefined || token.length === 0 ? null : token;
}

export async function readSessionUser(
  request: FastifyRequest,
  options: SessionReaderOptions,
): Promise<AuthUser | null> {
  const token = readSessionCookie(request, options.sessionCookieName);

  if (token === null) {
    return null;
  }

  return options.authService.authenticateSession(token);
}
