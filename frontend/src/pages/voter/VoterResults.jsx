import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import api from '../../api/axios';

export default function VoterResults() {
  const { id } = useParams();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api
      .get(`/results/${id}`)
      .then((res) => setData(res.data))
      .catch((err) => setError(err.response?.data?.error || 'Unable to fetch results'));
  }, [id]);

  if (error) return <div className="rounded-xl bg-white p-6 text-red-700">{error}</div>;
  if (!data) return <div>Loading results...</div>;

  return (
    <div className="space-y-4 rounded-xl bg-white p-6 shadow-sm">
      <h1 className="text-2xl font-semibold">Results: {data.election.title}</h1>
      <p className="text-sm text-slate-600">Total votes: {data.total_votes}</p>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-left text-slate-500">
            <tr><th>Candidate</th><th>Party</th><th>Votes</th><th>Percentage</th></tr>
          </thead>
          <tbody>
            {data.results.map((row) => (
              <tr className="border-t" key={row.candidate_id}>
                <td className="py-2">{row.name}</td>
                <td>{row.party || '-'}</td>
                <td>{row.vote_count}</td>
                <td>{row.percentage}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
