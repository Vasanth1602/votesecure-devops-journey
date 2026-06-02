import ElectionStatus from './ElectionStatus';
import { formatDate } from '../../utils/formatDate';

export default function ElectionCard({ election, actions }) {
  return (
    <div className="rounded-xl border bg-white p-4 shadow-sm">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="font-semibold text-slate-900">{election.title}</h3>
        <ElectionStatus status={election.status} />
      </div>
      <p className="mb-3 text-sm text-slate-600">{election.description || 'No description'}</p>
      <p className="text-xs text-slate-500">Start: {formatDate(election.start_time)}</p>
      <p className="mb-4 text-xs text-slate-500">End: {formatDate(election.end_time)}</p>
      <div className="flex gap-2">{actions}</div>
    </div>
  );
}
