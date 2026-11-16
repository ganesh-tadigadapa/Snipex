import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import {
  AlertTriangle, ArrowRight, Bookmark, Check, ChevronDown, CircleDashed, Loader2, Search,
  Trash2, X, XCircle,
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

/** Lower is better; formats outside the preferred list come after all preferred ones. */
function rank(fmt: string): number {
  const i = PREFERRED.indexOf(fmt)
  return i === -1 ? PREFERRED.length : i
}

function defaultTarget(targets: string[]): string {
  return PREFERRED.find((p) => targets.includes(p)) ?? targets[0] ?? ''
}

interface Props {
  caps: Capabilities
  onHistoryChange: () => void
  onActiveChange?: (active: boolean) => void
}

export function Converter({ caps, onHistoryChange, onActiveChange }: Props) {
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

  const active = files.length > 0 || phase !== 'select'
  useEffect(() => onActiveChange?.(active), [active, onActiveChange])

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
      .sort((a, b) => b[1] - a[1] || rank(a[0]) - rank(b[0]) || a[0].localeCompare(b[0]))
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
      <DropZone orb onFiles={addFiles}>
        <span className="whitespace-nowrap">
          Up to {caps.limits.max_files} files
          <span className="hidden sm:inline">
            <span className="mx-1.5 text-fg-3">•</span>
            {caps.inputs.length} formats
          </span>
          <span className="mx-1.5 text-fg-3">•</span>
          Batch convert
        </span>
      </DropZone>
    )
  }

  const unsupported = files.length - supported.length
  const skipped = supported.length - ready.length
  const PRIMARY_CHIPS = 7
  const chipOptions = singleOptions.slice(0, PRIMARY_CHIPS)
  const moreOptions = singleOptions.slice(PRIMARY_CHIPS)
  const ctaLabel =
    mode === 'single' && singleTarget
      ? `Convert ${ready.length} ${ready.length === 1 ? 'file' : 'files'} to ${labelOf(singleTarget, caps)}`
      : `Convert ${ready.length} ${ready.length === 1 ? 'file' : 'files'}`

  return (
    <Shell innerRef={rootRef}>
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 px-1 pb-4">
        <div>
          <p className="text-[11px] font-medium tracking-[0.18em] text-fg-3 uppercase">Your files</p>
          <p className="mt-1 text-xl font-semibold tracking-tight">
            {files.length} {files.length === 1 ? 'file' : 'files'}
            <span className="ml-2 text-sm font-normal text-fg-3">· {bytes(totalSize)}</span>
          </p>
          {unsupported > 0 && <p className="mt-0.5 text-xs text-danger">{unsupported} not supported, will be skipped</p>}
        </div>
        {phase === 'select' && (
          <div className="flex items-center gap-1.5">
            <DropZone onFiles={addFiles} compact disabled={files.length >= caps.limits.max_files} />
            <button
              onClick={() => setFiles([])}
              className="inline-flex h-9 items-center gap-1.5 rounded-full px-3 text-[13px] text-fg-3 transition-colors hover:text-danger"
            >
              <Trash2 className="size-3.5" /> Clear
            </button>
          </div>
        )}
      </div>

      {/* Output format */}
      <AnimatePresence initial={false}>
        {phase === 'select' && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
            <div className="mb-5 border-y border-line py-5">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <p className="text-[11px] font-medium tracking-[0.18em] text-fg-3 uppercase">{mode === 'single' ? 'Convert to' : 'Choose a format for each file'}</p>
                <div className="flex items-center gap-1 text-xs">
                  <button
                    onClick={() => setMode(mode === 'single' ? 'per_file' : 'single')}
                    className="rounded-md px-2 py-1 font-medium text-lavender transition-colors hover:bg-violet/10"
                  >
                    {mode === 'single' ? 'Customize per file' : 'Use one format for all'}
                  </button>
                  <span className="text-fg-3">·</span>
                  <label className="relative">
                    <span className="sr-only">Apply a preset</span>
                    <select
                      value=""
                      onChange={(e) => e.target.value && applyPreset(e.target.value)}
                      className="w-[78px] cursor-pointer rounded-md bg-transparent py-1 pr-5 pl-2 font-medium text-fg-2 transition-colors hover:text-fg focus:outline-none"
                    >
                      <option value="">Presets</option>
                      {[...BUILTIN_PRESETS, ...customPresets].map((p) => (
                        <option key={p.id} value={p.id}>{p.name}</option>
                      ))}
                    </select>
                    <ChevronDown className="pointer-events-none absolute top-1/2 right-1 size-3 -translate-y-1/2 text-fg-3" />
                  </label>
                  {mode === 'per_file' && !savingPreset && (
                    <>
                      <span className="text-fg-3">·</span>
                      <button onClick={() => setSavingPreset(true)} disabled={!ready.length} className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-fg-2 hover:bg-card hover:text-fg disabled:opacity-40">
                        <Bookmark className="size-3" /> Save
                      </button>
                    </>
                  )}
                </div>
              </div>

              {savingPreset && (
                <form onSubmit={(e) => (e.preventDefault(), savePreset())} className="mb-3 flex items-center gap-1.5">
                  <input
                    autoFocus
                    value={presetName}
                    onChange={(e) => setPresetName(e.target.value)}
                    placeholder="Name this preset"
                    maxLength={40}
                    aria-label="Preset name"
                    className="h-9 flex-1 rounded-lg border border-line bg-card px-3 text-sm placeholder:text-fg-3 focus:border-violet focus:outline-none sm:max-w-xs"
                  />
                  <button type="submit" className="grid size-9 place-items-center rounded-lg text-success hover:bg-success/10" aria-label="Save preset"><Check className="size-4" /></button>
                  <button type="button" onClick={() => setSavingPreset(false)} className="grid size-9 place-items-center rounded-lg text-fg-3 hover:bg-card" aria-label="Cancel"><X className="size-4" /></button>
                </form>
              )}

              {mode === 'single' && (
                <div role="radiogroup" aria-label="Output format" className="flex flex-wrap gap-2">
                  {chipOptions.map((o) => {
                    const on = o.value === singleTarget
                    const partial = o.hint !== 'all files'
                    return (
                      <button
                        key={o.value}
                        role="radio"
                        aria-checked={on}
                        onClick={() => setSingleTarget(o.value)}
                        title={partial ? `Works for ${o.hint}` : 'Works for all files'}
                        className={`relative inline-flex h-9 items-center gap-1.5 rounded-full px-4 text-[13px] font-medium tracking-wide transition-all duration-200 ${
                          on
                            ? 'bg-violet/15 text-fg ring-1 ring-purple/70 shadow-[0_0_22px_-6px_rgba(168,85,247,0.9),inset_0_0_12px_rgba(168,85,247,0.15)]'
                            : 'text-fg-2 ring-1 ring-line hover:text-fg hover:ring-line-2'
                        }`}
                      >
                        {o.label}
                        {partial && <span className="text-[10.5px] text-fg-3 tabular-nums">{o.hint.split(' of ')[0]}/{supported.length}</span>}
                      </button>
                    )
                  })}
                  {moreOptions.length > 0 && (() => {
                    const picked = moreOptions.find((o) => o.value === singleTarget)
                    return (
                      <label
                        className={`relative inline-flex h-9 items-center rounded-full text-[13px] font-medium tracking-wide transition-all ${
                          picked
                            ? 'bg-violet/15 text-fg ring-1 ring-purple/70 shadow-[0_0_22px_-6px_rgba(168,85,247,0.9)]'
                            : 'text-fg-2 ring-1 ring-line hover:text-fg hover:ring-line-2'
                        }`}
                      >
                        <span className="sr-only">More output formats</span>
                        <select
                          value={picked ? singleTarget : ''}
                          onChange={(e) => e.target.value && setSingleTarget(e.target.value)}
                          className="h-full cursor-pointer rounded-full bg-transparent pr-8 pl-4 focus:outline-none"
                        >
                          <option value="">More</option>
                          {moreOptions.map((o) => (
                            <option key={o.value} value={o.value}>{o.label}  ·  {o.hint}</option>
                          ))}
                        </select>
                        <ChevronDown className="pointer-events-none absolute right-3 size-3.5 text-fg-3" />
                      </label>
                    )
                  })()}
                  {!singleOptions.length && <p className="text-sm text-fg-3">None of these files can be converted.</p>}
                </div>
              )}

              {mode === 'single' && skipped > 0 && (
                <p className="mt-3 flex items-start gap-1.5 text-xs text-warning">
                  <AlertTriangle className="mt-px size-3.5 shrink-0" />
                  {skipped} {skipped === 1 ? 'file' : 'files'} can’t become {labelOf(singleTarget, caps)} and will be skipped.{' '}
                  <button onClick={() => setMode('per_file')} className="underline underline-offset-2 hover:text-fg">Pick formats per file</button>
                </p>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Search, only useful for big batches */}
      {files.length > 6 && (
        <div className="mb-3 flex gap-2">
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
            className="w-36"
          />
        </div>
      )}

      {/* Files */}
      <ul className="max-h-[max(180px,calc(100svh-560px))] divide-y divide-line overflow-y-auto overscroll-contain rounded-2xl border border-line bg-black/20 light:bg-white/60" aria-label="Selected files">
        <AnimatePresence initial={false}>
          {visible.map((f) => {
            const st = statusByKey.get(f.key)
            const target = effectiveTarget(f)
            const options = targetsFor(f.format, caps)
            const info = conversionInfo(f.format, target, caps)
            const err = st?.error || f.issue
            const dim = !!f.issue || (!target && phase === 'select')
            return (
              <motion.li
                key={f.key}
                layout="position"
                initial={{ opacity: 0, y: -6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, x: 16, transition: { duration: 0.15 } }}
                className={`group flex items-center gap-3.5 px-4 py-3 transition-colors hover:bg-white/[0.025] light:hover:bg-black/[0.02] ${dim ? 'opacity-50' : ''}`}
              >
                <FileIcon category={categoryOf(f.format, caps)} ext={f.ext} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium" title={f.name}>{f.name}</p>
                  <p className="mt-0.5 truncate text-xs text-fg-3">
                    {bytes(f.size)}
                    {err ? (
                      <span className="text-danger"> · {err}</span>
                    ) : !target && phase === 'select' ? (
                      <span> · skipped</span>
                    ) : info?.quality === 'basic' && phase === 'select' ? (
                      <span className="text-warning" title={info.notes}> · simplified layout</span>
                    ) : null}
                  </p>
                </div>
                {!f.issue && (
                  <div className="flex shrink-0 items-center gap-2">
                    <ArrowRight className="hidden size-3.5 text-fg-3 sm:block" aria-hidden />
                    {mode === 'per_file' && phase === 'select' ? (
                      <Select
                        label={`Output format for ${f.name}`}
                        value={f.target}
                        onChange={(v) => setTarget(f.key, v)}
                        options={options.map((t) => ({ value: t, label: labelOf(t, caps) }))}
                        className="w-[104px]"
                      />
                    ) : target ? (
                      <span className="min-w-12 font-mono text-xs font-medium tracking-wider text-lavender">{labelOf(target, caps)}</span>
                    ) : null}
                  </div>
                )}
                <div className="grid w-8 shrink-0 place-items-center">
                  {st ? (
                    <StatusIcon status={st.status} />
                  ) : phase === 'select' ? (
                    <button
                      onClick={() => remove(f.key)}
                      className="grid size-8 place-items-center rounded-lg text-fg-3 transition-colors hover:bg-danger/10 hover:text-danger sm:opacity-0 sm:group-hover:opacity-100 sm:focus:opacity-100"
                      aria-label={`Remove ${f.name}`}
                    >
                      <X className="size-4" />
                    </button>
                  ) : null}
                </div>
              </motion.li>
            )
          })}
        </AnimatePresence>
        {!visible.length && <li className="py-8 text-center text-sm text-fg-3">No files match “{query}”.</li>}
      </ul>

      {/* Action / progress: pinned to the bottom of the screen so it is always reachable */}
      <div className="sticky bottom-0 z-10 -mx-5 mt-4 rounded-b-[28px] bg-gradient-to-t from-[#0a0910] from-70% to-transparent px-5 pt-3 pb-1 sm:-mx-7 sm:px-7 light:from-white">
        {busy ? (
          <OverallProgress phase={phase} batch={batch} uploadFraction={uploadFraction} count={submitted.length} onCancel={cancel} />
        ) : (
          <button
            onClick={convert}
            disabled={!ready.length}
            className="group/cta inline-flex h-[52px] w-full items-center justify-center gap-2 rounded-2xl bg-white text-[15px] font-semibold text-black shadow-[0_12px_40px_-12px_rgba(168,85,247,0.8)] transition-all hover:-translate-y-px hover:shadow-[0_16px_50px_-12px_rgba(168,85,247,0.95)] disabled:translate-y-0 disabled:opacity-40 disabled:shadow-none light:bg-[#0b0b12] light:text-white"
          >
            {ctaLabel}
            <ArrowRight className="size-4 transition-transform group-hover/cta:translate-x-0.5" />
          </button>
        )}
      </div>
    </Shell>
  )
}

function Shell({ children, innerRef }: { children: React.ReactNode; innerRef?: React.Ref<HTMLDivElement> }) {
  return (
    <div
      ref={innerRef}
      className="relative rounded-[28px] border border-white/[0.08] bg-[#0a0910]/80 p-5 shadow-[0_0_0_1px_rgba(168,85,247,0.06),0_40px_120px_-40px_rgba(124,58,237,0.55)] backdrop-blur-2xl sm:p-7 light:border-black/[0.08] light:bg-white/85"
    >
      <div className="pointer-events-none absolute inset-x-10 top-0 h-px bg-gradient-to-r from-transparent via-purple/70 to-transparent" aria-hidden />
      {children}
    </div>
  )
}

function StatusIcon({ status }: { status: string }) {
  const label = { uploading: 'Uploading', waiting: 'Waiting', converting: 'Converting', completed: 'Done', failed: 'Failed', skipped: 'Skipped', cancelled: 'Cancelled' }[status] ?? status
  let icon: React.ReactNode
  if (status === 'completed') icon = <Check className="size-4 text-success" strokeWidth={2.5} />
  else if (status === 'failed') icon = <XCircle className="size-4 text-danger" strokeWidth={1.75} />
  else if (status === 'converting' || status === 'uploading') icon = <Loader2 className="size-4 animate-spin text-lavender" strokeWidth={1.75} />
  else if (status === 'waiting') icon = <CircleDashed className="size-4 text-fg-3" strokeWidth={1.5} />
  else icon = <span className="text-xs text-fg-3">—</span>
  return <span title={label} role="img" aria-label={label}>{icon}</span>
}

function OverallProgress({
  phase, batch, uploadFraction, count, onCancel,
}: { phase: Phase; batch: Batch | null; uploadFraction: number; count: number; onCancel: () => void }) {
  const uploading = phase === 'uploading'
  const pct = uploading ? Math.round(uploadFraction * 100) : batch?.progress ?? 0
  const done = batch?.finished ?? 0
  const total = batch?.total ?? count
  return (
    <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="rounded-2xl border border-line p-5" aria-live="polite">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold">
            {uploading ? `Uploading ${count} ${count === 1 ? 'file' : 'files'}…` : `Converting · ${done} of ${total} done`}
          </p>
          <p className="mt-0.5 truncate text-xs text-fg-2">
            {uploading
              ? 'Sending your files securely'
              : batch?.current
                ? <>Now: <span className="text-fg">{batch.current}</span></>
                : 'Getting ready…'}
            {!uploading && batch && batch.counts.failed > 0 && <span className="text-danger"> · {batch.counts.failed} failed</span>}
            {!uploading && batch?.eta_seconds != null && <span> · ~{duration(batch.eta_seconds)} left</span>}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          <span className="text-2xl font-light tracking-tight text-fg tabular-nums">{pct}<span className="text-sm text-fg-3">%</span></span>
          <button onClick={onCancel} className="rounded-full px-3 py-1 text-xs font-medium text-fg-3 ring-1 ring-line transition-colors hover:text-danger hover:ring-danger/40">
            Cancel
          </button>
        </div>
      </div>
      <div className="h-[3px] rounded-full bg-line" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="Overall progress">
        <motion.div
          className="h-full rounded-full bg-gradient-to-r from-violet via-purple to-fuchsia-400 shadow-[0_0_14px_2px_rgba(168,85,247,0.7)]"
          initial={false}
          animate={{ width: `${Math.max(pct, 2)}%` }}
          transition={{ type: 'spring', stiffness: 120, damping: 24 }}
        />
      </div>
    </motion.div>
  )
}
