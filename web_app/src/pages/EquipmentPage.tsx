import { useState, useEffect, useMemo, useRef } from 'react'
import { useAdminStore } from '@/store/adminStore'
import { useLabStore }   from '@/store/labStore'
import { useAuthStore }  from '@/store/authStore'
import { subscribeVisibleLabs } from '@/lib/db'
import { Panel } from '@/components/ui/Panel'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Pagination } from '@/components/ui/Pagination'
import type { Equipment, EquipmentStatus, Lab } from '@/types/admin'

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
  const { selectedLabId, selectedLabName } = useLabStore()
  const { equipment, fetchEquipment, addEquipment, updateEquipment, deleteEquipment, borrowEquipment, returnEquipment } = useAdminStore()

  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<EquipmentStatus | 'all'>('all')
  const [categoryFilter, setCategoryFilter] = useState('All')
  const [currentPage, setCurrentPage] = useState(1)

  // Modals state
  const [showAddModal, setShowAddModal] = useState(false)
  const [editingItem, setEditingItem] = useState<Equipment | null>(null)
  const [borrowingItem, setBorrowingItem] = useState<Equipment | null>(null)
  const [deletingItem, setDeletingItem] = useState<Equipment | null>(null)
  const [removeReason, setRemoveReason] = useState<'broken' | 'relocate'>('broken')
  const [targetLabId, setTargetLabId] = useState('')
  const [removeNotes, setRemoveNotes] = useState('')
  const [availableLabs, setAvailableLabs] = useState<Lab[]>([])

  const { admin, labAccessIds } = useAuthStore()

  useEffect(() => {
    if (!admin) return
    return subscribeVisibleLabs({
      isSuperAdmin: admin.type === 'super_admin',
      labIds: labAccessIds,
      onData: nextLabs => {
        setAvailableLabs(nextLabs.filter(l => l.status !== 'inactive'))
      },
      onError: () => {}
    })
  }, [admin, labAccessIds])

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
  const [entryMode, setEntryMode] = useState<'individual' | 'batch'>('individual')
  const [serialNumber, setSerialNumber] = useState('')
  const [name, setName] = useState('')
  const [category, setCategory] = useState('Module')
  const [status, setStatus] = useState<EquipmentStatus>('available')
  const [quantity, setQuantity] = useState<number | ''>(1)
  const [location, setLocation] = useState('')
  const [specs, setSpecs] = useState('')
  const [notes, setNotes] = useState('')
  const [contractNumber, setContractNumber] = useState('')
  const [invoiceNumber, setInvoiceNumber] = useState('')
  const [purchaseDate, setPurchaseDate] = useState('')
  const [batchNumber, setBatchNumber] = useState('')
  const [image, setImage] = useState('')
  const [submitting, setSubmitting] = useState(false)

  // Form State - Borrowing
  const [borrowerName, setBorrowerName] = useState('')
  const [borrowerId, setBorrowerId] = useState('')
  const [borrowQty, setBorrowQty] = useState<number | ''>(1)
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

  // View Mode & Grouping state
  const [viewMode, setViewMode] = useState<'flat' | 'grouped'>('flat')
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({})

  const toggleGroup = (groupName: string) => {
    setExpandedGroups(prev => ({
      ...prev,
      [groupName]: !prev[groupName]
    }))
  }

  const groupedEquipment = useMemo(() => {
    const groups: Record<string, {
      name: string
      category: string
      image: string
      items: Equipment[]
      total: number
      available: number
      inUse: number
      maintenance: number
      broken: number
    }> = {}

    for (const item of filtered) {
      const key = (item.name || 'Unnamed Equipment').trim()
      if (!groups[key]) {
        groups[key] = {
          name: key,
          category: item.category || 'Module',
          image: item.image || '',
          items: [],
          total: 0,
          available: 0,
          inUse: 0,
          maintenance: 0,
          broken: 0
        }
      }

      const itemQty = item.quantity || 1
      const itemAvail = item.availableQty ?? (item.status === 'available' ? itemQty : 0)
      const itemInUse = item.inUseQty ?? (item.status === 'in_use' ? itemQty : 0)

      groups[key].items.push(item)
      groups[key].total += itemQty
      groups[key].available += itemAvail
      groups[key].inUse += itemInUse
      if (item.status === 'maintenance') {
        groups[key].maintenance += itemQty
      } else if (item.status === 'broken') {
        groups[key].broken += itemQty
      }
      if (!groups[key].image && item.image) {
        groups[key].image = item.image
      }
    }

    return Object.values(groups)
  }, [filtered])

  const PAGE_SIZE = 25
  const paginatedEquipment = useMemo(() => {
    const start = (currentPage - 1) * PAGE_SIZE
    return (filtered || []).slice(start, start + PAGE_SIZE)
  }, [filtered, currentPage])

  // Stats calculation considering bulk quantities
  const totalCount = (equipment || []).reduce((acc, i) => acc + (i.quantity || 1), 0)
  const availableCount = (equipment || []).reduce((acc, i) => acc + (i.availableQty ?? (i.status === 'available' ? (i.quantity || 1) : 0)), 0)
  const inUseCount = (equipment || []).reduce((acc, i) => acc + (i.inUseQty ?? (i.status === 'in_use' ? (i.quantity || 1) : 0)), 0)
  const overdueCount = (equipment || []).filter(i => i.status === 'in_use' && !!i.returnDate && i.returnDate < getTodayStr()).length
  const issueCount = (equipment || []).filter(i => i.status === 'maintenance' || i.status === 'broken').reduce((acc, i) => acc + (i.quantity || 1), 0)

  const getNextAvailableSeqNumber = (groupItems: Equipment[]): number => {
    const usedNumbers = new Set<number>()
    for (const item of groupItems) {
      const matches = item.serialNumber.match(/\d+/g)
      if (matches && matches.length > 0) {
        const num = parseInt(matches[matches.length - 1], 10)
        if (!isNaN(num) && num > 0) {
          usedNumbers.add(num)
        }
      }
    }

    let next = 1
    while (usedNumbers.has(next)) {
      next++
    }
    return next
  }

  const openAddModal = () => {
    setIsGroupAdd(false)
    setIsGroupBatch(false)
    setEntryMode('individual')
    setSerialNumber('')
    setName('')
    setCategory('Module')
    setStatus('available')
    setQuantity(1)
    setLocation('')
    setSpecs('')
    setNotes('')
    setContractNumber('')
    setInvoiceNumber('')
    setPurchaseDate(getTodayStr())
    setBatchNumber('')
    setImage('')
    setShowAddModal(true)
  }

  const openAddModalForGroup = (groupName: string, groupCategory: string, groupImage: string) => {
    const groupItems = (equipment || []).filter(
      item => (item.name || '').trim().toLowerCase() === groupName.trim().toLowerCase()
    )

    const isParentBatch = groupItems.some(i => (i.quantity || 1) > 1 || !!i.batchNumber)
    const nextSeq = getNextAvailableSeqNumber(groupItems)

    let prefix = groupName.trim().replace(/\s+/g, '-')
    if (groupItems.length > 0 && groupItems[0].serialNumber) {
      const rawSerial = groupItems[0].serialNumber.trim()
      const match = rawSerial.match(/^(.*?)(?:[#\-_]?\d+)?$/)
      if (match && match[1] && match[1].trim()) {
        prefix = match[1].trim().replace(/[\-_#\s]+$/, '')
      }
    }

    const autoSerial = `${prefix}-${String(nextSeq).padStart(3, '0')}`
    const existingBatchNumber = groupItems.find(i => !!i.batchNumber)?.batchNumber || ''

    setIsGroupAdd(true)
    setIsGroupBatch(isParentBatch)
    setEntryMode(isParentBatch ? 'batch' : 'individual')
    setSerialNumber(autoSerial)
    setName(groupName)
    setCategory(groupCategory || 'Module')
    setStatus('available')
    setQuantity(1)
    setLocation(groupItems[0]?.location || '')
    setSpecs(groupItems[0]?.specs || '')
    setNotes('')
    setContractNumber(groupItems[0]?.contractNumber || '')
    setInvoiceNumber(groupItems[0]?.invoiceNumber || '')
    setPurchaseDate(getTodayStr())
    setBatchNumber(existingBatchNumber)
    setImage(groupImage || '')
    setShowAddModal(true)
  }

  const openEditModal = (item: Equipment) => {
    const isBatch = (item.quantity || 1) > 1 || !!item.batchNumber
    setIsGroupAdd(false)
    setIsGroupBatch(isBatch)
    setEditingItem(item)
    setEntryMode(isBatch ? 'batch' : 'individual')
    setSerialNumber(item.serialNumber)
    setName(item.name)
    setCategory(item.category)
    setStatus(item.status)
    setQuantity(item.quantity || 1)
    setLocation(item.location || '')
    setSpecs(item.specs || '')
    setNotes(item.notes || '')
    setContractNumber(item.contractNumber || '')
    setInvoiceNumber(item.invoiceNumber || '')
    setPurchaseDate(item.purchaseDate || '')
    setBatchNumber(item.batchNumber || '')
    setImage(item.image || '')
  }

  const openBorrowModal = (item: Equipment) => {
    setBorrowingItem(item)
    setBorrowerName(item.borrowerName || '')
    setBorrowerId(item.borrowerId || '')
    setBorrowQty(1)
    setBorrowDate(item.borrowDate || getTodayStr())
    setReturnDate(item.returnDate || getNextWeekStr())
    setBorrowNotes(item.borrowNotes || '')
  }

  const handleSaveAddEdit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!selectedLabId) return
    if (!serialNumber.trim() || !name.trim()) {
      showToast('Serial Number / Batch Code and Name are required.', 'error')
      return
    }

    // Check for duplicate equipment model name when creating a new equipment type from main button
    const isDuplicateName = !editingItem && !isGroupAdd && (equipment || []).some(
      item => (item.name || '').trim().toLowerCase() === name.trim().toLowerCase()
    )

    if (isDuplicateName) {
      showToast(
        `An equipment model named "${name.trim()}" already exists in this lab. Please use "+ Add Serial Unit" on its group card to add more units.`,
        'error'
      )
      return
    }

    const numericQty = typeof quantity === 'number' && quantity > 0 ? quantity : 1
    const itemQty = entryMode === 'batch' ? numericQty : 1

    setSubmitting(true)
    try {
      if (editingItem) {
        const prevQty = editingItem.quantity || 1
        const prevInUse = editingItem.inUseQty || 0
        const newAvail = Math.max(0, itemQty - prevInUse)

        await updateEquipment(selectedLabId, editingItem.id, {
          serialNumber: serialNumber.trim(),
          name: name.trim(),
          category,
          status: newAvail === 0 ? 'in_use' : status,
          quantity: itemQty,
          availableQty: newAvail,
          inUseQty: prevInUse,
          location: location.trim(),
          specs: specs.trim(),
          notes: notes.trim(),
          contractNumber: contractNumber.trim(),
          invoiceNumber: invoiceNumber.trim(),
          purchaseDate,
          batchNumber: batchNumber.trim(),
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
          quantity: itemQty,
          availableQty: itemQty,
          inUseQty: 0,
          location: location.trim(),
          specs: specs.trim(),
          notes: notes.trim(),
          contractNumber: contractNumber.trim(),
          invoiceNumber: invoiceNumber.trim(),
          purchaseDate,
          batchNumber: batchNumber.trim(),
          image
        })
        showToast(`Equipment [${serialNumber.trim()}] (${itemQty} units) added successfully to lab!`, 'success')
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

    const avail = borrowingItem.availableQty ?? 1
    const numericBorrowQty = typeof borrowQty === 'number' && borrowQty > 0 ? borrowQty : 1
    const qtyToBorrow = Math.min(avail, numericBorrowQty)

    setSubmitting(true)
    try {
      await borrowEquipment(
        selectedLabId,
        borrowingItem.id,
        {
          borrowerName: borrowerName.trim(),
          borrowerId: borrowerId.trim(),
          borrowQty: qtyToBorrow,
          borrowDate,
          returnDate,
          borrowNotes: borrowNotes.trim()
        },
        borrowingItem.name,
        borrowingItem.serialNumber
      )
      showToast(`Equipment [${borrowingItem.serialNumber}] (${qtyToBorrow} unit${qtyToBorrow > 1 ? 's' : ''}) checked out to ${borrowerName.trim()}!`, 'success')
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

  const openDeleteModal = (item: Equipment) => {
    setDeletingItem(item)
    setRemoveReason('broken')
    setTargetLabId('')
    setRemoveNotes('')
  }

  const handleConfirmRemove = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!selectedLabId || !deletingItem) return

    setSubmitting(true)
    try {
      if (removeReason === 'relocate') {
        if (!targetLabId) {
          showToast('Please select a target destination lab for relocation.', 'error')
          setSubmitting(false)
          return
        }

        const targetLab = availableLabs.find(l => l.id === targetLabId)
        const targetLabName = targetLab ? targetLab.name : targetLabId

        const origNotes = deletingItem.notes || ''
        const transferNotice = `[Relocated from ${selectedLabName || selectedLabId}]${removeNotes.trim() ? `: ${removeNotes.trim()}` : ''}`
        const fullNotes = origNotes ? `${origNotes}\n${transferNotice}` : transferNotice

        // 1. Add equipment copy to target lab carrying over 100% of original equipment data
        await addEquipment(targetLabId, {
          serialNumber: deletingItem.serialNumber,
          name: deletingItem.name,
          category: deletingItem.category,
          status: 'available',
          quantity: deletingItem.quantity || 1,
          availableQty: deletingItem.availableQty ?? (deletingItem.quantity || 1),
          inUseQty: 0,
          location: deletingItem.location || '',
          specs: deletingItem.specs || '',
          notes: fullNotes,
          contractNumber: deletingItem.contractNumber || '',
          invoiceNumber: deletingItem.invoiceNumber || '',
          purchaseDate: deletingItem.purchaseDate || getTodayStr(),
          batchNumber: deletingItem.batchNumber || '',
          image: deletingItem.image || ''
        })

        // 2. Remove equipment from current lab
        await deleteEquipment(selectedLabId, deletingItem.id)

        showToast(`Equipment [${deletingItem.serialNumber}] relocated successfully to ${targetLabName}!`, 'success')
      } else {
        // Broken / Defective
        await deleteEquipment(selectedLabId, deletingItem.id)
        showToast(`Equipment [${deletingItem.serialNumber}] decommissioned (Damaged / Defective)!`, 'success')
      }
      setDeletingItem(null)
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to process equipment removal', 'error')
    } finally {
      setSubmitting(false)
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
          {/* Row 1: Search Box, View Mode Switch & Add Equipment Button */}
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <div className="flex items-center gap-3 flex-wrap flex-1">
              <input
                type="text"
                placeholder="Search by serial number, name, category, or student borrower..."
                value={search}
                onChange={e => { setSearch(e.target.value); setCurrentPage(1); }}
                className="bg-raised border border-line rounded px-4 py-2 text-sm text-[#0f172a] placeholder:text-[#cbd5e1] outline-none focus:border-[#ea580c]/50 transition-colors w-full sm:w-80"
              />

              {/* View Mode Toggle Switch */}
              <div className="flex items-center bg-slate-100 p-1 rounded-lg border border-slate-200">
                <button
                  type="button"
                  onClick={() => setViewMode('flat')}
                  className={`px-3 py-1 rounded-md font-mono text-xs font-bold transition-all cursor-pointer ${
                    viewMode === 'flat'
                      ? 'bg-white text-[#ea580c] shadow-sm'
                      : 'text-slate-500 hover:text-slate-800'
                  }`}
                >
                  📋 Flat View
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setViewMode('grouped')
                    const allExpanded: Record<string, boolean> = {}
                    groupedEquipment.forEach(g => { allExpanded[g.name] = true })
                    setExpandedGroups(allExpanded)
                  }}
                  className={`px-3 py-1 rounded-md font-mono text-xs font-bold transition-all cursor-pointer ${
                    viewMode === 'grouped'
                      ? 'bg-white text-[#ea580c] shadow-sm'
                      : 'text-slate-500 hover:text-slate-800'
                  }`}
                >
                  📦 Grouped View ({groupedEquipment.length})
                </button>
              </div>
            </div>

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

        {/* View Mode Rendering: Grouped View vs Flat View */}
        {viewMode === 'grouped' ? (
          <div className="flex flex-col gap-4 p-5">
            {groupedEquipment.map(group => {
              const isExpanded = expandedGroups[group.name] !== false
              return (
                <div key={group.name} className="border border-line rounded-xl overflow-hidden bg-surface shadow-sm transition-all">
                  {/* Group Header Card */}
                  <div
                    onClick={() => toggleGroup(group.name)}
                    className="p-4 bg-raised hover:bg-slate-100/80 transition-colors cursor-pointer flex items-center justify-between gap-4 flex-wrap border-b border-line"
                  >
                    <div className="flex items-center gap-3.5">
                      {group.image ? (
                        <img src={group.image} alt={group.name} className="w-11 h-11 rounded-lg object-cover border border-line shadow-sm shrink-0" />
                      ) : (
                        <div className="w-11 h-11 rounded-lg bg-slate-200 border border-slate-300 flex items-center justify-center text-slate-500 font-bold text-lg shrink-0">
                          📦
                        </div>
                      )}
                      <div>
                        <div className="flex items-center gap-2">
                          <h3 className="font-bold text-base text-[#0f172a]">{group.name}</h3>
                          <span className="bg-slate-200 text-slate-700 font-mono text-[10px] font-bold px-2 py-0.5 rounded">{group.category}</span>
                        </div>
                        <p className="text-xs text-slate-500 mt-0.5 font-medium">
                          {group.items.length} unit{group.items.length > 1 ? 's' : ''} registered in lab
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center gap-3 flex-wrap">
                      {/* Group Status Counters */}
                      <div className="flex items-center gap-2">
                        {group.available > 0 && (
                          <span className="bg-emerald-100/90 text-emerald-800 font-mono font-bold text-xs px-2.5 py-1 rounded-md border border-emerald-300 shadow-2xs">
                            {group.available} Available
                          </span>
                        )}
                        {group.inUse > 0 && (
                          <span className="bg-blue-100/90 text-blue-800 font-mono font-bold text-xs px-2.5 py-1 rounded-md border border-blue-300 shadow-2xs">
                            {group.inUse} In Use
                          </span>
                        )}
                        {group.maintenance > 0 && (
                          <span className="bg-amber-100/90 text-amber-800 font-mono font-bold text-xs px-2.5 py-1 rounded-md border border-amber-300 shadow-2xs">
                            {group.maintenance} Maintenance
                          </span>
                        )}
                        {group.broken > 0 && (
                          <span className="bg-rose-100/90 text-rose-800 font-mono font-bold text-xs px-2.5 py-1 rounded-md border border-rose-300 shadow-2xs">
                            {group.broken} Broken
                          </span>
                        )}
                      </div>

                      {/* Add Serial Unit button pre-filled with Group Name */}
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation()
                          openAddModalForGroup(group.name, group.category, group.image)
                        }}
                        className="text-xs font-bold text-[#ea580c] hover:bg-orange-100/60 px-3 py-1 rounded-md transition-colors border border-[#ea580c]/30 cursor-pointer"
                      >
                        + Add Serial Unit
                      </button>

                      <span className="text-slate-400 font-bold text-sm ml-1">
                        {isExpanded ? '▲' : '▼'}
                      </span>
                    </div>
                  </div>

                  {/* Group Unit Sub-Table (Expanded) */}
                  {isExpanded && (
                    <div className="overflow-x-auto">
                      <table className="w-full border-collapse">
                        <thead>
                          <tr className="bg-slate-100/60 border-b border-line">
                            <th className="px-5 py-2.5 text-left font-mono text-[10px] font-bold uppercase text-slate-600 whitespace-nowrap">Serial Number</th>
                            <th className="px-5 py-2.5 text-left font-mono text-[10px] font-bold uppercase text-slate-600 whitespace-nowrap">Location / Storage</th>
                            <th className="px-5 py-2.5 text-left font-mono text-[10px] font-bold uppercase text-slate-600 whitespace-nowrap">Status</th>
                            <th className="px-5 py-2.5 text-left font-mono text-[10px] font-bold uppercase text-slate-600 whitespace-nowrap w-full">Borrower / User</th>
                            <th className="px-5 py-2.5 text-left font-mono text-[10px] font-bold uppercase text-slate-600 whitespace-nowrap">Return Date</th>
                            <th className="px-5 py-2.5 text-right font-mono text-[10px] font-bold uppercase text-slate-600 whitespace-nowrap">Actions</th>
                          </tr>
                        </thead>
                        <tbody>
                          {group.items.map(item => {
                            const todayStr = getTodayStr()
                            const isOverdue = item.status === 'in_use' && !!item.returnDate && item.returnDate < todayStr
                            return (
                              <tr
                                key={item.id}
                                onContextMenu={(e) => handleRowContextMenu(e, item)}
                                className={`border-b border-line hover:bg-orange-50/30 transition-colors ${
                                  isOverdue ? 'bg-red-50/90' : ''
                                }`}
                              >
                                <td className="px-5 py-3 font-mono text-xs font-bold text-[#ea580c] whitespace-nowrap">
                                  <div className="flex flex-col gap-0.5">
                                    <span>{item.serialNumber}</span>
                                    <div className="flex items-center gap-1.5 flex-wrap">
                                      {item.purchaseDate && (
                                        <span className="text-[10px] font-normal text-slate-400 font-sans tracking-tight">
                                          Added: {item.purchaseDate}
                                        </span>
                                      )}
                                      {item.batchNumber && (
                                        <span className="text-[9px] font-mono font-bold text-orange-700 bg-orange-50 px-1.5 py-0.5 rounded border border-orange-200">
                                          Lot: {item.batchNumber}
                                        </span>
                                      )}
                                    </div>
                                  </div>
                                </td>
                                <td className="px-5 py-3 text-xs text-slate-700 font-medium">
                                  {item.location ? `Bin: ${item.location}` : <span className="text-slate-300">-</span>}
                                </td>
                                <td className="px-5 py-3 whitespace-nowrap">
                                  <Badge tone={STATUS_TONE[item.status] || 'green'}>
                                    {(item.quantity || 1) > 1
                                      ? (item.availableQty === 0 ? 'All Checked Out' : `${item.availableQty} Available`)
                                      : (STATUS_LABEL[item.status] || item.status)}
                                  </Badge>
                                </td>
                                <td className="px-5 py-3 text-xs font-medium text-[#0f172a]">
                                  {item.borrowerName ? (
                                    <div>
                                      <p className="font-bold text-[#0f172a] whitespace-nowrap">{item.borrowerName}</p>
                                      <p className="font-mono text-[11px] text-[#ea580c]">ID: {item.borrowerId}</p>
                                    </div>
                                  ) : (
                                    <span className="text-slate-300 font-mono">-</span>
                                  )}
                                </td>
                                <td className="px-5 py-3 text-xs font-mono text-[#475569] whitespace-nowrap">
                                  {item.returnDate ? (
                                    <span className={`inline-flex items-center gap-1 font-mono font-bold text-[11px] px-2.5 py-1 rounded-md border shadow-2xs ${
                                      isOverdue
                                        ? 'bg-rose-100 text-rose-800 border-rose-300 animate-pulse'
                                        : 'bg-amber-100/80 text-amber-900 border-amber-300/80'
                                    }`}>
                                      📅 {item.returnDate}
                                    </span>
                                  ) : (
                                    <span className="text-slate-300 font-mono">-</span>
                                  )}
                                </td>
                                <td className="px-5 py-2 text-right whitespace-nowrap">
                                  <div className="flex flex-col items-end gap-1">
                                    <div className="flex items-center justify-end gap-1">
                                      {(item.inUseQty || 0) > 0 && (
                                        <Button variant="ghost" size="xs" onClick={() => handleReturnEquipment(item)} className="text-blue hover:bg-blue/5 h-6 px-2 text-[11px] font-semibold">Return</Button>
                                      )}
                                      {(item.availableQty ?? 1) > 0 && (
                                        <Button variant="ghost" size="xs" onClick={() => openBorrowModal(item)} className="text-orange-600 hover:bg-orange-50 h-6 px-2 text-[11px] font-semibold">Borrow</Button>
                                      )}
                                    </div>
                                    <div className="flex items-center justify-end gap-1">
                                      <Button variant="ghost" size="xs" onClick={() => openEditModal(item)} className="h-6 px-2 text-[11px]">Edit</Button>
                                      <Button variant="ghost" size="xs" onClick={() => openDeleteModal(item)} className="text-red hover:bg-red/5 h-6 px-2 text-[11px]">Delete</Button>
                                    </div>
                                  </div>
                                </td>
                              </tr>
                            )
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )
            })}

            {groupedEquipment.length === 0 && (
              <p className="py-12 text-center font-mono text-xs text-[#94a3b8]">No equipment matches the selected filters for this lab.</p>
            )}
          </div>
        ) : (
          <>
            {/* Equipment Table (Flat View) */}
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
                      <td className="px-4 py-3 font-mono text-xs font-bold text-[#ea580c] whitespace-nowrap">
                        <div className="flex flex-col gap-0.5">
                          <span>{item.serialNumber}</span>
                          <div className="flex items-center gap-1.5 flex-wrap">
                            {item.purchaseDate && (
                              <span className="text-[10px] font-normal text-slate-400 font-sans tracking-tight">
                                Added: {item.purchaseDate}
                              </span>
                            )}
                            {item.batchNumber && (
                              <span className="text-[9px] font-mono font-bold text-orange-700 bg-orange-50 px-1.5 py-0.5 rounded border border-orange-200">
                                Lot: {item.batchNumber}
                              </span>
                            )}
                          </div>
                        </div>
                      </td>
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
                        <Badge tone={STATUS_TONE[item.status] || 'green'}>
                          {(item.quantity || 1) > 1
                            ? (item.availableQty === 0 ? 'All Checked Out' : `${item.availableQty} Available`)
                            : (STATUS_LABEL[item.status] || item.status)}
                        </Badge>
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
                      <td className="px-4 py-2 text-right whitespace-nowrap">
                        <div className="flex flex-col items-end gap-1">
                          <div className="flex items-center justify-end gap-1">
                            {(item.inUseQty || 0) > 0 && (
                              <Button variant="ghost" size="xs" onClick={() => handleReturnEquipment(item)} className="text-blue hover:bg-blue/5 h-6 px-2 text-[11px] font-semibold">Return</Button>
                            )}
                            {(item.availableQty ?? 1) > 0 && (
                              <Button variant="ghost" size="xs" onClick={() => openBorrowModal(item)} className="text-orange-600 hover:bg-orange-50 h-6 px-2 text-[11px] font-semibold">Borrow</Button>
                            )}
                          </div>
                          <div className="flex items-center justify-end gap-1">
                            <Button variant="ghost" size="xs" onClick={() => openEditModal(item)} className="h-6 px-2 text-[11px]">Edit</Button>
                            <Button variant="ghost" size="xs" onClick={() => openDeleteModal(item)} className="text-red hover:bg-red/5 h-6 px-2 text-[11px]">Delete</Button>
                          </div>
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
          </>
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
              openDeleteModal(item)
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
              <div className="bg-raised border border-line rounded p-3 text-xs flex items-center justify-between font-mono flex-wrap gap-2">
                <span className="text-[#475569]">Serial/Tag: <strong className="text-[#ea580c]">{borrowingItem.serialNumber}</strong></span>
                <span className="text-[#475569]">Category: <strong>{borrowingItem.category}</strong></span>
                <span className="bg-emerald-100 text-emerald-800 font-bold px-2 py-0.5 rounded text-[11px]">
                  Available: {borrowingItem.availableQty ?? 1} / {borrowingItem.quantity ?? 1}
                </span>
              </div>

              {/* Quantity to Borrow for Batch Items */}
              {(borrowingItem.quantity || 1) > 1 && (
                <div className="flex flex-col gap-1.5 bg-orange-50/60 p-3 rounded-lg border border-orange-200">
                  <div className="flex items-center justify-between">
                    <label className="font-mono text-[11px] uppercase tracking-widest text-[#ea580c] font-bold">Quantity to Borrow *</label>
                    <span className="text-[10px] text-slate-500 font-medium">Max available: {borrowingItem.availableQty ?? 1}</span>
                  </div>
                  <input
                    type="number"
                    min="1"
                    max={borrowingItem.availableQty ?? 1}
                    required
                    value={borrowQty}
                    onChange={e => {
                      const val = e.target.value
                      if (val === '') {
                        setBorrowQty('')
                      } else {
                        const parsed = parseInt(val, 10)
                        setBorrowQty(isNaN(parsed) ? '' : parsed)
                      }
                    }}
                    onBlur={() => {
                      const maxAvail = borrowingItem.availableQty ?? 1
                      if (borrowQty === '' || (typeof borrowQty === 'number' && borrowQty < 1)) {
                        setBorrowQty(1)
                      } else if (typeof borrowQty === 'number' && borrowQty > maxAvail) {
                        setBorrowQty(maxAvail)
                      }
                    }}
                    className="bg-white border border-orange-300 rounded px-3 py-1.5 text-sm font-bold text-[#0f172a] font-mono outline-none focus:border-[#ea580c] w-full"
                  />
                </div>
              )}

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

      {/* Remove / Relocate Equipment Confirmation Modal */}
      {deletingItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/60" onClick={() => !submitting && setDeletingItem(null)} />
          <div className="relative z-10 w-full max-w-lg bg-surface border border-line rounded-xl shadow-2xl p-6 flex flex-col gap-5">
            <div className="flex justify-between items-center border-b border-line pb-3">
              <div>
                <h3 className="text-lg font-bold text-[#0f172a] flex items-center gap-2">
                  <span>🗑️</span> Remove or Relocate Equipment
                </h3>
                <p className="text-xs text-slate-500 mt-0.5 font-mono">
                  Asset Tag: <span className="text-[#ea580c] font-bold">{deletingItem.serialNumber}</span> ({deletingItem.name})
                </p>
              </div>
              <button
                onClick={() => !submitting && setDeletingItem(null)}
                className="text-[#94a3b8] hover:text-[#0f172a] transition-colors text-xl cursor-pointer"
              >x</button>
            </div>

            <form onSubmit={handleConfirmRemove} className="flex flex-col gap-4">
              <div className="flex flex-col gap-2">
                <label className="font-mono text-[11px] uppercase tracking-widest text-[#ea580c] font-bold">
                  Select Reason / Action for Removal *
                </label>

                <div className="flex flex-col gap-2.5">
                  {/* Option 1: Broken / Defective */}
                  <label
                    className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-all ${
                      removeReason === 'broken'
                        ? 'bg-rose-50/70 border-rose-400 shadow-xs'
                        : 'bg-slate-50/60 border-slate-200 hover:border-slate-300'
                    }`}
                  >
                    <input
                      type="radio"
                      name="removeReason"
                      value="broken"
                      checked={removeReason === 'broken'}
                      onChange={() => setRemoveReason('broken')}
                      className="mt-0.5 accent-[#ea580c]"
                    />
                    <div className="flex flex-col">
                      <span className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
                        🛠️ Broken / Damaged Beyond Repair
                      </span>
                      <span className="text-[11px] text-slate-500 mt-0.5">
                        Mark equipment as defective/damaged and remove it from active lab inventory.
                      </span>
                    </div>
                  </label>

                  {/* Option 2: Relocate to another lab */}
                  <label
                    className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-all ${
                      removeReason === 'relocate'
                        ? 'bg-amber-50/70 border-amber-400 shadow-xs'
                        : 'bg-slate-50/60 border-slate-200 hover:border-slate-300'
                    }`}
                  >
                    <input
                      type="radio"
                      name="removeReason"
                      value="relocate"
                      checked={removeReason === 'relocate'}
                      onChange={() => setRemoveReason('relocate')}
                      className="mt-0.5 accent-[#ea580c]"
                    />
                    <div className="flex flex-col w-full">
                      <span className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
                        🔄 Relocate / Transfer to Another Lab
                      </span>
                      <span className="text-[11px] text-slate-500 mt-0.5">
                        Transfer this equipment unit directly to a different lab facility.
                      </span>
                    </div>
                  </label>

                  {/* Destination Lab Selector (shown if relocate is selected) */}
                  {removeReason === 'relocate' && (
                    <div className="ml-7 flex flex-col gap-1 bg-white p-3 rounded-lg border border-amber-300 shadow-2xs">
                      <label className="font-mono text-[10px] uppercase tracking-wider text-amber-900 font-bold">
                        Target Destination Lab *
                      </label>
                      <select
                        required
                        value={targetLabId}
                        onChange={e => setTargetLabId(e.target.value)}
                        className="bg-raised border border-amber-300 rounded px-3 py-1.5 text-xs text-[#0f172a] font-medium outline-none focus:border-[#ea580c] w-full cursor-pointer"
                      >
                        <option value="">-- Select Destination Lab --</option>
                        {availableLabs.filter(l => l.id !== selectedLabId).map(lab => (
                          <option key={lab.id} value={lab.id}>
                            {lab.name} ({lab.code || lab.id})
                          </option>
                        ))}
                      </select>
                    </div>
                  )}
                </div>
              </div>

              {/* Notes / Reason Details */}
              <div className="flex flex-col gap-1.5">
                <label className="font-mono text-[11px] uppercase tracking-widest text-[#475569] font-bold">
                  Removal / Transfer Notes (Optional)
                </label>
                <textarea
                  placeholder="Provide reason, defect description, or transfer authorization details..."
                  value={removeNotes}
                  onChange={e => setRemoveNotes(e.target.value)}
                  rows={2}
                  className="bg-raised border border-line rounded px-3 py-2 text-sm text-[#0f172a] outline-none focus:border-[#ea580c]/50 w-full resize-none"
                />
              </div>

              <div className="flex gap-2 justify-end mt-3 pt-3 border-t border-line">
                <Button variant="ghost" type="button" onClick={() => setDeletingItem(null)} disabled={submitting}>
                  Cancel
                </Button>
                <Button
                  variant="primary"
                  type="submit"
                  disabled={submitting || (removeReason === 'relocate' && !targetLabId)}
                  className={removeReason === 'relocate' ? 'bg-amber-600 hover:bg-amber-700' : 'bg-rose-600 hover:bg-rose-700'}
                >
                  {submitting
                    ? 'Processing...'
                    : removeReason === 'relocate'
                    ? 'Transfer Equipment'
                    : 'Confirm Removal'}
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
          <div className="relative z-10 w-full max-w-xl bg-surface border border-line rounded-xl shadow-2xl p-6 flex flex-col gap-5 max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-center border-b border-line pb-3">
              <h3 className="text-lg font-bold text-[#0f172a]">
                {editingItem
                  ? 'Edit Equipment Details'
                  : isGroupAdd
                  ? `Add Serial Unit to "${name}"`
                  : 'Add New Equipment / Device'}
              </h3>
              <button
                onClick={() => !submitting && (setShowAddModal(false), setEditingItem(null))}
                className="text-[#94a3b8] hover:text-[#0f172a] transition-colors text-xl cursor-pointer"
              >x</button>
            </div>

            <form onSubmit={handleSaveAddEdit} className="flex flex-col gap-4">
              {/* Management Mode Selector Switch (Shown ONLY when registering a NEW equipment model from main button) */}
              {!isGroupAdd && !editingItem && (
                <div className="flex flex-col gap-1.5 bg-slate-50 p-2.5 rounded-lg border border-slate-200">
                  <label className="font-mono text-[10px] uppercase tracking-wider text-[#ea580c] font-bold">Management Mode</label>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => { setEntryMode('individual'); setQuantity(1); }}
                      className={`px-3 py-1.5 rounded-md font-mono text-xs font-bold transition-all cursor-pointer border ${
                        entryMode === 'individual'
                          ? 'bg-white text-[#ea580c] border-[#ea580c]/40 shadow-sm'
                          : 'bg-slate-100 text-slate-500 border-transparent hover:text-slate-800'
                      }`}
                    >
                      📌 Individual Asset Tag
                    </button>
                    <button
                      type="button"
                      onClick={() => setEntryMode('batch')}
                      className={`px-3 py-1.5 rounded-md font-mono text-xs font-bold transition-all cursor-pointer border ${
                        entryMode === 'batch'
                          ? 'bg-white text-[#ea580c] border-[#ea580c]/40 shadow-sm'
                          : 'bg-slate-100 text-slate-500 border-transparent hover:text-slate-800'
                      }`}
                    >
                      📦 Bulk Batch Item
                    </button>
                  </div>
                </div>
              )}

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
                    <span className="text-[10px] text-[#0f172a] font-medium">Upload PNG or JPEG photo. Hovering over equipment will display a preview card.</span>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="flex flex-col gap-1.5">
                  <div className="h-5 flex items-end">
                    <label className="font-mono text-[11px] uppercase tracking-widest text-[#475569] font-bold whitespace-nowrap">
                      {entryMode === 'batch' ? 'Batch Code / Serial ID *' : 'Asset Tag / Serial Number *'}
                    </label>
                  </div>
                  <input
                    type="text"
                    required
                    placeholder={entryMode === 'batch' ? "e.g. BATCH-ESP32-01" : "e.g. VGU-EQ-2026-001"}
                    value={serialNumber}
                    onChange={e => setSerialNumber(e.target.value)}
                    className="bg-raised border border-line rounded px-3 py-2 text-sm text-[#0f172a] font-mono outline-none focus:border-[#ea580c]/50 w-full"
                  />
                </div>

                <div className="flex flex-col gap-1.5">
                  <div className="h-5 flex items-end">
                    <label className="font-mono text-[11px] uppercase tracking-widest text-[#475569] font-bold whitespace-nowrap">Category</label>
                  </div>
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

              {/* Quantity Field (for Batch Mode) */}
              {entryMode === 'batch' && (
                <div className="flex flex-col gap-1.5 bg-orange-50/50 p-3 rounded-lg border border-orange-200">
                  <div className="flex items-center justify-between">
                    <label className="font-mono text-[11px] uppercase tracking-widest text-[#ea580c] font-bold">Total Batch Quantity *</label>
                    <span className="text-[10px] text-slate-500 font-medium">Quantity of items purchased in this batch</span>
                  </div>
                  <input
                    type="number"
                    min="1"
                    max="1000"
                    required
                    value={quantity}
                    onChange={e => {
                      const val = e.target.value
                      if (val === '') {
                        setQuantity('')
                      } else {
                        const parsed = parseInt(val, 10)
                        setQuantity(isNaN(parsed) ? '' : parsed)
                      }
                    }}
                    onBlur={() => {
                      if (quantity === '' || (typeof quantity === 'number' && quantity < 1)) {
                        setQuantity(1)
                      }
                    }}
                    className="bg-white border border-orange-300 rounded px-3 py-1.5 text-sm font-bold text-[#0f172a] font-mono outline-none focus:border-[#ea580c] w-full"
                  />
                </div>
              )}

              <div className="flex flex-col gap-1.5">
                <div className="flex items-center justify-between">
                  <label className="font-mono text-[11px] uppercase tracking-widest text-[#475569] font-bold">Equipment Name *</label>
                  {!editingItem && !isGroupAdd && !!name.trim() && (equipment || []).some(item => (item.name || '').trim().toLowerCase() === name.trim().toLowerCase()) && (
                    <span className="text-[10px] font-mono font-bold text-rose-600 bg-rose-50 px-2 py-0.5 rounded border border-rose-200 animate-pulse">
                      ⚠️ Duplicate Name
                    </span>
                  )}
                </div>
                <input
                  type="text"
                  required
                  placeholder="e.g. ESP32 WROOM Development Module"
                  value={name}
                  onChange={e => setName(e.target.value)}
                  className={`bg-raised border rounded px-3 py-2 text-sm text-[#0f172a] outline-none w-full transition-colors ${
                    !editingItem && !isGroupAdd && !!name.trim() && (equipment || []).some(item => (item.name || '').trim().toLowerCase() === name.trim().toLowerCase())
                      ? 'border-rose-400 focus:border-rose-500 bg-rose-50/30'
                      : 'border-line focus:border-[#ea580c]/50'
                  }`}
                />
                {!editingItem && !isGroupAdd && !!name.trim() && (equipment || []).some(item => (item.name || '').trim().toLowerCase() === name.trim().toLowerCase()) && (
                  <p className="text-[11px] font-medium text-rose-700 bg-rose-50 p-2.5 rounded-md border border-rose-200 leading-tight">
                    ⚠️ An equipment model named <strong>"{name.trim()}"</strong> already exists in this lab. To add another unit instance to this model, please cancel and use the <strong>"+ Add Serial Unit"</strong> button on its group card instead.
                  </p>
                )}
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

              {/* Procurement & Financial Details (Admin Only / Detailed) */}
              <div className="border-t border-line pt-3 flex flex-col gap-3">
                <p className="font-mono text-[10px] uppercase tracking-widest text-[#ea580c] font-bold">
                  Procurement & Asset Details (Optional / Admin Only)
                </p>
                <div className="grid grid-cols-2 gap-3">
                  <div className="flex flex-col gap-1">
                    <div className="h-4 flex items-end">
                      <label className="font-mono text-[10px] uppercase tracking-wider text-slate-500 font-bold whitespace-nowrap">Purchase Contract No.</label>
                    </div>
                    <input
                      type="text"
                      placeholder="e.g. CTR-2026-LAB01"
                      value={contractNumber}
                      onChange={e => setContractNumber(e.target.value)}
                      className="bg-raised border border-line rounded px-3 py-1.5 text-xs text-[#0f172a] font-mono outline-none focus:border-[#ea580c]/50 w-full"
                    />
                  </div>

                  <div className="flex flex-col gap-1">
                    <div className="h-4 flex items-end">
                      <label className="font-mono text-[10px] uppercase tracking-wider text-slate-500 font-bold whitespace-nowrap">Invoice No.</label>
                    </div>
                    <input
                      type="text"
                      placeholder="e.g. INV-984021"
                      value={invoiceNumber}
                      onChange={e => setInvoiceNumber(e.target.value)}
                      className="bg-raised border border-line rounded px-3 py-1.5 text-xs text-[#0f172a] font-mono outline-none focus:border-[#ea580c]/50 w-full"
                    />
                  </div>

                  <div className="flex flex-col gap-1 col-span-2">
                    <div className="h-4 flex items-end">
                      <label className="font-mono text-[10px] uppercase tracking-wider text-slate-500 font-bold whitespace-nowrap">Purchase Date</label>
                    </div>
                    <input
                      type="date"
                      value={purchaseDate}
                      onChange={e => setPurchaseDate(e.target.value)}
                      className="bg-raised border border-line rounded px-3 py-1.5 text-xs text-[#0f172a] font-mono outline-none focus:border-[#ea580c]/50 w-full cursor-pointer"
                    />
                  </div>
                </div>
              </div>

              <div className="flex gap-2 justify-end mt-3 pt-3 border-t border-line">
                <Button variant="ghost" type="button" onClick={() => (setShowAddModal(false), setEditingItem(null))} disabled={submitting}>Cancel</Button>
                <Button
                  variant="primary"
                  type="submit"
                  disabled={
                    submitting ||
                    !serialNumber.trim() ||
                    !name.trim() ||
                    (!editingItem && !isGroupAdd && (equipment || []).some(item => (item.name || '').trim().toLowerCase() === name.trim().toLowerCase()))
                  }
                >
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
