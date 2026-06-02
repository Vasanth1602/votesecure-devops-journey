import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import api from '../../api/axios';
import Input from '../../components/ui/Input';
import Button from '../../components/ui/Button';
import useAuth from '../../hooks/useAuth';

export default function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({ email: '', password: '' });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    try {
      setLoading(true);
      const { data } = await api.post('/auth/login', form);
      login(data.user, data.accessToken, data.refreshToken);
      navigate(data.user.role === 'admin' ? '/admin' : '/voter');
    } catch (err) {
      const message = err.response?.data?.error || 'Login failed';
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="mx-auto mt-10 max-w-md rounded-xl bg-white p-6 shadow-sm">
      <h1 className="mb-1 text-2xl font-semibold">Sign in</h1>
      <p className="mb-6 text-sm text-slate-600">Access your VoteSecure account.</p>
      <form className="space-y-4" onSubmit={submit}>
        <Input label="Email" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
        <Input label="Password" type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
        {error && (
          <div className="rounded border border-red-200 bg-red-50 p-2 text-sm text-red-700">
            {error}
            {error.toLowerCase().includes('not verified') && (
              <div className="mt-1">
                <Link to="/verify-otp" state={{ email: form.email }} className="underline">
                  Verify account
                </Link>
              </div>
            )}
          </div>
        )}
        <Button disabled={loading} className="w-full">{loading ? 'Signing in...' : 'Login'}</Button>
      </form>
      <p className="mt-4 text-sm text-slate-600">
        New user? <Link to="/register" className="text-primary-700">Register</Link>
      </p>
    </div>
  );
}
