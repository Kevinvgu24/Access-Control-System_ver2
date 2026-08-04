import { useState, useMemo } from 'react'
import { useAdminStore } from '@/store/adminStore'
import { Pagination } from '@/components/ui/Pagination'
import { Panel, PanelHeader } from '@/components/ui/Panel'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { fmtConf, fmtMethod, fmtTs, resultLabel, resultTone } from '@/lib/format'
import type { AccessResult } from '@/types/admin'

const OPTS: { value: AccessResult | 'all'; label: string }[] = [
  { value: 'all',             label: 'All Events'    },
  { value: 'granted',         label: 'Granted'       },
  { value: 'denied',          label: 'Denied'        },
  { value: 'unknown_user',    label: 'Unknown'       },
  { value: 'liveness_failed', label: 'Liveness Fail' },
  { value: 'pin_failed',      label: 'PIN Failed'    },
]

export function LogsPage() {
  const { events } = useAdminStore()
  const [currentPage, setCurrentPage]   = useState(1)
  const [search, setSearch]             = useState('')
  const [resultFilter, setResultFilter] = useState<AccessResult | 'all'>('all')
  const [dateFrom, setDateFrom]         = useState('')
  const [dateTo, setDateTo]             = useState('')

  const filtered = useMemo(() => (events || []).filter(ev => {
    const ts = fmtTs(ev.occurredAt)
    const name = (ev.displayName ?? '').toLowerCase()
    const uid  = ev.universityId ?? ''
    return (
      (!search || name.includes(search.toLowerCase()) || uid.includes(search)) &&
      (resultFilter === 'all' || ev.result === resultFilter) &&
      (!dateFrom || ts >= dateFrom) &&
      (!dateTo   || ts <= dateTo + ' 23:59')
    )
  }), [events, search, resultFilter, dateFrom, dateTo])

  const PAGE_SIZE = 25
  const paginatedEvents = useMemo(() => {
    const start = (currentPage - 1) * PAGE_SIZE
    return filtered.slice(start, start + PAGE_SIZE)
  }, [filtered, currentPage])

  function exportCSV() {
    const rows = [
      'Timestamp,University ID,Name,Method,Confidence,Result,Reason',
      ...filtered.map(ev => [
        fmtTs(ev.occurredAt), ev.universityId ?? '', ev.displayName ?? 'Unknown',
        ev.method, ev.confidence, ev.result, ev.reason,
      ].join(','))
    ].join('\n')
    const a = Object.assign(document.createElement('a'), {
      href: URL.createObjectURL(new Blob([rows], { type: 'text/csv' })),
      download: 'access-log.csv',
    })
    a.click()
  }

  const chipClass = (active: boolean) =>
    `px-3 py-1.5 rounded font-mono text-[11px] border cursor-pointer transition-colors ${
      active ? 'bg-[#ffedd5] border-[#ea580c] text-[#ea580c]' : 'bg-raised border-line text-[#475569] hover:text-[#334155]'
    }`

  return (
    <div className="flex flex-col gap-6">
      <Panel>
        <PanelHeader
          eyebrow="Logs"
          title="Access Log History"
          action={<Button variant="ghost" size="sm" onClick={exportCSV}>Export CSV</Button>}
        />
        {/* Row 1: Search Box & Date Range Picker */}
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 mb-3 pb-3 border-b border-line">
          <input type="text" placeholder="Search by name or university ID..." value={search}
            onChange={e => { setSearch(e.target.value); setCurrentPage(1); }}
            className="bg-raised border border-line rounded px-4 py-2 text-sm text-[#0f172a] placeholder:text-[#cbd5e1] outline-none focus:border-[#ea580c]/50 w-full sm:w-80"
          />
          <div className="flex gap-2 items-center shrink-0">
            <span className="font-mono text-[11px] text-[#94a3b8] uppercase tracking-wider font-bold hidden sm:inline">Date Range:</span>
            <input type="date" value={dateFrom} onChange={e => { setDateFrom(e.target.value); setCurrentPage(1); }}
              className="bg-raised border border-line rounded px-3 py-1.5 text-xs text-[#475569] outline-none focus:border-[#ea580c]/50 [color-scheme:light]"
            />
            <span className="text-[#cbd5e1] font-mono text-xs">-</span>
            <input type="date" value={dateTo} onChange={e => { setDateTo(e.target.value); setCurrentPage(1); }}
              className="bg-raised border border-line rounded px-3 py-1.5 text-xs text-[#475569] outline-none focus:border-[#ea580c]/50 [color-scheme:light]"
            />
          </div>
        </div>

        {/* Row 2: Filter Option Chips (Placed BELOW Search & Date Pickers) */}
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-mono text-[11px] text-[#94a3b8] uppercase tracking-wider font-bold mr-1">Filter Result:</span>
          {OPTS.map(({ value, label }) => (
            <button key={value} onClick={() => { setResultFilter(value); setCurrentPage(1); }} className={chipClass(resultFilter === value)}>{label}</button>
          ))}
        </div>
      </Panel>

      <Panel pad={false} className="overflow-x-auto flex flex-col">
        <table className="w-full border-collapse">
          <thead>
            <tr className="bg-raised">
              {['Timestamp', 'User', 'Method', 'Confidence', 'Result', 'Reason'].map(h => (
                <th key={h} className="text-left px-5 py-3 font-mono text-[10px] uppercase tracking-widest text-[#94a3b8] border-b border-line">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {paginatedEvents.map(ev => (
              <tr key={ev.id} className="border-b border-line hover:bg-raised transition-colors last:border-0">
                <td className="px-5 py-3.5 font-mono text-xs text-[#475569]">{fmtTs(ev.occurredAt)}</td>
                <td className="px-5 py-3.5">
                  <p className="text-sm font-semibold text-[#0f172a]">{ev.displayName ?? 'Unknown User'}</p>
                  <p className="font-mono text-[11px] text-[#94a3b8] mt-0.5">{ev.universityId ?? '-'}</p>
                </td>
                <td className="px-5 py-3.5 font-mono text-xs text-[#475569]">{fmtMethod(ev.method)}</td>
                <td className="px-5 py-3.5 font-mono text-sm font-semibold text-[#0f172a]">{fmtConf(ev.confidence)}</td>
                <td className="px-5 py-3.5"><Badge tone={resultTone(ev.result)}>{resultLabel(ev.result)}</Badge></td>
                <td className="px-5 py-3.5 font-mono text-xs text-[#475569] max-w-[200px] truncate">{ev.reason}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {filtered.length === 0 && (
          <p className="py-12 text-center font-mono text-xs text-[#94a3b8]">No events match current filters.</p>
        )}
        <Pagination currentPage={currentPage} totalItems={filtered.length} pageSize={25} onPageChange={setCurrentPage} />
      </Panel>
    </div>
  )
}
