import { useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { AlertTriangle, FileText, Image as ImageIcon, LayoutGrid, Lock, RefreshCw } from 'lucide-react'
import type { Capabilities } from '../lib/api'
import { Converter } from './Converter'
import { Logo } from './ui'

const GITHUB_URL = 'https://github.com/ganesh-tadigadapa/Snipex'

function LetterGlyph({ letter }: { letter: string }) {
  return (
    <span className="grid size-[22px] place-items-center rounded-[5px] border-[1.6px] border-current text-[11px] leading-none font-bold" aria-hidden>
      {letter}
    </span>
  )
}

const TILES = [
  { label: 'PDF', icon: <FileText className="size-[22px]" strokeWidth={1.6} /> },
  { label: 'DOCX', icon: <LetterGlyph letter="W" /> },
  { label: 'PPTX', icon: <LetterGlyph letter="P" /> },
  { label: 'XLSX', icon: <LetterGlyph letter="X" /> },
  { label: 'JPG', icon: <ImageIcon className="size-[22px]" strokeWidth={1.6} /> },
]

export function GithubMark({ className = 'size-[18px]' }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" className={className} fill="currentColor" aria-hidden>
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
    </svg>
  )
}

interface Props {
  caps: Capabilities | null
  error: string | null
  onRetry: () => void
  onHistoryChange: () => void
}

export function Hero({ caps, error, onRetry, onHistoryChange }: Props) {
  const [active, setActive] = useState(false)

  return (
    <section id="convert" className="relative px-3 pt-20 pb-10 sm:px-6 sm:pt-24">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-[900px] ambient opacity-60" aria-hidden />
      <div className="hero-frame relative mx-auto max-w-7xl overflow-hidden rounded-[28px] border border-line sm:rounded-[36px]">
        {/* Brand */}
        <div className="flex justify-center pt-8 sm:pt-10">
          <Logo size="lg" />
        </div>

        <div
          className={`grid items-center gap-10 px-4 pt-8 pb-12 sm:px-10 lg:gap-6 lg:px-14 ${
            active ? 'grid-cols-1' : 'lg:grid-cols-[1fr_1.05fr] lg:pt-4 lg:pb-16'
          }`}
        >
          {/* Copy */}
          <motion.div
            layout="position"
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
            className={active ? 'text-center' : 'text-center lg:order-2 lg:pl-6 lg:text-left'}
          >
            {!active && (
              <a
                href="#faq"
                className="inline-flex items-center gap-2.5 rounded-full border border-line-2 bg-card/50 px-4 py-2 text-[13px] text-fg-2 backdrop-blur transition-colors hover:border-violet/50 hover:text-fg sm:text-sm"
              >
                <Lock className="size-3.5 text-fg" strokeWidth={2.2} /> Your files are private &amp; auto-deleted
              </a>
            )}
            <h1
              className={`font-bold tracking-[-0.04em] ${
                active ? 'text-3xl leading-tight sm:text-4xl' : 'mt-7 text-[46px] leading-[1.02] sm:text-7xl lg:text-[84px]'
              }`}
            >
              Convert Files{active ? ' ' : <br />}
              <span className="text-gradient-hero">Effortlessly.</span>
            </h1>
            <AnimatePresence initial={false}>
              {!active && (
                <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, height: 0 }}>
                  <p className="mx-auto mt-6 max-w-xl text-base leading-relaxed text-fg-2 sm:text-lg lg:mx-0">
                    Documents, presentations, spreadsheets, images and more.
                    <br className="hidden sm:block" /> Convert multiple files in one go.
                  </p>
                  <div className="mt-9 flex flex-wrap justify-center gap-2.5 sm:gap-3 lg:justify-start xl:flex-nowrap">
                    {TILES.map((t, i) => (
                      <motion.a
                        key={t.label}
                        href="#formats"
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: 0.25 + i * 0.05 }}
                        className="format-tile flex size-[70px] flex-col items-center justify-center gap-2 rounded-2xl text-fg sm:size-[78px]"
                        aria-label={`${t.label} conversions`}
                      >
                        {t.icon}
                        <span className="text-[12px] font-medium tracking-wide text-fg-2 sm:text-[13px]">{t.label}</span>
                      </motion.a>
                    ))}
                    <motion.a
                      href="#formats"
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: 0.25 + TILES.length * 0.05 }}
                      className="format-tile flex size-[70px] flex-col items-center justify-center gap-2 rounded-2xl text-fg sm:size-[78px]"
                    >
                      <LayoutGrid className="size-[20px]" strokeWidth={1.6} />
                      <span className="text-[12px] font-medium text-fg-2 sm:text-[13px]">+ More</span>
                    </motion.a>
                  </div>
                  {caps && (
                    <p className="mt-7 text-[13px] text-fg-3">
                      {caps.conversions.length} tested conversion routes <span className="mx-1.5">·</span> No sign-up{' '}
                      <span className="mx-1.5">·</span> Deleted after {caps.limits.retention_minutes} min
                    </p>
                  )}
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>

          {/* Converter */}
          <motion.div
            layout="position"
            initial={{ opacity: 0, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.7, delay: 0.1 }}
            className={active ? 'mx-auto w-full max-w-4xl' : 'lg:order-1'}
          >
            {caps ? (
              <Converter caps={caps} onHistoryChange={onHistoryChange} onActiveChange={setActive} />
            ) : error ? (
              <div className="mx-auto max-w-md rounded-[28px] border border-danger/30 bg-card/80 p-10 text-center">
                <AlertTriangle className="mx-auto mb-3 size-8 text-danger" />
                <p className="font-semibold">{error}</p>
                <p className="mt-1 text-sm text-fg-2">Make sure the SNIPEX API is running, then try again.</p>
                <button onClick={onRetry} className="mt-5 inline-flex h-10 items-center gap-2 rounded-xl border border-line bg-card-2 px-4 text-sm font-medium hover:border-line-2">
                  <RefreshCw className="size-4" /> Retry
                </button>
              </div>
            ) : (
              <div className="mx-auto aspect-square w-full max-w-[540px] p-[7%]" aria-busy="true" aria-label="Loading converter">
                <div className="skeleton size-full rounded-full" />
              </div>
            )}
          </motion.div>
        </div>

        {/* Frame footer */}
        <div className="flex flex-col items-center justify-between gap-4 border-t border-line px-6 py-5 text-sm sm:flex-row sm:px-10">
          <p className="flex items-center gap-3">
            <span className="font-semibold tracking-[0.14em]">SNIPEX</span>
            <span className="text-fg-3">v1.0.0</span>
          </p>
          <nav className="flex items-center gap-7 text-fg-2" aria-label="Hero footer">
            <a href="#formats" className="transition-colors hover:text-fg">Supported Formats</a>
            <a href="#faq" className="transition-colors hover:text-fg">Privacy</a>
            <a href={GITHUB_URL} target="_blank" rel="noreferrer" className="flex items-center gap-2 transition-colors hover:text-fg">
              <GithubMark /> GitHub
            </a>
          </nav>
        </div>
      </div>
    </section>
  )
}
