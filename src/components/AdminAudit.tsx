import { useCallback, useEffect, useState } from 'react'
import { api, ApiError } from '../lib/api'

type AuditLog = {
  id: string
  actor_id: string | null
  action: string
  target_type: string | null
  target_id: string | null
  ip: string | null
  user_agent: string | null
  metadata_json: string | null
  created_at: number
}

export default function AdminAudit() {
  const [logs, setLogs] = useState<AuditLog[] | null>(null)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    try {
      const data = await api.get<{ logs: AuditLog[] }>('/admin/audit?limit=200')
      setLogs(data.logs)
      setError('')
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        window.location.href = '/login?next=/admin'
        return
      }
      setError(err instanceof ApiError ? err.message : 'Failed to load audit log.')
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  if (error) return <p className="text-[13px] text-loss">{error}</p>
  if (logs === null) return <p className="py-8 text-center text-[13px] text-muted" role="status">Loading audit log…</p>

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-[15px] font-semibold text-content">Audit log</h2>
        <p className="mt-1 text-[13px] text-muted">Recent admin actions.</p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[800px] text-left text-[13px]">
          <thead>
            <tr className="border-b border-line text-muted">
              <th className="px-3 py-2 font-medium">Time</th>
              <th className="px-3 py-2 font-medium">Action</th>
              <th className="px-3 py-2 font-medium">Actor</th>
              <th className="px-3 py-2 font-medium">Target</th>
              <th className="px-3 py-2 font-medium">Meta</th>
            </tr>
          </thead>
          <tbody>
            {logs.length === 0 ? (
              <tr><td className="px-3 py-6 text-center text-muted" colSpan={5}>No audit entries.</td></tr>
            ) : null}
            {logs.map((l) => (
              <tr key={l.id} className="border-b border-line last:border-0">
                <td className="px-3 py-2 text-muted">{new Date(l.created_at).toLocaleString()}</td>
                <td className="px-3 py-2 text-content">{l.action}</td>
                <td className="px-3 py-2 text-muted">{l.actor_id || '—'}</td>
                <td className="px-3 py-2 text-muted">{l.target_type ? `${l.target_type}:${l.target_id || ''}` : '—'}</td>
                <td className="px-3 py-2 font-mono text-[11px] text-muted">{l.metadata_json ? l.metadata_json.slice(0, 120) : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
