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

function isDateOnDay(dateStr: unknown, targetDate: Date): boolean {
  if (!dateStr) return false
  try {
    const tYear = targetDate.getFullYear()
    const tMonth = targetDate.getMonth() + 1
    const tDay = targetDate.getDate()

    const str = String(dateStr).trim()
    if (!str) return false

    if (str.includes('/')) {
      const parts = str.split('/')
      if (parts.length === 3) {
        if (parts[0].length === 4) {
          const y = parseInt(parts[0], 10)
          const m = parseInt(parts[1], 10)
          const d = parseInt(parts[2], 10)
          return y === tYear && m === tMonth && d === tDay
        } else {
          const d = parseInt(parts[0], 10)
          const m = parseInt(parts[1], 10)
          const y = parseInt(parts[2], 10)
          return y === tYear && m === tMonth && d === tDay
        }
      }
    }

    if (str.includes('-')) {
      const parts = str.split('T')[0].split('-')
      if (parts.length === 3) {
        if (parts[0].length === 4) {
          const y = parseInt(parts[0], 10)
          const m = parseInt(parts[1], 10)
          const d = parseInt(parts[2], 10)
          return y === tYear && m === tMonth && d === tDay
        } else {
          const d = parseInt(parts[0], 10)
          const m = parseInt(parts[1], 10)
          const y = parseInt(parts[2], 10)
          return y === tYear && m === tMonth && d === tDay
        }
      }
    }

    const parsed = new Date(str)
    if (!isNaN(parsed.getTime())) {
      return (
        parsed.getFullYear() === tYear &&
        parsed.getMonth() + 1 === tMonth &&
        parsed.getDate() === tDay
      )
    }
  } catch {
    return false
  }
  return false
}

function scheduleToday(dateStr: unknown): boolean {
  return isDateOnDay(dateStr, new Date())
}

function scheduleTomorrow(dateStr: unknown): boolean {
  const tomorrow = new Date()
  tomorrow.setDate(tomorrow.getDate() + 1)
  return isDateOnDay(dateStr, tomorrow)
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

export function NotificationPanel() {
  const {
    events = [],
    users = [],
    readNotificationIds,
    lastMarkAllReadTime,
    markNotificationRead,
    markAllNotificationsRead,
  } = useAdminStore()
  const { selectedLabId } = useLabStore()

  const [upcomingSchedules, setUpcomingSchedules] = useState<ScheduleRecord[]>([])
  const [filter, setFilter] = useState<'all' | 'unread'>('all')

  // Helper to determine if a notification item is unread
  const checkIsUnread = useCallback((n: Notification): boolean => {
    if (readNotificationIds.has(n.id)) return false
    if (lastMarkAllReadTime > 0) {
      const nTime = n.time ? new Date(n.time).getTime() : 0
      if (nTime <= lastMarkAllReadTime) return false
    }
    return n.unread
  }, [readNotificationIds, lastMarkAllReadTime])

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
        id: 'sched-today-' + (selectedLabId || 'default') + '-' + (todaySchedules[0].date || 'today'),
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
        id: 'sched-soon-' + (selectedLabId || 'default') + '-' + (tomorrowSchedules[0].date || 'tomorrow'),
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
      const isUnreadA = checkIsUnread(a)
      const isUnreadB = checkIsUnread(b)
      if (isUnreadA !== isUnreadB) return isUnreadA ? -1 : 1
      const ta = a.time ? new Date(a.time).getTime() : 0
      const tb = b.time ? new Date(b.time).getTime() : 0
      return tb - ta
    })
  }, [events, users, upcomingSchedules, checkIsUnread, selectedLabId])

  const unreadCount = notifications.filter(n => checkIsUnread(n)).length

  const displayList = useMemo(() => {
    if (filter === 'unread') {
      return notifications.filter(n => checkIsUnread(n))
    }
    return notifications
  }, [notifications, filter, checkIsUnread])

  function markRead(id: string) {
    markNotificationRead(id)
  }

  function markAllRead() {
    markAllNotificationsRead(notifications.map(n => n.id))
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-3 border-b border-line">
        <div className="flex items-center gap-2">
          <p className="font-mono text-[10px] uppercase tracking-widest font-bold" style={{ color: '#000000' }}>System</p>
          <span className="w-px h-3 bg-line" />
          <p className="font-bold text-sm" style={{ color: '#000000' }}>System Notifications</p>
          {unreadCount > 0 && (
            <span className="flex items-center justify-center w-5 h-5 rounded-full bg-orange-500 text-white font-bold text-[10px] leading-none">
              {unreadCount > 9 ? '9+' : unreadCount}
            </span>
          )}
        </div>
        <button
          onClick={markAllRead}
          disabled={unreadCount === 0}
          style={{
            color: unreadCount > 0 ? '#ea580c' : '#64748b',
            borderColor: unreadCount > 0 ? '#f97316' : '#cbd5e1',
            backgroundColor: unreadCount > 0 ? '#fff7ed' : '#f8fafc',
          }}
          className="font-mono text-[11px] font-bold px-2.5 py-1 rounded border transition-all cursor-pointer shadow-xs disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Mark all read
        </button>
      </div>

      {/* Filter tabs: All vs Unread */}
      <div className="flex items-center gap-1.5 px-4 py-2 border-b border-line bg-slate-50/50">
        <button
          onClick={() => setFilter('all')}
          style={{ color: filter === 'all' ? '#ffffff' : '#000000' }}
          className={
            'px-2.5 py-1 rounded-full font-mono text-[10px] font-bold transition-all cursor-pointer ' +
            (filter === 'all'
              ? 'bg-orange-500 shadow-xs'
              : 'hover:bg-slate-200/70')
          }
        >
          All ({notifications.length})
        </button>
        <button
          onClick={() => setFilter('unread')}
          style={{ color: filter === 'unread' ? '#ffffff' : '#000000' }}
          className={
            'px-2.5 py-1 rounded-full font-mono text-[10px] font-bold flex items-center gap-1 transition-all cursor-pointer ' +
            (filter === 'unread'
              ? 'bg-orange-500 shadow-xs'
              : 'hover:bg-slate-200/70')
          }
        >
          Unread
          {unreadCount > 0 && (
            <span className={
              'px-1.5 py-0.2 rounded-full font-bold text-[9px] ' +
              (filter === 'unread' ? 'bg-white text-orange-600' : 'bg-orange-500 text-white')
            }>
              {unreadCount}
            </span>
          )}
        </button>
      </div>

      {/* Notification list */}
      <div className="flex flex-col gap-1 px-2 py-2 overflow-y-auto flex-1 custom-scrollbar max-h-[calc(100vh-14rem)] min-h-[260px]">
        {displayList.length === 0 && (
          <div className="flex flex-col items-center justify-center py-8 gap-2">
            <p className="text-2xl" style={{ opacity: 0.3 }}>&#128276;</p>
            <p className="font-mono text-[11px] font-bold" style={{ color: '#000000' }}>
              {filter === 'unread' ? 'No unread notifications.' : 'No notifications found.'}
            </p>
          </div>
        )}
        {displayList.map(notif => {
          const showUnread = checkIsUnread(notif)
          const cfg = typeConfig[notif.type] || typeConfig.login
          return (
            <button
              key={notif.id}
              onClick={() => markRead(notif.id)}
              className={
                'w-full text-left flex items-start gap-3 px-3 py-2.5 rounded-lg border transition-all hover:bg-slate-100/80 cursor-pointer ' +
                (showUnread ? cfg.bg + ' ' + cfg.border : 'border-transparent')
              }
            >
              <span className={'shrink-0 mt-0.5 flex items-center justify-center w-6 h-6 rounded-full ' + cfg.bg + ' ' + cfg.iconColor}>
                {cfg.icon}
              </span>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between gap-1">
                  <p className="text-xs font-bold truncate" style={{ color: '#000000' }}>
                    {notif.title}
                  </p>
                  {showUnread && (
                    <span className="shrink-0 w-1.5 h-1.5 rounded-full bg-orange-500" />
                  )}
                </div>
                <p className="font-mono text-[11px] font-semibold mt-0.5 leading-relaxed truncate" style={{ color: '#000000' }}>
                  {notif.body}
                </p>
                {notif.time && (
                  <p className="font-mono text-[10px] font-bold mt-1" style={{ color: '#000000' }}>
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
        <p className="font-mono text-[10px] font-bold text-center" style={{ color: '#000000' }}>
          {notifications.length} notifications &bull; Auto updated
        </p>
      </div>
    </div>
  )
}

