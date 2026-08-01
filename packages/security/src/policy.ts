import { BrowserRequestEnvelope, Permission, RiskLevel } from '@conduit/protocol';

export type DomainPolicyMode = 'allowlist' | 'blocklist' | 'ask';

export interface SecurityPolicyOptions {
  permissions?: Permission[];
  domainMode?: DomainPolicyMode;
  allowedDomains?: string[];
  blockedDomains?: string[];
  allowLocalhost?: boolean;
  allowPrivateNetworks?: boolean;
}

export type AuthorizationDecision =
  | { outcome: 'allow'; permission: Permission; risk: RiskLevel; domain?: string }
  | { outcome: 'deny'; permission: Permission; risk: RiskLevel; reason: string; domain?: string }
  | {
      outcome: 'confirm';
      permission: Permission;
      risk: RiskLevel;
      reason: string;
      domain?: string;
    };

type DomainDecision =
  | { outcome: 'allow'; domain?: string }
  | { outcome: 'deny'; reason: string; domain?: string }
  | { outcome: 'confirm'; reason: string; domain?: string };

const OPERATION_SECURITY: Record<
  BrowserRequestEnvelope['type'],
  { permission: Permission; risk: RiskLevel }
> = {
  'browser.list_tabs': { permission: 'browser.read', risk: 'low' },
  'browser.get_active_tab': { permission: 'browser.read', risk: 'low' },
  'browser.open_tab': { permission: 'browser.navigate', risk: 'medium' },
  'browser.close_tab': { permission: 'browser.interact', risk: 'medium' },
  'browser.focus_tab': { permission: 'browser.interact', risk: 'low' },
  'browser.navigate': { permission: 'browser.navigate', risk: 'medium' },
  'browser.go_back': { permission: 'browser.navigate', risk: 'low' },
  'browser.go_forward': { permission: 'browser.navigate', risk: 'low' },
  'browser.reload': { permission: 'browser.navigate', risk: 'low' },
  'browser.snapshot': { permission: 'browser.read', risk: 'low' },
  'browser.get_visible_text': { permission: 'browser.read', risk: 'low' },
  'browser.click': { permission: 'browser.interact', risk: 'medium' },
  'browser.type': { permission: 'browser.forms', risk: 'medium' },
  'browser.clear': { permission: 'browser.forms', risk: 'medium' },
  'browser.select': { permission: 'browser.forms', risk: 'medium' },
  'browser.hover': { permission: 'browser.interact', risk: 'low' },
  'browser.scroll': { permission: 'browser.read', risk: 'low' },
  'browser.press_key': { permission: 'browser.interact', risk: 'medium' },
  'browser.wait_for': { permission: 'browser.read', risk: 'low' },
  'browser.screenshot': { permission: 'browser.read', risk: 'low' },
  'browser.upload_file': { permission: 'browser.upload', risk: 'high' },
  'browser.get_downloads': { permission: 'browser.download', risk: 'medium' },
};

export class SecurityPolicy {
  private readonly permissions: Set<Permission>;
  private readonly domainMode: DomainPolicyMode;
  private readonly allowedDomains: string[];
  private readonly blockedDomains: string[];
  private readonly allowLocalhost: boolean;
  private readonly allowPrivateNetworks: boolean;

  public constructor(options: SecurityPolicyOptions = {}) {
    this.permissions = new Set(options.permissions ?? ['browser.read']);
    this.domainMode = options.domainMode ?? 'ask';
    this.allowedDomains = normalizePatterns(options.allowedDomains ?? []);
    this.blockedDomains = normalizePatterns(options.blockedDomains ?? []);
    this.allowLocalhost = options.allowLocalhost ?? false;
    this.allowPrivateNetworks = options.allowPrivateNetworks ?? false;
  }

  public authorize(request: BrowserRequestEnvelope, currentUrl?: string): AuthorizationDecision {
    const security = OPERATION_SECURITY[request.type];
    if (!this.permissions.has(security.permission)) {
      return {
        outcome: 'deny',
        ...security,
        reason: `Permission ${security.permission} is not granted.`,
      };
    }

    const url = requestUrl(request) ?? currentUrl;
    if (!url) {
      return security.risk === 'high'
        ? { outcome: 'confirm', ...security, reason: `${request.type} is a high-risk operation.` }
        : { outcome: 'allow', ...security };
    }
    const domainDecision = this.evaluateUrl(url);
    if (domainDecision.outcome === 'allow') {
      return security.risk === 'high'
        ? {
            outcome: 'confirm',
            ...security,
            domain: domainDecision.domain,
            reason: `${request.type} is a high-risk operation.`,
          }
        : { outcome: 'allow', ...security, domain: domainDecision.domain };
    }
    if (domainDecision.outcome === 'deny') {
      return { ...security, ...domainDecision };
    }
    return { ...security, ...domainDecision };
  }

  public evaluateUrl(url: string): DomainDecision {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return { outcome: 'deny', reason: 'The target URL is invalid.' };
    }
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      return {
        outcome: 'deny',
        domain: parsed.hostname || undefined,
        reason: `Protocol ${parsed.protocol} is not allowed.`,
      };
    }

    const domain = parsed.hostname.toLowerCase();
    if (isLocalhost(domain) && !this.allowLocalhost) {
      return { outcome: 'deny', domain, reason: 'Localhost access is disabled by policy.' };
    }
    if (isPrivateNetworkHost(domain) && !isLocalhost(domain) && !this.allowPrivateNetworks) {
      return { outcome: 'deny', domain, reason: 'Private-network access is disabled by policy.' };
    }
    if (matchesAnyDomain(domain, this.blockedDomains)) {
      return { outcome: 'deny', domain, reason: `Domain ${domain} is blocked.` };
    }
    if (matchesAnyDomain(domain, this.allowedDomains)) return { outcome: 'allow', domain };
    if (this.domainMode === 'allowlist') {
      return { outcome: 'deny', domain, reason: `Domain ${domain} is not on the allowlist.` };
    }
    if (this.domainMode === 'ask') {
      return { outcome: 'confirm', domain, reason: `Domain ${domain} requires approval.` };
    }
    return { outcome: 'allow', domain };
  }
}

export function requiredPermissionFor(request: BrowserRequestEnvelope): Permission {
  return OPERATION_SECURITY[request.type].permission;
}

export function matchesDomain(hostname: string, pattern: string): boolean {
  const host = hostname.toLowerCase().replace(/\.$/u, '');
  const normalized = pattern.toLowerCase().trim().replace(/\.$/u, '');
  if (normalized.startsWith('*.')) {
    const suffix = normalized.slice(2);
    return host.length > suffix.length && host.endsWith(`.${suffix}`);
  }
  return host === normalized;
}

export function isPrivateNetworkHost(hostname: string): boolean {
  const parts = hostname.split('.').map(Number);
  if (
    parts.length !== 4 ||
    parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)
  ) {
    return hostname.endsWith('.local');
  }
  return (
    parts[0] === 10 ||
    parts[0] === 127 ||
    (parts[0] === 169 && parts[1] === 254) ||
    (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
    (parts[0] === 192 && parts[1] === 168)
  );
}

function requestUrl(request: BrowserRequestEnvelope): string | undefined {
  return request.type === 'browser.navigate' || request.type === 'browser.open_tab'
    ? request.payload.url
    : undefined;
}
function normalizePatterns(patterns: string[]): string[] {
  return patterns.map((pattern) => pattern.trim().toLowerCase()).filter(Boolean);
}
function matchesAnyDomain(hostname: string, patterns: string[]): boolean {
  return patterns.some((pattern) => matchesDomain(hostname, pattern));
}
function isLocalhost(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';
}
