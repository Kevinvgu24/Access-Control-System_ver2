import { useState, useRef } from 'react'
import { useAdminStore } from '@/store/adminStore'
import { useLabStore }   from '@/store/labStore'
import { Panel } from '@/components/ui/Panel'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { fmtTs } from '@/lib/format'
import type { UserRole, UserStatus } from '@/types/admin'
import { useNavigate } from 'react-router-dom'

const ROLE_OPTS: UserRole[] = ['student', 'faculty', 'lab_assistant', 'guest', 'maintenance']
const ROLE_LABEL: Record<UserRole, string> = {
  student: 'Student', faculty: 'Faculty',
  lab_assistant: 'Lab Asst', guest: 'Guest', maintenance: 'Maintenance',
}
const STATUS_TONE: Record<UserStatus, 'green' | 'red'> = { active: 'green', suspended: 'red' }

export function UsersPage() {
  const { users, refreshUsers, deleteUser } = useAdminStore()
  const { selectedLabId }       = useLabStore()
  const navigate = useNavigate()
  const [search, setSearch]           = useState('')
  const [roleFilter, setRoleFilter]   = useState<UserRole | 'all'>('all')
  const [statusFilter, setStatusFilter] = useState<UserStatus | 'all'>('all')
  const [menuOpen, setMenuOpen]       = useState<string | null>(null)
  const [importing, setImporting]     = useState(false)
  const fileInputRef                  = useRef<HTMLInputElement>(null)

  const triggerFileInput = () => {
    fileInputRef.current?.click()
  }

  const handleImportExcel = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file || !selectedLabId) return

    const formData = new FormData()
    formData.append('file', file)

    setImporting(true)
    try {
      const response = await fetch(`/api/labs/${selectedLabId}/users/import-excel`, {
        method: 'POST',
        body: formData
      })
      const result = await response.json()
      if (response.ok) {
        const fmtName = result.format === 'schedule_template' ? 'Schedule Template' : 'Standard List';
        alert(`Successfully imported Excel (${fmtName}):\n- ${result.inserted} new users added\n- ${result.updated} users updated`)
        refreshUsers(selectedLabId)
      } else {
        alert(result.error || 'Failed to import Excel file')
      }
    } catch (err) {
      alert(err instanceof Error ? err.message : 'An error occurred during import')
    } finally {
      setImporting(false)
      if (e.target) e.target.value = ''
    }
  }

  const filtered = users.filter(u =>
    (!search || u.fullName.toLowerCase().includes(search.toLowerCase()) || u.universityId.includes(search)) &&
    (roleFilter === 'all' || u.roles.includes(roleFilter as UserRole)) &&
    (statusFilter === 'all' || u.status === statusFilter)
  )

  const handleDelete = async (userId: string) => {
    if (!selectedLabId) return
    if (confirm('Are you sure you want to revoke access and delete this user?')) {
      try {
        await deleteUser(selectedLabId, userId)
      } catch (err) {
        alert(err instanceof Error ? err.message : 'Failed to delete user')
      }
    }
  }

  const chipClass = (active: boolean) =>
    `px-3 py-1.5 rounded font-mono text-[11px] border cursor-pointer transition-colors ${
      active ? 'bg-green/10 border-green/25 text-green' : 'bg-raised border-slate-200 text-[#475569] hover:text-[#334155]'
    }`

  return (
    <div className="flex flex-col gap-7">
      <div className="flex justify-between items-end">
        <div>
          <p className="font-mono text-[11px] tracking-widest uppercase text-[#94a3b8] mb-3">The Roster</p>
          <h1 className="text-4xl font-bold tracking-tight text-[#0f172a]">User Directory</h1>
          <p className="text-sm text-[#475569] mt-2">Everyone authorized to access this lab.</p>
        </div>
        <div className="flex gap-2">
          <Button variant="ghost" onClick={() => selectedLabId && refreshUsers(selectedLabId)}>↻ Refresh</Button>
          <input type="file" ref={fileInputRef} accept=".xlsx" onChange={handleImportExcel} className="hidden" />
          <Button variant="ghost" onClick={triggerFileInput} disabled={importing}>
            {importing ? 'Importing...' : '📥 Import Excel'}
          </Button>
          <Button variant="primary" onClick={() => navigate('/enrollment')}>+ Add New User</Button>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-4">
        {[
          { label: 'Total',     value: users.length,                                       color: 'text-[#0f172a]' },
          { label: 'Active',    value: users.filter(u => u.status === 'active').length,    color: 'text-green'     },
          { label: 'Suspended', value: users.filter(u => u.status === 'suspended').length, color: 'text-red'       },
        ].map(({ label, value, color }) => (
          <div key={label} className="bg-surface border border-line rounded-lg p-6 shadow-sm">
            <p className="font-mono text-[10px] uppercase tracking-widest text-[#94a3b8] mb-3">{label}</p>
            <p className={`text-5xl font-bold ${color}`}>{value}</p>
          </div>
        ))}
      </div>

      <Panel pad={false}>
        <div className="flex gap-3 items-center p-5 border-b border-line flex-wrap">
          <input type="text" placeholder="Search name or university ID…" value={search}
            onChange={e => setSearch(e.target.value)}
            className="flex-1 min-w-[160px] bg-raised border border-line rounded px-3 py-2 text-sm text-[#0f172a] placeholder:text-[#cbd5e1] outline-none focus:border-green/30 transition-colors"
          />
          <div className="flex gap-1.5 flex-wrap">
            <button onClick={() => setRoleFilter('all')} className={chipClass(roleFilter === 'all')}>All</button>
            {ROLE_OPTS.map(r => (
              <button key={r} onClick={() => setRoleFilter(r)} className={chipClass(roleFilter === r)}>
                {ROLE_LABEL[r]}
              </button>
            ))}
          </div>
          <div className="w-px h-5 bg-slate-200" />
          <div className="flex gap-1.5">
            {(['all', 'active', 'suspended'] as const).map(s => (
              <button key={s} onClick={() => setStatusFilter(s)} className={chipClass(statusFilter === s)}>
                {s === 'all' ? 'All' : s.charAt(0).toUpperCase() + s.slice(1)}
              </button>
            ))}
          </div>
        </div>

        <table className="w-full border-collapse">
          <thead>
            <tr className="bg-raised">
              {['User', 'Role', 'Credentials', 'Last Access', 'Status', ''].map(h => (
                <th key={h} className="text-left px-5 py-3 font-mono text-[10px] uppercase tracking-widest text-[#94a3b8] border-b border-line">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.map(u => (
              <tr key={u.id} className="border-b border-line hover:bg-raised transition-colors last:border-0">
                <td className="px-5 py-4">
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-full bg-slate-200 border border-line flex items-center justify-center text-xs font-semibold text-[#475569] shrink-0">
                      {u.fullName.split(' ').map((w: string) => w[0]).slice(-2).join('')}
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-[#0f172a]">{u.fullName}</p>
                      <p className="font-mono text-[11px] text-[#94a3b8] mt-0.5">{u.universityId}</p>
                    </div>
                  </div>
                </td>
                <td className="px-5 py-4 font-mono text-xs text-[#475569]">
                  {u.roles.map(r => ROLE_LABEL[r] ?? r).join(', ')}
                </td>
                <td className="px-5 py-4">
                  <div className="flex gap-1.5">
                    {u.faceStatus === 'complete' && <Badge tone="green">Face</Badge>}
                    {u.pinStatus === 'set'       && <Badge tone="blue">PIN</Badge>}
                    {u.faceStatus === 'incomplete' && <Badge tone="neutral">No Face</Badge>}
                    {u.pinStatus === 'missing'   && <Badge tone="neutral">No PIN</Badge>}
                  </div>
                </td>
                <td className="px-5 py-4 font-mono text-xs text-[#475569]">{fmtTs(u.lastAccessAt)}</td>
                <td className="px-5 py-4"><Badge tone={STATUS_TONE[u.status]}>{u.status}</Badge></td>
                <td className="px-5 py-4 relative">
                  <button onClick={() => setMenuOpen(menuOpen === u.id ? null : u.id)}
                    className="w-8 h-8 flex items-center justify-center rounded text-[#94a3b8] hover:text-[#0f172a] hover:bg-slate-100 transition-colors cursor-pointer text-lg">⋯</button>
                  {menuOpen === u.id && (
                    <div className="absolute right-4 top-12 z-20 bg-white border border-line rounded shadow-lg min-w-[150px] overflow-hidden py-1">
                      {['Edit Profile', 'Reset PIN', 'Revoke Access'].map(a => (
                        <button key={a} 
                          onClick={() => {
                            setMenuOpen(null)
                            if (a === 'Revoke Access') handleDelete(u.id)
                          }}
                          className={`w-full text-left px-4 py-2.5 text-sm transition-colors cursor-pointer hover:bg-slate-50 ${a === 'Revoke Access' ? 'text-red' : 'text-[#475569]'}`}>
                          {a}
                        </button>
                      ))}
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {filtered.length === 0 && (
          <p className="py-12 text-center font-mono text-xs text-[#94a3b8]">No users match the current filters.</p>
        )}
      </Panel>
    </div>
  )
}
