import { IMPORT_COLUMN_KEYS, type ImportRowError, type ImportRowResult, type ImportSummary } from '@/types/product-import';
import type { ApiErrorBody } from '@/types/checkout';

export type UploadResult = { ok: true; data: ImportSummary } | { ok: false; error: string };

/**
 * POST /api/inventory/bulk-upload with real upload progress (fetch has no
 * upload-progress events, so this uses XMLHttpRequest). `onProgress` gets
 * 0–1 while bytes are sent; `onProcessing` fires once the upload is done and
 * the server is validating/saving rows.
 */
export function uploadProductFile(file: File, onProgress: (fraction: number) => void, onProcessing: () => void): Promise<UploadResult> {
  return new Promise((resolve) => {
    const form = new FormData();
    form.append('file', file);
    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/inventory/bulk-upload');
    xhr.responseType = 'json';
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(e.loaded / e.total);
    };
    xhr.upload.onload = () => {
      onProgress(1);
      onProcessing();
    };
    xhr.onload = () => {
      const body = xhr.response as ({ data?: ImportSummary } & Partial<ApiErrorBody>) | null;
      if (xhr.status >= 200 && xhr.status < 300 && body?.data) resolve({ ok: true, data: body.data });
      else resolve({ ok: false, error: body?.error?.code ?? `HTTP_${xhr.status}` });
    };
    xhr.onerror = () => resolve({ ok: false, error: 'ERR_NETWORK' });
    xhr.send(form);
  });
}

/** Renders a row error in the active language (`import.err.<code>`, `{param}` placeholders), falling back to the server's English message. */
export function formatImportError(t: (key: string) => string, error: ImportRowError): string {
  const key = `import.err.${error.code}`;
  const template = t(key);
  if (template === key) return error.message;
  return template.replace(/\{(\w+)\}/g, (_, name: string) => {
    const value = error.params?.[name];
    if (value == null) return '';
    // Column names inside messages are shown by their translated label.
    if (name === 'field') {
      const label = t(`import.col.${value}`);
      return label === `import.col.${value}` ? String(value) : label;
    }
    return String(value);
  });
}

function csvCell(v: unknown): string {
  const s = v == null ? '' : String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * Failed rows as a CSV in template column order plus `row` and `error` — the
 * user can fix it and upload the same file again (unknown columns such as
 * `error` are ignored on upload).
 */
export function failedRowsCsv(rows: ImportRowResult[], t: (key: string) => string): string {
  const header = ['row', ...IMPORT_COLUMN_KEYS, 'error'];
  const lines = rows
    .filter((r) => r.status === 'FAILED')
    .map((r) =>
      [
        r.row_number,
        ...IMPORT_COLUMN_KEYS.map((k) => (k === 'product_name' ? r.source?.[k] ?? r.product_name : r.source?.[k]) ?? ''),
        (r.errors ?? []).map((e) => formatImportError(t, e)).join('; '),
      ]
        .map(csvCell)
        .join(',')
    );
  return '﻿' + [header.join(','), ...lines].join('\r\n') + '\r\n';
}

export function downloadText(filename: string, text: string, mime = 'text/csv;charset=utf-8') {
  const url = URL.createObjectURL(new Blob([text], { type: mime }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
