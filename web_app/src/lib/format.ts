import type { AccessResult, NodeOnlineState, AccessMethod } from '@/types/admin'

type Tone = 'green' | 'red' | 'amber' | 'blue' | 'neutral'

export function resultLabel(r: AccessResult): string {
  if (!r) return 'Unknown'
  const m: Record<AccessResult, string> = {
    granted:         'Granted',
    denied:          'Denied',
    unknown_user:    'Unknown',
    liveness_failed: 'Liveness Fail',
    pin_failed:      'PIN Failed',
    system_error:    'System Error',
  }
  return m[r] ?? String(r)
}

export function resultTone(r: AccessResult): Tone {
  if (!r) return 'neutral'
  const m: Record<AccessResult, Tone> = {
    granted:         'green',
    denied:          'red',
    unknown_user:    'neutral',
    liveness_failed: 'amber',
    pin_failed:      'red',
    system_error:    'neutral',
  }
  return m[r] ?? 'neutral'
}

export function onlineTone(s: NodeOnlineState): 'green' | 'amber' | 'red' {
  return s === 'online' ? 'green' : s === 'grace_period' ? 'amber' : 'red'
}

export function fmtMethod(m: AccessMethod): string {
  return m === 'face' ? 'Face ID' : 'Face + PIN'
}

export function fmtConf(v: number | string | null | undefined): string {
  if (v == null) return 'N/A'
  const num = Number(v)
  if (isNaN(num)) return 'N/A'
  return `${num.toFixed(1)}%`
}

export function fmtTs(ts: any): string {
  if (!ts) return '-'
  if (typeof ts.toDate === 'function') {
    try { return ts.toDate().toLocaleString('sv-SE').replace('T', ' ').slice(0, 16) } catch { return '-' }
  }
  if (ts instanceof Date) {
    try { return ts.toLocaleString('sv-SE').replace('T', ' ').slice(0, 16) } catch { return '-' }
  }
  try {
    const d = new Date(ts)
    if (!isNaN(d.getTime())) {
      return d.toLocaleString('sv-SE').replace('T', ' ').slice(0, 16)
    }
  } catch {
    // fallback
  }
  return String(ts).slice(0, 16)
}
