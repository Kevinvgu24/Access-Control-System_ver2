import { useState } from 'react'
import { useAuthStore } from '@/store/authStore'

export function LoginPage() {
  const { signIn, loading, error } = useAuthStore()
  const [email, setEmail]       = useState('')
  const [password, setPassword] = useState('')

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    signIn(email, password)
  }

  return (
    <div className="min-h-screen bg-dark flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        {/* Logo */}
        <div className="mb-10 text-center">
          <div className="flex items-center justify-center gap-2 mb-4">
            <span className="blink w-2 h-2 rounded-full bg-green shrink-0" />
            <span className="font-mono text-[11px] tracking-widest uppercase text-green">Secure Access</span>
          </div>
          <h1 className="text-3xl font-bold tracking-tight text-[#0f172a]">Smart Lab</h1>
          <p className="font-mono text-[11px] text-[#94a3b8] mt-1">Access Control Dashboard</p>
        </div>

        {/* Form */}
        <form onSubmit={submit} className="bg-surface border border-line rounded-lg p-7 flex flex-col gap-5">
          <div className="flex flex-col gap-1.5">
            <label className="font-mono text-[11px] uppercase tracking-widest text-[#475569]">Email</label>
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="admin@lab.edu"
              required
              autoFocus
              className="bg-raised border border-line rounded px-4 py-2.5 text-sm text-[#0f172a] placeholder:text-[#cbd5e1] outline-none focus:border-[#ea580c]/50 transition-colors"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="font-mono text-[11px] uppercase tracking-widest text-[#475569]">Password</label>
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="••••••••"
              required
              className="bg-raised border border-line rounded px-4 py-2.5 text-sm text-[#0f172a] placeholder:text-[#cbd5e1] outline-none focus:border-[#ea580c]/50 transition-colors"
            />
          </div>

          {error && (
            <p className="font-mono text-[11px] text-red bg-red/5 border border-red/20 rounded px-3 py-2">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="bg-green text-white hover:bg-green/95 active:scale-[0.98] transition-transform font-semibold text-sm px-4 py-2.5 rounded cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed mt-1"
          >
            {loading ? 'Signing in...' : 'Sign in'}
          </button>
        </form>

        <p className="font-mono text-[10px] text-[#94a3b8] uppercase tracking-wider text-center mt-6">
          Admin access only
        </p>
      </div>
    </div>
  )
}
