import { useRef, useState, type ReactNode } from 'react'
import { motion } from 'framer-motion'
import { FileUp, Plus, Upload, UploadCloud } from 'lucide-react'

interface Props {
  onFiles: (files: File[]) => void
  accept?: string
  compact?: boolean
  orb?: boolean
  disabled?: boolean
  children?: ReactNode
  title?: string
  subtitle?: ReactNode
}

/** Multi-file drag & drop zone backed by a native <input type="file" multiple>. */
export function DropZone({ onFiles, accept, compact, orb, disabled, children, title, subtitle }: Props) {
  const input = useRef<HTMLInputElement>(null)
  const [over, setOver] = useState(false)
  const depth = useRef(0)

  const open = () => !disabled && input.current?.click()

  const handle = (list: FileList | null) => {
    if (!list || disabled) return
    const files = Array.from(list).filter((f) => f.size > 0 || f.type !== '' || f.name.includes('.'))
    if (files.length) onFiles(files)
  }

  const events = {
    onDragEnter: (e: React.DragEvent) => {
      e.preventDefault()
      depth.current += 1
      if (!disabled) setOver(true)
    },
    onDragOver: (e: React.DragEvent) => {
      e.preventDefault()
      e.dataTransfer.dropEffect = disabled ? 'none' : 'copy'
    },
    onDragLeave: (e: React.DragEvent) => {
      e.preventDefault()
      depth.current -= 1
      if (depth.current <= 0) setOver(false)
    },
    onDrop: (e: React.DragEvent) => {
      e.preventDefault()
      depth.current = 0
      setOver(false)
      handle(e.dataTransfer.files)
    },
  }

  const inputEl = (
    <input
      ref={input}
      type="file"
      multiple
      accept={accept}
      className="sr-only"
      tabIndex={-1}
      aria-hidden
      onChange={(e) => {
        handle(e.target.files)
        e.target.value = '' // allow selecting the same files again after removing them
      }}
    />
  )

  if (orb) {
    return (
      <div {...events} className="relative mx-auto aspect-square w-full max-w-[min(540px,62svh)]">
        {inputEl}
        <div className="orb-haze" aria-hidden />
        <div className="orb-streak orb-streak-a" aria-hidden />
        <div className="orb-streak orb-streak-b" aria-hidden />
        <div className="orb-streak orb-streak-c" aria-hidden />
        <motion.div
          role="button"
          tabIndex={disabled ? -1 : 0}
          aria-label="Upload files: drop files here or press Enter to browse"
          onClick={open}
          onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), open())}
          animate={{ scale: over ? 1.035 : 1 }}
          transition={{ type: 'spring', stiffness: 260, damping: 24 }}
          className={`orb-ring group absolute inset-[7%] grid cursor-pointer place-items-center rounded-full text-center ${over ? 'is-over' : ''}`}
        >
          <div className="px-8">
            <motion.div
              animate={over ? { y: -8, scale: 1.08 } : { y: [0, -6, 0] }}
              transition={over ? { type: 'spring', stiffness: 300 } : { duration: 4.5, repeat: Infinity, ease: 'easeInOut' }}
              className="mx-auto w-fit"
            >
              <FileUp className="size-14 text-[#C4B5FD] drop-shadow-[0_0_18px_rgba(168,85,247,0.55)]" strokeWidth={1.4} />
            </motion.div>
            <p className="mt-6 text-lg font-semibold tracking-tight sm:text-[22px]">{over ? 'Release to add your files' : title ?? 'Drag and drop your files here'}</p>
            <p className="mt-1.5 text-sm text-fg-2 sm:text-base">{subtitle ?? 'or click to browse files'}</p>
            <span className="mt-7 inline-flex h-12 items-center gap-2.5 rounded-xl bg-white px-6 text-[15px] font-semibold text-black shadow-[0_10px_40px_-8px_rgba(168,85,247,0.7)] transition-transform group-hover:-translate-y-0.5 light:bg-[#0b0b12] light:text-white">
              <Upload className="size-[18px]" strokeWidth={2.2} /> Upload Files
            </span>
            {children && <div className="mt-6 text-xs text-fg-2 sm:text-[13px]">{children}</div>}
          </div>
        </motion.div>
      </div>
    )
  }

  if (compact) {
    return (
      <div {...events} className={`rounded-xl transition-colors ${over ? 'bg-violet/10 ring-1 ring-violet/50' : ''}`}>
        {inputEl}
        <button
          type="button"
          onClick={open}
          disabled={disabled}
          className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-line bg-card-2 px-3 text-sm font-medium text-fg transition-colors hover:border-line-2 hover:bg-card disabled:opacity-50"
        >
          <Plus className="size-4" /> Add files
        </button>
        {children}
      </div>
    )
  }

  return (
    <motion.div
      {...(events as object)}
      role="button"
      tabIndex={disabled ? -1 : 0}
      aria-label="Upload files: drop files here or press Enter to browse"
      onClick={open}
      onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), open())}
      animate={{ scale: over ? 1.01 : 1 }}
      transition={{ type: 'spring', stiffness: 400, damping: 30 }}
      className={`dashed-zone group relative flex cursor-pointer flex-col items-center justify-center overflow-hidden rounded-[20px] px-6 text-center transition-colors ${
        over ? 'bg-violet/[0.09]' : 'bg-bg-2/40 hover:bg-violet/[0.045]'
      } ${disabled ? 'pointer-events-none opacity-60' : ''} py-12 sm:py-14`}
    >
      {inputEl}
      <div className={`pointer-events-none absolute inset-0 transition-opacity duration-300 ${over ? 'opacity-100' : 'opacity-0'}`}
        style={{ background: 'radial-gradient(50% 60% at 50% 50%, rgba(124,58,237,0.16), transparent 70%)' }} />
      <motion.div
        animate={over ? { y: -4, scale: 1.06 } : { y: 0, scale: 1 }}
        className="relative mb-5 grid size-14 place-items-center rounded-2xl bg-gradient-to-b from-purple/25 to-violet/10 ring-1 ring-violet/40"
      >
        <UploadCloud className="size-6 text-lavender" strokeWidth={1.75} />
      </motion.div>
      <p className="relative text-lg font-semibold tracking-tight">{over ? 'Release to add your files' : title ?? 'Drop your files here'}</p>
      <div className="relative mt-1.5 text-sm text-fg-2">{subtitle}</div>
      <span className="btn-primary relative mt-6 inline-flex h-10 items-center rounded-xl px-5 text-sm font-semibold">
        Browse files
      </span>
      {children}
    </motion.div>
  )
}
