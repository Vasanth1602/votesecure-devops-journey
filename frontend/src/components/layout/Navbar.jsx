import { NavLink, useNavigate } from 'react-router-dom';
import useAuth from '../../hooks/useAuth';

export default function Navbar() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const links = user?.role === 'admin'
    ? [
        { to: '/admin', label: 'Dashboard' },
        { to: '/admin/elections', label: 'Elections' },
        { to: '/admin/candidates', label: 'Candidates' },
        { to: '/admin/results', label: 'Live Results' },
        { to: '/admin/audit', label: 'Audit Trail' },
      ]
    : [{ to: '/voter', label: 'Elections' }];

  return (
    <header className="border-b bg-white">
      <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3">
        <div className="text-xl font-semibold text-primary-700">VoteSecure</div>
        {user && (
          <div className="hidden items-center gap-4 md:flex">
            {links.map((link) => (
              <NavLink
                key={link.to}
                to={link.to}
                className={({ isActive }) =>
                  `text-sm ${isActive ? 'text-primary-700 font-semibold' : 'text-slate-600'}`
                }
              >
                {link.label}
              </NavLink>
            ))}
          </div>
        )}
        {user && (
          <div className="flex items-center gap-3">
            <div className="text-sm">
              <div className="font-medium">{user.name}</div>
              <div className="text-xs uppercase text-slate-500">{user.role}</div>
            </div>
            <button
              onClick={async () => {
                await logout();
                navigate('/login');
              }}
              className="rounded bg-slate-900 px-3 py-2 text-sm text-white"
            >
              Logout
            </button>
          </div>
        )}
      </div>
    </header>
  );
}
