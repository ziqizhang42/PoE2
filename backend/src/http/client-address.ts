/** Collapses IPv6 addresses to /64 so one host cannot generate unlimited keys. */

import type { FastifyRequest } from "fastify";

const IPV6_GROUPS = 8;
const PREFIX_GROUPS = 4;

export function clientAddressKey(request: FastifyRequest): string {
  // Fastify's synthetic requests can omit the otherwise-required address.
  const address: unknown = request.ip;

  return typeof address === "string" ? addressKey(address) : "unknown";
}

export function addressKey(address: string): string {
  const trimmed = address.trim().toLowerCase();

  if (trimmed.length === 0) {
    return "unknown";
  }

  // IPv4 and IPv4-mapped IPv6 identify a host, not an IPv6 prefix.
  if (!trimmed.includes(":") || trimmed.includes(".")) {
    return trimmed;
  }

  const groups = expand(trimmed);

  return groups === null ? trimmed : `${groups.slice(0, PREFIX_GROUPS).join(":")}::/64`;
}

function expand(address: string): readonly string[] | null {
  const [withoutZone = ""] = address.split("%");
  const halves = withoutZone.split("::");

  if (halves.length > 2) {
    return null;
  }

  const head = groupsOf(halves[0]);
  const tail = halves.length === 2 ? groupsOf(halves[1]) : [];

  if (halves.length === 1) {
    return head.length === IPV6_GROUPS ? head : null;
  }

  const elided = IPV6_GROUPS - head.length - tail.length;
  if (elided < 0) {
    return null;
  }

  return [...head, ...Array.from({ length: elided }, () => "0"), ...tail];
}

function groupsOf(half: string | undefined): readonly string[] {
  return (half ?? "")
    .split(":")
    .filter((group) => group.length > 0)
    .map((group) => group.replace(/^0+(?=.)/u, ""));
}
