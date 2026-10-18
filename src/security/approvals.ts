import { createHmac, timingSafeEqual } from 'node:crypto';
import { ApprovalVerificationError } from '../domain/errors';
import type { Approval, ConsequentialActionType } from '../domain/schemas';

export function canonicalizeObject(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalizeObject(item)).join(',')}]`;
  }
  const record = value as Record<string, unknown>;
  const sortedKeys = Object.keys(record).sort();
  const entries = sortedKeys
    .filter((k) => record[k] !== undefined)
    .map((k) => `${JSON.stringify(k)}:${canonicalizeObject(record[k])}`);
  return `{${entries.join(',')}}`;
}

export function computeApprovalMac(params: {
  secret: string;
  orgId: string;
  actorUid: string;
  action: ConsequentialActionType;
  canonicalPayload: Record<string, unknown>;
}): string {
  const { secret, orgId, actorUid, action, canonicalPayload } = params;
  if (!secret || secret.length < 16) {
    throw new Error('LOW_APPROVAL_SECRET must be set and at least 16 characters long');
  }
  const message = canonicalizeObject({
    orgId,
    actor: actorUid,
    action,
    payload: canonicalPayload,
  });
  return createHmac('sha256', secret).update(message, 'utf8').digest('hex');
}

export function verifyApprovalForExecution(params: {
  secret: string;
  storedApproval: Approval;
  orgId: string;
  actorUid: string;
  expectedAction: ConsequentialActionType;
  providedMac: string;
  actualRequestPayload: Record<string, unknown>;
  now?: Date;
}): void {
  const {
    secret,
    storedApproval,
    orgId,
    actorUid,
    expectedAction,
    providedMac,
    actualRequestPayload,
    now = new Date(),
  } = params;

  if (storedApproval.used) {
    throw new ApprovalVerificationError('Approval has already been used (replay rejected)');
  }

  const expiresAtMs = Date.parse(storedApproval.expiresAt);
  if (Number.isNaN(expiresAtMs) || expiresAtMs <= now.getTime()) {
    throw new ApprovalVerificationError('Approval has expired');
  }

  if (storedApproval.actor !== actorUid) {
    throw new ApprovalVerificationError('Approval actor does not match caller');
  }

  if (storedApproval.action !== expectedAction) {
    throw new ApprovalVerificationError('Approval action does not match requested action');
  }

  const expectedMac = computeApprovalMac({
    secret,
    orgId,
    actorUid,
    action: expectedAction,
    canonicalPayload: actualRequestPayload,
  });

  const storedMacBuf = Buffer.from(storedApproval.requestMac, 'hex');
  const providedMacBuf = Buffer.from(providedMac, 'hex');
  const expectedMacBuf = Buffer.from(expectedMac, 'hex');

  if (
    storedMacBuf.byteLength !== 32 ||
    providedMacBuf.byteLength !== 32 ||
    expectedMacBuf.byteLength !== 32 ||
    !timingSafeEqual(storedMacBuf, providedMacBuf) ||
    !timingSafeEqual(storedMacBuf, expectedMacBuf)
  ) {
    throw new ApprovalVerificationError(
      'Approval HMAC mismatch: request payload or MAC was altered'
    );
  }
}
