import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import { ConfirmationRequest, RiskLevel } from '@conduit/protocol';

export interface RequestFingerprintInput {
  type: string;
  /** The full validated action payload exactly as the policy evaluated it. */
  payload: unknown;
  /** Tab the action will run against after resolving the default active tab. */
  tabId?: number | undefined;
  /** Page URL (or, for navigation, nothing) that the policy evaluated against. */
  currentUrl?: string | undefined;
}

export type ConfirmationConsumeResult = 'consumed' | 'mismatch' | 'invalid';

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((item) => canonicalize(item));
  if (typeof value === 'object' && value !== null) {
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) {
      const entry = (value as Record<string, unknown>)[key];
      if (entry !== undefined) sorted[key] = canonicalize(entry);
    }
    return sorted;
  }
  return value;
}

/**
 * SHA-256 over a deterministic, key-sorted serialization of the request. The
 * envelope ID and timestamp are excluded so an exact retry produces the same
 * fingerprint, while any change to type, target tab, page, or payload does not.
 */
export function fingerprintRequest(input: RequestFingerprintInput): string {
  const canonical = canonicalize({
    type: input.type,
    payload: input.payload,
    tabId: input.tabId ?? null,
    currentUrl: input.currentUrl ?? null,
  });
  return createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
}

interface ConfirmationState {
  request: ConfirmationRequest;
  fingerprint: string;
  approved: boolean;
  consumed: boolean;
}

function timingSafeEqualHex(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

export class ConfirmationManager {
  private readonly ttlMs: number;
  private readonly confirmations = new Map<string, ConfirmationState>();

  public constructor(ttlMs = 60_000) {
    this.ttlMs = ttlMs;
  }

  public create(
    requestId: string,
    operation: string,
    risk: RiskLevel,
    summary: string,
    fingerprint: string,
    domain?: string,
  ): ConfirmationRequest {
    this.prune();
    const request: ConfirmationRequest = {
      id: randomUUID(),
      requestId,
      operation,
      risk,
      summary,
      ...(domain ? { domain } : {}),
      expiresAt: Date.now() + this.ttlMs,
    };
    this.confirmations.set(request.id, { request, fingerprint, approved: false, consumed: false });
    return request;
  }

  public list(): ConfirmationRequest[] {
    this.prune();
    return Array.from(this.confirmations.values())
      .filter((state) => !state.approved && !state.consumed)
      .map((state) => state.request);
  }

  public respond(id: string, approved: boolean): boolean {
    this.prune();
    const state = this.confirmations.get(id);
    if (!state || state.consumed) return false;
    state.approved = approved;
    if (!approved) state.consumed = true;
    return true;
  }

  /**
   * Spends an approval only when it was granted for this exact request. A
   * mismatch leaves the approval intact so the legitimate retry still works.
   */
  public consume(id: string, fingerprint: string): ConfirmationConsumeResult {
    this.prune();
    const state = this.confirmations.get(id);
    if (!state || !state.approved || state.consumed) return 'invalid';
    if (!timingSafeEqualHex(state.fingerprint, fingerprint)) return 'mismatch';
    state.consumed = true;
    return 'consumed';
  }

  private prune(): void {
    const now = Date.now();
    for (const [id, state] of this.confirmations) {
      if (state.request.expiresAt <= now || state.consumed) this.confirmations.delete(id);
    }
  }
}
