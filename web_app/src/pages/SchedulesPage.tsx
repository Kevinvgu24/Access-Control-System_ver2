import { useState, useEffect, useRef } from 'react'
import { useLabStore } from '@/store/labStore'
import { Panel } from '@/components/ui/Panel'
import { Button } from '@/components/ui/Button'
import { fmtTs } from '@/lib/format'

interface ScheduleRecord {
  id: number
  student_id: string
  student_name: string
  group_nr: string
  student_nr: string
  date: string
  day_of_week: string
  ma: string
  session_num: string
  experiment: string
  createdAt: string
}

export function SchedulesPage() {
  const { selectedLabId } = useLabStore()
  const [schedules, setSchedules] = useState<ScheduleRecord[]>([])
  const [loading, setLoading] = useState(false)
  const [importing, setImporting] = useState(false)
  const [search, setSearch] = useState('')
  const fileInputRef = useRef<HTMLInputElement>(null)

  const fetchSchedules = async () => {
    if (!selectedLabId) return
    setLoading(true)
    try {
      const response = await fetch(`/api/labs/${selectedLabId}/schedules`)
      if (response.ok) {
        const data = await response.json()
        setSchedules(data)
      } else {
        console.error('Failed to fetch schedules')
      }
    } catch (err) {
      console.error(err)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchSchedules()
  }, [selectedLabId])

  const triggerFileInput = () => {
    fileInputRef.current?.click()
  }

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file || !selectedLabId) return

    const formData = new FormData()
    formData.append('file', file)

    setImporting(true)
    try {
      const response = await fetch(`/api/labs/${selectedLabId}/schedules/import`, {
        method: 'POST',
        body: formData
      })
      const result = await response.json()
      if (response.ok) {
        alert(`Successfully imported: ${result.count} schedule records parsed and loaded!`)
        fetchSchedules()
      } else {
        alert(result.error || 'Failed to import schedule file')
      }
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to import schedule file')
    } finally {
      setImporting(false)
      if (e.target) e.target.value = ''
    }
  }

  const filtered = schedules.filter(s =>
    !search ||
    s.student_name.toLowerCase().includes(search.toLowerCase()) ||
    s.student_id.toLowerCase().includes(search.toLowerCase()) ||
    s.date.includes(search) ||
    s.experiment.toLowerCase().includes(search.toLowerCase()) ||
    s.group_nr.toLowerCase().includes(search.toLowerCase())
  )

  // Compute stats
  const uniqueStudents = new Set(schedules.map(s => s.student_id)).size
  const totalSessions = schedules.length
  
  // Group by experiments to see unique topics
  const uniqueExperiments = new Set(schedules.map(s => s.experiment).filter(Boolean)).size

  return (
    <div className="flex flex-col gap-7">
      <div className="flex justify-between items-end">
        <div>
          <p className="font-mono text-[11px] tracking-widest uppercase text-[#94a3b8] mb-3">Lab Calendar</p>
          <h1 className="text-4xl font-bold tracking-tight text-[#0f172a]">Lab Schedules</h1>
          <p className="text-sm text-[#475569] mt-2">Manage student lab attendance groups and experiment schedules.</p>
        </div>
        <div className="flex gap-2">
          <Button variant="ghost" onClick={fetchSchedules} disabled={loading}>
            {loading ? 'Refreshing...' : '↻ Refresh'}
          </Button>
          <input type="file" ref={fileInputRef} accept=".xlsx,.html,.htm" onChange={handleImport} className="hidden" />
          <Button variant="primary" onClick={triggerFileInput} disabled={importing}>
            {importing ? 'Parsing...' : '📥 Import Schedule (Excel/HTML)'}
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-4">
        {[
          { label: 'Total Schedule Entries', value: totalSessions, color: 'text-[#0f172a]' },
          { label: 'Unique Students', value: uniqueStudents, color: 'text-green' },
          { label: 'Experiments scheduled', value: uniqueExperiments, color: 'text-blue' },
        ].map(({ label, value, color }) => (
          <div key={label} className="bg-surface border border-line rounded-lg p-6 shadow-sm">
            <p className="font-mono text-[10px] uppercase tracking-widest text-[#94a3b8] mb-3">{label}</p>
            <p className={`text-5xl font-bold ${color}`}>{value}</p>
          </div>
        ))}
      </div>

      <Panel pad={false}>
        <div className="flex gap-3 items-center p-5 border-b border-line">
          <input 
            type="text" 
            placeholder="Search by student, MSSV, date (YYYY-MM-DD), or experiment…" 
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="flex-1 bg-raised border border-line rounded px-3 py-2 text-sm text-[#0f172a] placeholder:text-[#cbd5e1] outline-none focus:border-green/30 transition-colors"
          />
        </div>

        <table className="w-full border-collapse">
          <thead>
            <tr className="bg-raised">
              {['Student', 'Group / No.', 'Date & Day', 'Session / M/A', 'Experiment', 'Uploaded At'].map(h => (
                <th key={h} className="text-left px-5 py-3 font-mono text-[10px] uppercase tracking-widest text-[#94a3b8] border-b border-line">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.map(s => (
              <tr key={s.id} className="border-b border-line hover:bg-raised transition-colors last:border-0">
                <td className="px-5 py-4">
                  <div>
                    <p className="text-sm font-semibold text-[#0f172a]">{s.student_name}</p>
                    <p className="font-mono text-[11px] text-[#94a3b8] mt-0.5">{s.student_id}</p>
                  </div>
                </td>
                <td className="px-5 py-4 font-mono text-xs text-[#475569]">
                  Group {s.group_nr} {s.student_nr ? `#${s.student_nr}` : ''}
                </td>
                <td className="px-5 py-4 font-mono text-xs text-[#0f172a]">
                  <div>{s.date}</div>
                  <div className="text-[10px] text-[#94a3b8] mt-0.5">{s.day_of_week}</div>
                </td>
                <td className="px-5 py-4 font-mono text-xs text-[#475569]">
                  <div>Session {s.session_num}</div>
                  <div className="text-[10px] text-[#94a3b8] mt-0.5">{s.ma}</div>
                </td>
                <td className="px-5 py-4">
                  <span className="text-sm text-[#0f172a] font-medium">{s.experiment || 'No Experiment Assigned'}</span>
                </td>
                <td className="px-5 py-4 font-mono text-[11px] text-[#94a3b8]">
                  {fmtTs(s.createdAt)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {filtered.length === 0 && (
          <div className="py-16 text-center">
            <p className="font-mono text-xs text-[#94a3b8] mb-2">No schedules loaded for this lab.</p>
            <p className="text-xs text-[#64748b]">Upload your schedule spreadsheet (.xlsx) or HTML schedule grid to visualize.</p>
          </div>
        )}
      </Panel>
    </div>
  )
}
