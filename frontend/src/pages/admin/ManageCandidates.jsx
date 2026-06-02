import { useEffect, useState } from 'react';
import api from '../../api/axios';
import Modal from '../../components/ui/Modal';
import Button from '../../components/ui/Button';
import { useToast } from '../../components/ui/Toast';

const initial = { name: '', party: '', bio: '', photo_url: '' };

export default function ManageCandidates() {
  const [elections, setElections] = useState([]);
  const [selectedElection, setSelectedElection] = useState('');
  const [candidates, setCandidates] = useState([]);
  const [form, setForm] = useState(initial);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const toast = useToast();

  useEffect(() => {
    api
      .get('/elections')
      .then(({ data }) => {
        setElections(data);
        if (data.length) setSelectedElection(data[0].id);
      })
      .catch((err) => {
        toast?.push(err.response?.data?.error || 'Failed to load elections', 'error');
      });
  }, [toast]);

  useEffect(() => {
    if (!selectedElection) return;
    api
      .get(`/elections/${selectedElection}/candidates`)
      .then(({ data }) => setCandidates(data))
      .catch((err) => {
        toast?.push(err.response?.data?.error || 'Failed to load candidates', 'error');
      });
  }, [selectedElection]);

  const selected = elections.find((e) => e.id === selectedElection);

  const save = async () => {
    try {
      if (!form.name.trim()) {
        toast?.push('Candidate name is required', 'error');
        return;
      }

      if (selected?.status !== 'upcoming') {
        toast?.push('Candidates can only be added or edited when election is upcoming', 'error');
        return;
      }

      if (editing) {
        await api.put(`/elections/${selectedElection}/candidates/${editing.id}`, form);
        toast?.push('Candidate updated successfully', 'success');
      } else {
        await api.post(`/elections/${selectedElection}/candidates`, form);
        toast?.push('Candidate added successfully', 'success');
      }

      setForm(initial);
      setEditing(null);
      setOpen(false);
      const { data } = await api.get(`/elections/${selectedElection}/candidates`);
      setCandidates(data);
    } catch (err) {
      toast?.push(err.response?.data?.error || 'Could not save candidate', 'error');
    }
  };

  const remove = async (id) => {
    if (!confirm('Delete this candidate?')) return;
    try {
      await api.delete(`/elections/${selectedElection}/candidates/${id}`);
      const { data } = await api.get(`/elections/${selectedElection}/candidates`);
      setCandidates(data);
      toast?.push('Candidate deleted successfully', 'success');
    } catch (err) {
      toast?.push(err.response?.data?.error || 'Could not delete candidate', 'error');
    }
  };

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Manage Candidates</h1>
      <div className="rounded-xl bg-white p-4 shadow-sm">
        <div className="mb-4 flex items-center justify-between">
          <select className="rounded border p-2" value={selectedElection} onChange={(e) => setSelectedElection(e.target.value)}>
            {elections.map((e) => <option key={e.id} value={e.id}>{e.title}</option>)}
          </select>
          <Button
            disabled={selected?.status !== 'upcoming'}
            onClick={() => {
              if (selected?.status !== 'upcoming') {
                toast?.push('Add candidates before activating election. Current status is not upcoming.', 'error');
                return;
              }
              setOpen(true);
            }}
            title={selected?.status !== 'upcoming' ? 'Only upcoming elections allow candidate changes' : 'Add candidate'}
          >
            Add Candidate
          </Button>
        </div>
        {selected && selected.status !== 'upcoming' && (
          <p className="mb-3 text-sm text-amber-700">
            Candidate changes are locked because this election is <strong>{selected.status}</strong>.
            Create a new election or use an upcoming one to add candidates.
          </p>
        )}
        <table className="w-full text-sm">
          <thead><tr className="text-left text-slate-500"><th>Name</th><th>Party</th><th>Actions</th></tr></thead>
          <tbody>
            {candidates.map((c) => (
              <tr key={c.id} className="border-t">
                <td className="py-2">{c.name}</td><td>{c.party}</td>
                <td>
                  {selected?.status === 'upcoming' && (
                    <>
                      <button className="mr-3 text-primary-700" onClick={() => { setEditing(c); setForm(c); setOpen(true); }}>Edit</button>
                      <button className="text-red-700" onClick={() => remove(c.id)}>Delete</button>
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Modal open={open} onClose={() => setOpen(false)} title={editing ? 'Edit Candidate' : 'Add Candidate'}>
        <div className="space-y-3">
          <input className="w-full rounded border p-2" placeholder="Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <input className="w-full rounded border p-2" placeholder="Party" value={form.party} onChange={(e) => setForm({ ...form, party: e.target.value })} />
          <textarea className="w-full rounded border p-2" placeholder="Bio" value={form.bio} onChange={(e) => setForm({ ...form, bio: e.target.value })} />
          <input className="w-full rounded border p-2" placeholder="Photo URL" value={form.photo_url} onChange={(e) => setForm({ ...form, photo_url: e.target.value })} />
          <Button onClick={save}>Save Candidate</Button>
        </div>
      </Modal>
    </div>
  );
}
