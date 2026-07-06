import type {
  Lab, Cluster, Node, NodeState, NodeConfig, User, AccessEvent, Incident, AdminDoc,
} from '@/types/admin'

// helper function to extract clean code from name
function makeCode(input: string, fallback: string): string {
  return input.trim().toUpperCase().replace(/[^A-Z0-9]+/g, '-').slice(0, 24) || fallback
}

// Helper to make fetch calls easier
async function fetchJson<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(url, options)
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Unknown API error' }))
    throw new Error(err.error || `HTTP ${res.status}: ${res.statusText}`)
  }
  return res.json() as Promise<T>
}

// ── Labs ─────────────────────────────────────────────────────────────────────

export function subscribeVisibleLabs(
  params: {
    isSuperAdmin: boolean
    labIds: string[]
    onData: (labs: Lab[]) => void
    onError?: (error: Error) => void
  }
) {
  const { onData, onError } = params

  const fetchLabs = async () => {
    try {
      const labs = await getAllLabs()
      onData(labs)
    } catch (err: any) {
      console.error('Error fetching labs:', err)
      onError?.(err)
    }
  }

  fetchLabs()
  const interval = setInterval(fetchLabs, 3000)

  return () => clearInterval(interval)
}

export async function getAllLabs(): Promise<Lab[]> {
  return fetchJson<Lab[]>('/api/labs')
}

export async function createLab(
  data: { name: string; code?: string; location?: string; timezone: string },
  createdBy: string
): Promise<string> {
  void createdBy
  // Stub for offline mode - return a fake ID
  return 'default-lab'
}

export async function updateLab(labId: string, patch: Partial<Lab>): Promise<void> {
  void labId; void patch;
}

export async function archiveLab(labId: string): Promise<void> {
  void labId;
}

// ── Clusters ──────────────────────────────────────────────────────────────────

export async function getLabClusters(labId: string): Promise<Cluster[]> {
  return fetchJson<Cluster[]>(`/api/labs/${labId}/clusters`)
}

export async function createCluster(labId: string, name: string, createdBy: string): Promise<string> {
  void labId; void name; void createdBy;
  return 'default-cluster'
}

export async function createNode(
  labId: string,
  clusterId: string,
  data: { name: string; deviceId?: string; location?: string },
  createdBy: string
): Promise<string> {
  void labId; void clusterId; void data; void createdBy;
  return 'default-node'
}

export async function updateNode(
  labId: string, clusterId: string, nodeId: string, patch: Partial<Node>
): Promise<void> {
  void labId; void clusterId; void nodeId; void patch;
}

export async function getClusterNodes(labId: string, clusterId: string): Promise<Node[]> {
  return fetchJson<Node[]>(`/api/labs/${labId}/clusters/${clusterId}/nodes`)
}

export async function deleteNode(labId: string, clusterId: string, nodeId: string): Promise<void> {
  void labId; void clusterId; void nodeId;
}

// ── Admins ────────────────────────────────────────────────────────────────────

export async function getAllAdmins(): Promise<AdminDoc[]> {
  // Stub out admins list offline
  return [
    {
      id: 'default-admin',
      email: 'dawnnkevin9@gmail.com',
      displayName: 'Kevin',
      type: 'super_admin',
      status: 'active',
      createdAt: new Date().toISOString() as any
    }
  ]
}

export async function createLabAdmin(
  data: { email: string; password: string; displayName: string; labIds: string[] },
): Promise<string> {
  void data;
  return 'new-admin-id'
}

export async function updateAdminLabAccess(adminId: string, labIds: string[]): Promise<void> {
  void adminId; void labIds;
}

export async function deleteAdminDoc(adminId: string): Promise<void> {
  void adminId;
}

// ── Nodes ─────────────────────────────────────────────────────────────────────

export async function getFirstLabNode(labId: string) {
  try {
    const clusters = await getLabClusters(labId)
    if (clusters.length === 0) return null
    const firstCluster = clusters[0]
    const nodes = await getClusterNodes(labId, firstCluster.id)
    if (nodes.length === 0) return null
    return { id: nodes[0].id, clusterId: firstCluster.id }
  } catch {
    return null
  }
}

export async function getLabNodes(labId: string): Promise<Array<Node & { clusterId: string }>> {
  try {
    const clusters = await getLabClusters(labId)
    const result: Array<Node & { clusterId: string }> = []
    for (const c of clusters) {
      const nodes = await getClusterNodes(labId, c.id)
      nodes.forEach(n => result.push({ ...n, clusterId: c.id }))
    }
    return result
  } catch {
    return []
  }
}

export function subscribeNodeState(
  labId: string,
  clusterId: string,
  nodeId: string,
  cb: (state: NodeState | null) => void
) {
  const fetchState = async () => {
    try {
      const nodes = await getClusterNodes(labId, clusterId)
      const node = nodes.find(n => n.id === nodeId)
      if (node && node.latestTelemetry) {
        cb(node.latestTelemetry as NodeState)
      } else {
        cb(null)
      }
    } catch {
      cb(null)
    }
  }

  fetchState()
  const interval = setInterval(fetchState, 3000)
  return () => clearInterval(interval)
}

// ── Node Config ───────────────────────────────────────────────────────────────

export async function getNodeConfig(
  labId: string,
  clusterId: string,
  nodeId: string
): Promise<NodeConfig | null> {
  return fetchJson<NodeConfig>(`/api/labs/${labId}/clusters/${clusterId}/nodes/${nodeId}/config/current`)
}

export async function updateNodeConfig(
  labId: string,
  clusterId: string,
  nodeId: string,
  patch: Partial<NodeConfig>,
  updatedBy: string
) {
  return fetchJson<{ success: boolean; version: number }>(
    `/api/labs/${labId}/clusters/${clusterId}/nodes/${nodeId}/config/current`,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...patch, updatedBy })
    }
  )
}

// ── Access Events ─────────────────────────────────────────────────────────────

export function subscribeAccessEvents(
  labId: string,
  limitCount: number,
  cb: (events: AccessEvent[]) => void
) {
  const fetchEvents = async () => {
    try {
      const events = await getAccessEvents(labId, {}, limitCount)
      cb(events)
    } catch (err) {
      console.error('Error in subscribeAccessEvents:', err)
    }
  }

  fetchEvents()
  const interval = setInterval(fetchEvents, 3000)
  return () => clearInterval(interval)
}

export async function getAccessEvents(
  labId: string,
  filters: { result?: string; dateFrom?: string; dateTo?: string; search?: string },
  limitCount = 200
): Promise<AccessEvent[]> {
  // Query parameters can be extended if needed, currently limit is primary
  return fetchJson<AccessEvent[]>(`/api/labs/${labId}/access-events?limit=${limitCount}`)
}

// ── Incidents ─────────────────────────────────────────────────────────────────

export function subscribeIncidents(labId: string, cb: (incidents: Incident[]) => void) {
  const fetchIncidents = async () => {
    try {
      const incidents = await fetchJson<Incident[]>(`/api/labs/${labId}/incidents`)
      cb(incidents)
    } catch (err) {
      console.error('Error in subscribeIncidents:', err)
    }
  }

  fetchIncidents()
  const interval = setInterval(fetchIncidents, 3000)
  return () => clearInterval(interval)
}

// ── Users ─────────────────────────────────────────────────────────────────────

export async function getLabUsers(labId: string): Promise<User[]> {
  return fetchJson<User[]>(`/api/labs/${labId}/users`)
}

// ── Enrollment ────────────────────────────────────────────────────────────────

interface EnrollmentPayload {
  universityId:  string
  fullName:      string
  email:         string
  roles:         string[]
  labId:         string
  pin:           string
  faceImageUrls: string[]
  capturedBy:    string
  photos?:       File[]
}

export async function enrollUser(payload: EnrollmentPayload): Promise<string> {
  const { universityId, fullName, email, roles, labId, pin, photos } = payload

  const formData = new FormData()
  formData.append('universityId', universityId)
  formData.append('fullName', fullName)
  formData.append('email', email)
  formData.append('role', roles[0] || 'student')
  formData.append('pin', pin)

  if (photos && photos.length > 0) {
    photos.forEach((photo) => {
      formData.append('photos', photo)
    })
  } else {
    throw new Error('Offline enrollment requires at least 1 face photo file')
  }

  const res = await fetch(`/api/labs/${labId}/enroll`, {
    method: 'POST',
    body: formData
  })

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Enrollment failed' }))
    throw new Error(err.error || 'Failed to enroll user offline')
  }

  const data = await res.json()
  return data.success ? 'local-user-id' : ''
}

export async function deleteUser(labId: string, userId: string): Promise<void> {
  const res = await fetch(`/api/labs/${labId}/users/${userId}`, {
    method: 'DELETE'
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Deletion failed' }))
    throw new Error(err.error || 'Failed to delete user')
  }
}
