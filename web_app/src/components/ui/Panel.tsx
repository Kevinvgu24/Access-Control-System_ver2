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
        {eyebrow && <p className="font-mono text-[10px] uppercase tracking-widest text-[#94a3b8] mb-1">{eyebrow}</p>}
        <h2 className="text-[15px] font-semibold text-[#0f172a]">{title}</h2>
      </div>
      {action}
    </div>
  )
}
