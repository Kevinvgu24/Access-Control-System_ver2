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

const DAY_ORDER: Record<string, number> = {
  'thứ hai': 1, 'thứ 2': 1, 'monday': 1, 'mon': 1, 't2': 1,
  'thứ ba': 2, 'thứ 3': 2, 'tuesday': 2, 'tue': 2, 't3': 2,
  'thứ tư': 3, 'thứ 4': 3, 'wednesday': 3, 'wed': 3, 't4': 3,
  'thứ năm': 4, 'thứ 5': 4, 'thursday': 4, 'thu': 4, 't5': 4,
  'thứ sáu': 5, 'thứ 6': 5, 'friday': 5, 'fri': 5, 't6': 5,
  'thứ bảy': 6, 'thứ 7': 6, 'saturday': 6, 'sat': 6, 't7': 6,
  'chủ nhật': 7, 'cn': 7, 'sunday': 7, 'sun': 7
}

const getDayWeight = (day: string) => {
  const normalized = day.toLowerCase().trim()
  return DAY_ORDER[normalized] ?? 99
}

const getExperimentColor = (expName: string) => {
  if (!expName || expName === 'No Experiment') return 'bg-slate-50 text-[#0f172a] border-slate-200'
  
  let hash = 0
  for (let i = 0; i < expName.length; i++) {
    hash = expName.charCodeAt(i) + ((hash << 5) - hash)
  }
  
  const colors = [
    'bg-blue/10 text-[#0f172a] border-blue/30 hover:bg-blue/20',
    'bg-green/10 text-[#0f172a] border-green/30 hover:bg-green/20',
    'bg-amber/10 text-[#0f172a] border-amber/30 hover:bg-amber/20',
    'bg-red/10 text-[#0f172a] border-red/30 hover:bg-red/20',
    'bg-indigo/10 text-[#0f172a] border-indigo/30 hover:bg-indigo/20',
    'bg-purple/10 text-[#0f172a] border-purple/30 hover:bg-purple/20',
    'bg-teal/10 text-[#0f172a] border-teal/30 hover:bg-teal/20',
    'bg-pink/10 text-[#0f172a] border-pink/30 hover:bg-pink/20',
  ]
  
  return colors[Math.abs(hash) % colors.length]
}

export function SchedulesPage() {
  const { selectedLabId } = useLabStore()
  const [scheduleFiles, setScheduleFiles] = useState<ScheduleFile[]>([])
  const [selectedFileKey, setSelectedFileKey] = useState<string>('') // "filename|labId"
  
  const [schedules, setSchedules] = useState<ScheduleRecord[]>([])
  const [loading, setLoading] = useState(false)
  const [importing, setImporting] = useState(false)
  const [search, setSearch] = useState('')
  const [activeTab, setActiveTab] = useState<'matrix' | 'list'>('matrix')
  const [sortBy, setSortBy] = useState<'date' | 'group'>('date')
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

  // Filter schedules based on search query
  const filtered = schedules.filter(s =>
    !search ||
    s.student_name.toLowerCase().includes(search.toLowerCase()) ||
    s.student_id.toLowerCase().includes(search.toLowerCase()) ||
    s.date.includes(search) ||
    s.experiment.toLowerCase().includes(search.toLowerCase()) ||
    s.group_nr.toLowerCase().includes(search.toLowerCase()) ||
    (s.day_of_week && s.day_of_week.toLowerCase().includes(search.toLowerCase())) ||
    (s.ma && s.ma.toLowerCase().includes(search.toLowerCase()))
  )

  // Sort filtered schedules
  const sortedFiltered = [...filtered].sort((a, b) => {
    if (sortBy === 'group') {
      const groupA = parseInt(a.group_nr) || 0
      const groupB = parseInt(b.group_nr) || 0
      if (groupA !== groupB) return groupA - groupB
      const groupStrCompare = a.group_nr.localeCompare(b.group_nr)
      if (groupStrCompare !== 0) return groupStrCompare
      return a.student_id.localeCompare(b.student_id)
    } else {
      const dateCompare = a.date.localeCompare(b.date)
      if (dateCompare !== 0) return dateCompare
      const sessionCompare = a.session_num.localeCompare(b.session_num)
      if (sessionCompare !== 0) return sessionCompare
      const groupA = parseInt(a.group_nr) || 0
      const groupB = parseInt(b.group_nr) || 0
      if (groupA !== groupB) return groupA - groupB
      return a.student_id.localeCompare(b.student_id)
    }
  })

  // Compute matrix grid data based on current filtered items
  const slotsMap: Record<string, { day: string; session: string; experiment: string; groups: string[]; studentCount: number }> = {}
  filtered.forEach(s => {
    const day = s.day_of_week || 'Unknown Day'
    const session = `${s.session_num || ''} (${s.ma || ''})`.trim() || 'General'
    const key = `${day}|${session}`
    if (!slotsMap[key]) {
      slotsMap[key] = {
        day,
        session,
        experiment: s.experiment || 'No Experiment Assigned',
        groups: [],
        studentCount: 0
      }
    }
    if (s.group_nr && !slotsMap[key].groups.includes(s.group_nr)) {
      slotsMap[key].groups.push(s.group_nr)
    }
    slotsMap[key].studentCount++
  })

  // Get unique days & sessions in alphabetical/chronological order
  const uniqueDays = Array.from(new Set(schedules.map(s => s.day_of_week || 'Unknown Day')))
    .sort((a, b) => getDayWeight(a) - getDayWeight(b))

  const uniqueSessions = Array.from(new Set(schedules.map(s => `${s.session_num || ''} (${s.ma || ''})`.trim() || 'General')))
    .sort((a, b) => {
      const numA = parseInt(a) || 0
      const numB = parseInt(b) || 0
      if (numA !== numB) return numA - numB
      return a.localeCompare(b)
    })

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
          <span className="font-mono text-[11px] uppercase tracking-widest text-[#0f172a] font-bold">Select Schedule List:</span>
          <select 
            value={selectedFileKey} 
            onChange={e => setSelectedFileKey(e.target.value)}
            className="bg-surface border border-line rounded px-4 py-2 text-sm text-[#0f172a] outline-none focus:border-green/30 cursor-pointer font-bold max-w-md truncate"
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
              <Button variant="ghost" onClick={handleClearCurrentFile} className="text-red hover:bg-red/5 font-bold">
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

          {/* Tab Selection */}
          <div className="flex border-b border-line gap-6">
            <button
              onClick={() => setActiveTab('matrix')}
              className={`pb-3 text-sm font-bold border-b-2 transition-all cursor-pointer ${
                activeTab === 'matrix' ? 'border-green text-green' : 'border-transparent text-[#0f172a] hover:text-black'
              }`}
            >
              📅 Timetable Grid (Bảng thời gian)
            </button>
            <button
              onClick={() => setActiveTab('list')}
              className={`pb-3 text-sm font-bold border-b-2 transition-all cursor-pointer ${
                activeTab === 'list' ? 'border-green text-green' : 'border-transparent text-[#0f172a] hover:text-black'
              }`}
            >
              📋 Student List (Danh sách chi tiết)
            </button>
          </div>

          {/* Search Bar & View Content */}
          <div className="flex flex-col gap-4">
            <div className="flex gap-4 items-center justify-between flex-wrap">
              <input 
                type="text" 
                placeholder="Search by student, ID, date (YYYY-MM-DD), group, or experiment…" 
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="flex-1 min-w-[280px] bg-surface border border-line rounded px-4 py-2.5 text-sm text-[#0f172a] placeholder:text-[#cbd5e1] outline-none focus:border-green/30 transition-colors font-semibold"
              />
              
              {activeTab === 'list' && (
                <div className="flex items-center gap-2">
                  <span className="font-mono text-xs text-[#0f172a] font-bold">Sort & Group:</span>
                  <select
                    value={sortBy}
                    onChange={e => setSortBy(e.target.value as 'date' | 'group')}
                    className="bg-surface border border-line rounded px-3 py-2 text-sm text-[#0f172a] font-bold cursor-pointer outline-none focus:border-green/30"
                  >
                    <option value="date">Date & Time</option>
                    <option value="group">Group Number</option>
                  </select>
                </div>
              )}
            </div>

            {activeTab === 'matrix' ? (
              <div className="overflow-x-auto bg-surface border border-line rounded-lg shadow-sm p-6">
                <table className="w-full border-collapse border border-line min-w-[900px]">
                  <thead>
                    <tr className="bg-raised">
                      <th className="border border-line px-4 py-3 font-mono text-[11px] uppercase tracking-widest text-[#0f172a] font-bold w-40 text-center">Session</th>
                      {uniqueDays.map(day => (
                        <th key={day} className="border border-line px-4 py-3 font-mono text-[11px] uppercase tracking-widest text-[#0f172a] font-bold text-center">{day}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {uniqueSessions.map(session => (
                      <tr key={session}>
                        <td className="border border-line px-4 py-6 font-mono text-xs font-bold text-[#0f172a] bg-raised/50 text-center">
                          {session}
                        </td>
                        {uniqueDays.map(day => {
                          const key = `${day}|${session}`
                          const slot = slotsMap[key]
                          return (
                            <td key={day} className="border border-line p-2.5 align-top w-[14%] min-w-[120px] bg-[#fafbfc]">
                              {slot ? (
                                <div className={`p-3 rounded-lg border flex flex-col gap-2 h-full min-h-[110px] transition-all duration-200 ${getExperimentColor(slot.experiment)} shadow-sm`}>
                                  <div className="text-xs font-bold leading-snug">{slot.experiment}</div>
                                  <div className="flex flex-wrap gap-1 mt-auto">
                                    {slot.groups.map(g => (
                                      <span key={g} className="text-[10px] px-1.5 py-0.5 rounded bg-black/5 font-mono font-bold">Group {g}</span>
                                    ))}
                                  </div>
                                  <div className="text-[10px] font-bold opacity-80 mt-1 border-t border-black/5 pt-1">
                                    👥 {slot.studentCount} Students
                                  </div>
                                </div>
                              ) : (
                                <div className="text-slate-300 text-center py-10 font-mono text-[11px] italic font-semibold">No slots</div>
                              )}
                            </td>
                          )
                        })}
                      </tr>
                    ))}
                    {uniqueSessions.length === 0 && (
                      <tr>
                        <td colSpan={uniqueDays.length + 1} className="py-12 text-center font-mono text-xs text-[#0f172a] font-bold">
                          No schedule slots available.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            ) : (
              <Panel pad={false}>
                <table className="w-full border-collapse">
                  <thead>
                    <tr className="bg-raised">
                      {['Student', 'Group / No.', 'Date & Day', 'Session / M/A', 'Experiment', 'Uploaded At'].map(h => (
                        <th key={h} className="text-left px-5 py-3 font-mono text-[10px] uppercase tracking-widest text-[#0f172a] font-bold border-b border-line">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {sortedFiltered.map((s, index) => {
                      const showGroupHeader = sortBy === 'group' && (index === 0 || sortedFiltered[index - 1].group_nr !== s.group_nr)
                      return (
                        <React.Fragment key={s.id}>
                          {showGroupHeader && (
                            <tr className="bg-slate-100">
                              <td colSpan={6} className="px-5 py-2.5 font-bold text-xs text-[#0f172a] border-b border-line font-mono">
                                👥 Group Number: {s.group_nr || 'Unassigned'}
                              </td>
                            </tr>
                          )}
                          <tr className="border-b border-line hover:bg-raised transition-colors last:border-0">
                            <td className="px-5 py-4">
                              <div>
                                <p className="text-sm font-bold text-[#0f172a]">{s.student_name}</p>
                                <p className="font-mono text-[11px] text-[#0f172a] font-bold mt-0.5">{s.student_id}</p>
                              </div>
                            </td>
                            <td className="px-5 py-4 font-mono text-xs text-[#0f172a] font-bold">
                              Group {s.group_nr} {s.student_nr ? `#${s.student_nr}` : ''}
                            </td>
                            <td className="px-5 py-4 font-mono text-xs text-[#0f172a] font-bold">
                              <div>{s.date}</div>
                              <div className="text-[10px] text-[#0f172a] font-bold mt-0.5">{s.day_of_week}</div>
                            </td>
                            <td className="px-5 py-4 font-mono text-xs text-[#0f172a] font-bold">
                              <div>Session {s.session_num}</div>
                              <div className="text-[10px] text-[#0f172a] font-bold mt-0.5">{s.ma}</div>
                            </td>
                            <td className="px-5 py-4">
                              <span className="text-sm text-[#0f172a] font-bold">{s.experiment || 'No Experiment Assigned'}</span>
                            </td>
                            <td className="px-5 py-4 font-mono text-[11px] text-[#0f172a] font-bold">
                              {fmtTs(s.createdAt)}
                            </td>
                          </tr>
                        </React.Fragment>
                      )
                    })}
                  </tbody>
                </table>

                {sortedFiltered.length === 0 && (
                  <div className="py-16 text-center">
                    <p className="font-mono text-xs text-[#0f172a] font-bold mb-2">No schedules matched the filter.</p>
                    <p className="text-xs text-[#0f172a] font-semibold">Upload your schedule spreadsheet (.xlsx) or HTML schedule grid to visualize.</p>
                  </div>
                )}
              </Panel>
            )}
          </div>
        </>
      )}
    </div>
  )
}
