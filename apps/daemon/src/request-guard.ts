import * as net from 'node:net';

/**
 * DNS-rebinding and cross-origin defenses for the daemon listener.
 *
 * A malicious web page can make a victim's browser send requests to
 * `http://attacker.example:9222` after re-pointing that name at 127.0.0.1. The
 * browser then treats the daemon as same-origin with the attacker page. Browsers
 * cannot forge the `Host` header, so rejecting unexpected hosts defeats the attack.
 */

export interface RequestGuardOptions {
  /** True when the listener is served over TLS (default port 443 instead of 80). */
  readonly secure: boolean;
  /** Address the daemon binds to; it is accepted as a Host when it is not a wildcard. */
  readonly bindAddress: string;
  /** Remote mode is the only mode in which non-loopback Host values are considered. */
  readonly remoteEnabled: boolean;
  /** Extra DNS names (for example a Tailscale MagicDNS name) accepted in remote mode. */
  readonly allowedHosts: readonly string[];
}

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1']);
const WILDCARD_BINDS = new Set(['0.0.0.0', '::', '']);

interface ParsedHost {
  readonly hostname: string;
  readonly port: number | undefined;
}

/** Parses a Host header value. Returns undefined for anything malformed. */
export function parseHostHeader(value: string | undefined): ParsedHost | undefined {
  if (!value || value.length > 261 || /[\s/@\\?#]/u.test(value)) return undefined;
  let hostname: string;
  let portText: string | undefined;
  if (value.startsWith('[')) {
    const end = value.indexOf(']');
    if (end < 0) return undefined;
    hostname = value.slice(1, end);
    const rest = value.slice(end + 1);
    if (rest !== '') {
      if (!rest.startsWith(':')) return undefined;
      portText = rest.slice(1);
    }
    if (!net.isIPv6(hostname)) return undefined;
  } else {
    const separator = value.lastIndexOf(':');
    if (separator >= 0) {
      hostname = value.slice(0, separator);
      portText = value.slice(separator + 1);
    } else {
      hostname = value;
    }
    if (hostname.includes(':')) return undefined;
  }
  let port: number | undefined;
  if (portText !== undefined) {
    if (!/^\d{1,5}$/u.test(portText)) return undefined;
    port = Number(portText);
    if (port < 1 || port > 65_535) return undefined;
  }
  hostname = hostname.toLowerCase().replace(/\.$/u, '');
  return hostname ? { hostname, port } : undefined;
}

/** Decides whether a Host header is acceptable for this listener. */
export function isAllowedHost(
  hostHeader: string | undefined,
  localPort: number | undefined,
  options: RequestGuardOptions,
): boolean {
  const parsed = parseHostHeader(hostHeader);
  if (!parsed) return false;
  const effectivePort = parsed.port ?? (options.secure ? 443 : 80);
  if (localPort !== undefined && effectivePort !== localPort) return false;
  if (LOOPBACK_HOSTS.has(parsed.hostname)) return true;
  if (!options.remoteEnabled) return false;
  // Literal IP addresses cannot be re-pointed by DNS, so they are safe in remote mode.
  if (net.isIP(parsed.hostname) !== 0) return true;
  const bind = options.bindAddress.toLowerCase();
  if (!WILDCARD_BINDS.has(bind) && parsed.hostname === bind) return true;
  return options.allowedHosts.some((allowed) => allowed.toLowerCase() === parsed.hostname);
}

/**
 * Legitimate WebSocket clients are the browser extension (chrome-extension:// or
 * moz-extension:// origin) and non-browser clients (no Origin header). Any web origin
 * means a page is trying to reach the daemon and is refused.
 */
export function isAllowedWebSocketOrigin(origin: string | undefined): boolean {
  if (origin === undefined) return true;
  return /^(?:chrome-extension|moz-extension):\/\/[a-z0-9-]{8,64}$/iu.test(origin);
}
