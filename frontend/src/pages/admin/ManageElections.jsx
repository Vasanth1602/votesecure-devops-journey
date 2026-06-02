import { useEffect, useState } from 'react';
import api from '../../api/axios';
import Modal from '../../components/ui/Modal';
import Button from '../../components/ui/Button';
import { useToast } from '../../components/ui/Toast';

const initialForm = { title: '', description: '', start_time: '', end_time: '' };

export default function ManageElections() {
  const [elections, setElections] = useState([]);
  const [form, setForm] = useState(initialForm);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const toast = useToast();

  const load = () => api.get('/elections').then(({ data }) => setElections(data));
  useEffect(() => { load(); }, []);

  const save = async () => {
    try {
      if (editing) {
        await api.put(`/elections/${editing.id}`, form);
        toast?.push('Election updated', 'success');
      } else {
        await api.post('/elections', form);
        toast?.push('Election created', 'success');
      }
      setForm(initialForm);
      setEditing(null);
      setOpen(false);
      load();
    } catch (err) {
      toast?.push(err.response?.data?.error || 'Failed to save election', 'error');
    }
  };

  const setStatus = async (id, status) => {
    if (!confirm(`Set election to ${status}?`)) return;
    await api.patch(`/elections/${id}/status`, { status });
    load();
  };

  const remove = async (id) => {
    if (!confirm('Delete this upcoming election?')) return;
    await api.delete(`/elections/${id}`);
    load();
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Manage Elections</h1>
        <Button onClick={() => { setEditing(null); setForm(initialForm); setOpen(true); }}>Create Election</Button>
      </div>
      <div className="rounded-xl bg-white p-4 shadow-sm">
        <table className="w-full text-sm">
          <thead className="text-left text-slate-500">
            <tr><th>Title</th><th>Status</th><th>Candidates</th><th>Votes</th><th>Actions</th></tr>
          </thead>
          <tbody>
            {elections.map((election) => (
              <tr key={election.id} className="border-t">
                <td className="py-2">{election.title}</td>
                <td>{election.status}</td>
                <td>{election.candidate_count}</td>
                <td>{election.voter_count}</td>
                <td className="space-x-2 py-2">
                  {election.status === 'upcoming' && (
                    <>
                      <button className="text-primary-700" onClick={() => { setEditing(election); setForm(election); setOpen(true); }}>Edit</button>
                      <button className="text-emerald-700" onClick={() => setStatus(election.id, 'active')}>Set Active</button>
                      <button className="text-red-700" onClick={() => remove(election.id)}>Delete</button>
                    </>
                  )}
                  {election.status === 'active' && (
                    <button className="text-amber-700" onClick={() => setStatus(election.id, 'closed')}>Set Closed</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Modal open={open} onClose={() => setOpen(false)} title={editing ? 'Edit Election' : 'Create Election'}>
        <div className="space-y-3">
          <input className="w-full rounded border p-2" placeholder="Title" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
          <textarea className="w-full rounded border p-2" placeholder="Description" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          <input type="datetime-local" className="w-full rounded border p-2" value={form.start_time?.slice(0, 16) || ''} onChange={(e) => setForm({ ...form, start_time: e.target.value })} />
          <input type="datetime-local" className="w-full rounded border p-2" value={form.end_time?.slice(0, 16) || ''} onChange={(e) => setForm({ ...form, end_time: e.target.value })} />
          <Button onClick={save}>Save</Button>
        </div>
      </Modal>
    </div>
  );
}
