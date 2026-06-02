import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../../api/axios';

export default function AdminDashboard() {
  const [elections, setElections] = useState([]);

  useEffect(() => {
    api.get('/elections').then(({ data }) => setElections(data));
  }, []);

  const summary = useMemo(() => {
    const total = elections.length;
    const active = elections.filter((e) => e.status === 'active').length;
    const totalVotesToday = elections.reduce((sum, e) => sum + Number(e.voter_count || 0), 0);
    return { total, active, totalVotesToday };
  }, [elections]);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Admin Dashboard</h1>
      <div className="grid gap-4 md:grid-cols-4">
        <div className="rounded-xl bg-white p-4 shadow-sm"><p className="text-sm text-slate-500">Total Elections</p><p className="text-2xl font-semibold">{summary.total}</p></div>
        <div className="rounded-xl bg-white p-4 shadow-sm"><p className="text-sm text-slate-500">Active Elections</p><p className="text-2xl font-semibold">{summary.active}</p></div>
        <div className="rounded-xl bg-white p-4 shadow-sm"><p className="text-sm text-slate-500">Total Votes Today</p><p className="text-2xl font-semibold">{summary.totalVotesToday}</p></div>
        <div className="rounded-xl bg-white p-4 shadow-sm"><p className="text-sm text-slate-500">Registered Voters</p><p className="text-2xl font-semibold">-</p></div>
      </div>

      <div className="flex gap-3">
        <Link to="/admin/elections" className="rounded bg-primary-600 px-4 py-2 text-sm text-white">Create Election</Link>
        <Link to="/admin/audit" className="rounded bg-slate-800 px-4 py-2 text-sm text-white">View Audit Trail</Link>
      </div>

      <div className="rounded-xl bg-white p-4 shadow-sm">
        <h2 className="mb-3 text-lg font-semibold">Recent Elections</h2>
        <table className="w-full text-sm">
          <thead className="text-left text-slate-500">
            <tr><th className="pb-2">Title</th><th>Status</th><th>Candidates</th><th>Voters</th></tr>
          </thead>
          <tbody>
            {elections.slice(0, 6).map((e) => (
              <tr key={e.id} className="border-t">
                <td className="py-2">{e.title}</td>
                <td>{e.status}</td>
                <td>{e.candidate_count}</td>
                <td>{e.voter_count}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
