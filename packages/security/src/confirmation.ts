import { randomUUID } from 'node:crypto';
import { ConfirmationRequest, RiskLevel } from '@conduit/protocol';

interface ConfirmationState {
  request: ConfirmationRequest;
  approved: boolean;
  consumed: boolean;
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
    this.confirmations.set(request.id, { request, approved: false, consumed: false });
    return request;
  }

  public list(): ConfirmationRequest[] {
    this.prune();
    return Array.from(this.confirmations.values())
      .filter((state) => !state.consumed)
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

  public consume(id: string, operation: string): boolean {
    this.prune();
    const state = this.confirmations.get(id);
    if (!state || !state.approved || state.consumed || state.request.operation !== operation) {
      return false;
    }
    state.consumed = true;
    return true;
  }

  private prune(): void {
    const now = Date.now();
    for (const [id, state] of this.confirmations) {
      if (state.request.expiresAt <= now || state.consumed) this.confirmations.delete(id);
    }
  }
}
