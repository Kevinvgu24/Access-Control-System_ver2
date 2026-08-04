import { useState, useEffect, useMemo } from 'react'
import { useAdminStore } from '@/store/adminStore'
import { useLabStore } from '@/store/labStore'

// ─── Types ───────────────────────────────────────────────────────────────────

interface ScheduleRecord {
  id: number
  student_id: string
  student_name: string
  group_nr: string
  date: string
  day_of_week: string
  session_num: string
  experiment: string
}

interface ScheduleFile {
  filename: string
  labId: string
  labName: string
}

export type NotifType = 'login' | 'denied' | 'enrollment' | 'schedule_soon' | 'schedule_today'

export interface Notification {
  id: string
  type: NotifType
  title: string
  body: string
  time: string | null
  unread: boolean
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function timeAgo(isoOrTs: string | null): string {
  if (!isoOrTs) return ''
  const d = new Date(isoOrTs)
  if (isNaN(d.getTime())) return ''
  const diff = Date.now() - d.getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'Just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.floor(hrs / 24)}d ago`
}

function isRecent(isoOrTs: string | null, withinMs: number): boolean {
  if (!isoOrTs) return false
  const d = new Date(isoOrTs)
  if (isNaN(d.getTime())) return false
  return Date.now() - d.getTime() < withinMs
}

function scheduleToday(dateStr: string): boolean {
  if (!dateStr) return false
  try {
    const today = new Date()
    let d: Date
    if (dateStr.includes('/')) {
      const parts = dateStr.split('/')
      d = new Date(`${parts[2]}-${parts[1]}-${parts[0]}`)
    } else {
      d = new Date(dateStr)
    }
    return (
      d.getFullYear() === today.getFullYear() &&
      d.getMonth() === today.getMonth() &&
      d.getDate() === today.getDate()
    )
  } catch { return false }
}

function scheduleTomorrow(dateStr: string): boolean {
  if (!dateStr) return false
  try {
    const tomorrow = new Date()
    tomorrow.setDate(tomorrow.getDate() + 1)
    let d: Date
    if (dateStr.includes('/')) {
      const parts = dateStr.split('/')
      d = new Date(`${parts[2]}-${parts[1]}-${parts[0]}`)
    } else {
      d = new Date(dateStr)
    }
    return (
      d.getFullYear() === tomorrow.getFullYear() &&
      d.getMonth() === tomorrow.getMonth() &&
      d.getDate() === tomorrow.getDate()
    )
  } catch { return false }
}

function resolveTs(ts: unknown): string | null {
  if (!ts) return null
  if (typeof ts === 'string') return ts
  if (ts instanceof Date) return ts.toISOString()
  if (typeof ts === 'number') {
    return new Date(ts < 1e11 ? ts * 1000 : ts).toISOString()
  }
  if (typeof ts === 'object' && ts !== null) {
    if (typeof (ts as any).toDate === 'function') {
      try { return (ts as any).toDate().toISOString() } catch { return null }
    }
    if ('seconds' in ts && typeof (ts as any).seconds === 'number') {
      return new Date((ts as any).seconds * 1000).toISOString()
    }
  }
  return null
}

// ─── Icon SVGs ────────────────────────────────────────────────────────────────

function IconLogin() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4" />
      <polyline points="10 17 15 12 10 7" />
      <line x1="15" y1="12" x2="3" y2="12" />
    </svg>
  )
}

function IconDenied() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <line x1="15" y1="9" x2="9" y2="15" />
      <line x1="9" y1="9" x2="15" y2="15" />
    </svg>
  )
}

function IconEnroll() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
      <line x1="12" y1="17" x2="12" y2="23" />
      <line x1="9" y1="20" x2="15" y2="20" />
    </svg>
  )
}

function IconSchedule() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
      <line x1="16" y1="2" x2="16" y2="6" />
      <line x1="8" y1="2" x2="8" y2="6" />
      <line x1="3" y1="10" x2="21" y2="10" />
    </svg>
  )
}

// ─── Type config ──────────────────────────────────────────────────────────────

const typeConfig: Record<NotifType, {
  icon: React.ReactNode
  bg: string
  iconColor: string
  border: string
}> = {
  login:          { icon: <IconLogin />,    bg: 'bg-green/10',   iconColor: 'text-green',       border: 'border-green/20'    },
  denied:         { icon: <IconDenied />,   bg: 'bg-red/10',     iconColor: 'text-red',         border: 'border-red/20'      },
  enrollment:     { icon: <IconEnroll />,   bg: 'bg-blue/10',    iconColor: 'text-blue',        border: 'border-blue/20'     },
  schedule_today: { icon: <IconSchedule />, bg: 'bg-amber/10',   iconColor: 'text-amber',       border: 'border-amber/20'    },
  schedule_soon:  { icon: <IconSchedule />, bg: 'bg-orange-50',  iconColor: 'text-orange-500',  border: 'border-orange-200'  },
}

// ─── Filter labels (English) ──────────────────────────────────────────────────

const filterLabels: { key: NotifType | 'all'; label: string }[] = [
  { key: 'all',            label: 'All'           },
  { key: 'login',          label: 'Logins'        },
  { key: 'denied',         label: 'Denied'        },
  { key: 'enrollment',     label: 'Registrations' },
  { key: 'schedule_today', label: 'Today'         },
  { key: 'schedule_soon',  label: 'Upcoming'      },
]

// ─── Main Component ───────────────────────────────────────────────────────────

export function NotificationPanel() {
  const { events = [], users = [] } = useAdminStore()
  const { selectedLabId } = useLabStore()

  const [upcomingSchedules, setUpcomingSchedules] = useState<ScheduleRecord[]>([])
  const [readIds, setReadIds] = useState<Set<string>>(new Set())
  const [filter, setFilter] = useState<NotifType | 'all'>('all')

  // Load schedule files & fetch today/tomorrow schedules safely
  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const res = await fetch('/api/schedules/files')
        if (!res.ok || cancelled) return
        const files: ScheduleFile[] = await res.json()

        const labFiles = selectedLabId
          ? (files || []).filter((f: ScheduleFile) => f.labId === selectedLabId)
          : (files || [])

        const allSchedules: ScheduleRecord[] = []
        for (const f of labFiles.slice(0, 3)) {
          try {
            const r = await fetch(
              '/api/schedules/by-file?filename=' + encodeURIComponent(f.filename) +
              '&labId=' + encodeURIComponent(f.labId)
            )
            if (r.ok && !cancelled) {
              const data: ScheduleRecord[] = await r.json()
              const relevant = (data || []).filter((s: ScheduleRecord) => scheduleToday(s.date) || scheduleTomorrow(s.date))
              allSchedules.push(...relevant)
            }
          } catch { /* ignore */ }
        }
        if (!cancelled) setUpcomingSchedules(allSchedules)
      } catch { /* ignore */ }
    }
    load()
    const timer = setInterval(load, 60_000)
    return () => { cancelled = true; clearInterval(timer) }
  }, [selectedLabId])

  // Build notifications safely (100% English text)
  const notifications = useMemo<Notification[]>(() => {
    const list: Notification[] = []

    const safeEvents = events || []
    const safeUsers = users || []
    const safeSchedules = upcomingSchedules || []

    // 1) Granted logins (last 6h)
    safeEvents
      .filter(e => e && e.result === 'granted' && isRecent(resolveTs(e.occurredAt), 6 * 3600_000))
      .slice(0, 5)
      .forEach(e => {
        list.push({
          id: 'login-' + e.id,
          type: 'login',
          title: 'Successful Access',
          body: (e.displayName ?? 'Unknown User') + ' entered the lab room',
          time: resolveTs(e.occurredAt),
          unread: isRecent(resolveTs(e.occurredAt), 10 * 60_000),
        })
      })

    // 2) Denied / failed events (last 3h)
    safeEvents
      .filter(e => e &&
        (e.result === 'denied' || e.result === 'liveness_failed' ||
         e.result === 'pin_failed' || e.result === 'unknown_user') &&
        isRecent(resolveTs(e.occurredAt), 3 * 3600_000)
      )
      .slice(0, 3)
      .forEach(e => {
        const reasonMap: Record<string, string> = {
          denied:          'access denied',
          liveness_failed: 'failed liveness check',
          pin_failed:      'incorrect PIN entered',
          unknown_user:    'unregistered user',
        }
        list.push({
          id: 'denied-' + e.id,
          type: 'denied',
          title: 'Access Denied',
          body: (e.displayName ?? 'Unknown User') + ' ' + (reasonMap[e.result] ?? (e.reason || e.result)),
          time: resolveTs(e.occurredAt),
          unread: isRecent(resolveTs(e.occurredAt), 15 * 60_000),
        })
      })

    // 3) New user enrollments (within 24h)
    safeUsers
      .filter(u => u && isRecent(resolveTs(u.createdAt), 24 * 3600_000))
      .slice(0, 3)
      .forEach(u => {
        list.push({
          id: 'enroll-' + u.id,
          type: 'enrollment',
          title: 'New User Registration',
          body: (u.fullName || 'New User') + ' (' + (u.universityId || 'ID') + ') registered in system',
          time: resolveTs(u.createdAt),
          unread: isRecent(resolveTs(u.createdAt), 2 * 3600_000),
        })
      })

    // 4) Today's lab schedule
    const todaySchedules = safeSchedules.filter(s => s && scheduleToday(s.date))
    if (todaySchedules.length > 0) {
      const groups = [...new Set(todaySchedules.map(s => s.group_nr).filter(Boolean))]
      list.push({
        id: 'sched-today-' + (todaySchedules[0].date || 'today'),
        type: 'schedule_today',
        title: 'Lab Schedule Today',
        body: todaySchedules.length + ' students' +
          (groups.length > 0 ? ' (Group ' + groups.slice(0, 3).join(', ') + ')' : '') +
          ' scheduled for lab today',
        time: null,
        unread: true,
      })
    }

    // 5) Tomorrow's lab schedule reminder
    const tomorrowSchedules = safeSchedules.filter(s => s && scheduleTomorrow(s.date))
    if (tomorrowSchedules.length > 0) {
      const groups = [...new Set(tomorrowSchedules.map(s => s.group_nr).filter(Boolean))]
      list.push({
        id: 'sched-soon-' + (tomorrowSchedules[0].date || 'tomorrow'),
        type: 'schedule_soon',
        title: 'Tomorrow Lab Reminder',
        body: tomorrowSchedules.length + ' students' +
          (groups.length > 0 ? ' (Group ' + groups.slice(0, 3).join(', ') + ')' : '') +
          ' scheduled for lab tomorrow',
        time: null,
        unread: false,
      })
    }

    // Sort: unread first, then by time desc safely without mutating original list
    return [...list].sort((a, b) => {
      if (a.unread !== b.unread) return a.unread ? -1 : 1
      const ta = a.time ? new Date(a.time).getTime() : 0
      const tb = b.time ? new Date(b.time).getTime() : 0
      return tb - ta
    })
  }, [events, users, upcomingSchedules])

  const filtered = filter === 'all' ? notifications : notifications.filter(n => n.type === filter)
  const unreadCount = notifications.filter(n => n.unread && !readIds.has(n.id)).length

  function markRead(id: string) {
    setReadIds(prev => new Set([...prev, id]))
  }

  function markAllRead() {
    setReadIds(new Set(notifications.map(n => n.id)))
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-3 border-b border-line">
        <div className="flex items-center gap-2">
          <p className="font-mono text-[10px] uppercase tracking-widest text-[#94a3b8]">System</p>
          <span className="w-px h-3 bg-line" />
          <p className="font-bold text-sm text-[#0f172a]">System Notifications</p>
          {unreadCount > 0 && (
            <span className="flex items-center justify-center w-5 h-5 rounded-full bg-orange-500 text-white font-bold text-[10px] leading-none">
              {unreadCount > 9 ? '9+' : unreadCount}
            </span>
          )}
        </div>
        {unreadCount > 0 && (
          <button
            onClick={markAllRead}
            className="font-mono text-[10px] text-[#94a3b8] hover:text-orange-500 transition-colors cursor-pointer"
          >
            Mark all read
          </button>
        )}
      </div>

      {/* Filter tabs */}
      <div className="flex gap-1 px-3 py-2 border-b border-line overflow-x-auto custom-scrollbar">
        {filterLabels.map(f => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key as NotifType | 'all')}
            className={
              'shrink-0 px-2.5 py-1 rounded-full font-mono text-[10px] transition-all cursor-pointer ' +
              (filter === f.key
                ? 'bg-orange-500 text-white font-bold'
                : 'text-[#94a3b8] hover:bg-slate-100 hover:text-[#0f172a]')
            }
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* Notification list */}
      <div className="flex flex-col gap-1 px-2 py-2 overflow-y-auto flex-1 custom-scrollbar max-h-[calc(100vh-14rem)] min-h-[260px]">
        {filtered.length === 0 && (
          <div className="flex flex-col items-center justify-center py-8 gap-2">
            <p className="text-2xl" style={{ opacity: 0.3 }}>&#128276;</p>
            <p className="font-mono text-[11px] text-[#94a3b8]">No notifications found.</p>
          </div>
        )}
        {filtered.map(notif => {
          const isRead = readIds.has(notif.id)
          const cfg = typeConfig[notif.type] || typeConfig.login
          const showUnread = notif.unread && !isRead
          return (
            <button
              key={notif.id}
              onClick={() => markRead(notif.id)}
              className={
                'w-full text-left flex items-start gap-3 px-3 py-2.5 rounded-lg border transition-all hover:bg-slate-50 cursor-pointer ' +
                (showUnread ? cfg.bg + ' ' + cfg.border : 'border-transparent')
              }
            >
              <span className={'shrink-0 mt-0.5 flex items-center justify-center w-6 h-6 rounded-full ' + cfg.bg + ' ' + cfg.iconColor}>
                {cfg.icon}
              </span>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between gap-1">
                  <p className={'text-xs font-semibold truncate ' + (showUnread ? 'text-[#0f172a]' : 'text-[#475569]')}>
                    {notif.title}
                  </p>
                  {showUnread && (
                    <span className="shrink-0 w-1.5 h-1.5 rounded-full bg-orange-500" />
                  )}
                </div>
                <p className="font-mono text-[10px] text-[#94a3b8] mt-0.5 leading-relaxed truncate">
                  {notif.body}
                </p>
                {notif.time && (
                  <p className="font-mono text-[10px] text-[#cbd5e1] mt-1">
                    {timeAgo(notif.time)}
                  </p>
                )}
              </div>
            </button>
          )
        })}
      </div>

      {/* Footer */}
      <div className="px-4 py-2 border-t border-line">
        <p className="font-mono text-[10px] text-[#cbd5e1] text-center">
          {notifications.length} notifications &bull; Auto updated
        </p>
      </div>
    </div>
  )
}

