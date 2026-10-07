import { NextRequest, NextResponse } from 'next/server';
import { readSession } from '@/lib/session';
import { ImportFileError, parseUpload } from '@/lib/product-import/sheet';
import type { ImportRowResult } from '@/types/product-import';

const STRAPI_URL = process.env.STRAPI_URL ?? 'http://localhost:1337';
const STRAPI_SERVICE_TOKEN = process.env.STRAPI_SERVICE_TOKEN ?? '';
const MAX_FILE_BYTES = 5 * 1024 * 1024;

function errorBody(code: string, message: string, traceId: string, details?: Record<string, unknown>) {
  return { error: { code, message, trace_id: traceId, ...(details ? { details } : {}) } };
}

/**
 * POST /api/inventory/bulk-upload (multipart, field `file`) — parses the
 * .xlsx/.csv here and forwards the rows to Strapi's /api/product-import,
 * which validates and upserts them for the *session* store. The store never
 * comes from the file or the form.
 */
export async function POST(request: NextRequest) {
  const traceId = request.headers.get('x-trace-id') ?? crypto.randomUUID();
  const session = readSession(request);
  if (!session) return NextResponse.json(errorBody('ERR_UNAUTHENTICATED', 'Not signed in', traceId), { status: 401 });

  let file: File | null = null;
  try {
    const form = await request.formData();
    const value = form.get('file');
    file = value instanceof File ? value : null;
  } catch {
    /* handled below */
  }
  if (!file) return NextResponse.json(errorBody('ERR_VALIDATION', 'Attach the spreadsheet as the "file" field', traceId), { status: 400 });
  if (file.size > MAX_FILE_BYTES) return NextResponse.json(errorBody('ERR_IMPORT_TOO_LARGE', 'The file is larger than 5 MB', traceId), { status: 413 });

  let parsed;
  try {
    parsed = await parseUpload(file.name, Buffer.from(await file.arrayBuffer()));
  } catch (err) {
    if (err instanceof ImportFileError) return NextResponse.json(errorBody(err.code, err.message, traceId, err.details), { status: 400 });
    return NextResponse.json(errorBody('ERR_IMPORT_UNREADABLE', 'Could not read the file', traceId), { status: 400 });
  }

  let upstream: Response;
  try {
    upstream = await fetch(`${STRAPI_URL}/api/product-import`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Trace-Id': traceId,
        'X-Store-Id': session.storeId,
        'X-Tenant-Id': session.tenantId,
        'X-User-Id': session.userId,
        Authorization: `Bearer ${STRAPI_SERVICE_TOKEN}`,
      },
      body: JSON.stringify({ rows: parsed.rows }),
      cache: 'no-store',
    });
  } catch {
    return NextResponse.json(errorBody('ERR_UPSTREAM_UNREACHABLE', 'Could not reach the Strapi backend', traceId), { status: 502 });
  }

  const payload = await upstream.json().catch(() => null);
  if (!upstream.ok || !payload?.data) {
    return NextResponse.json(payload ?? errorBody('ERR_UPSTREAM', `HTTP ${upstream.status}`, traceId), { status: upstream.ok ? 502 : upstream.status });
  }
  // Failed rows carry their original cells back so the client can offer a fix-and-reupload file.
  const byLine = new Map(parsed.rows.map((r) => [r.row_number, r]));
  const rows = (payload.data.rows as ImportRowResult[]).map((r) => (r.status === 'FAILED' ? { ...r, source: byLine.get(r.row_number) } : r));
  return NextResponse.json({ data: { ...payload.data, rows, skipped_sample_rows: parsed.skipped_sample_rows } });
}
