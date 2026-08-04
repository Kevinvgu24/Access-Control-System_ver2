import type { ReactNode } from 'react'

interface PanelProps { children: ReactNode; className?: string; pad?: boolean }

export function Panel({ children, className = '', pad = true }: PanelProps) {
  return (
    <div className={`bg-surface border border-line rounded-lg ${pad ? 'p-6' : ''} ${className}`}>
      {children}
    </div>
  )
}

export function PanelHeader({ eyebrow, title, action }: { eyebrow?: string; title: string; action?: ReactNode }) {
  return (
    <div className="flex justify-between items-start mb-5">
      <div>
        {eyebrow && <p className="font-mono text-[11px] uppercase tracking-widest text-orange-600 font-extrabold mb-1">{eyebrow}</p>}
        <h2 className="text-base font-extrabold text-orange-600 tracking-tight">{title}</h2>
      </div>
      {action}
    </div>
  )
}
