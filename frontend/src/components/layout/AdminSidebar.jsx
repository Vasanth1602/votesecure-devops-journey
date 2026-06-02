import { NavLink } from 'react-router-dom';

const items = [
  { to: '/admin', label: 'Dashboard' },
  { to: '/admin/elections', label: 'Elections' },
  { to: '/admin/candidates', label: 'Candidates' },
  { to: '/admin/results', label: 'Live Results' },
  { to: '/admin/audit', label: 'Audit Trail' },
];

export default function AdminSidebar() {
  return (
    <aside className="w-full rounded-xl bg-white p-4 shadow-sm md:w-64">
      <nav className="space-y-2">
        {items.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.to === '/admin'}
            className={({ isActive }) =>
              `block rounded px-3 py-2 text-sm ${
                isActive ? 'bg-primary-50 text-primary-700 font-medium' : 'text-slate-600 hover:bg-slate-50'
              }`
            }
          >
            {item.label}
          </NavLink>
        ))}
      </nav>
    </aside>
  );
}
