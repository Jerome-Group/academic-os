import { networkInterfaces, type NetworkInterfaceInfo } from "node:os";

import { OperationalError } from "../operational-error.js";

// Tailscale gives every machine on the Tailnet an address in 100.64.0.0/10 and one in
// fd7a:115c:a1e0::/48, and its MagicDNS name resolves to both. Binding those — rather than every
// interface — is the whole of the server's access control: a request that arrives has already
// crossed the Tailnet, which is the Owner's own devices and nothing else.
const TAILNET_IPV4_FIRST_OCTET = 100;
const TAILNET_IPV4_SECOND_OCTET = [64, 127] as const;
const TAILNET_IPV6_PREFIX = /^fd7a:115c:a1e0:/iu;

export function resolveTailnetAddresses(
  interfaces: NodeJS.Dict<NetworkInterfaceInfo[]> = networkInterfaces(),
): string[] {
  const addresses = Object.values(interfaces)
    .flatMap((entries) => entries ?? [])
    .filter((entry) => !entry.internal)
    .filter(isTailnetAddress)
    .map(({ address }) => address)
    .sort();
  if (addresses.length === 0) {
    throw new OperationalError(
      "missing-target",
      "This machine has no tailnet address; sign in to Tailscale before starting the Operations server.",
    );
  }
  return addresses;
}

function isTailnetAddress(entry: NetworkInterfaceInfo): boolean {
  return entry.family === "IPv4"
    ? isTailnetIpv4(entry.address)
    : TAILNET_IPV6_PREFIX.test(entry.address);
}

function isTailnetIpv4(address: string): boolean {
  const octets = address.split(".").map(Number);
  const [first, second] = octets;
  return (
    octets.length === 4 &&
    octets.every((octet) => Number.isInteger(octet)) &&
    first === TAILNET_IPV4_FIRST_OCTET &&
    second !== undefined &&
    second >= TAILNET_IPV4_SECOND_OCTET[0] &&
    second <= TAILNET_IPV4_SECOND_OCTET[1]
  );
}
