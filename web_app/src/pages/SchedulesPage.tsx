import { useState, useEffect, useRef } from 'react'
import { FileSpreadsheet } from 'lucide-react'
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
  const [currentPage, setCurrentPage] = useState<number>(1)
  const ITEMS_PER_PAGE = 50
  const [templateType, setTemplateType] = useState<string>('type1')
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Interactive mapping states
  const [showMappingModal, setShowMappingModal] = useState(false)
  const [previewData, setPreviewData] = useState<{
    grid: { text: string; color: string }[][]
    file_token: string
    filename: string
  } | null>(null)
  const [selectedCell, setSelectedCell] = useState<{ row: number; col: number } | null>(null)

  // Row Mapping states (0-indexed default values)
  const [monthRow, setMonthRow] = useState<number>(5)
  const [dayOfWeekRow, setDayOfWeekRow] = useState<number>(6)
  const [dateRow, setDateRow] = useState<number>(7)
  const [maRow, setMaRow] = useState<number>(8)
  const [sessionRow, setSessionRow] = useState<number>(9)

  // Column Mapping states
  const [groupCol, setGroupCol] = useState<number>(0)
  const [nameCol, setNameCol] = useState<number>(2)
  const [idCol, setIdCol] = useState<number>(3)

  // Start Boundaries
  const [startCol, setStartCol] = useState<number>(4)
  const [startRow, setStartRow] = useState<number>(12)

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
    // Reset selected file when lab changes to avoid showing data from another lab
    setSelectedFileKey('')
    setSchedules([])
  }, [selectedLabId])

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

  useEffect(() => {
    setCurrentPage(1)
  }, [search, selectedFileKey])

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
      const response = await fetch(`/api/schedules/preview`, {
        method: 'POST',
        body: formData
      })
      const result = await response.json()
      if (response.ok) {
        setPreviewData(result)
        // Reset mapping states to defaults
        setMonthRow(5)
        setDayOfWeekRow(6)
        setDateRow(7)
        setMaRow(8)
        setSessionRow(9)
        setGroupCol(0)
        setNameCol(2)
        setIdCol(3)
        setStartCol(4)
        setStartRow(12)
        setSelectedCell(null)
        setShowMappingModal(true)
      } else {
        alert(result.error || 'Failed to build file preview')
      }
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to build file preview')
    } finally {
      setImporting(false)
      if (e.target) e.target.value = ''
    }
  }

  const handleConfirmMappingImport = async () => {
    if (!previewData || !selectedLabId) return

    setImporting(true)
    try {
      const response = await fetch(`/api/labs/${selectedLabId}/schedules/import_mapped`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          file_token: previewData.file_token,
          filename: previewData.filename,
          month_row: monthRow,
          day_of_week_row: dayOfWeekRow,
          date_row: dateRow,
          ma_row: maRow,
          session_row: sessionRow,
          group_col: groupCol,
          name_col: nameCol,
          id_col: idCol,
          start_col: startCol,
          start_row: startRow
        })
      })
      const result = await response.json()
      if (response.ok) {
        alert(`Successfully imported: ${result.count} schedule records parsed from "${result.filename}"!`)
        setShowMappingModal(false)
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

  const filtered = schedules.filter(s => {
    const sName = s.student_name || ""
    const sId = s.student_id || ""
    const sDate = s.date || ""
    const sExp = s.experiment || ""
    const sGroup = s.group_nr || ""
    return !search ||
      sName.toLowerCase().includes(search.toLowerCase()) ||
      sId.toLowerCase().includes(search.toLowerCase()) ||
      sDate.includes(search) ||
      sExp.toLowerCase().includes(search.toLowerCase()) ||
      sGroup.toLowerCase().includes(search.toLowerCase())
  })

  const displayedSchedules = filtered.slice(0, currentPage * ITEMS_PER_PAGE)

  // Compute stats
  const uniqueStudents = new Set(schedules.map(s => s.student_id).filter(Boolean)).size
  const totalSessions = schedules.length
  const uniqueExperiments = new Set(schedules.map(s => s.experiment).filter(Boolean)).size

  return (
    <div className="flex flex-col gap-7">
      {/* Page Header */}
      <div className="flex justify-between items-end gap-4 flex-wrap">
        <div>
          <p className="font-mono text-[11px] tracking-widest uppercase text-orange-600 font-extrabold mb-2">Lab Calendar</p>
          <h1 className="text-4xl font-extrabold tracking-tight text-orange-600">Lab Schedules</h1>
          <p className="text-sm text-[#475569] mt-2">Manage student lab attendance groups and experiment schedules by uploaded lists.</p>
        </div>
        
        {/* Schedule List Selection Dropdown */}
        <div className="flex items-center gap-3">
          <span className="font-mono text-[11px] uppercase tracking-widest text-[#475569]">Select Schedule List:</span>
          <select 
            value={selectedFileKey} 
            onChange={e => setSelectedFileKey(e.target.value)}
            className="bg-surface border border-line rounded px-4 py-2 text-sm text-[#0f172a] outline-none focus:border-[#ea580c]/50 cursor-pointer font-medium max-w-md truncate"
          >
            <option value="">-- Choose Schedule List --</option>
            {scheduleFiles
              .filter(f => f.labId === selectedLabId)
              .map(f => (
              <option key={`${f.filename}|${f.labId}`} value={`${f.filename}|${f.labId}`}>
                {f.filename}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Main Content Area */}
      {!selectedFileKey ? (
        <div className="bg-surface border border-line rounded-lg p-16 text-center shadow-sm flex flex-col items-center gap-5">
          <div className="text-[#107c41] bg-[#107c41]/10 p-4 rounded-full mb-2">
            <FileSpreadsheet className="w-16 h-16" strokeWidth={1.5} />
          </div>
          <h3 className="text-3xl font-bold text-[#0f172a]">No Schedule List Selected</h3>
          <p className="text-2xl text-[#475569] max-w-2xl leading-relaxed">
            Please select an uploaded Excel schedule list from the dropdown menu in the upper-right corner.
          </p>
          <div className="mt-4 flex flex-col items-center gap-3 border-t border-line pt-6 w-full max-w-sm">
            <span className="font-mono text-[11px] uppercase tracking-widest text-[#94a3b8] mb-1">Schedule Template Type:</span>
            <select
              value={templateType}
              onChange={e => setTemplateType(e.target.value)}
              className="bg-surface border border-line rounded px-3 py-2 text-xs text-[#0f172a] outline-none focus:border-[#ea580c]/50 cursor-pointer font-medium w-full mb-3 shadow-sm"
            >
              <option value="type1">Template 1 (By study group & calendar cell color)</option>
              <option value="original">Template 2 (Original dynamic design)</option>
            </select>
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
            
            <div className="flex gap-3 items-center">
              <div className="flex flex-col gap-1">
                <span className="font-mono text-[9px] uppercase tracking-widest text-[#94a3b8] text-right">Template</span>
                <select
                  value={templateType}
                  onChange={e => setTemplateType(e.target.value)}
                  className="bg-surface border border-line rounded px-2.5 py-1 text-xs text-[#0f172a] outline-none focus:border-[#ea580c]/50 cursor-pointer font-medium"
                >
                  <option value="type1">Template 1 (New)</option>
                  <option value="original">Template 2 (Old)</option>
                </select>
              </div>
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
                className="flex-1 bg-raised border border-line rounded px-3 py-2 text-sm text-[#0f172a] placeholder:text-[#cbd5e1] outline-none focus:border-[#ea580c]/50 transition-colors"
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
                {displayedSchedules.map(s => (
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

            {filtered.length > currentPage * ITEMS_PER_PAGE && (
              <div className="p-5 border-t border-line text-center bg-raised">
                <Button variant="ghost" onClick={() => setCurrentPage(p => p + 1)}>
                  ➕ Load More ({filtered.length - currentPage * ITEMS_PER_PAGE} rows hidden)
                </Button>
              </div>
            )}

            {filtered.length === 0 && (
              <div className="py-16 text-center">
                <p className="font-mono text-xs text-[#94a3b8] mb-2">No schedules matched the filter.</p>
                <p className="text-xs text-[#64748b]">Upload your schedule spreadsheet (.xlsx) or HTML schedule grid to visualize.</p>
              </div>
            )}
          </Panel>
        </>
      )}

      {/* Interactive Mapping Modal */}
      {showMappingModal && previewData && (() => {
        const getColLetter = (idx: number) => {
          return String.fromCharCode(65 + idx);
        };

        const getCellRole = (r: number, c: number) => {
          if (r === monthRow && c >= startCol) return { name: 'Month', bg: 'bg-[#e8f5e9] border border-[#a5d6a7] text-[#2e7d32]' };
          if (r === dayOfWeekRow && c >= startCol) return { name: 'Day of Week', bg: 'bg-[#e8f5e9] border border-[#a5d6a7] text-[#2e7d32]' };
          if (r === dateRow && c >= startCol) return { name: 'Date', bg: 'bg-[#e8f5e9] border border-[#a5d6a7] text-[#2e7d32]' };
          if (r === maRow && c >= startCol) return { name: 'Session (M/A)', bg: 'bg-[#e8f5e9] border border-[#a5d6a7] text-[#2e7d32]' };
          if (r === sessionRow && c >= startCol) return { name: 'Slot/Period', bg: 'bg-[#e8f5e9] border border-[#a5d6a7] text-[#2e7d32]' };
          
          if (c === groupCol && r >= startRow) return { name: 'Study Group', bg: 'bg-[#e0f2fe] border border-[#bae6fd] text-[#0369a1]' };
          if (c === nameCol && r >= startRow) return { name: 'Full Name', bg: 'bg-[#e0f2fe] border border-[#bae6fd] text-[#0369a1]' };
          if (c === idCol && r >= startRow) return { name: 'Student ID', bg: 'bg-[#e0f2fe] border border-[#bae6fd] text-[#0369a1]' };
          
          return null;
        };

        const updateMapping = (key: string, val: number) => {
          if (key === 'month_row') setMonthRow(val);
          else if (key === 'day_of_week_row') setDayOfWeekRow(val);
          else if (key === 'date_row') setDateRow(val);
          else if (key === 'ma_row') setMaRow(val);
          else if (key === 'session_row') setSessionRow(val);
          else if (key === 'group_col') setGroupCol(val);
          else if (key === 'name_col') setNameCol(val);
          else if (key === 'id_col') setIdCol(val);
        };

        const rowMappings = [
          { key: 'month_row', label: 'Row containing Month', value: monthRow },
          { key: 'day_of_week_row', label: 'Row containing Day', value: dayOfWeekRow },
          { key: 'date_row', label: 'Row containing Date', value: dateRow },
          { key: 'ma_row', label: 'Row containing Session (M/A)', value: maRow },
          { key: 'session_row', label: 'Row containing Slot/Period', value: sessionRow },
        ];

        const colMappings = [
          { key: 'group_col', label: 'Column containing Study Group', value: groupCol },
          { key: 'name_col', label: 'Column containing Full Name', value: nameCol },
          { key: 'id_col', label: 'Column containing Student ID', value: idCol },
        ];

        return (
          <div className="fixed inset-0 bg-[#0f172a]/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <div className="bg-surface border border-line rounded-xl shadow-2xl w-full max-w-7xl h-[90vh] flex flex-col overflow-hidden">
              {/* Modal Header */}
              <div className="p-6 border-b border-line flex justify-between items-center bg-raised">
                <div>
                  <h2 className="text-xl font-bold text-[#0f172a] flex items-center gap-2">
                    🗺️ Interactive Excel Mapping Layout
                  </h2>
                  <p className="text-xs text-[#475569] mt-1">
                    Loading file: <span className="font-mono font-bold text-green">{previewData.filename}</span>. Click cells on the grid to set their corresponding rows and columns.
                  </p>
                </div>
                <button 
                  onClick={() => setShowMappingModal(false)}
                  className="text-[#94a3b8] hover:text-[#0f172a] text-2xl font-semibold outline-none"
                >
                  &times;
                </button>
              </div>

              {/* Modal Body */}
              <div className="flex-1 flex overflow-hidden">
                {/* Left Side: Interactive Table Grid Preview */}
                <div className="flex-1 p-6 overflow-auto bg-surface border-r border-line">
                  <div className="mb-4 flex items-center justify-between">
                    <span className="text-xs font-semibold text-[#0f172a]">Data Preview (First 25 Rows / 20 Columns):</span>
                    {selectedCell && (
                      <div className="text-xs bg-[#e8f5e9] border border-[#a5d6a7] text-[#2e7d32] px-3 py-1 rounded-full font-medium">
                        Selected: Row {selectedCell.row + 1}, Column {getColLetter(selectedCell.col)} (Col {selectedCell.col + 1}) = &ldquo;{previewData.grid[selectedCell.row]?.[selectedCell.col]?.text || ''}&rdquo;
                      </div>
                    )}
                  </div>
                  
                  <div className="border border-line rounded-lg overflow-auto shadow-sm max-w-full max-h-[60vh]">
                    <table className="border-collapse text-left w-full text-xs font-medium min-w-[1200px]">
                      <thead>
                        <tr className="bg-raised border-b border-line">
                          <th className="p-2 border-r border-line text-center text-[#94a3b8] font-mono bg-raised sticky left-0 z-20 w-12">#</th>
                          {previewData.grid[0]?.map((_, colIdx) => (
                            <th key={colIdx} className="p-2 border-r border-line text-center text-[#475569] font-mono sticky top-0 bg-raised">
                              {getColLetter(colIdx)}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {previewData.grid.map((row, rowIdx) => (
                          <tr key={rowIdx} className="border-b border-line hover:bg-raised/50">
                            <td className="p-2 border-r border-line text-center text-[#94a3b8] font-mono bg-raised sticky left-0 z-10 w-12">
                              {rowIdx + 1}
                            </td>
                            {row.map((cell, colIdx) => {
                              const isSelected = selectedCell?.row === rowIdx && selectedCell?.col === colIdx;
                              const cellRole = getCellRole(rowIdx, colIdx);
                              let cellClass = "p-2 border-r border-line cursor-pointer select-none truncate max-w-[150px] transition-all ";
                              
                              if (isSelected) {
                                cellClass += "bg-[#fff3e0] ring-2 ring-[#ffb74d] font-bold z-10 ";
                              } else if (cellRole) {
                                cellClass += cellRole.bg + " font-semibold ";
                              } else if (cell.color && cell.color !== 'NO_COLOR') {
                                cellClass += "bg-[#f1f5f9] ";
                              }
                              
                              return (
                                <td 
                                  key={colIdx} 
                                  className={cellClass}
                                  onClick={() => setSelectedCell({ row: rowIdx, col: colIdx })}
                                  title={`Row ${rowIdx+1}, Col ${getColLetter(colIdx)}: ${cell.text}`}
                                >
                                  <div className="flex flex-col">
                                    <span className="text-[#0f172a]">{cell.text}</span>
                                    {cellRole && (
                                      <span className="text-[9px] text-gray-500 font-mono tracking-tighter uppercase mt-0.5">
                                        {cellRole.name}
                                      </span>
                                    )}
                                  </div>
                                </td>
                              );
                            })}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div className="mt-4 p-4 bg-raised border border-line rounded-lg text-xs text-[#475569] flex flex-col gap-1">
                    <p className="font-semibold text-[#0f172a] mb-1">💡 Quick Guide:</p>
                    <p>1. <strong>Select Cell:</strong> Click any cell on the preview grid.</p>
                    <p>2. <strong>Map Row:</strong> Select a cell in the desired row on the left, then click "Map" next to the corresponding row config on the right.</p>
                    <p>3. <strong>Map Column:</strong> Select a cell in the desired column on the left, then click "Map" next to the corresponding column config on the right.</p>
                  </div>
                </div>

                {/* Right Side: Configuration Sidebar */}
                <div className="w-96 bg-raised p-6 overflow-auto flex flex-col gap-5 border-l border-line">
                  <div>
                    <h3 className="text-sm font-bold text-[#0f172a] uppercase tracking-wider mb-1">Mapping Configuration</h3>
                    <p className="text-xs text-[#475569]">Select a cell on the left grid and click the corresponding Map button.</p>
                  </div>

                  <div className="flex flex-col gap-4">
                    {/* Rows Config */}
                    <div className="bg-surface border border-line rounded-lg p-4 flex flex-col gap-3 shadow-sm">
                      <h4 className="text-xs font-bold text-green uppercase tracking-wide border-b border-line pb-1.5 flex items-center gap-1.5">
                        📅 Map Schedule Rows
                      </h4>
                      
                      {rowMappings.map(mapping => {
                        const isCurrentRow = selectedCell?.row !== undefined;
                        return (
                          <div key={mapping.key} className="flex justify-between items-center gap-2 text-xs">
                            <span className="text-[#475569] font-medium">{mapping.label}:</span>
                            <div className="flex items-center gap-1">
                              <span className="font-mono bg-raised border border-line px-2 py-0.5 rounded text-[#0f172a]">
                                Row {mapping.value + 1}
                              </span>
                              <Button 
                                variant="ghost" 
                                size="xs" 
                                disabled={!isCurrentRow}
                                onClick={() => updateMapping(mapping.key, selectedCell!.row)}
                                className="py-0.5 px-1.5 text-[10px] hover:bg-green/10 hover:text-green"
                              >
                                Map
                              </Button>
                            </div>
                          </div>
                        );
                      })}
                    </div>

                    {/* Columns Config */}
                    <div className="bg-surface border border-line rounded-lg p-4 flex flex-col gap-3 shadow-sm">
                      <h4 className="text-xs font-bold text-blue uppercase tracking-wide border-b border-line pb-1.5 flex items-center gap-1.5">
                        👤 Map Student Columns
                      </h4>
                      
                      {colMappings.map(mapping => {
                        const isCurrentCol = selectedCell?.col !== undefined;
                        return (
                          <div key={mapping.key} className="flex justify-between items-center gap-2 text-xs">
                            <span className="text-[#475569] font-medium">{mapping.label}:</span>
                            <div className="flex items-center gap-1">
                              <span className="font-mono bg-raised border border-line px-2 py-0.5 rounded text-[#0f172a]">
                                Column {getColLetter(mapping.value)}
                              </span>
                              <Button 
                                variant="ghost" 
                                size="xs" 
                                disabled={!isCurrentCol}
                                onClick={() => updateMapping(mapping.key, selectedCell!.col)}
                                className="py-0.5 px-1.5 text-[10px] hover:bg-blue/10 hover:text-blue"
                              >
                                Map
                              </Button>
                            </div>
                          </div>
                        );
                      })}
                    </div>

                    {/* Boundaries Config */}
                    <div className="bg-surface border border-line rounded-lg p-4 flex flex-col gap-3 shadow-sm">
                      <h4 className="text-xs font-bold text-[#ffab00] uppercase tracking-wide border-b border-line pb-1.5 flex items-center gap-1.5">
                        🏁 Data Start Point
                      </h4>
                      
                      <div className="flex justify-between items-center gap-2 text-xs">
                        <span className="text-[#475569] font-medium">Schedule Start Column:</span>
                        <div className="flex items-center gap-1">
                          <span className="font-mono bg-raised border border-line px-2 py-0.5 rounded text-[#0f172a]">
                            Column {getColLetter(startCol)}
                          </span>
                          <Button 
                            variant="ghost" 
                            size="xs" 
                            disabled={selectedCell?.col === undefined}
                            onClick={() => setStartCol(selectedCell!.col)}
                            className="py-0.5 px-1.5 text-[10px] hover:bg-amber/10 hover:text-amber"
                          >
                            Map
                          </Button>
                        </div>
                      </div>

                      <div className="flex justify-between items-center gap-2 text-xs">
                        <span className="text-[#475569] font-medium">First Student Row:</span>
                        <div className="flex items-center gap-1">
                          <span className="font-mono bg-raised border border-line px-2 py-0.5 rounded text-[#0f172a]">
                            Row {startRow + 1}
                          </span>
                          <Button 
                            variant="ghost" 
                            size="xs" 
                            disabled={selectedCell?.row === undefined}
                            onClick={() => setStartRow(selectedCell!.row)}
                            className="py-0.5 px-1.5 text-[10px] hover:bg-amber/10 hover:text-amber"
                          >
                            Map
                          </Button>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="mt-auto pt-4 border-t border-line flex flex-col gap-2">
                    <Button 
                      variant="primary" 
                      className="w-full justify-center py-2.5 font-bold" 
                      onClick={handleConfirmMappingImport}
                      disabled={importing}
                    >
                      {importing ? 'Importing...' : '🚀 Confirm & Import Schedule'}
                    </Button>
                    <Button 
                      variant="ghost" 
                      className="w-full justify-center" 
                      onClick={() => setShowMappingModal(false)}
                    >
                      Cancel
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  )
}
