import { useEffect, useMemo, useState } from 'react';
import { io } from 'socket.io-client';
import api from '../../api/axios';
import BarChart from '../../components/charts/BarChart';
import PieChart from '../../components/charts/PieChart';

export default function LiveResults() {
  const [elections, setElections] = useState([]);
  const [selectedElection, setSelectedElection] = useState('');
  const [results, setResults] = useState([]);
  const [totalVotes, setTotalVotes] = useState(0);

  useEffect(() => {
    api.get('/elections').then(({ data }) => {
      setElections(data);
      if (data.length) setSelectedElection(data[0].id);
    });
  }, []);

  useEffect(() => {
    if (!selectedElection) return;
    api.get(`/results/${selectedElection}`).then(({ data }) => {
      setResults(data.results);
      setTotalVotes(data.total_votes);
    });
  }, [selectedElection]);

  useEffect(() => {
    if (!selectedElection) return;
    const socket = io();
    socket.emit('joinElection', selectedElection);
    socket.on('resultsUpdated', (payload) => {
      setResults(payload.results || []);
      setTotalVotes(payload.total_votes || 0);
    });
    return () => {
      socket.emit('leaveElection', selectedElection);
      socket.disconnect();
    };
  }, [selectedElection]);

  const winner = useMemo(() => results[0]?.name || '-', [results]);

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Live Results</h1>
      <div className="rounded-xl bg-white p-4 shadow-sm">
        <div className="mb-4 flex items-center gap-4">
          <select className="rounded border p-2" value={selectedElection} onChange={(e) => setSelectedElection(e.target.value)}>
            {elections.map((e) => <option key={e.id} value={e.id}>{e.title}</option>)}
          </select>
          <span className="rounded bg-emerald-100 px-3 py-1 text-sm text-emerald-700">Total Votes: {totalVotes}</span>
          <span className="rounded bg-primary-100 px-3 py-1 text-sm text-primary-700">Winner: {winner}</span>
        </div>
        <div className="grid gap-4 lg:grid-cols-2">
          <BarChart title="Vote Count by Candidate" data={results} />
          <PieChart data={results} />
        </div>
      </div>
    </div>
  );
}
