import { NextRequest, NextResponse } from 'next/server';
import { readSession } from '@/lib/session';
import { buildTemplateCsv, buildTemplateXlsx } from '@/lib/product-import/sheet';

/** GET /api/inventory/template?format=xlsx|csv — the Saman & Rates bulk-import template (headers, 2 ignored sample rows, notes). */
export async function GET(request: NextRequest) {
  if (!readSession(request)) {
    return NextResponse.json({ error: { code: 'ERR_UNAUTHENTICATED', message: 'Not signed in' } }, { status: 401 });
  }
  const format = request.nextUrl.searchParams.get('format') === 'csv' ? 'csv' : 'xlsx';
  if (format === 'csv') {
    return new NextResponse(buildTemplateCsv(), {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': 'attachment; filename="saman-rates-import-template.csv"',
        'Cache-Control': 'no-store',
      },
    });
  }
  const body = await buildTemplateXlsx();
  return new NextResponse(new Uint8Array(body), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': 'attachment; filename="saman-rates-import-template.xlsx"',
      'Cache-Control': 'no-store',
    },
  });
}
