import { useEffect, useState } from 'react';
import api from '../../api/axios';

const colors = {
  USER_LOGIN: 'bg-blue-100 text-blue-700',
  VOTE_CAST: 'bg-emerald-100 text-emerald-700',
  ELECTION_CREATED: 'bg-purple-100 text-purple-700',
};

export default function AuditTrail() {
  const [logs, setLogs] = useState([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [eventType, setEventType] = useState('');

  const load = async (nextPage = page, nextType = eventType) => {
    const { data } = await api.get('/audit', { params: { page: nextPage, limit: 20, event_type: nextType || undefined } });
    setLogs(data.logs);
    setPage(data.page);
    setTotalPages(data.totalPages);
  };

  useEffect(() => { load(1, eventType); }, [eventType]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Audit Trail</h1>
        <select className="rounded border p-2" value={eventType} onChange={(e) => setEventType(e.target.value)}>
          <option value="">All Events</option>
          <option value="USER_LOGIN">USER_LOGIN</option>
          <option value="VOTE_CAST">VOTE_CAST</option>
          <option value="ELECTION_CREATED">ELECTION_CREATED</option>
        </select>
      </div>
      <div className="overflow-x-auto rounded-xl bg-white p-4 shadow-sm">
        <table className="w-full text-sm">
          <thead className="text-left text-slate-500">
            <tr><th>Timestamp</th><th>Event Type</th><th>Actor Email</th><th>Description</th><th>IP Address</th><th>Hash</th></tr>
          </thead>
          <tbody>
            {logs.map((log) => (
              <tr key={log.id} className="border-t">
                <td className="py-2">{new Date(log.created_at).toLocaleString()}</td>
                <td><span className={`rounded px-2 py-1 text-xs ${colors[log.event_type] || 'bg-slate-100 text-slate-700'}`}>{log.event_type}</span></td>
                <td>{log.actor_email || '-'}</td>
                <td>{log.description}</td>
                <td>{log.ip_address || '-'}</td>
                <td>{String(log.current_hash).slice(0, 12)}...</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex items-center gap-2">
        <button className="rounded border px-3 py-1" disabled={page <= 1} onClick={() => load(page - 1, eventType)}>Prev</button>
        <span className="text-sm">Page {page} of {totalPages}</span>
        <button className="rounded border px-3 py-1" disabled={page >= totalPages} onClick={() => load(page + 1, eventType)}>Next</button>
      </div>
    </div>
  );
}
