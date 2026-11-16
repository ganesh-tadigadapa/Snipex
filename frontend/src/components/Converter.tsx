import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import {
  AlertTriangle, ArrowRight, ArrowUpDown, Bookmark, Check, CircleDashed, Layers, ListChecks, Loader2, Search,
  Sparkles, Trash2, X, XCircle,
} from 'lucide-react'
import { cancelBatch, deleteBatch, uploadBatch, type Batch, type Capabilities, type TaskStatus } from '../lib/api'
import { bytes, categoryOf, conversionInfo, duration, extOf, formatForName, labelOf, targetsFor } from '../lib/format'
import { BUILTIN_PRESETS, history, presets, type Preset } from '../lib/storage'
import { isTerminal, useBatchPolling } from '../lib/useBatch'
import { DownloadCenter } from './DownloadCenter'
import { DropZone } from './DropZone'
import { FileIcon, Select, useToast } from './ui'

interface LocalFile {
  key: string
  file: File
  name: string
  ext: string
  format: string | null
  size: number
  target: string
  issue: string | null
}

type Phase = 'select' | 'uploading' | 'processing' | 'done'
type Mode = 'single' | 'per_file'
type SortKey = 'added' | 'name' | 'type' | 'size'

const PREFERRED = ['pdf', 'docx', 'xlsx', 'png', 'jpg', 'csv', 'json', 'txt']

function defaultTarget(targets: string[]): string {
  return PREFERRED.find((p) => targets.includes(p)) ?? targets[0] ?? ''
}

interface Props {
  caps: Capabilities
  onHistoryChange: () => void
}

export function Converter({ caps, onHistoryChange }: Props) {
  const toast = useToast()
  const [files, setFiles] = useState<LocalFile[]>([])
  const [mode, setMode] = useState<Mode>('single')
  const [singleTarget, setSingleTarget] = useState('')
  const [phase, setPhase] = useState<Phase>('select')
  const [uploadFraction, setUploadFraction] = useState(0)
  const [created, setCreated] = useState<Batch | null>(null)
  const [token, setToken] = useState<string | null>(null)
  const [submitted, setSubmitted] = useState<string[]>([])
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<SortKey>('added')
  const [customPresets, setCustomPresets] = useState<Preset[]>(() => presets.custom())
  const [savingPreset, setSavingPreset] = useState(false)
  const [presetName, setPresetName] = useState('')
  const abortRef = useRef<AbortController | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)

  // Keep the converter in view when it switches to progress / results.
  useEffect(() => {
    if (phase === 'select') return
    const el = rootRef.current
    if (el && el.getBoundingClientRect().top < 64) el.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [phase])
  const maxBytes = caps.limits.max_file_mb * 1024 * 1024

  const batch = useBatchPolling(created, token, () => toast('error', 'Lost connection to the conversion service.'))

  // ---- derived -------------------------------------------------------------------------
  const supported = files.filter((f) => !f.issue)
  const effectiveTarget = useCallback(
    (f: LocalFile): string | null => {
      if (f.issue) return null
      const t = mode === 'single' ? singleTarget : f.target
      return t && targetsFor(f.format, caps).includes(t) ? t : null
    },
    [mode, singleTarget, caps],
  )
  const ready = files.filter((f) => effectiveTarget(f))
  const totalSize = files.reduce((n, f) => n + f.size, 0)

  const singleOptions = useMemo(() => {
    const counts = new Map<string, number>()
    for (const f of supported) for (const t of targetsFor(f.format, caps)) counts.set(t, (counts.get(t) ?? 0) + 1)
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1] || PREFERRED.indexOf(a[0]) - PREFERRED.indexOf(b[0]) || a[0].localeCompare(b[0]))
      .map(([t, n]) => ({ value: t, label: labelOf(t, caps), hint: n === supported.length ? 'all files' : `${n} of ${supported.length} files` }))
  }, [supported, caps])

  // Keep the single target valid as the file set changes.
  useEffect(() => {
    if (!singleOptions.length) return
    if (!singleOptions.some((o) => o.value === singleTarget)) setSingleTarget(singleOptions[0].value)
  }, [singleOptions, singleTarget])

  const statusByKey = useMemo(() => {
    const map = new Map<string, { status: TaskStatus | 'uploading'; error: string | null }>()
    if (phase === 'uploading') submitted.forEach((k) => map.set(k, { status: 'uploading' as never, error: null }))
    if (batch) batch.tasks.forEach((t, i) => submitted[i] && map.set(submitted[i], { status: t.status, error: t.error }))
    return map
  }, [batch, submitted, phase])

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    const list = files.filter((f) => !q || f.name.toLowerCase().includes(q) || f.ext.includes(q))
    const sorted = [...list]
    if (sort === 'name') sorted.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))
    if (sort === 'type') sorted.sort((a, b) => a.ext.localeCompare(b.ext) || a.name.localeCompare(b.name))
    if (sort === 'size') sorted.sort((a, b) => b.size - a.size)
    return sorted
  }, [files, query, sort])

  // ---- actions -------------------------------------------------------------------------
  const addFiles = (incoming: File[]) => {
    if (phase !== 'select') return
    const existing = new Set(files.map((f) => f.key))
    let dupes = 0
    const fresh: LocalFile[] = []
    for (const file of incoming) {
      const key = `${file.name}::${file.size}::${file.lastModified}`
      if (existing.has(key)) {
        dupes++
        continue
      }
      existing.add(key)
      const format = formatForName(file.name, caps)
      const targets = targetsFor(format, caps)
      let issue: string | null = null
      if (!format) issue = extOf(file.name) ? `.${extOf(file.name).toUpperCase()} files are not supported` : 'Unknown file type'
      else if (file.size === 0) issue = 'File is empty'
      else if (file.size > maxBytes) issue = `Larger than ${caps.limits.max_file_mb} MB`
      fresh.push({ key, file, name: file.name, ext: extOf(file.name), format, size: file.size, target: defaultTarget(targets), issue })
    }
    const room = caps.limits.max_files - files.length
    if (fresh.length > room) {
      toast('warning', `A batch holds up to ${caps.limits.max_files} files. ${fresh.length - Math.max(room, 0)} were not added.`)
    }
    const accepted = fresh.slice(0, Math.max(room, 0))
    if (dupes) toast('info', `Skipped ${dupes} duplicate ${dupes === 1 ? 'file' : 'files'} already in the list.`)
    const bad = accepted.filter((f) => f.issue).length
    if (bad) toast('warning', `${bad} ${bad === 1 ? 'file is' : 'files are'} not supported and will be skipped.`)
    if (accepted.length) setFiles((prev) => [...prev, ...accepted])
  }

  const remove = (key: string) => setFiles((prev) => prev.filter((f) => f.key !== key))
  const setTarget = (key: string, target: string) => setFiles((prev) => prev.map((f) => (f.key === key ? { ...f, target } : f)))

  const applyPreset = (id: string) => {
    const p = [...BUILTIN_PRESETS, ...customPresets].find((x) => x.id === id)
    if (!p) return
    if (Object.keys(p.map).length === 1 && p.map['*']) {
      setMode('single')
      setSingleTarget(p.map['*'])
    } else {
      setMode('per_file')
      setFiles((prev) =>
        prev.map((f) => {
          const t = (f.format && p.map[f.format]) || p.map['*']
          return t && targetsFor(f.format, caps).includes(t) ? { ...f, target: t } : f
        }),
      )
    }
    toast('success', `Preset “${p.name}” applied.`)
  }

  const savePreset = () => {
    const name = presetName.trim()
    if (!name) return
    const map: Record<string, string> = {}
    for (const f of supported) {
      const t = effectiveTarget(f)
      if (f.format && t) map[f.format] = t
    }
    const p: Preset = { id: `custom-${Date.now()}`, name, map: mode === 'single' ? { '*': singleTarget } : map }
    presets.save(p)
    setCustomPresets(presets.custom())
    setSavingPreset(false)
    setPresetName('')
    toast('success', `Preset “${name}” saved.`)
  }

  const convert = async () => {
    if (!ready.length) return
    const form = new FormData()
    const targets: string[] = []
    for (const f of ready) {
      form.append('files', f.file, f.name)
      targets.push(effectiveTarget(f)!)
    }
    form.append('targets', JSON.stringify(targets))
    form.append('mode', mode)
    setSubmitted(ready.map((f) => f.key))
    setUploadFraction(0)
    setPhase('uploading')
    const ctrl = new AbortController()
    abortRef.current = ctrl
    try {
      const b = await uploadBatch('/api/conversions', form, setUploadFraction, ctrl.signal)
      setToken(b.token!)
      setCreated(b)
      setPhase('processing')
    } catch (e) {
      setPhase('select')
      setSubmitted([])
      toast('error', (e as Error).message)
    }
  }

  // Batch finished -> download center + history
  useEffect(() => {
    if (phase !== 'processing' || !batch || !token || !isTerminal(batch)) return
    setPhase('done')
    history.add({
      id: batch.id, token, kind: 'convert', created_at: batch.created_at, expires_at: batch.expires_at,
      completed: batch.counts.completed, failed: batch.counts.failed + batch.counts.skipped, total: batch.tasks.length,
      outputs: batch.tasks.filter((t) => t.output).map((t) => ({ id: t.output!.id, filename: t.output!.filename, size: t.output!.size })),
    })
    onHistoryChange()
    const { completed, failed } = batch.counts
    if (batch.status === 'cancelled') toast('info', 'Conversion cancelled. Finished files are still available.')
    else if (failed) toast('warning', `${completed} converted, ${failed} failed.`)
    else toast('success', `All ${completed} files converted.`)
  }, [batch, phase, token, onHistoryChange, toast])

  const cancel = async () => {
    if (phase === 'uploading') {
      abortRef.current?.abort()
      return
    }
    if (created && token) {
      try {
        await cancelBatch(created.id, token)
      } catch (e) {
        toast('error', (e as Error).message)
      }
    }
  }

  const reset = () => {
    setFiles([])
    setPhase('select')
    setCreated(null)
    setToken(null)
    setSubmitted([])
    setQuery('')
  }

  const clearSession = async () => {
    if (created && token) {
      try {
        await deleteBatch(created.id, token)
      } catch {
        /* expired already */
      }
      history.remove(created.id)
      onHistoryChange()
    }
    reset()
    toast('info', 'Session cleared. Your files were deleted from the server.')
  }

  // ---- render --------------------------------------------------------------------------
  if (phase === 'done' && batch && token) {
    return (
      <Shell innerRef={rootRef}>
        <DownloadCenter batch={batch} token={token} caps={caps} onConvertMore={reset} onClear={clearSession} />
      </Shell>
    )
  }

  const busy = phase === 'uploading' || phase === 'processing'

  if (!files.length) {
    return (
      <Shell innerRef={rootRef}>
        <DropZone
          onFiles={addFiles}
          subtitle={
            <>
              or <span className="text-lavender underline decoration-violet/50 underline-offset-4">browse</span> to choose up to{' '}
              {caps.limits.max_files} files at once
            </>
          }
        >
          <div className="relative mt-7 flex flex-wrap items-center justify-center gap-x-4 gap-y-2 text-xs text-fg-3">
            <span className="flex items-center gap-1.5"><Layers className="size-3.5" /> {caps.inputs.length} input formats</span>
            <span className="flex items-center gap-1.5"><ListChecks className="size-3.5" /> Up to {caps.limits.max_files} files per batch</span>
            <span className="flex items-center gap-1.5"><CircleDashed className="size-3.5" /> {caps.limits.max_file_mb} MB per file</span>
          </div>
        </DropZone>
      </Shell>
    )
  }

  return (
    <Shell innerRef={rootRef}>
      {/* Stats */}
      <div className="mb-4 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm">
        <Stat label="Files" value={`${files.length}/${caps.limits.max_files}`} />
        <Stat label="Total size" value={bytes(totalSize)} />
        <Stat label="Supported" value={supported.length} />
        {files.length - supported.length > 0 && <Stat label="Unsupported" value={files.length - supported.length} tone="danger" />}
        <Stat label="Ready" value={ready.length} tone="success" />
      </div>

      {/* Output selector */}
      <AnimatePresence initial={false}>
        {phase === 'select' && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
            <div className="mb-4 rounded-2xl border border-line bg-bg-2/60 p-4">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
                <div className="flex-1">
                  <p className="mb-2 text-xs font-medium tracking-wide text-fg-3 uppercase">Output</p>
                  <div role="radiogroup" aria-label="Conversion mode" className="inline-flex rounded-xl border border-line bg-card p-1">
                    {(
                      [
                        ['single', 'Same format for all'],
                        ['per_file', 'Choose per file'],
                      ] as const
                    ).map(([m, label]) => (
                      <button
                        key={m}
                        role="radio"
                        aria-checked={mode === m}
                        onClick={() => setMode(m)}
                        className={`relative rounded-lg px-3 py-1.5 text-sm font-medium whitespace-nowrap transition-colors ${mode === m ? 'text-fg' : 'text-fg-2 hover:text-fg'}`}
                      >
                        {mode === m && <motion.span layoutId="mode-pill" className="absolute inset-0 rounded-lg bg-violet/20 ring-1 ring-violet/40" />}
                        <span className="relative">{label}</span>
                      </button>
                    ))}
                  </div>
                </div>
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                  {mode === 'single' && (
                    <div className="flex items-center gap-2">
                      <span className="text-sm whitespace-nowrap text-fg-2">Convert to</span>
                      <Select
                        label="Output format for all files"
                        value={singleTarget}
                        onChange={setSingleTarget}
                        options={singleOptions}
                        className="w-full min-w-48 sm:w-56"
                        disabled={!singleOptions.length}
                        placeholder={singleOptions.length ? undefined : 'No compatible format'}
                      />
                    </div>
                  )}
                  <Select
                    label="Apply a conversion preset"
                    value=""
                    onChange={applyPreset}
                    placeholder="Presets…"
                    options={[...BUILTIN_PRESETS, ...customPresets].map((p) => ({ value: p.id, label: p.name }))}
                    className="w-full sm:w-44"
                  />
                  {!savingPreset ? (
                    <button
                      onClick={() => setSavingPreset(true)}
                      disabled={!ready.length}
                      className="inline-flex h-9 items-center justify-center gap-1.5 rounded-lg px-2.5 text-sm text-fg-2 transition-colors hover:text-fg disabled:opacity-40"
                      title="Save current output choices as a preset"
                    >
                      <Bookmark className="size-4" /> Save
                    </button>
                  ) : (
                    <form onSubmit={(e) => (e.preventDefault(), savePreset())} className="flex items-center gap-1">
                      <input
                        autoFocus
                        value={presetName}
                        onChange={(e) => setPresetName(e.target.value)}
                        placeholder="Preset name"
                        maxLength={40}
                        aria-label="Preset name"
                        className="h-9 w-36 rounded-lg border border-line bg-card px-2.5 text-sm placeholder:text-fg-3 focus:border-violet focus:outline-none"
                      />
                      <button type="submit" className="grid size-9 place-items-center rounded-lg text-success hover:bg-success/10" aria-label="Save preset"><Check className="size-4" /></button>
                      <button type="button" onClick={() => setSavingPreset(false)} className="grid size-9 place-items-center rounded-lg text-fg-3 hover:bg-card" aria-label="Cancel"><X className="size-4" /></button>
                    </form>
                  )}
                </div>
              </div>
              {mode === 'single' && singleTarget && supported.length > ready.length && (
                <p className="mt-3 flex items-center gap-1.5 text-xs text-warning">
                  <AlertTriangle className="size-3.5" />
                  {supported.length - ready.length} {supported.length - ready.length === 1 ? 'file' : 'files'} can’t become {labelOf(singleTarget, caps)} and will be skipped — switch to “Choose per file” to pick another format.
                </p>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Progress */}
      {busy && <OverallProgress phase={phase} batch={batch} uploadFraction={uploadFraction} count={submitted.length} onCancel={cancel} />}

      {/* Toolbar */}
      {files.length > 3 && (
        <div className="mb-3 flex flex-col gap-2 sm:flex-row">
          <label className="relative flex-1">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-fg-3" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search files"
              aria-label="Search uploaded files"
              className="h-9 w-full rounded-lg border border-line bg-card-2 pr-3 pl-9 text-sm placeholder:text-fg-3 focus:border-violet focus:outline-none"
            />
          </label>
          <div className="flex items-center gap-2">
            <ArrowUpDown className="size-4 text-fg-3" aria-hidden />
            <Select
              label="Sort files"
              value={sort}
              onChange={(v) => setSort(v as SortKey)}
              options={[
                { value: 'added', label: 'Order added' },
                { value: 'name', label: 'Name' },
                { value: 'type', label: 'Type' },
                { value: 'size', label: 'Size' },
              ]}
              className="w-40"
            />
          </div>
        </div>
      )}

      {/* File list */}
      <ul className="max-h-[440px] divide-y divide-line overflow-y-auto overscroll-contain rounded-2xl border border-line bg-bg-2/50" aria-label="Selected files">
        <AnimatePresence initial={false}>
          {visible.map((f) => {
            const st = statusByKey.get(f.key)
            const target = effectiveTarget(f)
            const options = targetsFor(f.format, caps)
            const info = conversionInfo(f.format, target, caps)
            return (
              <motion.li
                key={f.key}
                layout="position"
                initial={{ opacity: 0, y: -6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, x: 16, transition: { duration: 0.15 } }}
                className="flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2.5 sm:flex-nowrap sm:px-4"
              >
                <FileIcon category={categoryOf(f.format, caps)} ext={f.ext} />
                <div className="min-w-0 flex-1 basis-[55%] sm:basis-auto">
                  <p className="truncate text-sm font-medium" title={f.name}>{f.name}</p>
                  <p className="mt-0.5 truncate text-xs text-fg-3">
                    {f.format ? labelOf(f.format, caps) : f.ext ? f.ext.toUpperCase() : 'Unknown'} · {bytes(f.size)}
                    {st?.error ? <span className="text-danger"> · {st.error}</span> : f.issue ? <span className="text-danger"> · {f.issue}</span> : info?.quality === 'basic' && phase === 'select' ? <span className="text-warning" title={info.notes}> · Basic fidelity</span> : null}
                  </p>
                </div>
                <div className="ml-auto flex items-center gap-2 sm:ml-0">
                  {!f.issue && (
                    <>
                      <ArrowRight className="hidden size-4 text-fg-3 sm:block" aria-hidden />
                      {mode === 'per_file' && phase === 'select' ? (
                        <Select
                          label={`Output format for ${f.name}`}
                          value={f.target}
                          onChange={(v) => setTarget(f.key, v)}
                          options={options.map((t) => ({ value: t, label: labelOf(t, caps) }))}
                          className="w-28"
                        />
                      ) : (
                        <span className={`inline-flex h-7 min-w-14 items-center justify-center rounded-md px-2 font-mono text-xs ${target ? 'bg-violet/15 text-lavender ring-1 ring-violet/30' : 'text-fg-3 ring-1 ring-line'}`}>
                          {target ? labelOf(target, caps) : 'skip'}
                        </span>
                      )}
                    </>
                  )}
                  <StatusPill status={st?.status ?? (f.issue ? 'unsupported' : target ? 'ready' : 'skip')} />
                  {phase === 'select' && (
                    <button onClick={() => remove(f.key)} className="grid size-8 place-items-center rounded-lg text-fg-3 transition-colors hover:bg-danger/10 hover:text-danger" aria-label={`Remove ${f.name}`}>
                      <X className="size-4" />
                    </button>
                  )}
                </div>
              </motion.li>
            )
          })}
        </AnimatePresence>
        {!visible.length && <li className="px-4 py-8 text-center text-sm text-fg-3">No files match “{query}”.</li>}
      </ul>

      {/* Actions */}
      {phase === 'select' && (
        <div className="mt-4 flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2">
            <DropZone onFiles={addFiles} compact disabled={files.length >= caps.limits.max_files} />
            <button onClick={() => setFiles([])} className="inline-flex h-9 items-center gap-1.5 rounded-lg px-3 text-sm text-fg-2 transition-colors hover:bg-danger/10 hover:text-danger">
              <Trash2 className="size-4" /> Clear all
            </button>
          </div>
          <button
            onClick={convert}
            disabled={!ready.length}
            className="btn-primary inline-flex h-12 items-center justify-center gap-2 rounded-xl px-6 text-[15px] font-semibold"
          >
            <Sparkles className="size-4" />
            {ready.length === files.length ? 'Convert All Files' : `Convert ${ready.length} ${ready.length === 1 ? 'File' : 'Files'}`}
            <ArrowRight className="size-4" />
          </button>
        </div>
      )}
    </Shell>
  )
}

function Shell({ children, innerRef }: { children: React.ReactNode; innerRef?: React.Ref<HTMLDivElement> }) {
  return (
    <div ref={innerRef} className="card-border relative rounded-[28px] border border-line bg-card/80 p-3 shadow-[0_30px_80px_-30px_rgba(124,58,237,0.35)] backdrop-blur-xl sm:p-5">
      {children}
    </div>
  )
}

function Stat({ label, value, tone }: { label: string; value: string | number; tone?: 'success' | 'danger' }) {
  const color = tone === 'success' ? 'text-success' : tone === 'danger' ? 'text-danger' : 'text-fg'
  return (
    <span className="flex items-baseline gap-1.5">
      <span className={`font-semibold tabular-nums ${color}`}>{value}</span>
      <span className="text-fg-3">{label}</span>
    </span>
  )
}

const PILL: Record<string, { label: string; cls: string; icon?: React.ReactNode }> = {
  ready: { label: 'Ready', cls: 'text-fg-2 ring-line' },
  skip: { label: 'Skipped', cls: 'text-fg-3 ring-line' },
  unsupported: { label: 'Unsupported', cls: 'text-danger ring-danger/30 bg-danger/5' },
  uploading: { label: 'Uploading', cls: 'text-lavender ring-violet/30 bg-violet/10', icon: <Loader2 className="size-3 animate-spin" /> },
  waiting: { label: 'Waiting', cls: 'text-fg-2 ring-line', icon: <CircleDashed className="size-3" /> },
  converting: { label: 'Converting', cls: 'text-lavender ring-violet/40 bg-violet/15', icon: <Loader2 className="size-3 animate-spin" /> },
  completed: { label: 'Completed', cls: 'text-success ring-success/30 bg-success/10', icon: <Check className="size-3" strokeWidth={3} /> },
  failed: { label: 'Failed', cls: 'text-danger ring-danger/30 bg-danger/10', icon: <XCircle className="size-3" /> },
  skipped: { label: 'Skipped', cls: 'text-fg-3 ring-line' },
  cancelled: { label: 'Cancelled', cls: 'text-fg-3 ring-line' },
}

function StatusPill({ status }: { status: string }) {
  const p = PILL[status] ?? PILL.ready
  return (
    <span className={`inline-flex h-7 shrink-0 items-center justify-center gap-1 rounded-full px-2 text-xs font-medium ring-1 sm:w-[104px] sm:px-0 ${p.cls}`} title={p.label}>
      {p.icon}
      <span className={p.icon ? 'sr-only sm:not-sr-only' : ''}>{p.label}</span>
    </span>
  )
}

function OverallProgress({
  phase, batch, uploadFraction, count, onCancel,
}: { phase: Phase; batch: Batch | null; uploadFraction: number; count: number; onCancel: () => void }) {
  const uploading = phase === 'uploading'
  const pct = uploading ? Math.round(uploadFraction * 100) : batch?.progress ?? 0
  const done = batch?.finished ?? 0
  const total = batch?.total ?? count
  return (
    <motion.div initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} className="mb-4 rounded-2xl border border-violet/30 bg-violet/[0.06] p-4" aria-live="polite">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-sm font-semibold">
            {uploading ? `Uploading ${count} ${count === 1 ? 'file' : 'files'}…` : `${done} / ${total} files completed`}
          </p>
          <p className="mt-0.5 truncate text-xs text-fg-2">
            {uploading
              ? 'Files are sent over your connection to the conversion service'
              : batch?.current
                ? <>Converting <span className="text-fg">{batch.current}</span></>
                : batch?.status === 'queued' ? 'Queued — waiting for a free converter' : 'Working…'}
          </p>
        </div>
        <div className="flex items-center gap-4 text-xs">
          {!uploading && batch && (
            <>
              <span className="text-success">{batch.counts.completed} succeeded</span>
              {batch.counts.failed > 0 && <span className="text-danger">{batch.counts.failed} failed</span>}
              {batch.eta_seconds != null && <span className="text-fg-2">~{duration(batch.eta_seconds)} left</span>}
            </>
          )}
          <span className="font-mono text-sm font-semibold text-lavender tabular-nums">{pct}%</span>
          <button onClick={onCancel} className="rounded-lg px-2.5 py-1 text-xs font-medium text-fg-2 ring-1 ring-line transition-colors hover:text-danger hover:ring-danger/40">
            Cancel
          </button>
        </div>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-line" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="Overall progress">
        <motion.div
          className="progress-stripes h-full rounded-full bg-gradient-to-r from-violet to-purple"
          initial={false}
          animate={{ width: `${Math.max(pct, 2)}%` }}
          transition={{ type: 'spring', stiffness: 120, damping: 24 }}
        />
      </div>
    </motion.div>
  )
}
