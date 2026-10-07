'use client';

import { useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, Download, FileSpreadsheet, Loader2, UploadCloud, X } from 'lucide-react';
import { useLanguage } from '@/context/LanguageContext';
import { translateError } from '@/lib/translations';
import { downloadText, failedRowsCsv, formatImportError, uploadProductFile } from '@/lib/product-import/client';
import type { ImportSummary } from '@/types/product-import';

const ACCEPT = '.xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv';
const MAX_BYTES = 5 * 1024 * 1024;

type Phase = { kind: 'pick' } | { kind: 'uploading'; progress: number } | { kind: 'processing' } | { kind: 'done'; summary: ImportSummary };

/** Saman & Rates "Upload Products Excel": dropzone -> upload progress -> server processing -> per-row summary. */
export function BulkImportModal({ onClose, onImported }: { onClose: () => void; onImported: () => void }) {
  const { t } = useLanguage();
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);
  const [phase, setPhase] = useState<Phase>({ kind: 'pick' });
  const [error, setError] = useState<string | null>(null);
  const busy = phase.kind === 'uploading' || phase.kind === 'processing';

  function choose(f: File | undefined | null) {
    setError(null);
    if (!f) return;
    if (!/\.(xlsx|csv)$/i.test(f.name)) return setError(t('import.onlyXlsxCsv'));
    if (f.size > MAX_BYTES) return setError(translateError(t, 'ERR_IMPORT_TOO_LARGE'));
    setFile(f);
  }

  async function start() {
    if (!file) return;
    setError(null);
    setPhase({ kind: 'uploading', progress: 0 });
    const res = await uploadProductFile(
      file,
      (progress) => setPhase((p) => (p.kind === 'uploading' ? { kind: 'uploading', progress } : p)),
      () => setPhase({ kind: 'processing' })
    );
    if (!res.ok) {
      setPhase({ kind: 'pick' });
      setError(translateError(t, res.error));
      return;
    }
    setPhase({ kind: 'done', summary: res.data });
    if (res.data.created + res.data.updated > 0) onImported();
  }

  const summary = phase.kind === 'done' ? phase.summary : null;
  const failedRows = summary?.rows.filter((r) => r.status === 'FAILED') ?? [];

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/40 p-0 backdrop-blur-sm sm:items-center sm:p-4">
      <div className="flex max-h-[92vh] w-full max-w-lg flex-col rounded-t-2xl bg-white shadow-2xl sm:rounded-2xl">
        <div className="flex items-start justify-between gap-3 border-b border-slate-100 p-5">
          <div>
            <h2 className="text-base font-bold text-slate-900">{t('import.uploadTitle')}</h2>
            <p className="mt-0.5 text-xs text-slate-500">{t('import.uploadSubtitle')}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            aria-label={t('common.close')}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 disabled:opacity-40"
          >
            <X size={18} />
          </button>
        </div>

        <div className="overflow-y-auto p-5">
          {!summary && (
            <>
              <button
                type="button"
                disabled={busy}
                onClick={() => inputRef.current?.click()}
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragging(true);
                }}
                onDragLeave={() => setDragging(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragging(false);
                  choose(e.dataTransfer.files?.[0]);
                }}
                className={`flex w-full flex-col items-center gap-2 rounded-xl border-2 border-dashed px-4 py-8 text-center transition ${
                  dragging ? 'border-primary bg-primary/5' : 'border-slate-200 hover:border-primary/50 hover:bg-slate-50'
                } disabled:cursor-not-allowed disabled:opacity-60`}
              >
                {file ? <FileSpreadsheet size={28} className="text-emerald-600" /> : <UploadCloud size={28} className="text-slate-400" />}
                <span className="text-sm font-semibold text-slate-800">{file ? file.name : t('import.dropHere')}</span>
                <span className="text-xs text-slate-500">{file ? `${(file.size / 1024).toFixed(1)} KB` : t('import.fileHint')}</span>
              </button>
              <input ref={inputRef} type="file" accept={ACCEPT} className="hidden" onChange={(e) => choose(e.target.files?.[0])} />

              {busy && (
                <div className="mt-4">
                  <div className="flex items-center justify-between text-xs font-medium text-slate-600">
                    <span className="flex items-center gap-1.5">
                      <Loader2 size={13} className="animate-spin" />
                      {phase.kind === 'uploading' ? t('import.uploading') : t('import.processing')}
                    </span>
                    {phase.kind === 'uploading' && <span className="tabular-nums">{Math.round(phase.progress * 100)}%</span>}
                  </div>
                  <div
                    className="mt-1.5 h-2 overflow-hidden rounded-full bg-slate-100"
                    role="progressbar"
                    aria-label={phase.kind === 'uploading' ? t('import.uploading') : t('import.processing')}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={phase.kind === 'uploading' ? Math.round(phase.progress * 100) : undefined}
                  >
                    {phase.kind === 'uploading' ? (
                      <div className="h-full rounded-full bg-primary transition-[width] duration-200" style={{ width: `${Math.round(phase.progress * 100)}%` }} />
                    ) : (
                      <div className="h-full w-1/3 animate-pulse rounded-full bg-primary" />
                    )}
                  </div>
                </div>
              )}

              {error && (
                <p className="mt-3 flex items-start gap-1.5 rounded-lg bg-rose-50 px-3 py-2 text-xs font-medium text-rose-700">
                  <AlertTriangle size={14} className="mt-0.5 shrink-0" />
                  {error}
                </p>
              )}
            </>
          )}

          {summary && (
            <div>
              <div className="flex items-center gap-2">
                {summary.failed === 0 ? <CheckCircle2 size={20} className="text-emerald-600" /> : <AlertTriangle size={20} className="text-amber-500" />}
                <p className="text-sm font-bold text-slate-900">{summary.failed === 0 ? t('import.doneAllOk') : t('import.doneWithErrors')}</p>
              </div>
              <dl className="mt-3 grid grid-cols-2 gap-2">
                {(
                  [
                    ['import.totalRows', summary.total_rows, 'text-slate-900'],
                    ['import.created', summary.created, 'text-emerald-600'],
                    ['import.updated', summary.updated, 'text-primary'],
                    ['import.failed', summary.failed, summary.failed ? 'text-rose-600' : 'text-slate-900'],
                  ] as const
                ).map(([key, value, tone]) => (
                  <div key={key} className="rounded-xl border border-slate-200 p-3">
                    <dt className="text-xs text-slate-500">{t(key)}</dt>
                    <dd className={`text-xl font-black tabular-nums ${tone}`}>{value}</dd>
                  </div>
                ))}
              </dl>
              {summary.skipped_sample_rows > 0 && (
                <p className="mt-2 text-xs text-slate-500">{t('import.skippedSamples').replace('{count}', String(summary.skipped_sample_rows))}</p>
              )}

              {failedRows.length > 0 && (
                <div className="mt-4">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-xs font-bold uppercase tracking-wide text-slate-500">{t('import.failedRowsTitle')}</p>
                    <button
                      type="button"
                      onClick={() => downloadText('failed-rows.csv', failedRowsCsv(summary.rows, t))}
                      className="flex min-h-[36px] items-center gap-1 rounded-lg border border-slate-200 px-2.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                    >
                      <Download size={13} /> {t('import.downloadFailed')}
                    </button>
                  </div>
                  <ul className="mt-2 max-h-56 divide-y divide-slate-100 overflow-y-auto rounded-xl border border-slate-200">
                    {failedRows.map((r) => (
                      <li key={r.row_number} className="px-3 py-2 text-xs">
                        <p className="font-semibold text-slate-800">
                          {t('import.rowLabel').replace('{row}', String(r.row_number))}
                          {r.product_name ? ` · ${r.product_name}` : ''}
                        </p>
                        {(r.errors ?? []).map((e, i) => (
                          <p key={i} className="text-rose-600">
                            {formatImportError(t, e)}
                          </p>
                        ))}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="flex gap-2 border-t border-slate-100 p-4">
          {summary ? (
            <button type="button" onClick={onClose} className="min-h-[48px] flex-1 rounded-lg bg-primary text-sm font-bold text-white hover:bg-primary-hover">
              {t('common.done')}
            </button>
          ) : (
            <>
              <button
                type="button"
                onClick={onClose}
                disabled={busy}
                className="min-h-[48px] flex-1 rounded-lg border border-slate-200 text-sm font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-40"
              >
                {t('common.cancel')}
              </button>
              <button
                type="button"
                onClick={start}
                disabled={!file || busy}
                className="flex min-h-[48px] flex-1 items-center justify-center gap-1.5 rounded-lg bg-primary text-sm font-bold text-white shadow-sm shadow-primary/25 hover:bg-primary-hover disabled:opacity-50"
              >
                {busy ? <Loader2 size={16} className="animate-spin" /> : <UploadCloud size={16} />}
                {t('import.startImport')}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
