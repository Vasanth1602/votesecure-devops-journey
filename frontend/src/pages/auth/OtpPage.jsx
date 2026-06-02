import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import api from '../../api/axios';
import Input from '../../components/ui/Input';
import Button from '../../components/ui/Button';
import { useToast } from '../../components/ui/Toast';

export default function OtpPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const toast = useToast();
  const [email, setEmail] = useState(location.state?.email || '');
  const [otp, setOtp] = useState('');
  const [cooldown, setCooldown] = useState(0);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!cooldown) return;
    const timer = setInterval(() => setCooldown((x) => Math.max(0, x - 1)), 1000);
    return () => clearInterval(timer);
  }, [cooldown]);

  const verify = async (e) => {
    e.preventDefault();
    try {
      setLoading(true);
      await api.post('/auth/verify-otp', { email, otp });
      toast?.push('Email verified successfully', 'success');
      navigate('/login');
    } catch (err) {
      toast?.push(err.response?.data?.error || 'OTP verification failed', 'error');
    } finally {
      setLoading(false);
    }
  };

  const resend = async () => {
    try {
      await api.post('/auth/resend-otp', { email });
      setCooldown(60);
      toast?.push('OTP resent successfully', 'success');
    } catch (err) {
      toast?.push(err.response?.data?.error || 'Could not resend OTP', 'error');
    }
  };

  return (
    <div className="mx-auto mt-10 max-w-md rounded-xl bg-white p-6 shadow-sm">
      <h1 className="mb-1 text-2xl font-semibold">Verify OTP</h1>
      <p className="mb-6 text-sm text-slate-600">Enter the 6-digit code sent to your email.</p>
      <form className="space-y-4" onSubmit={verify}>
        <Input label="Email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        <Input label="OTP" value={otp} maxLength={6} onChange={(e) => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))} />
        <Button disabled={loading} className="w-full">{loading ? 'Verifying...' : 'Verify OTP'}</Button>
      </form>
      <div className="mt-4 flex items-center justify-between text-sm">
        <button disabled={cooldown > 0} onClick={resend} className="text-primary-700 disabled:text-slate-400">
          {cooldown > 0 ? `Resend in ${cooldown}s` : 'Resend OTP'}
        </button>
        <Link to="/login" className="text-slate-600">Back to login</Link>
      </div>
    </div>
  );
}
