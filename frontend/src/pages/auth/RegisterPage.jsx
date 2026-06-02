import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import api from '../../api/axios';
import Input from '../../components/ui/Input';
import Button from '../../components/ui/Button';
import { useToast } from '../../components/ui/Toast';

function getStrength(password) {
  let score = 0;
  if (password.length >= 8) score += 1;
  if (/[A-Z]/.test(password)) score += 1;
  if (/[0-9]/.test(password)) score += 1;
  if (/[^A-Za-z0-9]/.test(password)) score += 1;
  return score;
}

export default function RegisterPage() {
  const [form, setForm] = useState({ name: '', email: '', password: '', confirmPassword: '' });
  const [errors, setErrors] = useState({});
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const toast = useToast();

  const strength = getStrength(form.password);

  const validate = () => {
    const next = {};
    if (!form.name.trim()) next.name = 'Full name is required';
    if (!form.email.includes('@')) next.email = 'Valid email is required';
    if (form.password.length < 8) next.password = 'Password must be at least 8 characters';
    if (form.password !== form.confirmPassword) next.confirmPassword = 'Passwords do not match';
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const submit = async (e) => {
    e.preventDefault();
    if (!validate()) return;

    try {
      setLoading(true);
      await api.post('/auth/register', {
        name: form.name,
        email: form.email,
        password: form.password,
        role: 'voter',
      });
      toast?.push('Registration successful. Please login.', 'success');
      navigate('/login');
    } catch (err) {
      toast?.push(err.response?.data?.error || 'Registration failed', 'error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="mx-auto mt-10 max-w-md rounded-xl bg-white p-6 shadow-sm">
      <h1 className="mb-1 text-2xl font-semibold">Create account</h1>
      <p className="mb-6 text-sm text-slate-600">Register as a voter to participate in elections.</p>
      <form className="space-y-4" onSubmit={submit}>
        <Input label="Full Name" value={form.name} error={errors.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        <Input label="Email" type="email" value={form.email} error={errors.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
        <Input label="Password" type="password" value={form.password} error={errors.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
        <div className="h-2 rounded bg-slate-200">
          <div className={`h-2 rounded ${strength <= 1 ? 'bg-red-500' : strength <= 3 ? 'bg-amber-500' : 'bg-emerald-500'}`} style={{ width: `${(strength / 4) * 100}%` }} />
        </div>
        <Input
          label="Confirm Password"
          type="password"
          value={form.confirmPassword}
          error={errors.confirmPassword}
          onChange={(e) => setForm({ ...form, confirmPassword: e.target.value })}
        />
        <Button disabled={loading} className="w-full">{loading ? 'Creating account...' : 'Register'}</Button>
      </form>
      <p className="mt-4 text-sm text-slate-600">
        Already have an account? <Link to="/login" className="text-primary-700">Login</Link>
      </p>
    </div>
  );
}
