import { createContext, useCallback, useContext, useState, type ReactNode } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import {
  AlertTriangle, CheckCircle2, ChevronDown, File, FileArchive, FileCode2, FileImage, FileSpreadsheet,
  FileText, Info, Presentation, X,
} from 'lucide-react'
import type { Category } from '../lib/api'

export function Logo({ className = '' }: { className?: string }) {
  return (
    <a href="#top" className={`flex items-center gap-2.5 font-semibold tracking-tight ${className}`} aria-label="SNIPEX home">
      <svg viewBox="0 0 32 32" className="size-7 shrink-0" aria-hidden>
        <defs>
          <linearGradient id="logo-g" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#A855F7" />
            <stop offset="1" stopColor="#7C3AED" />
          </linearGradient>
        </defs>
        <rect width="32" height="32" rx="8" fill="url(#logo-g)" />
        <path d="M10 20.5c1.2 1.3 3 2 5.3 2 3 0 4.7-1.4 4.7-3.4 0-4.4-9.4-2.6-9.4-7 0-2 1.8-3.6 4.6-3.6 2 0 3.6.6 4.7 1.8"
          fill="none" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" />
      </svg>
      <span className="text-[15px] tracking-[0.14em]">SNIPEX</span>
    </a>
  )
}

const CATEGORY_STYLE: Record<string, { icon: typeof File; tint: string }> = {
  document: { icon: FileText, tint: 'text-sky-400 bg-sky-400/10 ring-sky-400/20' },
  presentation: { icon: Presentation, tint: 'text-orange-400 bg-orange-400/10 ring-orange-400/20' },
  spreadsheet: { icon: FileSpreadsheet, tint: 'text-emerald-400 bg-emerald-400/10 ring-emerald-400/20' },
  image: { icon: FileImage, tint: 'text-pink-400 bg-pink-400/10 ring-pink-400/20' },
  pdf: { icon: FileText, tint: 'text-rose-400 bg-rose-400/10 ring-rose-400/20' },
  data: { icon: FileCode2, tint: 'text-amber-400 bg-amber-400/10 ring-amber-400/20' },
  archive: { icon: FileArchive, tint: 'text-lavender bg-violet/10 ring-violet/20' },
}

export function FileIcon({ category, ext, size = 'md' }: { category: Category | null; ext: string; size?: 'sm' | 'md' }) {
  const style = (category && CATEGORY_STYLE[category]) || { icon: File, tint: 'text-fg-3 bg-fg-3/10 ring-fg-3/20' }
  const Icon = style.icon
  const box = size === 'sm' ? 'size-8 rounded-lg' : 'size-10 rounded-xl'
  return (
    <div className={`relative grid shrink-0 place-items-center ring-1 ${box} ${style.tint}`} aria-hidden>
      <Icon className={size === 'sm' ? 'size-4' : 'size-[18px]'} strokeWidth={1.75} />
      {ext && size === 'md' && (
        <span className="absolute -bottom-1.5 left-1/2 -translate-x-1/2 rounded bg-bg px-1 font-mono text-[8.5px] leading-[13px] tracking-wide uppercase ring-1 ring-line">
          {ext.slice(0, 4)}
        </span>
      )}
    </div>
  )
}

export function Select({
  value, onChange, options, label, className = '', disabled, placeholder,
}: {
  value: string
  onChange: (v: string) => void
  options: { value: string; label: string; hint?: string; disabled?: boolean }[]
  label: string
  className?: string
  disabled?: boolean
  placeholder?: string
}) {
  return (
    <div className={`relative ${className}`}>
      <select
        aria-label={label}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        className="h-9 w-full cursor-pointer rounded-lg border border-line bg-card-2 pr-8 pl-3 text-sm font-medium text-fg transition-colors hover:border-line-2 focus:border-violet focus:outline-none disabled:cursor-not-allowed disabled:opacity-50"
      >
        {placeholder && <option value="">{placeholder}</option>}
        {options.map((o) => (
          <option key={o.value} value={o.value} disabled={o.disabled}>
            {o.label}{o.hint ? `  ·  ${o.hint}` : ''}
          </option>
        ))}
      </select>
      <ChevronDown className="pointer-events-none absolute top-1/2 right-2.5 size-4 -translate-y-1/2 text-fg-3" />
    </div>
  )
}

export function SectionHeading({ eyebrow, title, sub }: { eyebrow: string; title: ReactNode; sub?: string }) {
  return (
    <div className="mx-auto mb-12 max-w-2xl text-center">
      <p className="mb-3 text-xs font-semibold tracking-[0.2em] text-lavender uppercase">{eyebrow}</p>
      <h2 className="text-3xl font-semibold tracking-tight text-balance sm:text-4xl">{title}</h2>
      {sub && <p className="mt-4 text-base text-pretty text-fg-2">{sub}</p>}
    </div>
  )
}

// ---- Toasts -------------------------------------------------------------------------------

type ToastKind = 'success' | 'error' | 'info' | 'warning'
interface Toast { id: number; kind: ToastKind; message: string }
const ToastCtx = createContext<(kind: ToastKind, message: string) => void>(() => {})

export const useToast = () => useContext(ToastCtx)

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])
  const push = useCallback((kind: ToastKind, message: string) => {
    const id = Date.now() + Math.random()
    setToasts((t) => [...t.slice(-3), { id, kind, message }])
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === 'error' ? 7000 : 4500)
  }, [])
  const icons = { success: CheckCircle2, error: AlertTriangle, warning: AlertTriangle, info: Info }
  const colors = { success: 'text-success', error: 'text-danger', warning: 'text-warning', info: 'text-lavender' }
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="pointer-events-none fixed inset-x-4 bottom-4 z-[100] flex flex-col items-center gap-2 sm:inset-x-auto sm:right-5 sm:bottom-5 sm:items-end" role="status" aria-live="polite">
        <AnimatePresence initial={false}>
          {toasts.map((t) => {
            const Icon = icons[t.kind]
            return (
              <motion.div
                key={t.id}
                layout
                initial={{ opacity: 0, y: 16, scale: 0.96 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, x: 24, transition: { duration: 0.15 } }}
                className="glass pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-xl border border-line p-3.5 pr-2.5 shadow-2xl shadow-black/30"
              >
                <Icon className={`mt-0.5 size-4 shrink-0 ${colors[t.kind]}`} />
                <p className="flex-1 text-sm text-fg">{t.message}</p>
                <button onClick={() => setToasts((x) => x.filter((y) => y.id !== t.id))} className="rounded p-0.5 text-fg-3 hover:text-fg" aria-label="Dismiss notification">
                  <X className="size-4" />
                </button>
              </motion.div>
            )
          })}
        </AnimatePresence>
      </div>
    </ToastCtx.Provider>
  )
}
