import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../../api/axios';
import ElectionCard from '../../components/election/ElectionCard';
import Button from '../../components/ui/Button';
import Badge from '../../components/ui/Badge';

export default function VoterDashboard() {
  const [elections, setElections] = useState([]);
  const [votedMap, setVotedMap] = useState({});
  const navigate = useNavigate();

  useEffect(() => {
    const load = async () => {
      const { data } = await api.get('/elections');
      setElections(data);
      const checks = await Promise.all(
        data.map(async (election) => {
          try {
            const status = await api.get(`/votes/status/${election.id}`);
            return [election.id, status.data.hasVoted];
          } catch {
            return [election.id, false];
          }
        })
      );
      setVotedMap(Object.fromEntries(checks));
    };
    load();
  }, []);

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Voter Dashboard</h1>
      <div className="grid gap-4 md:grid-cols-2">
        {elections.map((election) => {
          const hasVoted = votedMap[election.id];
          return (
            <ElectionCard
              key={election.id}
              election={election}
              actions={
                <>
                  {election.status === 'active' && (
                    <Button onClick={() => navigate(`/voter/elections/${election.id}/vote`)}>Vote Now</Button>
                  )}
                  {(election.status === 'closed' || hasVoted) && (
                    <Button className="bg-slate-800 hover:bg-slate-900" onClick={() => navigate(`/voter/elections/${election.id}/results`)}>
                      View Results
                    </Button>
                  )}
                  {hasVoted && <Badge value="Already Voted" />}
                </>
              }
            />
          );
        })}
      </div>
    </div>
  );
}
