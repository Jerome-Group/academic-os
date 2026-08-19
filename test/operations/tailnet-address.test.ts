import assert from "node:assert/strict";
import type { NetworkInterfaceInfo } from "node:os";
import { describe, it } from "node:test";

import { resolveTailnetAddresses } from "../../src/operations/index.js";

function ipv4(address: string, internal = false): NetworkInterfaceInfo {
  return {
    address,
    netmask: "255.255.255.255",
    family: "IPv4",
    mac: "00:00:00:00:00:00",
    internal,
    cidr: `${address}/32`,
  };
}

function ipv6(address: string): NetworkInterfaceInfo {
  return {
    address,
    netmask: "ffff:ffff:ffff:ffff::",
    family: "IPv6",
    mac: "00:00:00:00:00:00",
    internal: false,
    cidr: `${address}/64`,
    scopeid: 0,
  };
}

describe("the addresses the Operations server binds", () => {
  it("are the machine's tailnet addresses, never the ones the house network gave it", () => {
    assert.deepEqual(
      resolveTailnetAddresses({
        lo0: [ipv4("127.0.0.1", true)],
        en0: [ipv4("192.168.1.14"), ipv6("fe80::1")],
        utun4: [ipv4("100.101.102.103"), ipv6("fd7a:115c:a1e0::4f01:2")],
      }),
      ["100.101.102.103", "fd7a:115c:a1e0::4f01:2"],
    );
  });

  it("refuse to start a server a machine off the tailnet would expose", () => {
    assert.throws(
      () =>
        resolveTailnetAddresses({
          lo0: [ipv4("127.0.0.1", true)],
          en0: [ipv4("192.168.1.14"), ipv6("fdff:115c:a1e0::1")],
          vpn0: [ipv4("100.200.0.1")],
        }),
      /no tailnet address/u,
    );
  });

  it("come back in the same order every start", () => {
    assert.deepEqual(
      resolveTailnetAddresses({
        utun4: [ipv4("100.120.0.9")],
        utun5: [ipv4("100.101.102.103")],
      }),
      ["100.101.102.103", "100.120.0.9"],
    );
  });
});
