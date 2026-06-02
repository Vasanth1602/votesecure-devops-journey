export default function Button({ children, className = '', ...props }) {
  return (
    <button
      {...props}
      className={`rounded-md bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700 disabled:opacity-60 ${className}`}
    >
      {children}
    </button>
  );
}
