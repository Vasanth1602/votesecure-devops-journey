import { Link } from 'react-router-dom';

export default function NotFound() {
  return (
    <div className="mx-auto mt-16 max-w-lg rounded-xl bg-white p-8 text-center shadow-sm">
      <h1 className="text-3xl font-semibold">Page not found</h1>
      <p className="mt-2 text-slate-600">The page you requested does not exist.</p>
      <Link to="/login" className="mt-6 inline-block rounded bg-primary-600 px-4 py-2 text-sm text-white">Go to Login</Link>
    </div>
  );
}
