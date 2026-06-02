export default function Input({ label, error, ...props }) {
  return (
    <label className="block space-y-1">
      {label && <span className="text-sm font-medium text-slate-700">{label}</span>}
      <input
        {...props}
        className={`w-full rounded-md border px-3 py-2 outline-none ring-primary-300 focus:ring ${
          error ? 'border-red-500' : 'border-slate-300'
        }`}
      />
      {error && <span className="text-xs text-red-600">{error}</span>}
    </label>
  );
}
