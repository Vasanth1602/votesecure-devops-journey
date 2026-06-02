import { Link, useLocation, useParams } from 'react-router-dom';

export default function VoteConfirmation() {
  const { id } = useParams();
  const { state } = useLocation();
  const candidateName = state?.candidateName || 'Candidate';
  const receipt = state?.receipt || 'Stored securely in backend';

  return (
    <div className="mx-auto max-w-2xl rounded-xl bg-white p-6 text-center shadow-sm">
      <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-emerald-100 text-2xl text-emerald-600">✓</div>
      <h1 className="text-2xl font-semibold">Vote Submitted Successfully</h1>
      <p className="mt-2 text-slate-600">You voted for <strong>{candidateName}</strong>.</p>
      <p className="mt-4 rounded bg-slate-50 p-3 text-left text-xs text-slate-600">
        Encrypted receipt: {String(receipt).slice(0, 100)}...
      </p>
      <div className="mt-6 flex justify-center gap-3">
        <Link to={`/voter/elections/${id}/results`} className="rounded bg-primary-600 px-4 py-2 text-sm text-white">View Results</Link>
        <Link to="/voter" className="rounded bg-slate-800 px-4 py-2 text-sm text-white">Back to Elections</Link>
      </div>
    </div>
  );
}
