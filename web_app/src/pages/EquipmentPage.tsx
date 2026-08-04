import { useState, useEffect, useMemo, useRef } from 'react'
import { useAdminStore } from '@/store/adminStore'
import { useLabStore }   from '@/store/labStore'
import { Panel } from '@/components/ui/Panel'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Pagination } from '@/components/ui/Pagination'
import type { Equipment, EquipmentStatus } from '@/types/admin'

const STATUS_TONE: Record<EquipmentStatus, 'green' | 'blue' | 'amber' | 'red'> = {
  available: 'green',
  in_use: 'blue',
  maintenance: 'amber',
  broken: 'red'
}

const STATUS_LABEL: Record<EquipmentStatus, string> = {
  available: 'Available',
  in_use: 'In Use / Borrowed',
  maintenance: 'Maintenance',
  broken: 'Broken'
}

const CATEGORY_OPTS = ['All', 'Module', 'Sensor', 'Microcontroller', 'Device', 'Tool']

function getTodayStr() {
  const d = new Date()
  return d.toISOString().split('T')[0]
}

function getNextWeekStr() {
  const d = new Date()
  d.setDate(d.getDate() + 7)
  return d.toISOString().split('T')[0]
}

// Compress uploaded image to Max 600px width/height Base64 JPEG to keep payload lightweight
function compressImage(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.readAsDataURL(file)
    reader.onload = (event) => {
      const img = new Image()
      img.src = event.target?.result as string
      img.onload = () => {
        const canvas = document.createElement('canvas')
        const MAX_WIDTH = 600
        const MAX_HEIGHT = 600
        let width = img.width
        let height = img.height

        if (width > height) {
          if (width > MAX_WIDTH) {
            height *= MAX_WIDTH / width
            width = MAX_WIDTH
          }
        } else {
          if (height > MAX_HEIGHT) {
            width *= MAX_HEIGHT / height
            height = MAX_HEIGHT
          }
        }

        canvas.width = width
        canvas.height = height
        const ctx = canvas.getContext('2d')
        ctx?.drawImage(img, 0, 0, width, height)
        resolve(canvas.toDataURL('image/jpeg', 0.85))
      }
      img.onerror = (err) => reject(err)
    }
    reader.onerror = (err) => reject(err)
  })
}

export function EquipmentPage() {
  const { selectedLabId } = useLabStore()
  const { equipment, fetchEquipment, addEquipment, updateEquipment, deleteEquipment, borrowEquipment, returnEquipment } = useAdminStore()

  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<EquipmentStatus | 'all'>('all')
  const [categoryFilter, setCategoryFilter] = useState('All')
  const [currentPage, setCurrentPage] = useState(1)

  // Modals state
  const [showAddModal, setShowAddModal] = useState(false)
  const [editingItem, setEditingItem] = useState<Equipment | null>(null)
  const [borrowingItem, setBorrowingItem] = useState<Equipment | null>(null)

  // Context Menu state
  const [contextMenu, setContextMenu] = useState<{
    x: number
    y: number
    item: Equipment
  } | null>(null)

  // Hover Preview Tooltip state
  const [hoverPreview, setHoverPreview] = useState<{
    x: number
    y: number
    item: Equipment
    visible: boolean
  } | null>(null)

  const leaveTimerRef = useRef<NodeJS.Timeout | null>(null)

  // Form State - Add/Edit
  const [serialNumber, setSerialNumber] = useState('')
  const [name, setName] = useState('')
  const [category, setCategory] = useState('Module')
  const [status, setStatus] = useState<EquipmentStatus>('available')
  const [location, setLocation] = useState('')
  const [specs, setSpecs] = useState('')
  const [notes, setNotes] = useState('')
  const [image, setImage] = useState('')
  const [submitting, setSubmitting] = useState(false)

  // Form State - Borrowing
  const [borrowerName, setBorrowerName] = useState('')
  const [borrowerId, setBorrowerId] = useState('')
  const [borrowDate, setBorrowDate] = useState(getTodayStr())
  const [returnDate, setReturnDate] = useState(getNextWeekStr())
  const [borrowNotes, setBorrowNotes] = useState('')

  // Toast Notification state
  const [toast, setToast] = useState<{
    message: string
    type: 'success' | 'error'
  } | null>(null)

  const showToast = (message: string, type: 'success' | 'error' = 'success') => {
    setToast({ message, type })
  }

  useEffect(() => {
    if (!toast) return
    const timer = setTimeout(() => {
      setToast(null)
    }, 4000)
    return () => clearTimeout(timer)
  }, [toast])

  useEffect(() => {
    if (selectedLabId) {
      fetchEquipment(selectedLabId)
    }
  }, [selectedLabId, fetchEquipment])

  // Close context menu on outside click
  useEffect(() => {
    const handleOutsideClick = () => setContextMenu(null)
    window.addEventListener('click', handleOutsideClick)
    return () => window.removeEventListener('click', handleOutsideClick)
  }, [])

  const handleRowContextMenu = (e: React.MouseEvent, item: Equipment) => {
    e.preventDefault()
    setHoverPreview(null)
    setContextMenu({
      x: e.clientX,
      y: e.clientY,
      item
    })
  }

  const handleCellMouseMove = (e: React.MouseEvent, item: Equipment) => {
    if (contextMenu) return
    if (leaveTimerRef.current) {
      clearTimeout(leaveTimerRef.current)
      leaveTimerRef.current = null
    }
    // Calculate tooltip coordinates keeping within viewport
    const x = Math.min(e.clientX + 16, window.innerWidth - 180)
    const y = Math.min(e.clientY + 16, window.innerHeight - 180)
    setHoverPreview(prev => (prev ? { ...prev, x, y, item, visible: true } : { x, y, item, visible: true }))
  }

  const handleCellMouseLeave = () => {
    setHoverPreview(prev => (prev ? { ...prev, visible: false } : null))
    if (leaveTimerRef.current) clearTimeout(leaveTimerRef.current)
    leaveTimerRef.current = setTimeout(() => {
      setHoverPreview(null)
    }, 200)
  }

  const handleImageFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    if (!file.type.startsWith('image/')) {
      alert('Please select a valid PNG or JPEG image file.')
      return
    }
    try {
      const base64 = await compressImage(file)
      setImage(base64)
    } catch (err) {
      alert('Failed to process image file.')
    }
  }

  const filtered = useMemo(() => {
    return (equipment || []).filter(item => {
      if (!item) return false
      const sNum = (item.serialNumber || '').toLowerCase()
      const eqName = (item.name || '').toLowerCase()
      const eqCat = (item.category || '').toLowerCase()
      const eqBorrower = (item.borrowerName || '').toLowerCase()
      const eqBorrowerId = (item.borrowerId || '').toLowerCase()
      const searchLower = (search || '').toLowerCase()

      const matchesSearch =
        !searchLower ||
        sNum.includes(searchLower) ||
        eqName.includes(searchLower) ||
        eqCat.includes(searchLower) ||
        eqBorrower.includes(searchLower) ||
        eqBorrowerId.includes(searchLower)

      const matchesStatus = statusFilter === 'all' || item.status === statusFilter
      const matchesCategory = categoryFilter === 'All' || item.category === categoryFilter

      return matchesSearch && matchesStatus && matchesCategory
    })
  }, [equipment, search, statusFilter, categoryFilter])

  const PAGE_SIZE = 25
  const paginatedEquipment = useMemo(() => {
    const start = (currentPage - 1) * PAGE_SIZE
    return (filtered || []).slice(start, start + PAGE_SIZE)
  }, [filtered, currentPage])

  // Stats calculation
  const totalCount = (equipment || []).length
  const availableCount = (equipment || []).filter(i => i.status === 'available').length
  const inUseCount = (equipment || []).filter(i => i.status === 'in_use').length
  const overdueCount = (equipment || []).filter(i => i.status === 'in_use' && !!i.returnDate && i.returnDate < getTodayStr()).length
  const issueCount = (equipment || []).filter(i => i.status === 'maintenance' || i.status === 'broken').length

  const openAddModal = () => {
    setSerialNumber('')
    setName('')
    setCategory('Module')
    setStatus('available')
    setLocation('')
    setSpecs('')
    setNotes('')
    setImage('')
    setShowAddModal(true)
  }

  const openEditModal = (item: Equipment) => {
    setEditingItem(item)
    setSerialNumber(item.serialNumber)
    setName(item.name)
    setCategory(item.category)
    setStatus(item.status)
    setLocation(item.location || '')
    setSpecs(item.specs || '')
    setNotes(item.notes || '')
    setImage(item.image || '')
  }

  const openBorrowModal = (item: Equipment) => {
    setBorrowingItem(item)
    setBorrowerName(item.borrowerName || '')
    setBorrowerId(item.borrowerId || '')
    setBorrowDate(item.borrowDate || getTodayStr())
    setReturnDate(item.returnDate || getNextWeekStr())
    setBorrowNotes(item.borrowNotes || '')
  }

  const handleSaveAddEdit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!selectedLabId) return
    if (!serialNumber.trim() || !name.trim()) {
      showToast('Serial Number and Name are required.', 'error')
      return
    }

    setSubmitting(true)
    try {
      if (editingItem) {
        await updateEquipment(selectedLabId, editingItem.id, {
          serialNumber: serialNumber.trim(),
          name: name.trim(),
          category,
          status,
          location: location.trim(),
          specs: specs.trim(),
          notes: notes.trim(),
          image
        })
        showToast(`Equipment [${serialNumber.trim()}] updated successfully!`, 'success')
        setEditingItem(null)
      } else {
        await addEquipment(selectedLabId, {
          serialNumber: serialNumber.trim(),
          name: name.trim(),
          category,
          status,
          location: location.trim(),
          specs: specs.trim(),
          notes: notes.trim(),
          image
        })
        showToast(`Equipment [${serialNumber.trim()}] added successfully to lab!`, 'success')
        setShowAddModal(false)
      }
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to save equipment', 'error')
    } finally {
      setSubmitting(false)
    }
  }

  const handleConfirmBorrow = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!selectedLabId || !borrowingItem) return
    if (!borrowerName.trim() || !borrowerId.trim()) {
      showToast('Student Name and Student ID are required to checkout equipment.', 'error')
      return
    }

    setSubmitting(true)
    try {
      await borrowEquipment(
        selectedLabId,
        borrowingItem.id,
        {
          borrowerName: borrowerName.trim(),
          borrowerId: borrowerId.trim(),
          borrowDate,
          returnDate,
          borrowNotes: borrowNotes.trim()
        },
        borrowingItem.name,
        borrowingItem.serialNumber
      )
      showToast(`Equipment [${borrowingItem.serialNumber}] successfully checked out to ${borrowerName.trim()}!`, 'success')
      setBorrowingItem(null)
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to process equipment borrowing', 'error')
    } finally {
      setSubmitting(false)
    }
  }

  const handleReturnEquipment = async (item: Equipment) => {
    if (!selectedLabId) return
    if (confirm(`Confirm return of equipment "${item.name}" [${item.serialNumber}] to lab storage?`)) {
      try {
        await returnEquipment(selectedLabId, item.id, item.name, item.serialNumber)
        showToast(`Equipment [${item.serialNumber}] returned to available inventory!`, 'success')
      } catch (err) {
        showToast(err instanceof Error ? err.message : 'Failed to return equipment', 'error')
      }
    }
  }

  const handleDelete = async (id: string, serial: string) => {
    if (!selectedLabId) return
    if (confirm(`Are you sure you want to delete equipment [${serial}]?`)) {
      try {
        await deleteEquipment(selectedLabId, id)
        showToast(`Equipment [${serial}] deleted successfully!`, 'success')
      } catch (err) {
        showToast(err instanceof Error ? err.message : 'Failed to delete equipment', 'error')
      }
    }
  }

  const chipClass = (active: boolean) =>
    `px-3 py-1.5 rounded font-mono text-[11px] border cursor-pointer transition-colors ${
      active ? 'bg-[#ffedd5] border-[#ea580c] text-[#ea580c]' : 'bg-raised border-slate-200 text-[#475569] hover:text-[#334155]'
    }`

  return (
    <div className="flex flex-col gap-7 relative">
      {/* Header */}
      <div className="flex justify-between items-end gap-4 flex-wrap">
        <div>
          <p className="font-mono text-xs uppercase tracking-widest text-[#ea580c] font-bold mb-1">INVENTORY</p>
          <h1 className="text-2xl font-extrabold text-[#0f172a] tracking-tight">Lab Equipment & Modules</h1>
          <p className="text-sm text-[#475569] mt-1">
            Right-click any equipment row to <strong>Borrow</strong>, <strong>Return</strong>, or <strong>Delete</strong> it. Hover over an item to preview its photo.
          </p>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-5 gap-4">
        {[
          { label: 'Total Inventory', value: totalCount, color: 'text-[#0f172a]' },
          { label: 'Available In Lab', value: availableCount, color: 'text-green' },
          { label: 'Borrowed / In Use', value: inUseCount, color: 'text-blue' },
          { label: 'Overdue Borrowed', value: overdueCount, color: 'text-red font-extrabold' },
          { label: 'Maintenance / Issues', value: issueCount, color: 'text-amber' },
        ].map(({ label, value, color }) => (
          <div key={label} className="bg-surface border border-line rounded-lg p-4 shadow-sm flex flex-col justify-between h-32">
            <div className="h-10 flex items-start">
              <p className="font-mono text-xs uppercase tracking-wider font-bold text-[#475569] leading-snug">{label}</p>
            </div>
            <p className={`text-4xl font-bold ${color} mt-auto`}>{value}</p>
          </div>
        ))}
      </div>

      {/* Main Panel */}
      <Panel pad={false} className="overflow-x-auto">
        {/* Controls Layout in 2 distinct rows */}
        <div className="p-5 border-b border-line flex flex-col gap-3">
          {/* Row 1: Search Box & Add Equipment Button */}
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <input
              type="text"
              placeholder="Search by serial number, name, category, or student borrower..."
              value={search}
              onChange={e => { setSearch(e.target.value); setCurrentPage(1); }}
              className="bg-raised border border-line rounded px-4 py-2 text-sm text-[#0f172a] placeholder:text-[#cbd5e1] outline-none focus:border-[#ea580c]/50 transition-colors w-full sm:w-96"
            />
            <Button variant="primary" onClick={openAddModal}>+ Add Equipment / Device</Button>
          </div>

          {/* Row 2: Filter Option Chips */}
          <div className="flex flex-wrap items-center gap-4 pt-2 border-t border-slate-100">
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="font-mono text-[11px] text-[#94a3b8] uppercase tracking-wider font-bold mr-1">Status:</span>
              <button onClick={() => setStatusFilter('all')} className={chipClass(statusFilter === 'all')}>All</button>
              {(['available', 'in_use', 'maintenance', 'broken'] as const).map(st => (
                <button key={st} onClick={() => setStatusFilter(st)} className={chipClass(statusFilter === st)}>
                  {STATUS_LABEL[st]}
                </button>
              ))}
            </div>

            <span className="w-px h-4 bg-slate-200 hidden sm:inline" />

            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="font-mono text-[11px] text-[#94a3b8] uppercase tracking-wider font-bold mr-1">Category:</span>
              {CATEGORY_OPTS.map(cat => (
                <button key={cat} onClick={() => setCategoryFilter(cat)} className={chipClass(categoryFilter === cat)}>
                  {cat}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Equipment Table */}
        <table className="w-full border-collapse">
          <thead>
            <tr className="bg-raised">
              {[
                { label: 'Serial Number', class: 'text-left whitespace-nowrap px-4 py-3' },
                { label: 'Equipment Name', class: 'text-left px-4 py-3' },
                { label: 'Category', class: 'text-left whitespace-nowrap px-4 py-3' },
                { label: 'Status', class: 'text-left whitespace-nowrap px-4 py-3' },
                { label: 'Borrower / User', class: 'text-left whitespace-nowrap px-4 py-3 w-full' },
                { label: 'Return Date', class: 'text-left whitespace-nowrap px-4 py-3' },
                { label: 'Actions', class: 'text-right whitespace-nowrap px-4 py-3' }
              ].map(h => (
                <th key={h.label} className={`font-mono text-[11px] uppercase tracking-wider font-bold text-[#1e293b] border-b border-line bg-slate-100/70 ${h.class}`}>
                  {h.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {paginatedEquipment.map(item => {
              const todayStr = getTodayStr()
              const isOverdue = item.status === 'in_use' && !!item.returnDate && item.returnDate < todayStr
              const rowBgClass = isOverdue
                ? 'bg-red-50/90 hover:bg-red-100/90 border-l-4 border-l-red-500'
                : 'border-b border-line hover:bg-orange-50/40'

              return (
                <tr
                  key={item.id}
                  onContextMenu={(e) => handleRowContextMenu(e, item)}
                  className={`${rowBgClass} transition-colors cursor-pointer select-none`}
                  title={isOverdue ? 'OVERDUE: Equipment is past due date! Right-click to Return or manage.' : 'Hover over Equipment Name for photo preview. Right-click for options.'}
                >
                  <td className="px-4 py-3 font-mono text-xs font-bold text-[#ea580c] whitespace-nowrap">{item.serialNumber}</td>
                  <td 
                    className="px-4 py-3 font-medium text-sm text-[#0f172a]"
                    onMouseMove={(e) => handleCellMouseMove(e, item)}
                    onMouseLeave={handleCellMouseLeave}
                  >
                    <div className="flex items-center gap-2.5">
                      {item.image ? (
                        <img src={item.image} alt={item.name} className="w-8 h-8 rounded object-cover border border-line shadow-sm shrink-0" />
                      ) : (
                        <div className="w-8 h-8 rounded bg-slate-100 border border-slate-200 flex items-center justify-center text-slate-400 font-bold text-xs shrink-0">
                          📷
                        </div>
                      )}
                      <div>
                        <span className="font-semibold text-[#0f172a] block">{item.name}</span>
                        {item.location && <span className="text-[11px] text-[#94a3b8] block">Bin: {item.location}</span>}
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-xs text-[#475569]">
                    <span className="bg-slate-100 border border-slate-200 px-2 py-0.5 rounded font-mono text-[11px] whitespace-nowrap">{item.category}</span>
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    <Badge tone={STATUS_TONE[item.status] || 'green'}>{STATUS_LABEL[item.status] || item.status}</Badge>
                  </td>
                  <td className="px-4 py-3 text-xs font-medium text-[#0f172a]">
                    {item.borrowerName ? (
                      <div>
                        <p className="font-bold text-[#0f172a] whitespace-nowrap">{item.borrowerName}</p>
                        <p className="font-mono text-[11px] text-[#ea580c]">ID: {item.borrowerId}</p>
                      </div>
                    ) : (
                      <span className="text-[#cbd5e1] font-mono">-</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-xs font-mono text-[#475569] whitespace-nowrap">
                    {item.returnDate ? (
                      <div className="flex flex-col gap-1 items-start">
                        <span className={isOverdue ? "bg-red-100 text-red-800 font-bold border border-red-300 px-2 py-0.5 rounded text-[11px]" : "bg-amber/10 text-amber-800 border border-amber/20 px-2 py-0.5 rounded text-[11px]"}>
                          {item.returnDate}
                        </span>
                        {isOverdue && (
                          <span className="bg-red-600 text-white font-bold text-[9px] px-1.5 py-0.5 rounded uppercase tracking-wider animate-pulse">
                            OVERDUE WARNING
                          </span>
                        )}
                      </div>
                    ) : (
                      <span className="text-[#cbd5e1]">-</span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-right whitespace-nowrap">
                    <div className="flex flex-col items-end gap-1">
                      <div className="flex items-center justify-end gap-1.5">
                        {item.status === 'in_use' ? (
                          <Button variant="ghost" size="xs" onClick={() => handleReturnEquipment(item)} className="text-blue hover:bg-blue/5 h-6 px-2 text-[11px]">Return</Button>
                        ) : (
                          <Button variant="ghost" size="xs" onClick={() => openBorrowModal(item)} className="text-orange-600 hover:bg-orange-50 h-6 px-2 text-[11px]">Borrow</Button>
                        )}
                        <Button variant="ghost" size="xs" onClick={() => openEditModal(item)} className="h-6 px-2 text-[11px]">Edit</Button>
                      </div>
                      <Button variant="ghost" size="xs" onClick={() => handleDelete(item.id, item.serialNumber)} className="text-red hover:bg-red/5 h-6 px-2 text-[11px]">Delete</Button>
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>

        <Pagination currentPage={currentPage} totalItems={filtered.length} pageSize={PAGE_SIZE} onPageChange={setCurrentPage} />
        {filtered.length === 0 && (
          <p className="py-12 text-center font-mono text-xs text-[#94a3b8]">No equipment matches the selected filters for this lab.</p>
        )}
      </Panel>

      {/* Floating Mouse-Hover Equipment Preview Tooltip - Image Only */}
      {hoverPreview && !contextMenu && (
        <div
          style={{ top: hoverPreview.y, left: hoverPreview.x }}
          className={`fixed z-40 bg-surface border border-line rounded-xl shadow-2xl p-2 w-[154px] h-[154px] pointer-events-none flex items-center justify-center transition-all duration-200 ease-out transform ${
            hoverPreview.visible ? 'opacity-100 scale-100 translate-y-0' : 'opacity-0 scale-90 translate-y-1'
          }`}
        >
          {hoverPreview.item.image ? (
            <img src={hoverPreview.item.image} alt={hoverPreview.item.name} className="w-full h-full object-cover rounded-lg shadow-sm" />
          ) : (
            <div className="flex flex-col items-center justify-center gap-1.5 text-slate-400 w-full h-full bg-slate-50 rounded-lg">
              <span className="text-3xl">📷</span>
              <span className="font-mono text-[9px] uppercase tracking-wider">No Image</span>
            </div>
          )}
        </div>
      )}

      {/* Floating Right-Click Context Menu */}
      {contextMenu && (
        <div
          style={{ top: contextMenu.y, left: contextMenu.x }}
          className="fixed z-50 bg-white border border-line rounded-lg shadow-2xl min-w-[180px] overflow-hidden py-1.5 animate-in fade-in zoom-in-95 duration-100"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="px-3 py-1.5 border-b border-line bg-slate-50">
            <p className="font-mono text-[10px] text-[#94a3b8] uppercase font-bold">Equipment Actions</p>
            <p className="font-bold text-xs text-[#ea580c] truncate">{contextMenu.item.serialNumber}</p>
          </div>

          {contextMenu.item.status === 'in_use' ? (
            <button
              onClick={() => {
                const item = contextMenu.item
                setContextMenu(null)
                handleReturnEquipment(item)
              }}
              className="w-full text-left px-4 py-2 text-xs font-semibold text-blue hover:bg-blue-50 transition-colors flex items-center gap-2 cursor-pointer"
            >
              🔄 Return Equipment
            </button>
          ) : (
            <button
              onClick={() => {
                const item = contextMenu.item
                setContextMenu(null)
                openBorrowModal(item)
              }}
              className="w-full text-left px-4 py-2 text-xs font-semibold text-[#ea580c] hover:bg-orange-50 transition-colors flex items-center gap-2 cursor-pointer"
            >
              📦 Borrow Equipment
            </button>
          )}

          <button
            onClick={() => {
              const item = contextMenu.item
              setContextMenu(null)
              openEditModal(item)
            }}
            className="w-full text-left px-4 py-2 text-xs font-medium text-[#475569] hover:bg-slate-50 transition-colors flex items-center gap-2 cursor-pointer"
          >
            ✏️ Edit Details
          </button>

          <button
            onClick={() => {
              const item = contextMenu.item
              setContextMenu(null)
              handleDelete(item.id, item.serialNumber)
            }}
            className="w-full text-left px-4 py-2 text-xs font-semibold text-red hover:bg-red-50 transition-colors flex items-center gap-2 cursor-pointer"
          >
            🗑️ Delete Equipment
          </button>
        </div>
      )}

      {/* Borrow Equipment Modal */}
      {borrowingItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/60" onClick={() => !submitting && setBorrowingItem(null)} />
          <div className="relative z-10 w-full max-w-lg bg-surface border border-line rounded-xl shadow-2xl p-6 flex flex-col gap-5">
            <div className="flex justify-between items-center border-b border-line pb-3">
              <div>
                <p className="font-mono text-[10px] text-[#ea580c] uppercase font-bold">Equipment Checkout</p>
                <h3 className="text-lg font-bold text-[#0f172a]">Borrow "{borrowingItem.name}"</h3>
              </div>
              <button
                onClick={() => !submitting && setBorrowingItem(null)}
                className="text-[#94a3b8] hover:text-[#0f172a] transition-colors text-xl cursor-pointer"
              >x</button>
            </div>

            <form onSubmit={handleConfirmBorrow} className="flex flex-col gap-4">
              <div className="bg-raised border border-line rounded p-3 text-xs flex justify-between font-mono">
                <span className="text-[#475569]">Serial: <strong className="text-[#ea580c]">{borrowingItem.serialNumber}</strong></span>
                <span className="text-[#475569]">Category: <strong>{borrowingItem.category}</strong></span>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="flex flex-col gap-1.5">
                  <label className="font-mono text-[11px] uppercase tracking-widest text-[#475569] font-bold">Student Name *</label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. Nguyen Van A"
                    value={borrowerName}
                    onChange={e => setBorrowerName(e.target.value)}
                    className="bg-raised border border-line rounded px-3 py-2 text-sm text-[#0f172a] outline-none focus:border-[#ea580c]/50 w-full"
                  />
                </div>

                <div className="flex flex-col gap-1.5">
                  <label className="font-mono text-[11px] uppercase tracking-widest text-[#475569] font-bold">Student / University ID *</label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. 102240280"
                    value={borrowerId}
                    onChange={e => setBorrowerId(e.target.value)}
                    className="bg-raised border border-line rounded px-3 py-2 text-sm text-[#0f172a] font-mono outline-none focus:border-[#ea580c]/50 w-full"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="flex flex-col gap-1.5">
                  <label className="font-mono text-[11px] uppercase tracking-widest text-[#475569] font-bold">Borrow Date *</label>
                  <input
                    type="date"
                    required
                    value={borrowDate}
                    onChange={e => setBorrowDate(e.target.value)}
                    className="bg-raised border border-line rounded px-3 py-2 text-sm text-[#0f172a] outline-none focus:border-[#ea580c]/50 w-full [color-scheme:light]"
                  />
                </div>

                <div className="flex flex-col gap-1.5">
                  <label className="font-mono text-[11px] uppercase tracking-widest text-[#475569] font-bold">Expected Return Date *</label>
                  <input
                    type="date"
                    required
                    value={returnDate}
                    onChange={e => setReturnDate(e.target.value)}
                    className="bg-raised border border-line rounded px-3 py-2 text-sm text-[#0f172a] outline-none focus:border-[#ea580c]/50 w-full [color-scheme:light]"
                  />
                </div>
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="font-mono text-[11px] uppercase tracking-widest text-[#475569] font-bold">Borrowing Notes / Purpose</label>
                <textarea
                  placeholder="e.g. Borrowed for Course EE301 Lab Project..."
                  value={borrowNotes}
                  onChange={e => setBorrowNotes(e.target.value)}
                  rows={2}
                  className="bg-raised border border-line rounded px-3 py-2 text-sm text-[#0f172a] outline-none focus:border-[#ea580c]/50 w-full resize-none"
                />
              </div>

              <div className="flex gap-2 justify-end mt-3 pt-3 border-t border-line">
                <Button variant="ghost" type="button" onClick={() => setBorrowingItem(null)} disabled={submitting}>Cancel</Button>
                <Button variant="primary" type="submit" disabled={submitting || !borrowerName.trim() || !borrowerId.trim()}>
                  {submitting ? 'Saving...' : 'Confirm Borrow & Push Notification'}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Add / Edit Equipment Modal */}
      {(showAddModal || editingItem) && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/60" onClick={() => !submitting && (setShowAddModal(false), setEditingItem(null))} />
          <div className="relative z-10 w-full max-w-lg bg-surface border border-line rounded-xl shadow-2xl p-6 flex flex-col gap-5 max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-center border-b border-line pb-3">
              <h3 className="text-lg font-bold text-[#0f172a]">
                {editingItem ? 'Edit Equipment Details' : 'Add New Equipment / Device'}
              </h3>
              <button
                onClick={() => !submitting && (setShowAddModal(false), setEditingItem(null))}
                className="text-[#94a3b8] hover:text-[#0f172a] transition-colors text-xl cursor-pointer"
              >x</button>
            </div>

            <form onSubmit={handleSaveAddEdit} className="flex flex-col gap-4">
              {/* Equipment Photo Upload */}
              <div className="flex flex-col gap-1.5">
                <label className="font-mono text-[11px] uppercase tracking-widest text-[#475569] font-bold">Equipment Photo (PNG / JPEG)</label>
                <div className="flex items-center gap-4">
                  {image ? (
                    <div className="relative w-20 h-20 rounded-lg overflow-hidden border border-line group shrink-0">
                      <img src={image} alt="Preview" className="w-full h-full object-cover" />
                      <button
                        type="button"
                        onClick={() => setImage('')}
                        className="absolute inset-0 bg-black/60 text-white font-bold text-xs flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer"
                      >
                        Remove
                      </button>
                    </div>
                  ) : (
                    <div className="w-20 h-20 rounded-lg bg-raised border border-dashed border-slate-300 flex flex-col items-center justify-center text-slate-400 shrink-0">
                      <span className="text-2xl">📷</span>
                      <span className="text-[9px] font-mono uppercase">No Image</span>
                    </div>
                  )}

                  <div className="flex flex-col gap-1">
                    <input
                      type="file"
                      accept="image/png, image/jpeg, image/jpg"
                      onChange={handleImageFileChange}
                      className="text-xs text-slate-600 file:mr-3 file:py-1.5 file:px-3 file:rounded file:border-0 file:text-xs file:font-semibold file:bg-orange-50 file:text-orange-700 hover:file:bg-orange-100 cursor-pointer"
                    />
                    <span className="text-[10px] text-[#94a3b8]">Upload PNG or JPEG photo. Hovering over equipment will display a preview card.</span>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="flex flex-col gap-1.5">
                  <label className="font-mono text-[11px] uppercase tracking-widest text-[#475569] font-bold">Serial Number *</label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. MOD-ESP32-01"
                    value={serialNumber}
                    onChange={e => setSerialNumber(e.target.value)}
                    className="bg-raised border border-line rounded px-3 py-2 text-sm text-[#0f172a] font-mono outline-none focus:border-[#ea580c]/50 w-full"
                  />
                </div>

                <div className="flex flex-col gap-1.5">
                  <label className="font-mono text-[11px] uppercase tracking-widest text-[#475569] font-bold">Category</label>
                  <select
                    value={category}
                    onChange={e => setCategory(e.target.value)}
                    className="bg-raised border border-line rounded px-3 py-2 text-sm text-[#0f172a] outline-none focus:border-[#ea580c]/50 w-full cursor-pointer"
                  >
                    {CATEGORY_OPTS.filter(c => c !== 'All').map(c => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="font-mono text-[11px] uppercase tracking-widest text-[#475569] font-bold">Equipment Name *</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. ESP32 WROOM Development Module"
                  value={name}
                  onChange={e => setName(e.target.value)}
                  className="bg-raised border border-line rounded px-3 py-2 text-sm text-[#0f172a] outline-none focus:border-[#ea580c]/50 w-full"
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="font-mono text-[11px] uppercase tracking-widest text-[#475569] font-bold">Status</label>
                <select
                  value={status}
                  onChange={e => setStatus(e.target.value as EquipmentStatus)}
                  className="bg-raised border border-line rounded px-3 py-2 text-sm text-[#0f172a] outline-none focus:border-[#ea580c]/50 w-full cursor-pointer"
                >
                  {(['available', 'in_use', 'maintenance', 'broken'] as const).map(st => (
                    <option key={st} value={st}>{STATUS_LABEL[st]}</option>
                  ))}
                </select>
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="font-mono text-[11px] uppercase tracking-widest text-[#475569] font-bold">Location / Storage Bin</label>
                <input
                  type="text"
                  placeholder="e.g. Shelf A - Bin 3"
                  value={location}
                  onChange={e => setLocation(e.target.value)}
                  className="bg-raised border border-line rounded px-3 py-2 text-sm text-[#0f172a] outline-none focus:border-[#ea580c]/50 w-full"
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="font-mono text-[11px] uppercase tracking-widest text-[#475569] font-bold">Notes / Specs</label>
                <textarea
                  placeholder="Additional specifications or defect description..."
                  value={notes}
                  onChange={e => setNotes(e.target.value)}
                  rows={2}
                  className="bg-raised border border-line rounded px-3 py-2 text-sm text-[#0f172a] outline-none focus:border-[#ea580c]/50 w-full resize-none"
                />
              </div>

              <div className="flex gap-2 justify-end mt-3 pt-3 border-t border-line">
                <Button variant="ghost" type="button" onClick={() => (setShowAddModal(false), setEditingItem(null))} disabled={submitting}>Cancel</Button>
                <Button variant="primary" type="submit" disabled={submitting || !serialNumber.trim() || !name.trim()}>
                  {submitting ? 'Saving...' : editingItem ? 'Save Changes' : 'Add Equipment / Device'}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Floating Toast Notification Banner - Bottom Left Corner */}
      {toast && (
        <div
          className={`fixed bottom-6 left-6 z-50 flex items-center gap-3 px-4 py-3 rounded-xl shadow-2xl border animate-in slide-in-from-bottom-5 fade-in duration-300 max-w-md ${
            toast.type === 'success'
              ? 'bg-emerald-600 text-white border-emerald-500 shadow-emerald-900/30'
              : 'bg-rose-600 text-white border-rose-500 shadow-rose-900/30'
          }`}
        >
          <div className="w-7 h-7 rounded-full bg-white/20 flex items-center justify-center shrink-0 font-bold text-sm">
            {toast.type === 'success' ? '✓' : '✕'}
          </div>
          <div className="flex-1 text-xs font-semibold leading-relaxed pr-1">
            {toast.message}
          </div>
          <button
            type="button"
            onClick={() => setToast(null)}
            className="text-white/70 hover:text-white font-bold text-sm p-1 rounded hover:bg-white/10 transition-colors cursor-pointer"
          >
            ✕
          </button>
        </div>
      )}
    </div>
  )
}
