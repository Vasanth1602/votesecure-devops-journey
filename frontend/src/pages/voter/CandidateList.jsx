import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import api from '../../api/axios';
import CandidateCard from '../../components/candidate/CandidateCard';

export default function CandidateList() {
  const { id } = useParams();
  const [candidates, setCandidates] = useState([]);

  useEffect(() => {
    api.get(`/elections/${id}/candidates`).then(({ data }) => setCandidates(data));
  }, [id]);

  return (
    <div className="space-y-3">
      {candidates.map((candidate) => (
        <CandidateCard key={candidate.id} candidate={candidate} />
      ))}
    </div>
  );
}
