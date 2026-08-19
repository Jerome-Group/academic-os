import assert from "node:assert/strict";
import type { NetworkInterfaceInfo } from "node:os";
import { describe, it } from "node:test";

import { resolveTailnetAddress } from "../../src/operations/index.js";

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

describe("the address the Operations server binds", () => {
  it("is the machine's tailnet address, never the one the house network gave it", () => {
    assert.equal(
      resolveTailnetAddress({
        lo0: [ipv4("127.0.0.1", true)],
        en0: [ipv4("192.168.1.14")],
        utun4: [ipv4("100.101.102.103")],
      }),
      "100.101.102.103",
    );
  });

  it("refuses to start a server a machine off the tailnet would expose", () => {
    assert.throws(
      () =>
        resolveTailnetAddress({
          lo0: [ipv4("127.0.0.1", true)],
          en0: [ipv4("192.168.1.14")],
          vpn0: [ipv4("100.200.0.1")],
        }),
      /no tailnet address/u,
    );
  });

  it("picks the same address every start when a machine has several", () => {
    const interfaces = {
      utun4: [ipv4("100.120.0.9")],
      utun5: [ipv4("100.101.102.103")],
    };

    assert.equal(resolveTailnetAddress(interfaces), "100.101.102.103");
  });
});
