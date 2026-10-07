import { createHash } from 'node:crypto';
import type { Knex } from 'knex';

/** Rule AUD-1: hash = SHA256(prev_hash || canonical_json(row_without_hash)), per-store chain. */
export interface AuditLogInput {
  store_id: number;
  actor_user_id?: number | null;
  approver_user_id?: number | null;
  action: string;
  entity_type: string;
  entity_id?: number | null;
  before_json?: unknown;
  after_json?: unknown;
  reason_code?: string | null;
  reason_text?: string | null;
  trace_id?: string | null;
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const keys = Object.keys(value as Record<string, unknown>).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson((value as Record<string, unknown>)[k])}`).join(',')}}`;
}

/** Must be called inside the same transaction as the audited change (Rule AUD-3). */
export async function writeAuditLog(trx: Knex.Transaction, input: AuditLogInput): Promise<void> {
  const prev = await trx('audit_logs')
    .where({ store_id: input.store_id })
    .orderBy('id', 'desc')
    .first('hash');
  const prevHash: Buffer | null = prev ? prev.hash : null;

  const row = {
    store_id: input.store_id,
    actor_user_id: input.actor_user_id ?? null,
    approver_user_id: input.approver_user_id ?? null,
    action: input.action,
    entity_type: input.entity_type,
    entity_id: input.entity_id ?? null,
    before_json: input.before_json ? JSON.stringify(input.before_json) : null,
    after_json: input.after_json ? JSON.stringify(input.after_json) : null,
    reason_code: input.reason_code ?? null,
    reason_text: input.reason_text ?? null,
    trace_id: input.trace_id ?? null,
  };

  const hash = createHash('sha256')
    .update(prevHash ?? Buffer.alloc(0))
    .update(canonicalJson(row))
    .digest();

  await trx('audit_logs').insert({ ...row, prev_hash: prevHash, hash });
}
