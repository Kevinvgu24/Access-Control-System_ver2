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
  { key: 'all', label: 'All' },
  { key: 'login', label: 'Logins' },
  { key: 'denied', label: 'Denied' },
  { key: 'registration', label: 'Registrations' },
]

const PAGE_SIZE = 15

// Calculate start of current week (Monday at 00:00:00). Live feed resets every Sunday midnight.
function getStartOfCurrentWeek(): Date {
  const now = new Date()
  const day = now.getDay() // 0 = Sun, 1 = Mon, 2 = Tue, 3 = Wed, 4 = Thu, 5 = Fri, 6 = Sat
  const diffToMonday = day === 0 ? 6 : day - 1
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() - diffToMonday, 0, 0, 0, 0)
}

function isItemInCurrentWeek(ts: any): boolean {
  if (!ts) return true // Keep item if timestamp missing
  let ms = 0
  if (typeof ts === 'number') ms = ts
  else if (typeof ts === 'string') ms = new Date(ts).getTime()
  else if (typeof ts?.toDate === 'function') ms = ts.toDate().getTime()
  else if ('seconds' in ts) ms = ts.seconds * 1000

  if (!ms || isNaN(ms)) return true

  const startOfWeek = getStartOfCurrentWeek().getTime()
  return ms >= startOfWeek
}

export function OverviewPage() {
  const { systemStatus, events, users, todayEntries, failedAttempts, loading } = useAdminStore()
  const { selectedLabId, selectedLabName } = useLabStore()
  const navigate = useNavigate()

  const [feedFilter, setFeedFilter] = useState<FeedFilter>('all')
  const [currentPage, setCurrentPage] = useState<number>(1)
  const [todayClassCount, setTodayClassCount] = useState<number>(0)
  const [totalListsCount, setTotalListsCount] = useState<number>(0)
  const [scheduledStudentIds, setScheduledStudentIds] = useState<Set<string>>(new Set())

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

        const allScheduledIds = new Set<string>()
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
              (records || []).forEach(s => {
                if (s.student_id) {
                  allScheduledIds.add(String(s.student_id).trim().toLowerCase())
                }
              })
            }
          } catch { /* ignore */ }
        }

        // Guarantee that todayClassCount <= totalLists stored in database
        const validCount = Math.min(count, totalLists)
        if (!cancelled) {
          setTodayClassCount(validCount)
          setTotalListsCount(totalLists)
          setScheduledStudentIds(allScheduledIds)
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
  const sysTopColor = systemStatus.overall === 'online' ? 'bg-green' : systemStatus.overall === 'grace_period' ? 'bg-amber' : 'bg-red'

  const kpis = [
    { label: 'System Status', value: systemStatus.overall.replace('_', ' '), sub: selectedLabName, color: sysStatusColor, top: sysTopColor },
    { label: "Today's Entries", value: String(todayEntries), sub: 'Granted access', color: 'text-[#0f172a]', top: 'bg-slate-200' },
    { label: 'Failed Attempts', value: String(failedAttempts), sub: 'Denied + liveness + PIN', color: 'text-red', top: 'bg-red' },
    { label: 'Class Today', value: String(todayClassCount), sub: totalListsCount > 0 ? `${todayClassCount} of ${totalListsCount} saved lists` : 'Scheduled lab classes', color: 'text-amber', top: 'bg-amber' },
  ]

  // Combine access events & user registrations for Live Activity Feed (Current week only - resets on Sunday midnight)
  const feedItems = useMemo(() => {
    const list: Array<{
      id: string
      occurredAt: any
      displayName: string
      method: string
      reason: string
      result: string
      statusLabel?: string
      confidence: number
      filterType: 'login' | 'denied' | 'registration'
    }> = []

      // 1) Access events (Logins & Denied attempts) - Resets on Sunday (Current week only)
      ; (events || []).forEach(ev => {
        if (!ev) return
        if (!isItemInCurrentWeek(ev.occurredAt)) return // Filter out events from previous weeks
        const isGranted = ev.result === 'granted'
        list.push({
          id: ev.id,
          occurredAt: ev.occurredAt,
          displayName: ev.displayName ?? 'Unknown User',
          method: ev.method,
          reason: ev.reason,
          result: ev.result,
          statusLabel: isGranted ? 'Granted' : resultLabel(ev.result),
          confidence: ev.confidence || 0,
          filterType: isGranted ? 'login' : 'denied',
        })
      })

      // 2) User registrations (ONLY for ad-hoc / unscheduled registration requests) - Resets on Sunday
      ; (users || []).forEach(u => {
        if (!u) return
        const uId = String(u.universityId || u.id || '').trim().toLowerCase()
        const isScheduledStudent = scheduledStudentIds.has(uId)

        // Filter: Only include if NOT in the automated schedule list OR role is non-student (guest, ad-hoc, etc.)
        const isAdhocRegistration = !isScheduledStudent || u.roles?.includes('guest') || u.roles?.includes('maintenance')

        const createdAt = (u as any).createdAt || null
        if (isAdhocRegistration && isItemInCurrentWeek(createdAt)) {
          const isApproved = u.status !== 'suspended'
          list.push({
            id: 'reg-' + u.id,
            occurredAt: createdAt,
            displayName: u.fullName || u.universityId || 'New User',
            method: 'enrollment',
            reason: `Ad-hoc Registration Request (${u.universityId ? 'ID: ' + u.universityId : 'Unscheduled'})`,
            result: isApproved ? 'granted' : 'denied',
            statusLabel: isApproved ? 'Accepted' : 'Suspended',
            confidence: 0,
            filterType: 'registration',
          })
        }
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
  }, [events, users, scheduledStudentIds])

  const filteredFeed = useMemo(() => {
    if (feedFilter === 'all') return feedItems
    return feedItems.filter(item => item.filterType === feedFilter)
  }, [feedItems, feedFilter])

  function exportDashboardLogsExcel() {
    const clickTime = new Date()
    const pad = (n: number) => String(n).padStart(2, '0')
    const timeStr = `${clickTime.getFullYear()}-${pad(clickTime.getMonth() + 1)}-${pad(clickTime.getDate())}_${pad(clickTime.getHours())}-${pad(clickTime.getMinutes())}-${pad(clickTime.getSeconds())}`

    const safeLabName = (selectedLabName || 'Lab').replace(/[^a-zA-Z0-9_-]/g, '_')
    const filterTag = feedFilter.toUpperCase()
    const filename = `Live_Activity_Feed_${filterTag}_${safeLabName}_${timeStr}.csv`

    const headers = [
      'Time',
      'Name',
      'Category / Filter',
      'Method',
      'Status / Result',
      'Confidence',
      'Details / Reason'
    ]

    const escapeCsv = (val: any) => {
      if (val == null) return '""'
      const str = String(val).replace(/"/g, '""')
      return `"${str}"`
    }

    const rows = filteredFeed.map(item => [
      escapeCsv(item.occurredAt ? fmtTs(item.occurredAt) : 'N/A'),
      escapeCsv(item.displayName),
      escapeCsv(item.filterType.toUpperCase()),
      escapeCsv(fmtMethod(item.method as any)),
      escapeCsv(item.statusLabel || resultLabel(item.result as any)),
      escapeCsv(item.confidence > 0 ? fmtConf(item.confidence) : 'N/A'),
      escapeCsv(item.reason)
    ].join(','))

    const metaHeader = escapeCsv(`Report Downloaded At: ${fmtTs(clickTime)} | Filter: ${filterTag} | Lab: ${selectedLabName || 'All Labs'}`)

    // UTF-8 BOM \uFEFF for 100% Microsoft Excel compatibility
    const csvContent = '\uFEFF' + metaHeader + '\r\n' + [headers.map(escapeCsv).join(','), ...rows].join('\r\n')
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)

    const link = document.createElement('a')
    link.href = url
    link.setAttribute('download', filename)
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(url)
  }

  return (
    <div className="flex flex-col gap-5 sm:gap-6 lg:gap-7">
      {/* Header (Always Visible & Fluid) */}
      <div className="flex flex-col sm:flex-row justify-between sm:items-end gap-3 sm:gap-4">
        <div>
          <p className="font-mono text-[10px] sm:text-[11px] tracking-widest uppercase text-orange-600 font-extrabold mb-1">Command Center</p>
          <h1 className="text-2xl sm:text-3xl lg:text-4xl font-extrabold tracking-tight text-orange-600">Global Dashboard</h1>
          <p className="text-xs sm:text-sm font-semibold mt-1" style={{ color: '#000000' }}>Lab health, sync status, and live door activity.</p>
        </div>
        <div className="flex gap-2 shrink-0">
          <Button variant="primary" onClick={() => navigate('/enrollment')}>+ Add User</Button>
          <Button variant="ghost" onClick={exportDashboardLogsExcel}>Export Logs (Excel)</Button>
        </div>
      </div>

      {/* Sensor Telemetry Widget */}
      <SensorTelemetryWidget compact={true} />

      {/* KPIs: 2x2 grid on small screens, 4-col grid on medium/large screens. All cards remain 100% visible */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 sm:gap-4">
        {kpis.map(({ label, value, sub, color, top }) => (
          <div key={label} className="bg-surface border border-line rounded-lg p-3.5 sm:p-5 lg:p-6 relative overflow-hidden shadow-sm flex flex-col justify-between min-w-0">
            <div className={`absolute top-0 inset-x-0 h-0.5 ${top} opacity-70`} />
            <p className="font-mono text-[9px] sm:text-[10px] uppercase tracking-widest font-bold mb-2 sm:mb-3 truncate" style={{ color: '#000000' }}>{label}</p>
            <p className={`text-2xl sm:text-3xl md:text-4xl lg:text-5xl font-bold tracking-tight leading-none capitalize ${color} truncate`}>{value}</p>
            <p className="text-[11px] sm:text-xs font-semibold mt-2 sm:mt-3 truncate" style={{ color: '#000000' }}>{sub}</p>
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
                    <div className="flex items-center gap-3">
                      <span className="flex items-center gap-1.5 font-mono text-[11px] font-bold" style={{ color: '#000000' }}>
                        <span className={`${loading ? '' : 'blink'} w-1.5 h-1.5 rounded-full bg-green`} />
                        {loading ? 'Loading...' : 'AUTO'}
                      </span>
                      <button
                        onClick={exportDashboardLogsExcel}
                        style={{ color: '#ea580c', borderColor: '#f97316' }}
                        className="px-2.5 py-1 rounded font-mono text-[11px] font-bold border bg-orange-50/50 hover:bg-orange-500 hover:text-white transition-all cursor-pointer shadow-xs"
                        title="Export current Live Activity Feed to Excel"
                      >
                        📥 Export Feed (Excel)
                      </button>
                    </div>
                  }
                />

                {/* Filter Tabs for Activity Feed */}
                <div className="flex gap-1.5 mt-3 overflow-x-auto custom-scrollbar">
                  {feedFilterTabs.map(tab => (
                    <button
                      key={tab.key}
                      onClick={() => handleFilterChange(tab.key)}
                      style={{ color: feedFilter === tab.key ? '#ffffff' : '#000000' }}
                      className={
                        'shrink-0 px-3 py-1 rounded-full font-mono text-[11px] font-bold transition-all cursor-pointer ' +
                        (feedFilter === tab.key
                          ? 'bg-orange-600 shadow-sm'
                          : 'bg-slate-100 hover:bg-slate-200')
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
                  <p className="py-6 text-center font-mono text-xs font-bold" style={{ color: '#000000' }}>No events found for this filter.</p>
                )}
                {paginatedFeed.map(ev => (
                  <div key={ev.id} className="flex items-center justify-between gap-2 sm:gap-4 px-3 sm:px-4 py-2.5 sm:py-3 rounded bg-raised hover:bg-slate-100 transition-colors min-w-0">
                    <div className="flex items-center gap-2.5 sm:gap-4 min-w-0 flex-1">
                      <span className="font-mono text-[11px] sm:text-[12px] font-bold shrink-0 w-9 sm:w-10" style={{ color: '#000000' }}>
                        {ev.occurredAt ? fmtTs(ev.occurredAt).slice(11, 16) : '--:--'}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="text-xs sm:text-sm font-bold truncate" style={{ color: '#000000' }}>{ev.displayName}</p>
                        <p className="font-mono text-[10px] sm:text-[11px] font-semibold mt-0.5 truncate" style={{ color: '#000000' }}>{fmtMethod(ev.method)} &rarr; {ev.reason}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 sm:gap-3 shrink-0">
                      {ev.confidence > 0 && <span className="font-mono text-[10px] sm:text-xs font-bold" style={{ color: '#000000' }}>{fmtConf(ev.confidence)}</span>}
                      <Badge tone={ev.statusLabel === 'Accepted' ? 'green' : resultTone(ev.result)}>
                        {ev.statusLabel || resultLabel(ev.result)}
                      </Badge>
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

