import { useState, useEffect, useRef } from 'react'
import { useLabStore } from '@/store/labStore'
import { Panel } from '@/components/ui/Panel'
import { Button } from '@/components/ui/Button'
import { fmtTs } from '@/lib/format'

import { getAllLabs, updateLab } from '@/lib/db'
import type { Lab } from '@/types/admin'

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
  const [labs, setLabs] = useState<Lab[]>([])
  const [viewLabId, setViewLabId] = useState<string>('')
  
  const [schedules, setSchedules] = useState<ScheduleRecord[]>([])
  const [loading, setLoading] = useState(false)
  const [importing, setImporting] = useState(false)
  const [search, setSearch] = useState('')
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Edit Lab states
  const [showEditLabModal, setShowEditLabModal] = useState(false)
  const [editLabName, setEditLabName] = useState('')
  const [editLabCode, setEditLabCode] = useState('')
  const [editLabLocation, setEditLabLocation] = useState('')
  const [editLabManager, setEditLabManager] = useState('')
  const [updatingLab, setUpdatingLab] = useState(false)

  // Fetch labs list on mount
  const loadLabs = async () => {
    try {
      const allLabs = await getAllLabs()
      const activeLabs = allLabs.filter(l => l.status === 'active')
      setLabs(activeLabs)
      // Auto-select the globally active lab if it's in the active list
      if (selectedLabId && activeLabs.some(l => l.id === selectedLabId)) {
        setViewLabId(selectedLabId)
      }
    } catch (err) {
      console.error('Failed to load labs list', err)
    }
  }

  useEffect(() => {
    loadLabs()
  }, [selectedLabId])

  const fetchSchedules = async (labId: string) => {
    if (!labId) return
    setLoading(true)
    try {
      const response = await fetch(`/api/labs/${labId}/schedules`)
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
    if (viewLabId) {
      fetchSchedules(viewLabId)
    } else {
      setSchedules([])
    }
  }, [viewLabId])

  const handleImportDirect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file || !viewLabId) return

    const formData = new FormData()
    formData.append('file', file)

    setImporting(true)
    try {
      const response = await fetch(`/api/labs/${viewLabId}/schedules/import`, {
        method: 'POST',
        body: formData
      })
      const result = await response.json()
      if (response.ok) {
        alert(`Successfully imported: ${result.count} schedule records parsed and loaded!`)
        fetchSchedules(viewLabId)
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

  const handleClearCurrentLab = async () => {
    if (!viewLabId) return
    const labName = labs.find(l => l.id === viewLabId)?.name || 'this lab'
    if (confirm(`Are you sure you want to delete all schedule records for "${labName}"? This action cannot be undone.`)) {
      setLoading(true)
      try {
        const response = await fetch(`/api/labs/${viewLabId}/schedules/clear`, { method: 'DELETE' })
        if (response.ok) {
          alert('Lab schedules cleared successfully.')
          fetchSchedules(viewLabId)
        } else {
          alert('Failed to clear schedules.')
        }
      } catch (err) {
        alert('An error occurred while deleting schedules.')
      } finally {
        setLoading(false)
      }
    }
  }

  const openEditLabModal = () => {
    const currentLab = labs.find(l => l.id === viewLabId)
    if (!currentLab) return
    setEditLabName(currentLab.name)
    setEditLabCode(currentLab.code || '')
    setEditLabLocation(currentLab.location || '')
    setEditLabManager(currentLab.manager || '')
    setShowEditLabModal(true)
  }

  const handleUpdateLab = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!editLabName.trim()) {
      alert('Lab Name is required')
      return
    }
    setUpdatingLab(true)
    try {
      await updateLab(viewLabId, {
        name: editLabName.trim(),
        code: editLabCode.trim() || undefined,
        location: editLabLocation.trim() || '',
        timezone: 'Asia/Ho_Chi_Minh',
        manager: editLabManager.trim()
      })
      alert(`Lab room info updated successfully!`)
      setShowEditLabModal(false)
      
      // Reload list
      await loadLabs()
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to update lab room info')
    } finally {
      setUpdatingLab(false)
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
          <p className="text-sm text-[#475569] mt-2">Manage student lab attendance groups and experiment schedules.</p>
        </div>
        
        {/* Lab Selection Dropdown */}
        <div className="flex items-center gap-3">
          <span className="font-mono text-[11px] uppercase tracking-widest text-[#475569]">Select Lab:</span>
          <select 
            value={viewLabId} 
            onChange={e => setViewLabId(e.target.value)}
            className="bg-surface border border-line rounded px-4 py-2 text-sm text-[#0f172a] outline-none focus:border-green/30 cursor-pointer font-medium"
          >
            <option value="">-- Choose Lab Room --</option>
            {labs.map(l => (
              <option key={l.id} value={l.id}>{l.name} ({l.code})</option>
            ))}
          </select>
        </div>
      </div>

      {/* Main Content Area */}
      {!viewLabId ? (
        <div className="bg-surface border border-line rounded-lg p-16 text-center shadow-sm flex flex-col items-center gap-4">
          <div className="text-5xl">📅</div>
          <h3 className="text-lg font-bold text-[#0f172a]">No Lab Selected</h3>
          <p className="text-sm text-[#475569] max-w-md">
            Please select a lab room from the dropdown menu in the upper-right corner to view and manage its schedules.
          </p>
        </div>
      ) : (
        <>
          {/* Action buttons when lab is active */}
          <div className="flex justify-between items-center gap-4 flex-wrap bg-surface p-4 border border-line rounded-lg shadow-sm">
            <div className="flex gap-2">
              <Button variant="ghost" onClick={() => fetchSchedules(viewLabId)} disabled={loading}>
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
                {importing ? 'Importing...' : '📥 Upload Schedule (Excel/HTML)'}
              </Button>
            </div>
            <div className="flex gap-2">
              <Button variant="ghost" onClick={openEditLabModal} className="hover:bg-slate-100">
                ✏️ Edit Lab Info
              </Button>
              <Button variant="ghost" onClick={handleClearCurrentLab} className="text-red hover:bg-red/5">
                🗑️ Clear Lab Schedules
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
                <p className="font-mono text-xs text-[#94a3b8] mb-2">No schedules loaded for this lab.</p>
                <p className="text-xs text-[#64748b]">Upload your schedule spreadsheet (.xlsx) or HTML schedule grid to visualize.</p>
              </div>
            )}
          </Panel>
        </>
      )}

      {/* Edit Lab Modal */}
      {showEditLabModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/60" onClick={() => !updatingLab && setShowEditLabModal(false)} />
          <div className="relative z-10 w-full max-w-lg bg-surface border border-line rounded-xl shadow-2xl p-6 flex flex-col gap-5">
            <div className="flex justify-between items-center">
              <h3 className="text-lg font-bold text-[#0f172a]">Edit Lab Details</h3>
              <button onClick={() => !updatingLab && setShowEditLabModal(false)} className="text-[#94a3b8] hover:text-[#0f172a] transition-colors text-xl cursor-pointer">✕</button>
            </div>
            
            <form onSubmit={handleUpdateLab} className="flex flex-col gap-4">
              <div className="flex flex-col gap-2">
                <label className="font-mono text-[11px] uppercase tracking-widest text-[#475569]">Lab Name</label>
                <input 
                  type="text" 
                  value={editLabName} 
                  onChange={e => setEditLabName(e.target.value)}
                  placeholder="e.g., IoT Lab C205"
                  className="bg-raised border border-line rounded px-4 py-2.5 text-sm text-[#0f172a] placeholder:text-[#cbd5e1] outline-none focus:border-green/30 w-full"
                />
              </div>

              <div className="flex flex-col gap-2">
                <label className="font-mono text-[11px] uppercase tracking-widest text-[#475569]">Lab Code</label>
                <input 
                  type="text" 
                  value={editLabCode} 
                  onChange={e => setEditLabCode(e.target.value.toUpperCase())}
                  placeholder="e.g., IoT-C205"
                  className="bg-raised border border-line rounded px-4 py-2.5 text-sm text-[#0f172a] placeholder:text-[#cbd5e1] outline-none focus:border-green/30 w-full"
                />
              </div>

              <div className="flex flex-col gap-2">
                <label className="font-mono text-[11px] uppercase tracking-widest text-[#475569]">Location</label>
                <input 
                  type="text" 
                  value={editLabLocation} 
                  onChange={e => setEditLabLocation(e.target.value)}
                  placeholder="e.g., Building C, Room 205"
                  className="bg-raised border border-line rounded px-4 py-2.5 text-sm text-[#0f172a] placeholder:text-[#cbd5e1] outline-none focus:border-green/30 w-full"
                />
              </div>

              <div className="flex flex-col gap-2">
                <label className="font-mono text-[11px] uppercase tracking-widest text-[#475569]">Manager / Supervisor</label>
                <input 
                  type="text" 
                  value={editLabManager} 
                  onChange={e => setEditLabManager(e.target.value)}
                  placeholder="e.g., TS. Nguyen Van A"
                  className="bg-raised border border-line rounded px-4 py-2.5 text-sm text-[#0f172a] placeholder:text-[#cbd5e1] outline-none focus:border-green/30 w-full"
                />
              </div>

              <div className="flex gap-2 justify-end mt-4">
                <Button variant="ghost" type="button" onClick={() => setShowEditLabModal(false)} disabled={updatingLab}>Cancel</Button>
                <Button variant="primary" type="submit" disabled={updatingLab || !editLabName.trim()}>
                  {updatingLab ? 'Updating...' : 'Save Changes'}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
