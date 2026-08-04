import { Pagination } from '@/components/ui/Pagination'
import { useState } from 'react'
import { useAdminStore } from '@/store/adminStore'
import { useLabStore }   from '@/store/labStore'
import { Panel } from '@/components/ui/Panel'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { fmtTs } from '@/lib/format'
import type { User, UserRole, UserStatus } from '@/types/admin'
import { useNavigate } from 'react-router-dom'

const ROLE_OPTS: UserRole[] = ['student', 'lecturer', 'teacher_assistant', 'guest', 'maintenance']
const ROLE_LABEL: Record<UserRole, string> = {
  student: 'Student', lecturer: 'Lecturer',
  teacher_assistant: 'Teacher Assistant', guest: 'Guest', maintenance: 'Maintenance',
}
const STATUS_TONE: Record<UserStatus, 'green' | 'red'> = { active: 'green', suspended: 'red' }

export function UsersPage() {
  const [currentPage, setCurrentPage] = useState(1)
  const { 
    users, refreshUsers,
    updateUserProfile, resetUserPin, updateUserStatus 
  } = useAdminStore()
  const { selectedLabId }       = useLabStore()
  const navigate = useNavigate()
  const [search, setSearch]           = useState('')
  const [roleFilter, setRoleFilter]   = useState<UserRole | 'all'>('all')
  const [statusFilter, setStatusFilter] = useState<UserStatus | 'all'>('all')
  const [menuOpen, setMenuOpen]       = useState<string | null>(null)

  // Edit Profile States
  const [editingUser, setEditingUser] = useState<User | null>(null)
  const [editName, setEditName] = useState('')
  const [editUniId, setEditUniId] = useState('')
  const [editEmail, setEditEmail] = useState('')
  const [editRole, setEditRole] = useState<UserRole>('student')
  const [updatingProfile, setUpdatingProfile] = useState(false)

  // Reset PIN States
  const [pinUser, setPinUser] = useState<User | null>(null)
  const [newPin, setNewPin] = useState('')
  const [updatingPin, setUpdatingPin] = useState(false)

  const filtered = users.filter(u =>
    (!search ||
      u.fullName.toLowerCase().includes(search.toLowerCase()) ||
      (u.universityId && u.universityId.toLowerCase().includes(search.toLowerCase())) ||
      (u.university_id && u.university_id.toLowerCase().includes(search.toLowerCase()))) &&
    (roleFilter === 'all' || u.roles.includes(roleFilter as UserRole)) &&
    (statusFilter === 'all' || u.status === statusFilter)
  )

  const handleToggleStatus = async (user: User) => {
    if (!selectedLabId) return
    const newStatus = user.status === 'active' ? 'suspended' : 'active'
    const verb = newStatus === 'active' ? 'grant access to' : 'revoke access for'
    if (confirm(`Are you sure you want to ${verb} "${user.fullName}"?`)) {
      try {
        await updateUserStatus(selectedLabId, user.id, newStatus)
        alert(`Successfully updated status for "${user.fullName}" to ${newStatus}`)
      } catch (err) {
        alert(err instanceof Error ? err.message : 'Failed to update user status')
      }
    }
  }

  const handleOpenEditModal = (user: User) => {
    setEditingUser(user)
    setEditName(user.fullName)
    setEditUniId(user.universityId || user.university_id || '')
    setEditEmail(user.email || '')
    setEditRole(user.roles?.[0] || 'student')
  }

  const handleUpdateProfile = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!selectedLabId || !editingUser) return
    if (!editName.trim()) {
      alert('Full Name is required')
      return
    }
    setUpdatingProfile(true)
    try {
      await updateUserProfile(selectedLabId, editingUser.id, {
        fullName: editName.trim(),
        universityId: editUniId.trim(),
        email: editEmail.trim(),
        role: editRole
      })
      alert('Administrator profile updated successfully!')
      setEditingUser(null)
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to update profile')
    } finally {
      setUpdatingProfile(false)
    }
  }

  const handleOpenPinModal = (user: User) => {
    setPinUser(user)
    setNewPin(user.pin || '')
  }

  const handleUpdatePin = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!selectedLabId || !pinUser) return
    if (newPin && !/^\d{4,6}$/.test(newPin)) {
      alert('PIN must be 4 to 6 numeric digits, or empty to disable PIN access.')
      return
    }
    setUpdatingPin(true)
    try {
      await resetUserPin(selectedLabId, pinUser.id, newPin.trim())
      alert(newPin ? 'PIN set successfully!' : 'PIN cleared successfully!')
      setPinUser(null)
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to update PIN')
    } finally {
      setUpdatingPin(false)
    }
  }

    const PAGE_SIZE = 25
  const paginatedUsers = useMemo(() => {
    const start = (currentPage - 1) * PAGE_SIZE
    return filtered.slice(start, start + PAGE_SIZE)
  }, [filtered, currentPage])

  const chipClass = (active: boolean) =>
    `px-3 py-1.5 rounded font-mono text-[11px] border cursor-pointer transition-colors ${
      active ? 'bg-[#ffedd5] border-[#ea580c] text-[#ea580c]' : 'bg-raised border-slate-200 text-[#475569] hover:text-[#334155]'
    }`

  return (
    <div className="flex flex-col gap-7">
      <div className="flex flex-col sm:flex-row justify-between sm:items-end gap-4">
        <div>
          <p className="font-mono text-[11px] tracking-widest uppercase text-orange-600 font-extrabold mb-2">Management</p>
          <h1 className="text-4xl font-extrabold tracking-tight text-orange-600">Administrators</h1>
          <p className="text-sm text-[#475569] mt-2">Administrators authorized to manage this lab.</p>
        </div>
        <div className="flex gap-2">
          <Button variant="ghost" onClick={() => selectedLabId && refreshUsers(selectedLabId)}>Refresh Refresh</Button>
          <Button variant="primary" onClick={() => navigate('/enrollment')}>+ Add Administrator</Button>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
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

      <Panel pad={false} className="overflow-x-auto">
        <div className="p-5 border-b border-line flex flex-col gap-3">
          {/* Row 1: Search Box */}
          <div className="flex items-center">
            <input type="text" placeholder="Search name or university ID..." value={search}
              onChange={e => { setSearch(e.target.value); setCurrentPage(1) }}
              className="bg-raised border border-line rounded px-4 py-2 text-sm text-[#0f172a] placeholder:text-[#cbd5e1] outline-none focus:border-[#ea580c]/50 transition-colors w-full sm:w-80"
            />
          </div>

          {/* Row 2: Filter Option Chips (Placed BELOW Search Box) */}
          <div className="flex flex-wrap items-center gap-3 pt-1 border-t border-slate-100">
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="font-mono text-[11px] text-[#94a3b8] uppercase tracking-wider font-bold mr-1">Role:</span>
              <button onClick={() => setRoleFilter('all')} className={chipClass(roleFilter === 'all')}>All</button>
              {ROLE_OPTS.map(r => (
                <button key={r} onClick={() => { setRoleFilter(r); setCurrentPage(1) }} className={chipClass(roleFilter === r)}>
                  {ROLE_LABEL[r]}
                </button>
              ))}
            </div>
            <span className="w-px h-4 bg-slate-200 hidden sm:inline" />
            <div className="flex items-center gap-1.5">
              <span className="font-mono text-[11px] text-[#94a3b8] uppercase tracking-wider font-bold mr-1">Status:</span>
              {(['all', 'active', 'suspended'] as const).map(s => (
                <button key={s} onClick={() => setStatusFilter(s)} className={chipClass(statusFilter === s)}>
                  {s === 'all' ? 'All' : s.charAt(0).toUpperCase() + s.slice(1)}
                </button>
              ))}
            </div>
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
            {paginatedUsers.map(u => (
              <tr key={u.id} className="border-b border-line hover:bg-raised transition-colors last:border-0">
                <td className="px-5 py-4">
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-full bg-slate-200 border border-line flex items-center justify-center text-xs font-semibold text-[#475569] shrink-0">
                      {u.fullName.split(' ').map((w: string) => w[0]).slice(-2).join('')}
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-[#0f172a]">{u.fullName}</p>
                      <p className="font-mono text-[11px] text-[#94a3b8] mt-0.5">{u.universityId || u.university_id}</p>
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
                    className="w-8 h-8 flex items-center justify-center rounded text-[#94a3b8] hover:text-[#0f172a] hover:bg-slate-100 transition-colors cursor-pointer text-lg">...</button>
                  {menuOpen === u.id && (
                    <div className="absolute right-4 top-12 z-20 bg-white border border-line rounded shadow-lg min-w-[150px] overflow-hidden py-1">
                      <button 
                        onClick={() => { setMenuOpen(null); handleOpenEditModal(u); }}
                        className="w-full text-left px-4 py-2.5 text-sm text-[#475569] hover:bg-slate-50 transition-colors cursor-pointer"
                      >
                        Edit Profile
                      </button>
                      <button 
                        onClick={() => { setMenuOpen(null); handleOpenPinModal(u); }}
                        className="w-full text-left px-4 py-2.5 text-sm text-[#475569] hover:bg-slate-50 transition-colors cursor-pointer"
                      >
                        Reset PIN
                      </button>
                      <button 
                        onClick={() => { setMenuOpen(null); handleToggleStatus(u); }}
                        className={`w-full text-left px-4 py-2.5 text-sm transition-colors cursor-pointer hover:bg-slate-50 ${u.status === 'active' ? 'text-red' : 'text-green'}`}
                      >
                        {u.status === 'active' ? 'Revoke Access' : 'Grant Access'}
                      </button>
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <Pagination currentPage={currentPage} totalItems={filtered.length} pageSize={25} onPageChange={setCurrentPage} />
        {filtered.length === 0 && (
          <p className="py-12 text-center font-mono text-xs text-[#94a3b8]">No administrators match the current filters.</p>
        )}
      </Panel>

      {/* Edit Profile Modal */}
      {editingUser && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/60" onClick={() => !updatingProfile && setEditingUser(null)} />
          <div className="relative z-10 w-full max-w-lg bg-surface border border-line rounded-xl shadow-2xl p-6 flex flex-col gap-5">
            <div className="flex justify-between items-center">
              <h3 className="text-lg font-bold text-[#0f172a]">Edit Administrator Profile</h3>
              <button onClick={() => !updatingProfile && setEditingUser(null)} className="text-[#94a3b8] hover:text-[#0f172a] transition-colors text-xl cursor-pointer">x</button>
            </div>
            
            <form onSubmit={handleUpdateProfile} className="flex flex-col gap-4">
              <div className="flex flex-col gap-2">
                <label className="font-mono text-[11px] uppercase tracking-widest text-[#475569]">Full Name</label>
                <input 
                  type="text" 
                  value={editName} 
                  onChange={e => setEditName(e.target.value)}
                  className="bg-raised border border-line rounded px-4 py-2.5 text-sm text-[#0f172a] outline-none focus:border-[#ea580c]/50 w-full"
                />
              </div>

              <div className="flex flex-col gap-2">
                <label className="font-mono text-[11px] uppercase tracking-widest text-[#475569]">University ID</label>
                <input 
                  type="text" 
                  value={editUniId} 
                  onChange={e => setEditUniId(e.target.value)}
                  className="bg-raised border border-line rounded px-4 py-2.5 text-sm text-[#0f172a] outline-none focus:border-[#ea580c]/50 w-full"
                />
              </div>

              <div className="flex flex-col gap-2">
                <label className="font-mono text-[11px] uppercase tracking-widest text-[#475569]">Email Address</label>
                <input 
                  type="email" 
                  value={editEmail} 
                  onChange={e => setEditEmail(e.target.value)}
                  className="bg-raised border border-line rounded px-4 py-2.5 text-sm text-[#0f172a] outline-none focus:border-[#ea580c]/50 w-full"
                />
              </div>

              <div className="flex flex-col gap-2">
                <label className="font-mono text-[11px] uppercase tracking-widest text-[#475569]">Role</label>
                <select 
                  value={editRole}
                  onChange={e => setEditRole(e.target.value as UserRole)}
                  className="bg-raised border border-line rounded px-4 py-2.5 text-sm text-[#0f172a] outline-none focus:border-[#ea580c]/50 w-full cursor-pointer"
                >
                  {ROLE_OPTS.map(role => (
                    <option key={role} value={role}>{ROLE_LABEL[role]}</option>
                  ))}
                </select>
              </div>

              <div className="flex gap-2 justify-end mt-4">
                <Button variant="ghost" type="button" onClick={() => setEditingUser(null)} disabled={updatingProfile}>Cancel</Button>
                <Button variant="primary" type="submit" disabled={updatingProfile || !editName.trim()}>
                  {updatingProfile ? 'Saving...' : 'Save Changes'}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Reset PIN Modal */}
      {pinUser && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/60" onClick={() => !updatingPin && setPinUser(null)} />
          <div className="relative z-10 w-full max-w-md bg-surface border border-line rounded-xl shadow-2xl p-6 flex flex-col gap-5">
            <div className="flex justify-between items-center">
              <h3 className="text-lg font-bold text-[#0f172a]">Reset Access PIN</h3>
              <button onClick={() => !updatingPin && setPinUser(null)} className="text-[#94a3b8] hover:text-[#0f172a] transition-colors text-xl cursor-pointer">x</button>
            </div>
            
            <form onSubmit={handleUpdatePin} className="flex flex-col gap-4">
              <p className="text-xs text-[#475569]">
                Set a 4 to 6 digit PIN for <strong>{pinUser.fullName}</strong>. Leave empty to clear and disable PIN access for this user.
              </p>
              <div className="flex flex-col gap-2">
                <label className="font-mono text-[11px] uppercase tracking-widest text-[#475569]">New PIN</label>
                <input 
                  type="password" 
                  maxLength={6}
                  pattern="\d*"
                  value={newPin} 
                  onChange={e => setNewPin(e.target.value.replace(/\D/g, ''))}
                  placeholder="e.g., 123456"
                  className="bg-raised border border-line rounded px-4 py-2.5 text-sm text-[#0f172a] placeholder:text-[#cbd5e1] outline-none focus:border-[#ea580c]/50 w-full tracking-widest font-mono text-center text-lg"
                />
              </div>

              <div className="flex gap-2 justify-end mt-4">
                <Button variant="ghost" type="button" onClick={() => setPinUser(null)} disabled={updatingPin}>Cancel</Button>
                <Button variant="primary" type="submit" disabled={updatingPin}>
                  {updatingPin ? 'Saving...' : 'Update PIN'}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}

