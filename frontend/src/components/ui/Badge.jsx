const map = {
  upcoming: 'bg-amber-100 text-amber-700',
  active: 'bg-emerald-100 text-emerald-700',
  closed: 'bg-slate-200 text-slate-700',
  admin: 'bg-purple-100 text-purple-700',
  voter: 'bg-sky-100 text-sky-700',
};

export default function Badge({ value }) {
  const key = String(value || '').toLowerCase();
  return <span className={`rounded-full px-2 py-1 text-xs font-medium ${map[key] || 'bg-slate-100 text-slate-700'}`}>{value}</span>;
}
