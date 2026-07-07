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

interface ScheduleFile {
  filename: string
  labId: string
  labName: string
}

export function SchedulesPage() {
  const { selectedLabId } = useLabStore()
  const [scheduleFiles, setScheduleFiles] = useState<ScheduleFile[]>([])
  const [selectedFileKey, setSelectedFileKey] = useState<string>('') // "filename|labId"
  
  const [schedules, setSchedules] = useState<ScheduleRecord[]>([])
  const [loading, setLoading] = useState(false)
  const [importing, setImporting] = useState(false)
  const [search, setSearch] = useState('')
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Fetch unique schedule files
  const loadScheduleFiles = async () => {
    try {
      const res = await fetch('/api/schedules/files')
      if (res.ok) {
        const data = await res.json()
        setScheduleFiles(data)
        return data as ScheduleFile[]
      }
    } catch (err) {
      console.error('Failed to load schedule files list', err)
    }
    return []
  }

  useEffect(() => {
    loadScheduleFiles()
  }, [])

  const fetchSchedules = async (fileKey: string) => {
    if (!fileKey) {
      setSchedules([])
      return
    }
    const [filename, labId] = fileKey.split('|')
    setLoading(true)
    try {
      const response = await fetch(`/api/schedules/by-file?filename=${encodeURIComponent(filename)}&labId=${encodeURIComponent(labId)}`)
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
    if (selectedFileKey) {
      fetchSchedules(selectedFileKey)
    } else {
      setSchedules([])
    }
  }, [selectedFileKey])

  const handleImportDirect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    if (!selectedLabId) {
      alert('Please select an active lab room (Switch Lab) before uploading a schedule.')
      return
    }

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
        alert(`Successfully imported: ${result.count} schedule records parsed from "${result.filename}"!`)
        const nextFiles = await loadScheduleFiles()
        // Auto-select the newly uploaded file list
        const newKey = `${result.filename}|${selectedLabId}`
        setSelectedFileKey(newKey)
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

  const handleClearCurrentFile = async () => {
    if (!selectedFileKey) return
    const [filename, labId] = selectedFileKey.split('|')
    if (confirm(`Are you sure you want to delete all schedule records in the list "${filename}"? This action cannot be undone.`)) {
      setLoading(true)
      try {
        const response = await fetch(`/api/schedules/by-file?filename=${encodeURIComponent(filename)}&labId=${encodeURIComponent(labId)}`, {
          method: 'DELETE'
        })
        if (response.ok) {
          alert('Schedule list deleted successfully.')
          setSelectedFileKey('')
          loadScheduleFiles()
        } else {
          alert('Failed to delete schedule list.')
        }
      } catch (err) {
        alert('An error occurred while deleting schedules.')
      } finally {
        setLoading(false)
      }
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
  const uniqueExperiments = new Set(schedules.map(s => s.experiment).filter(Boolean)).size

  return (
    <div className="flex flex-col gap-7">
      {/* Page Header */}
      <div className="flex justify-between items-end gap-4 flex-wrap">
        <div>
          <p className="font-mono text-[11px] tracking-widest uppercase text-[#94a3b8] mb-3">Lab Calendar</p>
          <h1 className="text-4xl font-bold tracking-tight text-[#0f172a]">Lab Schedules</h1>
          <p className="text-sm text-[#475569] mt-2">Manage student lab attendance groups and experiment schedules by uploaded lists.</p>
        </div>
        
        {/* Schedule List Selection Dropdown */}
        <div className="flex items-center gap-3">
          <span className="font-mono text-[11px] uppercase tracking-widest text-[#475569]">Select Schedule List:</span>
          <select 
            value={selectedFileKey} 
            onChange={e => setSelectedFileKey(e.target.value)}
            className="bg-surface border border-line rounded px-4 py-2 text-sm text-[#0f172a] outline-none focus:border-green/30 cursor-pointer font-medium max-w-md truncate"
          >
            <option value="">-- Choose Schedule List --</option>
            {scheduleFiles.map(f => (
              <option key={`${f.filename}|${f.labId}`} value={`${f.filename}|${f.labId}`}>
                [{f.labName}] {f.filename}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Main Content Area */}
      {!selectedFileKey ? (
        <div className="bg-surface border border-line rounded-lg p-16 text-center shadow-sm flex flex-col items-center gap-5">
          <div className="text-5xl">📅</div>
          <h3 className="text-lg font-bold text-[#0f172a]">No Schedule List Selected</h3>
          <p className="text-sm text-[#475569] max-w-md">
            Please select an uploaded Excel schedule list from the dropdown menu in the upper-right corner.
          </p>
          <div className="mt-4 flex flex-col items-center gap-3 border-t border-line pt-6 w-full max-w-sm">
            <span className="font-mono text-[11px] uppercase tracking-widest text-[#94a3b8]">Or upload new file for active lab:</span>
            <input 
              type="file" 
              ref={fileInputRef} 
              accept=".xlsx,.html,.htm" 
              onChange={handleImportDirect} 
              className="hidden" 
            />
            <Button variant="primary" onClick={() => fileInputRef.current?.click()} disabled={importing}>
              {importing ? 'Importing...' : '📥 Upload New Schedule (Excel/HTML)'}
            </Button>
          </div>
        </div>
      ) : (
        <>
          {/* Action buttons when list is active */}
          <div className="flex justify-between items-center gap-4 flex-wrap bg-surface p-5 border border-line rounded-lg shadow-sm">
            <div className="flex flex-col gap-1.5">
              <span className="font-mono text-[10px] uppercase tracking-widest text-[#94a3b8]">Active Schedule List</span>
              <h2 className="text-xl font-bold text-[#0f172a] flex items-center gap-2 flex-wrap">
                📄 {selectedFileKey.split('|')[0]}
                <span className="text-[11px] font-mono font-normal text-green bg-green/5 px-2 py-0.5 rounded border border-green/10">
                  Lab: {scheduleFiles.find(f => `${f.filename}|${f.labId}` === selectedFileKey)?.labName}
                </span>
              </h2>
            </div>
            
            <div className="flex gap-2.5 items-center">
              <Button variant="ghost" onClick={() => fetchSchedules(selectedFileKey)} disabled={loading}>
                {loading ? 'Refreshing...' : '↻ Refresh'}
              </Button>
              <input 
                type="file" 
                ref={fileInputRef} 
                accept=".xlsx,.html,.htm" 
                onChange={handleImportDirect} 
                className="hidden" 
              />
              <Button variant="primary" onClick={() => fileInputRef.current?.click()} disabled={importing}>
                {importing ? 'Importing...' : '📥 Upload New List'}
              </Button>
              <Button variant="ghost" onClick={handleClearCurrentFile} className="text-red hover:bg-red/5">
                🗑️ Delete List
              </Button>
            </div>
          </div>

          {/* Stats */}
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

          {/* Search and Table */}
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
                <p className="font-mono text-xs text-[#94a3b8] mb-2">No schedules matched the filter.</p>
                <p className="text-xs text-[#64748b]">Upload your schedule spreadsheet (.xlsx) or HTML schedule grid to visualize.</p>
              </div>
            )}
          </Panel>
        </>
      )}
    </div>
  )
}
