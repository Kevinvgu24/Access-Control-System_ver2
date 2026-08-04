import { useState, useEffect, useMemo } from 'react'
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
  in_use: 'In Use',
  maintenance: 'Maintenance',
  broken: 'Broken'
}

const CATEGORY_OPTS = ['All', 'Module', 'Sensor', 'Microcontroller', 'Device', 'Tool']

export function EquipmentPage() {
  const { selectedLabId } = useLabStore()
  const { equipment, fetchEquipment, addEquipment, updateEquipment, deleteEquipment } = useAdminStore()

  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<EquipmentStatus | 'all'>('all')
  const [categoryFilter, setCategoryFilter] = useState('All')
  const [currentPage, setCurrentPage] = useState(1)

  // Modals state
  const [showAddModal, setShowAddModal] = useState(false)
  const [editingItem, setEditingItem] = useState<Equipment | null>(null)

  // Form State
  const [serialNumber, setSerialNumber] = useState('')
  const [name, setName] = useState('')
  const [category, setCategory] = useState('Module')
  const [status, setStatus] = useState<EquipmentStatus>('available')
  const [assignedTo, setAssignedTo] = useState('')
  const [location, setLocation] = useState('')
  const [specs, setSpecs] = useState('')
  const [notes, setNotes] = useState('')
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (selectedLabId) {
      fetchEquipment(selectedLabId)
    }
  }, [selectedLabId, fetchEquipment])

  const filtered = useMemo(() => {
    return (equipment || []).filter(item => {
      if (!item) return false
      const sNum = (item.serialNumber || '').toLowerCase()
      const eqName = (item.name || '').toLowerCase()
      const eqCat = (item.category || '').toLowerCase()
      const eqAssigned = (item.assignedTo || '').toLowerCase()
      const searchLower = (search || '').toLowerCase()

      const matchesSearch =
        !searchLower ||
        sNum.includes(searchLower) ||
        eqName.includes(searchLower) ||
        eqCat.includes(searchLower) ||
        eqAssigned.includes(searchLower)

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
  const issueCount = (equipment || []).filter(i => i.status === 'maintenance' || i.status === 'broken').length

  const openAddModal = () => {
    setSerialNumber('')
    setName('')
    setCategory('Module')
    setStatus('available')
    setAssignedTo('')
    setLocation('')
    setSpecs('')
    setNotes('')
    setShowAddModal(true)
  }

  const openEditModal = (item: Equipment) => {
    setEditingItem(item)
    setSerialNumber(item.serialNumber)
    setName(item.name)
    setCategory(item.category)
    setStatus(item.status)
    setAssignedTo(item.assignedTo || '')
    setLocation(item.location || '')
    setSpecs(item.specs || '')
    setNotes(item.notes || '')
  }

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!selectedLabId) return
    if (!serialNumber.trim() || !name.trim()) {
      alert('Serial Number and Name are required.')
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
          assignedTo: assignedTo.trim(),
          location: location.trim(),
          specs: specs.trim(),
          notes: notes.trim()
        })
        alert('Equipment updated successfully!')
        setEditingItem(null)
      } else {
        await addEquipment(selectedLabId, {
          serialNumber: serialNumber.trim(),
          name: name.trim(),
          category,
          status,
          assignedTo: assignedTo.trim(),
          location: location.trim(),
          specs: specs.trim(),
          notes: notes.trim()
        })
        alert('Equipment added successfully!')
        setShowAddModal(false)
      }
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to save equipment')
    } finally {
      setSubmitting(false)
    }
  }

  const handleDelete = async (id: string, serial: string) => {
    if (!selectedLabId) return
    if (confirm(`Are you sure you want to delete equipment [${serial}]?`)) {
      try {
        await deleteEquipment(selectedLabId, id)
        alert('Equipment deleted successfully!')
      } catch (err) {
        alert(err instanceof Error ? err.message : 'Failed to delete equipment')
      }
    }
  }

  const chipClass = (active: boolean) =>
    `px-3 py-1.5 rounded font-mono text-[11px] border cursor-pointer transition-colors ${
      active ? 'bg-[#ffedd5] border-[#ea580c] text-[#ea580c]' : 'bg-raised border-slate-200 text-[#475569] hover:text-[#334155]'
    }`

  return (
    <div className="flex flex-col gap-7">
      {/* Header */}
      <div className="flex justify-between items-end gap-4 flex-wrap">
        <div>
          <p className="font-mono text-xs uppercase tracking-widest text-[#ea580c] font-bold mb-1">INVENTORY</p>
          <h1 className="text-2xl font-extrabold text-[#0f172a] tracking-tight">Lab Equipment & Modules</h1>
          <p className="text-sm text-[#475569] mt-1">Manage hardware modules, sensors, and equipment for room <strong className="font-mono text-[#ea580c]">{selectedLabId}</strong>.</p>
        </div>
        <Button variant="primary" onClick={openAddModal}>+ Add Equipment / Module</Button>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
        {[
          { label: 'Total Inventory', value: totalCount, color: 'text-[#0f172a]' },
          { label: 'Available', value: availableCount, color: 'text-green' },
          { label: 'In Use / Borrowed', value: inUseCount, color: 'text-blue' },
          { label: 'Maintenance / Issues', value: issueCount, color: 'text-amber' },
        ].map(({ label, value, color }) => (
          <div key={label} className="bg-surface border border-line rounded-lg p-5 shadow-sm">
            <p className="font-mono text-[10px] uppercase tracking-widest text-[#94a3b8] mb-2">{label}</p>
            <p className={`text-4xl font-bold ${color}`}>{value}</p>
          </div>
        ))}
      </div>

      {/* Main Panel */}
      <Panel pad={false} className="overflow-x-auto">
        {/* Controls Layout in 2 distinct rows */}
        <div className="p-5 border-b border-line flex flex-col gap-3">
          {/* Row 1: Search Box */}
          <div className="flex items-center">
            <input
              type="text"
              placeholder="Search by serial number, name, category, or assigned user..."
              value={search}
              onChange={e => { setSearch(e.target.value); setCurrentPage(1); }}
              className="bg-raised border border-line rounded px-4 py-2 text-sm text-[#0f172a] placeholder:text-[#cbd5e1] outline-none focus:border-[#ea580c]/50 transition-colors w-full sm:w-96"
            />
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
              {['Serial Number', 'Equipment Name', 'Category', 'Status', 'Assigned To', 'Location', 'Actions'].map(h => (
                <th key={h} className="text-left px-5 py-3 font-mono text-[10px] uppercase tracking-widest text-[#94a3b8] border-b border-line">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {paginatedEquipment.map(item => (
              <tr key={item.id} className="border-b border-line hover:bg-slate-50/50 transition-colors">
                <td className="px-5 py-4 font-mono text-xs font-bold text-[#ea580c]">{item.serialNumber}</td>
                <td className="px-5 py-4 font-medium text-sm text-[#0f172a]">
                  {item.name}
                  {item.notes && <p className="text-[11px] text-[#94a3b8] font-normal">{item.notes}</p>}
                </td>
                <td className="px-5 py-4 text-xs text-[#475569]">
                  <span className="bg-slate-100 border border-slate-200 px-2 py-0.5 rounded font-mono text-[11px]">{item.category}</span>
                </td>
                <td className="px-5 py-4">
                  <Badge tone={STATUS_TONE[item.status] || 'green'}>{STATUS_LABEL[item.status] || item.status}</Badge>
                </td>
                <td className="px-5 py-4 text-xs font-medium text-[#0f172a]">{item.assignedTo || '-'}</td>
                <td className="px-5 py-4 text-xs text-[#475569]">{item.location || '-'}</td>
                <td className="px-5 py-4">
                  <div className="flex gap-2">
                    <Button variant="ghost" size="xs" onClick={() => openEditModal(item)}>Edit</Button>
                    <Button variant="ghost" size="xs" onClick={() => handleDelete(item.id, item.serialNumber)} className="text-red hover:bg-red/5">Delete</Button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        <Pagination currentPage={currentPage} totalItems={filtered.length} pageSize={PAGE_SIZE} onPageChange={setCurrentPage} />
        {filtered.length === 0 && (
          <p className="py-12 text-center font-mono text-xs text-[#94a3b8]">No equipment matches the selected filters for this lab.</p>
        )}
      </Panel>

      {/* Add / Edit Equipment Modal */}
      {(showAddModal || editingItem) && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/60" onClick={() => !submitting && (setShowAddModal(false), setEditingItem(null))} />
          <div className="relative z-10 w-full max-w-lg bg-surface border border-line rounded-xl shadow-2xl p-6 flex flex-col gap-5">
            <div className="flex justify-between items-center border-b border-line pb-3">
              <h3 className="text-lg font-bold text-[#0f172a]">
                {editingItem ? 'Edit Equipment Details' : 'Add New Equipment / Module'}
              </h3>
              <button
                onClick={() => !submitting && (setShowAddModal(false), setEditingItem(null))}
                className="text-[#94a3b8] hover:text-[#0f172a] transition-colors text-xl cursor-pointer"
              >x</button>
            </div>

            <form onSubmit={handleSave} className="flex flex-col gap-4">
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
                  {submitting ? 'Saving...' : editingItem ? 'Save Changes' : 'Add Equipment'}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
