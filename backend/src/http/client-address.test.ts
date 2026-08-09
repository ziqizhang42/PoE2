import { describe, expect, it } from "vitest";

import { addressKey } from "./client-address.js";

describe("addressKey", () => {
  it("uses an IPv4 address as it stands", () => {
    expect(addressKey("203.0.113.7")).toBe("203.0.113.7");
  });

  it("keeps different IPv4 addresses apart", () => {
    expect(addressKey("203.0.113.7")).not.toBe(addressKey("203.0.113.8"));
  });

  it("collapses an IPv6 address to its /64 prefix", () => {
    expect(addressKey("2001:db8:85a3:1::1")).toBe("2001:db8:85a3:1::/64");
  });

  it("puts a whole /64 in one bucket, which is the point", () => {
    const first = addressKey("2001:db8:85a3:1:0:0:0:1");
    const second = addressKey("2001:db8:85a3:1:ffff:ffff:ffff:ffff");

    expect(first).toBe(second);
  });

  it("keeps separate /64s in separate buckets", () => {
    expect(addressKey("2001:db8:85a3:1::1")).not.toBe(addressKey("2001:db8:85a3:2::1"));
  });

  it("reads an address in full form the same as its compressed form", () => {
    expect(addressKey("2001:0db8:0000:0000:0000:0000:0000:0001")).toBe(addressKey("2001:db8::1"));
  });

  it("normalises case", () => {
    expect(addressKey("2001:DB8:85A3:1::1")).toBe(addressKey("2001:db8:85a3:1::1"));
  });

  it("treats an IPv4-mapped address as the single host it is", () => {
    expect(addressKey("::ffff:203.0.113.7")).toBe("::ffff:203.0.113.7");
    expect(addressKey("::ffff:203.0.113.7")).not.toBe(addressKey("::ffff:203.0.113.8"));
  });

  it("ignores a zone index, which describes our interface and not the peer", () => {
    expect(addressKey("fe80::1%eth0")).toBe(addressKey("fe80::1"));
  });

  it("handles the loopback and unspecified addresses", () => {
    expect(addressKey("::1")).toBe("0:0:0:0::/64");
    expect(addressKey("::")).toBe("0:0:0:0::/64");
  });

  it("uses an unreadable address whole rather than guessing at it", () => {
    expect(addressKey("2001:db8::1::2")).toBe("2001:db8::1::2");
    expect(addressKey("2001:db8:1:2:3:4:5:6:7:8")).toBe("2001:db8:1:2:3:4:5:6:7:8");
  });

  it("gives an empty address one shared bucket rather than no bucket", () => {
    expect(addressKey("")).toBe("unknown");
    expect(addressKey("   ")).toBe("unknown");
  });
});
