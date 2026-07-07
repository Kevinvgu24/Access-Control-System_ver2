import { useState, useEffect, useRef } from 'react'
import { useLabStore } from '@/store/labStore'
import { Panel } from '@/components/ui/Panel'
import { Button } from '@/components/ui/Button'
import { fmtTs } from '@/lib/format'

import { getAllLabs } from '@/lib/db'
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
  const [schedules, setSchedules] = useState<ScheduleRecord[]>([])
  const [loading, setLoading] = useState(false)
  const [importing, setImporting] = useState(false)
  const [search, setSearch] = useState('')
  const [showUploadModal, setShowUploadModal] = useState(false)
  const [labs, setLabs] = useState<Lab[]>([])
  const [targetLabId, setTargetLabId] = useState('')
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
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

  const openUploadModal = async () => {
    try {
      const allLabs = await getAllLabs()
      const activeLabs = allLabs.filter(l => l.status === 'active')
      setLabs(activeLabs)
      if (activeLabs.length > 0) {
        setTargetLabId(selectedLabId || activeLabs[0].id)
      }
      setSelectedFile(null)
      setShowUploadModal(true)
    } catch (err) {
      alert('Failed to load labs list')
    }
  }

  const handleModalImport = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!targetLabId) {
      alert('Please select a target Lab')
      return
    }
    if (!selectedFile) {
      alert('Please select a schedule file first')
      return
    }

    const formData = new FormData()
    formData.append('file', selectedFile)

    setImporting(true)
    try {
      const response = await fetch(`/api/labs/${targetLabId}/schedules/import`, {
        method: 'POST',
        body: formData
      })
      const result = await response.json()
      if (response.ok) {
        alert(`Successfully imported: ${result.count} schedule records parsed and loaded!`)
        setShowUploadModal(false)
        if (targetLabId === selectedLabId) {
          fetchSchedules()
        }
      } else {
        alert(result.error || 'Failed to import schedule file')
      }
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to import schedule file')
    } finally {
      setImporting(false)
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
          <Button variant="primary" onClick={openUploadModal}>
            + Create New Lab Schedule
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

      {showUploadModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/60" onClick={() => !importing && setShowUploadModal(false)} />
          <div className="relative z-10 w-full max-w-lg bg-surface border border-line rounded-xl shadow-2xl p-6 flex flex-col gap-5">
            <div className="flex justify-between items-center">
              <h3 className="text-lg font-bold text-[#0f172a]">Create New Lab Schedule</h3>
              <button onClick={() => !importing && setShowUploadModal(false)} className="text-[#94a3b8] hover:text-[#0f172a] transition-colors text-xl cursor-pointer">✕</button>
            </div>
            
            <form onSubmit={handleModalImport} className="flex flex-col gap-4">
              <div className="flex flex-col gap-2">
                <label className="font-mono text-[11px] uppercase tracking-widest text-[#475569]">Target Lab Room</label>
                <select 
                  value={targetLabId} 
                  onChange={e => setTargetLabId(e.target.value)}
                  className="bg-raised border border-line rounded px-4 py-2.5 text-sm text-[#0f172a] outline-none focus:border-green/30 cursor-pointer w-full"
                >
                  {labs.map(l => (
                    <option key={l.id} value={l.id}>{l.name} ({l.code})</option>
                  ))}
                  {labs.length === 0 && <option value="">No active labs available</option>}
                </select>
              </div>

              <div className="flex flex-col gap-2">
                <label className="font-mono text-[11px] uppercase tracking-widest text-[#475569]">Schedule File (.xlsx / .html)</label>
                <div className="flex items-center gap-3">
                  <Button variant="ghost" type="button" onClick={() => fileInputRef.current?.click()}>
                    📁 Choose File
                  </Button>
                  <span className="text-xs text-[#64748b] truncate">
                    {selectedFile ? selectedFile.name : 'No file chosen'}
                  </span>
                </div>
                <input 
                  type="file" 
                  ref={fileInputRef} 
                  accept=".xlsx,.html,.htm" 
                  onChange={e => setSelectedFile(e.target.files?.[0] || null)} 
                  className="hidden" 
                />
              </div>

              <div className="flex gap-2 justify-end mt-4">
                <Button variant="ghost" type="button" onClick={() => setShowUploadModal(false)} disabled={importing}>Cancel</Button>
                <Button variant="primary" type="submit" disabled={importing || !selectedFile}>
                  {importing ? 'Importing...' : 'Upload & Parse Schedule'}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
