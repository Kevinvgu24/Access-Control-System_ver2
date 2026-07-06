import type { ButtonHTMLAttributes, ReactNode } from 'react'

interface BtnProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'ghost' | 'danger'
  size?: 'sm' | 'md'
  children: ReactNode
}

const v = {
  primary: 'bg-green text-white border-transparent hover:bg-green/95 active:scale-[0.98] transition-transform',
  ghost:   'bg-transparent border-line text-[#475569] hover:text-[#334155] hover:bg-slate-50',
  danger:  'bg-red text-white border-transparent hover:bg-red/95 active:scale-[0.98] transition-transform',
}
const sz = {
  sm: 'px-3 py-1.5 text-xs',
  md: 'px-4 py-2 text-sm',
}

export function Button({ variant = 'ghost', size = 'md', children, className = '', ...p }: BtnProps) {
  return (
    <button className={`inline-flex items-center gap-2 font-semibold border rounded cursor-pointer transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${v[variant]} ${sz[size]} ${className}`} {...p}>
      {children}
    </button>
  )
}
