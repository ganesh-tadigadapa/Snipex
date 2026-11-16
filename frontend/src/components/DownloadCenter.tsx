import { motion } from 'framer-motion'
import { AlertCircle, ArrowRight, Check, Download, FileArchive, RotateCcw, Trash2 } from 'lucide-react'
import { fileUrl, zipUrl, type Batch, type Capabilities } from '../lib/api'
import { bytes, categoryOf, extOf, labelOf } from '../lib/format'
import { FileIcon } from './ui'

interface Props {
  batch: Batch
  token: string
  caps: Capabilities | null
  onConvertMore: () => void
  onClear: () => void
}

export function DownloadCenter({ batch, token, caps, onConvertMore, onClear }: Props) {
  const done = batch.tasks.filter((t) => t.status === 'completed' && t.output)
  const problems = batch.tasks.filter((t) => t.status === 'failed' || t.status === 'skipped' || t.status === 'cancelled')
  const total = done.reduce((n, t) => n + (t.output?.size ?? 0), 0)
  const minutesLeft = Math.max(0, Math.round((batch.expires_at * 1000 - Date.now()) / 60000))

  return (
    <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="space-y-6">
      <div className="flex flex-col items-start gap-5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-4">
          <motion.div
            initial={{ scale: 0.6, rotate: -20 }}
            animate={{ scale: 1, rotate: 0 }}
            transition={{ type: 'spring', stiffness: 300, damping: 15 }}
            className={`grid size-12 place-items-center rounded-2xl ring-1 ${done.length ? 'bg-success/10 text-success ring-success/30' : 'bg-danger/10 text-danger ring-danger/30'}`}
          >
            {done.length ? <Check className="size-6" strokeWidth={2.5} /> : <AlertCircle className="size-6" />}
          </motion.div>
          <div>
            <h3 className="text-xl font-semibold tracking-tight">
              {done.length ? 'Your Files Are Ready!' : batch.status === 'cancelled' ? 'Conversion cancelled' : 'No files could be converted'}
            </h3>
            <p className="mt-0.5 text-sm text-fg-2">
              {done.length} converted{problems.length ? ` · ${problems.length} not converted` : ''}
              {done.length > 0 && ` · ${bytes(total)}`} · Deleted automatically in {minutesLeft} min
            </p>
          </div>
        </div>
        {done.length > 0 && (
          <a href={zipUrl(batch.id, token)} download className="btn-primary inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl px-5 text-sm font-semibold sm:w-auto">
            <FileArchive className="size-4" /> Download All as ZIP
          </a>
        )}
      </div>

      {done.length > 0 && (
        <ul className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-bg-2/50">
          {done.map((t, i) => {
            const out = t.output!
            const outFmt = out.format === 'zip' ? 'zip' : out.format
            return (
              <motion.li
                key={t.id}
                initial={{ opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: Math.min(i * 0.03, 0.5) }}
                className="flex items-center gap-3 px-3 py-3 sm:gap-4 sm:px-4"
              >
                <FileIcon category={outFmt === 'zip' ? 'archive' : categoryOf(outFmt, caps)} ext={extOf(out.filename)} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium" title={out.filename}>{out.filename}</p>
                  <p className="mt-0.5 flex min-w-0 items-center gap-1.5 text-xs text-fg-3">
                    <span className="truncate" title={t.inputs.map((x) => x.name).join(', ')}>
                      {t.inputs.length > 1 ? `${t.inputs.length} files` : t.inputs[0].name}
                    </span>
                    <ArrowRight className="size-3 shrink-0" />
                    <span className="shrink-0">{out.format === 'zip' ? (t.target ? `ZIP of ${labelOf(t.target, caps)} files` : 'ZIP') : labelOf(out.format, caps)}</span>
                    <span className="shrink-0">· {bytes(out.size)}</span>
                  </p>
                </div>
                <a
                  href={fileUrl(batch.id, token, out.id)}
                  download={out.filename}
                  className="inline-flex size-9 shrink-0 items-center justify-center gap-1.5 rounded-lg border border-line bg-card text-sm font-medium transition-colors hover:border-violet/60 hover:text-lavender sm:w-auto sm:px-3"
                  aria-label={`Download ${out.filename}`}
                >
                  <Download className="size-4" /> <span className="hidden sm:inline">Download</span>
                </a>
              </motion.li>
            )
          })}
        </ul>
      )}

      {problems.length > 0 && (
        <div className="rounded-2xl border border-danger/25 bg-danger/[0.04] p-4">
          <p className="mb-2 flex items-center gap-2 text-sm font-medium text-danger">
            <AlertCircle className="size-4" /> {problems.length} {problems.length === 1 ? 'file was' : 'files were'} not converted
          </p>
          <ul className="space-y-1.5 text-sm">
            {problems.map((t) => (
              <li key={t.id} className="flex flex-col gap-0.5 sm:flex-row sm:gap-2">
                <span className="truncate font-medium text-fg">{t.inputs.map((x) => x.name).join(', ')}</span>
                <span className="text-fg-2">— {t.error ?? (t.status === 'cancelled' ? 'Cancelled' : 'Not converted')}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex flex-col gap-2 sm:flex-row">
        <button onClick={onConvertMore} className="inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-line bg-card px-4 text-sm font-medium transition-colors hover:border-line-2">
          <RotateCcw className="size-4" /> Convert More Files
        </button>
        <button onClick={onClear} className="inline-flex h-10 items-center justify-center gap-2 rounded-xl px-4 text-sm font-medium text-fg-2 transition-colors hover:bg-danger/10 hover:text-danger">
          <Trash2 className="size-4" /> Clear Session
        </button>
      </div>
    </motion.div>
  )
}
