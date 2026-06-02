export default function CandidateCard({ candidate, selected, onSelect }) {
  const initials = candidate.name
    .split(' ')
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

  return (
    <button
      onClick={onSelect}
      className={`w-full rounded-xl border p-4 text-left ${selected ? 'border-primary-600 bg-primary-50' : 'border-slate-200 bg-white'}`}
    >
      <div className="mb-3 flex items-center gap-3">
        {candidate.photo_url ? (
          <img src={candidate.photo_url} alt={candidate.name} className="h-12 w-12 rounded-full object-cover" />
        ) : (
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-slate-200 font-semibold text-slate-700">{initials}</div>
        )}
        <div>
          <h4 className="font-semibold">{candidate.name}</h4>
          <p className="text-sm text-slate-600">{candidate.party || 'Independent'}</p>
        </div>
      </div>
      <p className="text-sm text-slate-600">{candidate.bio || 'No bio available.'}</p>
    </button>
  );
}
