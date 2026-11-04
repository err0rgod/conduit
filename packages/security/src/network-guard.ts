import { BlockList, isIP } from 'node:net';

/**
 * Host classification for the localhost / private-network guard.
 *
 * Hostnames are expected to come from `new URL(...).hostname`, which already
 * canonicalises numeric IPv4 forms (`2130706433`, `0x7f.1`, `017700000001`,
 * `127.1` all become `127.0.0.1`) and IPv6 text (`[0:0:0:0:0:0:0:1]` becomes
 * `[::1]`, `[::ffff:127.0.0.1]` becomes `[::ffff:7f00:1]`). Bracketed IPv6 and
 * trailing dots are handled here. Callers that pass raw input are canonicalised
 * through the same WHATWG parser so behavior does not depend on the caller.
 */
export type HostClass = 'localhost' | 'private' | 'public';

const LOOPBACK_V4 = new BlockList();
LOOPBACK_V4.addSubnet('127.0.0.0', 8, 'ipv4');
// 0.0.0.0/8 ("this network"): connecting to 0.0.0.0 reaches the local machine.
LOOPBACK_V4.addSubnet('0.0.0.0', 8, 'ipv4');

const PRIVATE_V4 = new BlockList();
for (const [network, prefix] of [
  ['10.0.0.0', 8],
  ['172.16.0.0', 12],
  ['192.168.0.0', 16],
  ['169.254.0.0', 16], // link-local, includes cloud metadata 169.254.169.254
  ['100.64.0.0', 10], // carrier-grade NAT / Tailscale-style shared space
  ['192.0.0.0', 24], // IETF protocol assignments
  ['198.18.0.0', 15], // benchmarking
  ['224.0.0.0', 3], // multicast, reserved, broadcast
] as const) {
  PRIVATE_V4.addSubnet(network, prefix, 'ipv4');
}

const PRIVATE_SUFFIXES = ['.local', '.internal', '.home.arpa', '.localdomain', '.lan', '.intranet'];

export function classifyHost(hostname: string): HostClass {
  const host = canonicalHost(hostname);
  if (host === '') return 'public';

  const family = isIP(host);
  if (family === 4) return classifyV4(host);
  if (family === 6) return classifyV6(host);

  if (host === 'localhost' || host.endsWith('.localhost')) return 'localhost';
  if (PRIVATE_SUFFIXES.some((suffix) => host.endsWith(suffix))) return 'private';
  // Single-label names (for example `router`) resolve through the local search
  // domain, so treat them as private-network targets.
  if (!host.includes('.')) return 'private';
  return 'public';
}

export function isLocalhostHost(hostname: string): boolean {
  return classifyHost(hostname) === 'localhost';
}

/** True for any loopback or private-network host (loopback is a superset here). */
export function isPrivateOrLocalHost(hostname: string): boolean {
  return classifyHost(hostname) !== 'public';
}

function canonicalHost(hostname: string): string {
  let host = hostname.trim().toLowerCase();
  if (host.startsWith('[') && host.endsWith(']')) host = host.slice(1, -1);
  host = host.replace(/\.+$/u, '');
  if (host === '' || isIP(host) !== 0) return host;
  // Raw input such as `2130706433` or `0x7f.1`: let the URL parser canonicalise.
  try {
    const parsed = new URL(`http://${host}`).hostname.toLowerCase();
    const unbracketed =
      parsed.startsWith('[') && parsed.endsWith(']') ? parsed.slice(1, -1) : parsed;
    return unbracketed.replace(/\.+$/u, '');
  } catch {
    return host;
  }
}

function classifyV4(address: string): HostClass {
  if (LOOPBACK_V4.check(address, 'ipv4')) return 'localhost';
  if (PRIVATE_V4.check(address, 'ipv4')) return 'private';
  return 'public';
}

function classifyV6(address: string): HostClass {
  const groups = expandIPv6(address);
  if (groups === null) return 'private'; // unparseable: fail closed
  const g = (index: number): number => groups[index] ?? 0;
  const zeroBefore = (end: number): boolean => groups.slice(0, end).every((group) => group === 0);

  if (zeroBefore(7) && (g(7) === 0 || g(7) === 1)) return 'localhost'; // :: and ::1
  const embedded = `${g(6) >> 8}.${g(6) & 0xff}.${g(7) >> 8}.${g(7) & 0xff}`;
  // IPv4-mapped ::ffff:a.b.c.d and deprecated IPv4-compatible ::a.b.c.d
  if (zeroBefore(5) && (g(5) === 0xffff || g(5) === 0)) return classifyV4(embedded);
  // NAT64 well-known prefix 64:ff9b::/96 maps to an IPv4 destination.
  if (g(0) === 0x64 && g(1) === 0xff9b && groups.slice(2, 6).every((group) => group === 0)) {
    return classifyV4(embedded);
  }
  // 6to4 2002:AABB:CCDD::/48 embeds the IPv4 address in groups 1 and 2.
  if (g(0) === 0x2002) {
    return classifyV4(`${g(1) >> 8}.${g(1) & 0xff}.${g(2) >> 8}.${g(2) & 0xff}`);
  }
  if ((g(0) & 0xfe00) === 0xfc00) return 'private'; // unique local fc00::/7
  if ((g(0) & 0xffc0) === 0xfe80) return 'private'; // link-local fe80::/10
  if ((g(0) & 0xff00) === 0xff00) return 'private'; // multicast ff00::/8
  return 'public';
}

function expandIPv6(address: string): number[] | null {
  let text = address.split('%')[0] ?? address;
  const dotted = /(\d+\.\d+\.\d+\.\d+)$/u.exec(text);
  if (dotted?.[1]) {
    const octets = dotted[1].split('.').map(Number);
    if (octets.some((octet) => octet > 255)) return null;
    const hi = ((octets[0] ?? 0) << 8) | (octets[1] ?? 0);
    const lo = ((octets[2] ?? 0) << 8) | (octets[3] ?? 0);
    text = `${text.slice(0, -dotted[1].length)}${hi.toString(16)}:${lo.toString(16)}`;
  }
  const halves = text.split('::');
  if (halves.length > 2) return null;
  const parse = (part: string): string[] => (part === '' ? [] : part.split(':'));
  const head = parse(halves[0] ?? '');
  const tail = halves.length === 2 ? parse(halves[1] ?? '') : [];
  const missing = 8 - head.length - tail.length;
  if (halves.length === 2 ? missing < 1 : missing !== 0) return null;
  const fill = Array<string>(halves.length === 2 ? missing : 0).fill('0');
  const groups = [...head, ...fill, ...tail].map((part) => Number.parseInt(part, 16));
  if (groups.length !== 8 || groups.some((group) => !Number.isInteger(group) || group > 0xffff)) {
    return null;
  }
  return groups;
}
