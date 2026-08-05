import { useState, useEffect, useMemo } from 'react'
import { useAdminStore } from '@/store/adminStore'
import { useLabStore } from '@/store/labStore'
import { Panel, PanelHeader } from '@/components/ui/Panel'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Pagination } from '@/components/ui/Pagination'
import { fmtConf, fmtMethod, fmtTs, resultLabel, resultTone } from '@/lib/format'
import { useNavigate } from 'react-router-dom'
import { SensorTelemetryWidget } from '@/components/sensors/SensorTelemetryWidget'
import { NotificationPanel } from '@/components/ui/NotificationPanel'

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

function scheduleToday(dateStr: unknown): boolean {
  if (!dateStr) return false
  try {
    const today = new Date()
    const tYear = today.getFullYear()
    const tMonth = today.getMonth() + 1
    const tDay = today.getDate()

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

type FeedFilter = 'all' | 'login' | 'denied' | 'registration'

const feedFilterTabs: { key: FeedFilter; label: string }[] = [
  { key: 'all',          label: 'All' },
  { key: 'login',        label: 'Logins' },
  { key: 'denied',       label: 'Denied' },
  { key: 'registration', label: 'Registrations' },
]

const PAGE_SIZE = 15

export function OverviewPage() {
  const { systemStatus, events, users, todayEntries, failedAttempts, loading } = useAdminStore()
  const { selectedLabId, selectedLabName } = useLabStore()
  const navigate = useNavigate()

  const [feedFilter, setFeedFilter] = useState<FeedFilter>('all')
  const [currentPage, setCurrentPage] = useState<number>(1)
  const [todayClassCount, setTodayClassCount] = useState<number>(0)
  const [totalListsCount, setTotalListsCount] = useState<number>(0)

  // Fetch saved schedule files and count how many class lists have lab sessions today
  useEffect(() => {
    let cancelled = false
    async function checkTodayClasses() {
      try {
        const res = await fetch('/api/schedules/files')
        if (!res.ok || cancelled) return
        const files: ScheduleFile[] = await res.json()

        const labFiles = selectedLabId
          ? (files || []).filter((f: ScheduleFile) => f.labId === selectedLabId)
          : (files || [])

        // Deduplicate unique saved schedule list files
        const uniqueLabFiles = Array.from(
          new Map((labFiles || []).map(f => [`${f.labId}_${f.filename}`, f])).values()
        )
        const totalLists = uniqueLabFiles.length

        let count = 0
        for (const f of uniqueLabFiles) {
          try {
            const r = await fetch(
              '/api/schedules/by-file?filename=' + encodeURIComponent(f.filename) +
              '&labId=' + encodeURIComponent(f.labId)
            )
            if (r.ok && !cancelled) {
              const records: ScheduleRecord[] = await r.json()
              const hasClassToday = (records || []).some(s => scheduleToday(s.date))
              if (hasClassToday) {
                count++
              }
            }
          } catch { /* ignore */ }
        }

        // Guarantee that todayClassCount <= totalLists stored in database
        const validCount = Math.min(count, totalLists)
        if (!cancelled) {
          setTodayClassCount(validCount)
          setTotalListsCount(totalLists)
        }
      } catch { /* ignore */ }
    }

    checkTodayClasses()
    const timer = setInterval(checkTodayClasses, 60_000)
    return () => { cancelled = true; clearInterval(timer) }
  }, [selectedLabId])

  const handleFilterChange = (filter: FeedFilter) => {
    setFeedFilter(filter)
    setCurrentPage(1)
  }

  const sysStatusColor = systemStatus.overall === 'online' ? 'text-green' : systemStatus.overall === 'grace_period' ? 'text-amber' : 'text-red'
  const sysTopColor    = systemStatus.overall === 'online' ? 'bg-green'  : systemStatus.overall === 'grace_period' ? 'bg-amber'  : 'bg-red'

  const kpis = [
    { label: 'System Status',   value: systemStatus.overall.replace('_', ' '), sub: selectedLabName, color: sysStatusColor, top: sysTopColor },
    { label: "Today's Entries", value: String(todayEntries),   sub: 'Granted access',          color: 'text-[#0f172a]', top: 'bg-slate-200' },
    { label: 'Failed Attempts', value: String(failedAttempts), sub: 'Denied + liveness + PIN', color: 'text-red',       top: 'bg-red'      },
    { label: 'Class Today',     value: String(todayClassCount),sub: totalListsCount > 0 ? `${todayClassCount} of ${totalListsCount} saved lists` : 'Scheduled lab classes', color: 'text-amber', top: 'bg-amber' },
  ]

  // Combine access events & user registrations for Live Activity Feed
  const feedItems = useMemo(() => {
    const list: Array<{
      id: string
      occurredAt: any
      displayName: string
      method: string
      reason: string
      result: string
      confidence: number
      filterType: 'login' | 'denied' | 'registration'
    }> = []

    // 1) Access events (Logins & Denied attempts)
    ;(events || []).forEach(ev => {
      if (!ev) return
      const isGranted = ev.result === 'granted'
      list.push({
        id: ev.id,
        occurredAt: ev.occurredAt,
        displayName: ev.displayName ?? 'Unknown User',
        method: ev.method,
        reason: ev.reason,
        result: ev.result,
        confidence: ev.confidence || 0,
        filterType: isGranted ? 'login' : 'denied',
      })
    })

    // 2) User registrations
    ;(users || []).forEach(u => {
      if (!u) return
      list.push({
        id: 'reg-' + u.id,
        occurredAt: (u as any).createdAt || null,
        displayName: u.fullName || u.universityId || 'New User',
        method: 'enrollment',
        reason: `Registered in system (${u.universityId || 'ID'})`,
        result: 'granted',
        confidence: 0,
        filterType: 'registration',
      })
    })

    // Sort by occurredAt descending
    return list.sort((a, b) => {
      const getTs = (ts: any) => {
        if (!ts) return 0
        if (typeof ts === 'string') return new Date(ts).getTime()
        if (typeof ts === 'number') return ts
        if (typeof ts?.toDate === 'function') return ts.toDate().getTime()
        if ('seconds' in ts) return ts.seconds * 1000
        return 0
      }
      return getTs(b.occurredAt) - getTs(a.occurredAt)
    })
  }, [events, users])

  const filteredFeed = useMemo(() => {
    if (feedFilter === 'all') return feedItems
    return feedItems.filter(item => item.filterType === feedFilter)
  }, [feedItems, feedFilter])

  const paginatedFeed = useMemo(() => {
    const start = (currentPage - 1) * PAGE_SIZE
    return filteredFeed.slice(start, start + PAGE_SIZE)
  }, [filteredFeed, currentPage])

  return (
    <div className="flex flex-col gap-5 sm:gap-6 lg:gap-7">
      {/* Header (Always Visible & Fluid) */}
      <div className="flex flex-col sm:flex-row justify-between sm:items-end gap-3 sm:gap-4">
        <div>
          <p className="font-mono text-[10px] sm:text-[11px] tracking-widest uppercase text-orange-600 font-extrabold mb-1">Command Center</p>
          <h1 className="text-2xl sm:text-3xl lg:text-4xl font-extrabold tracking-tight text-orange-600">Global Dashboard</h1>
          <p className="text-xs sm:text-sm text-[#475569] mt-1">Lab health, sync status, and live door activity.</p>
        </div>
        <div className="flex gap-2 shrink-0">
          <Button variant="primary" onClick={() => navigate('/enrollment')}>+ Add User</Button>
          <Button variant="ghost" onClick={() => navigate('/logs')}>Export Logs</Button>
        </div>
      </div>

      {/* Sensor Telemetry Widget */}
      <SensorTelemetryWidget compact={true} />

      {/* KPIs: 2x2 grid on small screens, 4-col grid on medium/large screens. All cards remain 100% visible */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 sm:gap-4">
        {kpis.map(({ label, value, sub, color, top }) => (
          <div key={label} className="bg-surface border border-line rounded-lg p-3.5 sm:p-5 lg:p-6 relative overflow-hidden shadow-sm flex flex-col justify-between min-w-0">
            <div className={`absolute top-0 inset-x-0 h-0.5 ${top} opacity-70`} />
            <p className="font-mono text-[9px] sm:text-[10px] uppercase tracking-widest text-[#94a3b8] mb-2 sm:mb-3 truncate">{label}</p>
            <p className={`text-2xl sm:text-3xl md:text-4xl lg:text-5xl font-bold tracking-tight leading-none capitalize ${color} truncate`}>{value}</p>
            <p className="text-[11px] sm:text-xs text-[#475569] mt-2 sm:mt-3 truncate">{sub}</p>
          </div>
        ))}
      </div>

      {/* Main Content Split: Side-by-side from medium screens (768px+) and desktop during zoom */}
      <div className="grid grid-cols-1 md:grid-cols-12 gap-4 sm:gap-6">
        {/* Live Activity Feed */}
        <div className="md:col-span-7 lg:col-span-8 flex flex-col">
          <Panel className="flex-1 flex flex-col justify-between" pad={false}>
            <div>
              <div className="p-4 sm:p-5 border-b border-line">
                <PanelHeader eyebrow="Real-time" title="Live Activity Feed"
                  action={
                    <span className="flex items-center gap-1.5 font-mono text-[11px] text-[#94a3b8]">
                      <span className={`${loading ? '' : 'blink'} w-1.5 h-1.5 rounded-full bg-green`} />
                      {loading ? 'Loading...' : 'AUTO'}
                    </span>
                  }
                />

                {/* Filter Tabs for Activity Feed */}
                <div className="flex gap-1.5 mt-3 overflow-x-auto custom-scrollbar">
                  {feedFilterTabs.map(tab => (
                    <button
                      key={tab.key}
                      onClick={() => handleFilterChange(tab.key)}
                      className={
                        'shrink-0 px-3 py-1 rounded-full font-mono text-[11px] transition-all cursor-pointer ' +
                        (feedFilter === tab.key
                          ? 'bg-orange-600 text-white font-bold shadow-sm'
                          : 'bg-slate-100 text-[#64748b] hover:bg-slate-200 hover:text-[#0f172a]')
                      }
                    >
                      {tab.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Feed items list */}
              <div className="flex flex-col gap-1.5 p-4 sm:p-5 overflow-x-auto custom-scrollbar">
                {filteredFeed.length === 0 && !loading && (
                  <p className="py-6 text-center font-mono text-xs text-[#94a3b8]">No events found for this filter.</p>
                )}
                {paginatedFeed.map(ev => (
                  <div key={ev.id} className="flex items-center justify-between gap-2 sm:gap-4 px-3 sm:px-4 py-2.5 sm:py-3 rounded bg-raised hover:bg-slate-100 transition-colors min-w-0">
                    <div className="flex items-center gap-2.5 sm:gap-4 min-w-0 flex-1">
                      <span className="font-mono text-[11px] sm:text-[12px] text-[#94a3b8] shrink-0 w-9 sm:w-10">
                        {ev.occurredAt ? fmtTs(ev.occurredAt).slice(11, 16) : '--:--'}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="text-xs sm:text-sm font-semibold text-[#0f172a] truncate">{ev.displayName}</p>
                        <p className="font-mono text-[10px] sm:text-[11px] text-[#94a3b8] mt-0.5 truncate">{fmtMethod(ev.method)} &rarr; {ev.reason}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 sm:gap-3 shrink-0">
                      {ev.confidence > 0 && <span className="font-mono text-[10px] sm:text-xs text-[#475569]">{fmtConf(ev.confidence)}</span>}
                      <Badge tone={resultTone(ev.result)}>{resultLabel(ev.result)}</Badge>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Pagination controls at bottom */}
            {filteredFeed.length > 0 && (
              <Pagination
                currentPage={currentPage}
                totalItems={filteredFeed.length}
                pageSize={PAGE_SIZE}
                onPageChange={setCurrentPage}
              />
            )}
          </Panel>
        </div>

        {/* Notification Panel */}
        <div className="md:col-span-5 lg:col-span-4 flex flex-col md:sticky md:top-4 self-start max-h-[calc(100vh-5rem)]">
          <Panel pad={false} className="overflow-hidden flex-1">
            <NotificationPanel />
          </Panel>
        </div>
      </div>
    </div>
  )
}

