import type { Capabilities, Category } from './api'

export function extOf(name: string): string {
  const i = name.lastIndexOf('.')
  return i > 0 ? name.slice(i + 1).toLowerCase() : ''
}

export function formatForName(name: string, caps: Capabilities): string | null {
  const ext = extOf(name)
  const f = caps.formats.find((f) => f.extensions.includes(ext))
  return f && caps.inputs.includes(f.id) ? f.id : null
}

export function targetsFor(fmt: string | null, caps: Capabilities): string[] {
  if (!fmt) return []
  return caps.conversions.filter((c) => c.src === fmt).map((c) => c.dst)
}

export function conversionInfo(src: string | null, dst: string | null, caps: Capabilities) {
  return caps.conversions.find((c) => c.src === src && c.dst === dst)
}

export function labelOf(fmt: string | null | undefined, caps: Capabilities | null): string {
  if (!fmt) return '—'
  return caps?.formats.find((f) => f.id === fmt)?.label ?? fmt.toUpperCase()
}

export function categoryOf(fmt: string | null, caps: Capabilities | null): Category | null {
  if (!fmt) return null
  return caps?.formats.find((f) => f.id === fmt)?.category ?? null
}

export function bytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(n < 10 * 1024 ? 1 : 0)} KB`
  if (n < 1024 ** 3) return `${(n / 1024 / 1024).toFixed(1)} MB`
  return `${(n / 1024 ** 3).toFixed(2)} GB`
}

export function duration(s: number): string {
  if (s < 60) return `${Math.max(1, Math.round(s))}s`
  const m = Math.floor(s / 60)
  return `${m}m ${Math.round(s % 60)}s`
}

export const CATEGORY_LABEL: Record<Category, string> = {
  document: 'Documents',
  presentation: 'Presentations',
  spreadsheet: 'Spreadsheets',
  image: 'Images',
  pdf: 'PDF',
  data: 'Data & structured',
  archive: 'Archives',
}

export const CATEGORY_ORDER: Category[] = ['document', 'presentation', 'spreadsheet', 'image', 'pdf', 'data']
