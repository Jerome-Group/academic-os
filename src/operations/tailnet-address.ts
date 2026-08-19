import { networkInterfaces, type NetworkInterfaceInfo } from "node:os";

import { OperationalError } from "../operational-error.js";

// Tailscale gives every machine on the tailnet one address in the 100.64.0.0/10 range, and that
// address is what its MagicDNS name resolves to. Binding the server to it — rather than to every
// interface — is the whole of the server's access control: a request that arrives has already
// crossed the tailnet, which is the Owner's own devices and nothing else.
const TAILNET_FIRST_OCTET = 100;
const TAILNET_SECOND_OCTET_RANGE = [64, 127] as const;

export function resolveTailnetAddress(
  interfaces: NodeJS.Dict<NetworkInterfaceInfo[]> = networkInterfaces(),
): string {
  const addresses = Object.values(interfaces)
    .flatMap((entries) => entries ?? [])
    .filter((entry) => entry.family === "IPv4" && !entry.internal)
    .map(({ address }) => address)
    .filter(isTailnetAddress)
    .sort();
  const address = addresses[0];
  if (address === undefined) {
    throw new OperationalError(
      "missing-target",
      "This machine has no tailnet address; sign in to Tailscale before starting the Operations server.",
    );
  }
  return address;
}

function isTailnetAddress(address: string): boolean {
  const octets = address.split(".").map(Number);
  const [first, second] = octets;
  return (
    octets.length === 4 &&
    octets.every((octet) => Number.isInteger(octet)) &&
    first === TAILNET_FIRST_OCTET &&
    second !== undefined &&
    second >= TAILNET_SECOND_OCTET_RANGE[0] &&
    second <= TAILNET_SECOND_OCTET_RANGE[1]
  );
}
