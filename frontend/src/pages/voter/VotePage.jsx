import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import api from '../../api/axios';
import CandidateCard from '../../components/candidate/CandidateCard';
import Button from '../../components/ui/Button';
import Modal from '../../components/ui/Modal';
import { useToast } from '../../components/ui/Toast';

export default function VotePage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const [election, setElection] = useState(null);
  const [candidates, setCandidates] = useState([]);
  const [selected, setSelected] = useState('');
  const [openConfirm, setOpenConfirm] = useState(false);

  useEffect(() => {
    const load = async () => {
      const [electionRes, candidatesRes, votedRes] = await Promise.all([
        api.get(`/elections/${id}`),
        api.get(`/elections/${id}/candidates`),
        api.get(`/votes/status/${id}`),
      ]);

      if (votedRes.data.hasVoted) {
        navigate(`/voter/elections/${id}/confirmation`, {
          state: { voted: true, candidateId: votedRes.data.candidateId },
        });
        return;
      }

      setElection(electionRes.data);
      setCandidates(candidatesRes.data);
    };
    load();
  }, [id, navigate]);

  const castVote = async () => {
    try {
      const { data } = await api.post('/votes', { election_id: id, candidate_id: selected });
      const selectedCandidate = candidates.find((c) => c.id === selected);
      toast?.push('Vote cast successfully', 'success');
      navigate(`/voter/elections/${id}/confirmation`, {
        state: {
          receipt: data.receipt,
          candidateName: selectedCandidate?.name,
        },
      });
    } catch (err) {
      toast?.push(err.response?.data?.error || 'Unable to cast vote', 'error');
    }
  };

  if (!election) return <div>Loading election...</div>;
  if (election.status !== 'active') {
    return <div className="rounded-xl bg-white p-6">This election is currently {election.status}. Voting is unavailable.</div>;
  }

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Cast Vote: {election.title}</h1>
      <div className="grid gap-4 md:grid-cols-2">
        {candidates.map((candidate) => (
          <CandidateCard
            key={candidate.id}
            candidate={candidate}
            selected={selected === candidate.id}
            onSelect={() => setSelected(candidate.id)}
          />
        ))}
      </div>
      <Button disabled={!selected} onClick={() => setOpenConfirm(true)}>
        Cast My Vote
      </Button>

      <Modal open={openConfirm} onClose={() => setOpenConfirm(false)} title="Confirm Vote">
        <p className="mb-4 text-sm text-slate-600">This action is final. Are you sure you want to submit your vote?</p>
        <div className="flex gap-2">
          <Button className="bg-slate-700 hover:bg-slate-800" onClick={() => setOpenConfirm(false)}>Cancel</Button>
          <Button onClick={castVote}>Confirm and Submit</Button>
        </div>
      </Modal>
    </div>
  );
}
