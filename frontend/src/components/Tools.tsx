import { useEffect, useMemo, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import {
  ArrowDown, ArrowRight, ArrowUp, Combine, FileImage, FileOutput, FileSpreadsheet, FileText, Image as ImageIcon, ImageDown,
  Loader2, Minimize2, Scaling, Scissors, Sheet, X, type LucideIcon,
} from 'lucide-react'
import { deleteBatch, uploadBatch, type Batch, type Capabilities } from '../lib/api'
import { bytes, categoryOf, extOf, formatForName, labelOf } from '../lib/format'
import { history } from '../lib/storage'
import { isTerminal, useBatchPolling } from '../lib/useBatch'
import { DownloadCenter } from './DownloadCenter'
import { DropZone } from './DropZone'
import { FileIcon, Select, useToast } from './ui'

type OptionKind = 'split' | 'compress-pdf' | 'resize' | 'compress-img' | 'image-target' | 'pdf-image-target' | null

export interface ToolDef {
  id: string
  name: string
  desc: string
  icon: LucideIcon
  accepts: string[]
  run: { kind: 'tool'; tool: string } | { kind: 'convert'; target: string }
  options: OptionKind
  reorder?: boolean
}

const IMAGES = ['jpg', 'png', 'webp', 'bmp', 'tiff', 'gif']

export const GROUPS: { name: string; icon: LucideIcon; tools: ToolDef[] }[] = [
  {
    name: 'PDF Tools', icon: FileText,
    tools: [
      { id: 'merge', name: 'Merge PDF', desc: 'Combine several PDFs into one, in the order you choose.', icon: Combine, accepts: ['pdf'], run: { kind: 'tool', tool: 'merge-pdf' }, options: null, reorder: true },
      { id: 'split', name: 'Split PDF', desc: 'Split into single pages, page ranges, or extract selected pages.', icon: Scissors, accepts: ['pdf'], run: { kind: 'tool', tool: 'split-pdf' }, options: 'split' },
      { id: 'compress-pdf', name: 'Compress PDF', desc: 'Downsample images and strip unused data to shrink PDFs.', icon: Minimize2, accepts: ['pdf'], run: { kind: 'tool', tool: 'compress-pdf' }, options: 'compress-pdf' },
      { id: 'pdf-img', name: 'PDF to Image', desc: 'Render every page as a high-quality PNG, JPG or WEBP.', icon: FileImage, accepts: ['pdf'], run: { kind: 'convert', target: 'png' }, options: 'pdf-image-target' },
      { id: 'img-pdf', name: 'Image to PDF', desc: 'Turn images into a single PDF, one image per page.', icon: FileOutput, accepts: [...IMAGES, 'svg'], run: { kind: 'tool', tool: 'images-to-pdf' }, options: null, reorder: true },
    ],
  },
  {
    name: 'Image Tools', icon: ImageIcon,
    tools: [
      { id: 'resize', name: 'Resize Images', desc: 'Scale by percentage or fit to exact dimensions.', icon: Scaling, accepts: IMAGES, run: { kind: 'tool', tool: 'resize-images' }, options: 'resize' },
      { id: 'compress-img', name: 'Compress Images', desc: 'Reduce JPG, PNG and WEBP file size with adjustable quality.', icon: ImageDown, accepts: ['jpg', 'png', 'webp'], run: { kind: 'tool', tool: 'compress-images' }, options: 'compress-img' },
      { id: 'img-convert', name: 'Convert Image Formats', desc: 'Batch convert between JPG, PNG, WEBP, BMP, TIFF and GIF.', icon: ImageIcon, accepts: [...IMAGES, 'svg'], run: { kind: 'convert', target: 'webp' }, options: 'image-target' },
    ],
  },
  {
    name: 'Document Tools', icon: FileText,
    tools: [
      { id: 'docx-pdf', name: 'DOCX to PDF', desc: 'Pixel-faithful PDFs from Word documents via LibreOffice.', icon: FileText, accepts: ['docx'], run: { kind: 'convert', target: 'pdf' }, options: null },
      { id: 'pdf-docx', name: 'PDF to DOCX', desc: 'Reconstruct an editable Word document from a PDF.', icon: FileText, accepts: ['pdf'], run: { kind: 'convert', target: 'docx' }, options: null },
      { id: 'txt-pdf', name: 'TXT to PDF', desc: 'Typeset plain text files as clean A4 PDFs.', icon: FileText, accepts: ['txt'], run: { kind: 'convert', target: 'pdf' }, options: null },
    ],
  },
  {
    name: 'Spreadsheet Tools', icon: Sheet,
    tools: [
      { id: 'xlsx-csv', name: 'XLSX to CSV', desc: 'Export every sheet of a workbook to CSV.', icon: FileSpreadsheet, accepts: ['xlsx'], run: { kind: 'convert', target: 'csv' }, options: null },
      { id: 'csv-xlsx', name: 'CSV to XLSX', desc: 'Delimiter-aware import with numbers kept as numbers.', icon: FileSpreadsheet, accepts: ['csv'], run: { kind: 'convert', target: 'xlsx' }, options: null },
    ],
  },
]

export function toolEnabled(t: ToolDef, caps: Capabilities): boolean {
  if (t.run.kind === 'tool') return !!caps.tools[t.run.tool]
  const target = t.run.target
  return t.accepts.some((src) => caps.conversions.some((c) => c.src === src && c.dst === target))
}

interface ToolFile { key: string; file: File; format: string | null }

export function ToolRunner({ tool, caps, onClose, onHistoryChange }: { tool: ToolDef; caps: Capabilities; onClose: () => void; onHistoryChange: () => void }) {
  const toast = useToast()
  const [files, setFiles] = useState<ToolFile[]>([])
  const [busy, setBusy] = useState(false)
  const [upload, setUpload] = useState(0)
  const [created, setCreated] = useState<Batch | null>(null)
  const [token, setToken] = useState<string | null>(null)
  const recorded = useRef<string | null>(null)
  // options
  const [splitMode, setSplitMode] = useState('pages')
  const [ranges, setRanges] = useState('')
  const [level, setLevel] = useState('medium')
  const [resizeBy, setResizeBy] = useState<'percent' | 'size'>('percent')
  const [percent, setPercent] = useState(50)
  const [width, setWidth] = useState('')
  const [height, setHeight] = useState('')
  const [quality, setQuality] = useState(70)
  const [target, setTarget] = useState(tool.run.kind === 'convert' ? tool.run.target : '')

  const batch = useBatchPolling(created, token)
  const accept = useMemo(
    () => caps.formats.filter((f) => tool.accepts.includes(f.id)).flatMap((f) => f.extensions.map((e) => `.${e}`)).join(','),
    [caps, tool],
  )
  const minFiles = tool.run.kind === 'tool' ? caps.tools[tool.run.tool]?.min_files ?? 1 : 1

  const add = (list: File[]) => {
    const existing = new Set(files.map((f) => f.key))
    let rejected = 0
    const next: ToolFile[] = []
    for (const file of list) {
      const key = `${file.name}::${file.size}::${file.lastModified}`
      const format = formatForName(file.name, caps)
      if (!format || !tool.accepts.includes(format)) {
        rejected++
        continue
      }
      if (existing.has(key)) continue
      existing.add(key)
      next.push({ key, file, format })
    }
    if (rejected) toast('warning', `${rejected} ${rejected === 1 ? 'file isn’t' : 'files aren’t'} accepted by ${tool.name}.`)
    const room = caps.limits.max_files - files.length
    if (next.length > room) toast('warning', `Up to ${caps.limits.max_files} files per run.`)
    setFiles((f) => [...f, ...next.slice(0, Math.max(0, room))])
  }

  const move = (i: number, d: -1 | 1) =>
    setFiles((f) => {
      const j = i + d
      if (j < 0 || j >= f.length) return f
      const copy = [...f]
      ;[copy[i], copy[j]] = [copy[j], copy[i]]
      return copy
    })

  const targetOptions = useMemo(() => {
    if (tool.options === 'pdf-image-target') return ['png', 'jpg', 'webp'].filter((t) => caps.conversions.some((c) => c.src === 'pdf' && c.dst === t))
    if (tool.options === 'image-target') return IMAGES.filter((t) => caps.conversions.some((c) => c.dst === t && IMAGES.includes(c.src)))
    return []
  }, [tool, caps])

  const run = async () => {
    const form = new FormData()
    files.forEach((f) => form.append('files', f.file, f.file.name))
    let url: string
    if (tool.run.kind === 'convert') {
      url = '/api/conversions'
      // Per-file targets so files that can't reach the chosen format (e.g. a PNG -> PNG) are clearly skipped.
      form.append('targets', JSON.stringify(files.map((f) => (f.format === target ? '' : target))))
    } else {
      url = `/api/tools/${tool.run.tool}`
      const options: Record<string, unknown> = {}
      if (tool.options === 'split') Object.assign(options, { mode: splitMode, ranges })
      if (tool.options === 'compress-pdf') options.level = level
      if (tool.options === 'compress-img') options.quality = quality
      if (tool.options === 'resize') {
        if (resizeBy === 'percent') options.percent = percent
        else Object.assign(options, { width: width ? Number(width) : undefined, height: height ? Number(height) : undefined, keep_aspect: true })
      }
      form.append('options', JSON.stringify(options))
    }
    setBusy(true)
    setUpload(0)
    try {
      const b = await uploadBatch(url, form, setUpload)
      setToken(b.token!)
      setCreated(b)
    } catch (e) {
      toast('error', (e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const finished = batch && token && isTerminal(batch)
  useEffect(() => {
    if (!batch || !token || !isTerminal(batch) || recorded.current === batch.id) return
    recorded.current = batch.id
    history.add({
      id: batch.id, token, kind: tool.name, created_at: batch.created_at, expires_at: batch.expires_at,
      completed: batch.counts.completed, failed: batch.counts.failed + batch.counts.skipped, total: batch.tasks.length,
      outputs: batch.tasks.filter((t) => t.output).map((t) => ({ id: t.output!.id, filename: t.output!.filename, size: t.output!.size })),
    })
    onHistoryChange()
  }, [batch, token, tool.name, onHistoryChange])

  const reset = () => {
    setFiles([])
    setCreated(null)
    setToken(null)
  }

  const optionsInvalid =
    (tool.options === 'split' && splitMode !== 'pages' && !ranges.trim()) ||
    (tool.options === 'resize' && resizeBy === 'size' && !width && !height)

  return (
    <div className="relative rounded-[28px] border border-white/[0.08] bg-[#0a0910]/80 p-5 shadow-[0_0_0_1px_rgba(168,85,247,0.06),0_40px_120px_-40px_rgba(124,58,237,0.55)] backdrop-blur-2xl sm:p-7 light:border-black/[0.08] light:bg-white/85">
      <div className="pointer-events-none absolute inset-x-10 top-0 h-px bg-gradient-to-r from-transparent via-purple/70 to-transparent" aria-hidden />
      <div className="mb-6 flex items-start justify-between gap-4 border-b border-line pb-5">
        <div className="flex items-center gap-3">
          <span className="grid size-11 place-items-center rounded-xl bg-gradient-to-b from-white/[0.07] to-white/[0.015] text-lavender ring-1 ring-white/10 shadow-[0_0_24px_-8px_rgba(168,85,247,0.8)] light:from-black/[0.03] light:ring-black/10">
            <tool.icon className="size-5" strokeWidth={1.6} />
          </span>
          <div>
            <h3 className="text-xl font-semibold tracking-tight">{tool.name}</h3>
            <p className="mt-0.5 text-sm text-fg-3">{tool.desc}</p>
          </div>
        </div>
        <button onClick={onClose} className="grid size-9 shrink-0 place-items-center rounded-full border border-line text-fg-3 transition-colors hover:border-line-2 hover:text-fg" aria-label="Close tool">
          <X className="size-4" />
        </button>
      </div>

      {finished ? (
        <DownloadCenter
          batch={batch}
          token={token!}
          caps={caps}
          onConvertMore={reset}
          onClear={async () => {
            await deleteBatch(batch.id, token!).catch(() => {})
            history.remove(batch.id)
            onHistoryChange()
            reset()
          }}
        />
      ) : created && batch ? (
        <div className="rounded-2xl border border-line p-5" aria-live="polite">
          <div className="mb-3 flex items-center justify-between text-sm">
            <span className="flex items-center gap-2 font-medium"><Loader2 className="size-4 animate-spin text-lavender" /> {batch.current ? `Processing ${batch.current}` : 'Processing…'}</span>
            <span className="text-fg-2 tabular-nums">{batch.finished} / {batch.total}</span>
          </div>
          <div className="h-[3px] rounded-full bg-line">
            <motion.div className="h-full rounded-full bg-gradient-to-r from-violet via-purple to-fuchsia-400 shadow-[0_0_14px_2px_rgba(168,85,247,0.7)]" animate={{ width: `${Math.max(4, batch.progress)}%` }} />
          </div>
        </div>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[1fr_300px]">
          <div>
            {files.length === 0 ? (
              <div className="mx-auto max-w-[400px]">
                <DropZone orb onFiles={add} accept={accept} title={`Drop files for ${tool.name}`}>
                  {tool.accepts.map((a) => labelOf(a, caps)).join(' · ')}
                </DropZone>
              </div>
            ) : (
              <>
                <ul className="max-h-80 divide-y divide-line overflow-y-auto rounded-2xl border border-line bg-black/20 light:bg-white/60">
                  {files.map((f, i) => (
                    <li key={f.key} className="flex items-center gap-3 px-4 py-2.5">
                      {tool.reorder && <span className="w-5 text-center font-mono text-xs text-fg-3">{i + 1}</span>}
                      <FileIcon category={categoryOf(f.format, caps)} ext={extOf(f.file.name)} size="sm" />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm">{f.file.name}</p>
                        <p className="text-xs text-fg-3">{bytes(f.file.size)}</p>
                      </div>
                      {tool.reorder && (
                        <>
                          <button onClick={() => move(i, -1)} disabled={i === 0} className="grid size-7 place-items-center rounded-md text-fg-3 hover:bg-card-2 hover:text-fg disabled:opacity-30" aria-label={`Move ${f.file.name} up`}><ArrowUp className="size-3.5" /></button>
                          <button onClick={() => move(i, 1)} disabled={i === files.length - 1} className="grid size-7 place-items-center rounded-md text-fg-3 hover:bg-card-2 hover:text-fg disabled:opacity-30" aria-label={`Move ${f.file.name} down`}><ArrowDown className="size-3.5" /></button>
                        </>
                      )}
                      <button onClick={() => setFiles((x) => x.filter((y) => y.key !== f.key))} className="grid size-7 place-items-center rounded-md text-fg-3 hover:bg-danger/10 hover:text-danger" aria-label={`Remove ${f.file.name}`}><X className="size-3.5" /></button>
                    </li>
                  ))}
                </ul>
                <div className="mt-3"><DropZone onFiles={add} accept={accept} compact /></div>
              </>
            )}
          </div>
          <div className="flex flex-col gap-4 rounded-2xl border border-line p-5">
            <p className="text-[11px] font-medium tracking-[0.18em] text-fg-3 uppercase">Settings</p>
            <ToolOptions
              kind={tool.options}
              {...{ splitMode, setSplitMode, ranges, setRanges, level, setLevel, resizeBy, setResizeBy, percent, setPercent, width, setWidth, height, setHeight, quality, setQuality, target, setTarget, targetOptions, caps }}
            />
            <button
              onClick={run}
              disabled={busy || files.length < minFiles || optionsInvalid}
              className="mt-auto inline-flex h-12 items-center justify-center gap-2 rounded-2xl bg-white text-sm font-semibold text-black shadow-[0_12px_40px_-12px_rgba(168,85,247,0.8)] transition-all hover:-translate-y-px disabled:translate-y-0 disabled:opacity-40 disabled:shadow-none light:bg-[#0b0b12] light:text-white"
            >
              {busy ? <><Loader2 className="size-4 animate-spin" /> Uploading {Math.round(upload * 100)}%</> : <>Run {tool.name} <ArrowRight className="size-4" /></>}
            </button>
            {files.length < minFiles && <p className="-mt-2 text-center text-xs text-fg-3">Add at least {minFiles} {minFiles === 1 ? 'file' : 'files'}</p>}
          </div>
        </div>
      )}
    </div>
  )
}

/* eslint-disable @typescript-eslint/no-explicit-any */
function ToolOptions(p: any) {
  const label = 'mb-1.5 block text-xs font-medium tracking-wide text-fg-3 uppercase'
  const input = 'h-9 w-full rounded-lg border border-line bg-card-2 px-3 text-sm focus:border-violet focus:outline-none'
  switch (p.kind as OptionKind) {
    case 'split':
      return (
        <>
          <div>
            <span className={label}>Split mode</span>
            <Select label="Split mode" value={p.splitMode} onChange={p.setSplitMode} options={[
              { value: 'pages', label: 'Every page → separate PDF' },
              { value: 'ranges', label: 'Each range → separate PDF' },
              { value: 'extract', label: 'Extract pages → one PDF' },
            ]} />
          </div>
          {p.splitMode !== 'pages' && (
            <label>
              <span className={label}>Pages</span>
              <input className={input} value={p.ranges} onChange={(e) => p.setRanges(e.target.value)} placeholder="e.g. 1-3, 5, 8-" />
            </label>
          )}
        </>
      )
    case 'compress-pdf':
      return (
        <div>
          <span className={label}>Compression</span>
          <Select label="Compression level" value={p.level} onChange={p.setLevel} options={[
            { value: 'low', label: 'Light — best quality' },
            { value: 'medium', label: 'Balanced' },
            { value: 'high', label: 'Strong — smallest file' },
          ]} />
        </div>
      )
    case 'compress-img':
      return (
        <label>
          <span className={label}>Quality · {p.quality}</span>
          <input type="range" min={10} max={95} value={p.quality} onChange={(e) => p.setQuality(Number(e.target.value))} className="w-full accent-purple-400" />
          <span className="mt-1 block text-xs text-fg-3">PNG files are reduced to an optimised 256-colour palette.</span>
        </label>
      )
    case 'resize':
      return (
        <>
          <div>
            <span className={label}>Resize by</span>
            <Select label="Resize by" value={p.resizeBy} onChange={p.setResizeBy} options={[
              { value: 'percent', label: 'Percentage' },
              { value: 'size', label: 'Max width / height' },
            ]} />
          </div>
          {p.resizeBy === 'percent' ? (
            <label>
              <span className={label}>Scale · {p.percent}%</span>
              <input type="range" min={5} max={200} step={5} value={p.percent} onChange={(e) => p.setPercent(Number(e.target.value))} className="w-full accent-purple-400" />
            </label>
          ) : (
            <div className="grid grid-cols-2 gap-2">
              <label><span className={label}>Width</span><input className={input} inputMode="numeric" value={p.width} onChange={(e) => p.setWidth(e.target.value.replace(/\D/g, ''))} placeholder="px" /></label>
              <label><span className={label}>Height</span><input className={input} inputMode="numeric" value={p.height} onChange={(e) => p.setHeight(e.target.value.replace(/\D/g, ''))} placeholder="px" /></label>
              <p className="col-span-2 text-xs text-fg-3">Aspect ratio is preserved.</p>
            </div>
          )}
        </>
      )
    case 'image-target':
    case 'pdf-image-target':
      return (
        <div>
          <span className={label}>Output format</span>
          <Select label="Output format" value={p.target} onChange={p.setTarget} options={p.targetOptions.map((t: string) => ({ value: t, label: labelOf(t, p.caps) }))} />
          {p.kind === 'pdf-image-target' && <p className="mt-2 text-xs text-fg-3">One image per page at 150 DPI. Multi-page PDFs download as a ZIP.</p>}
        </div>
      )
    default:
      return <p className="text-sm text-fg-2">No settings needed. Add your files and run.</p>
  }
}
