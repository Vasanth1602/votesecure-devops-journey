import { Navigate, Route, Routes } from 'react-router-dom';
import Navbar from './components/layout/Navbar';
import ProtectedRoute from './components/layout/ProtectedRoute';
import AdminSidebar from './components/layout/AdminSidebar';
import { ToastProvider } from './components/ui/Toast';
import LoginPage from './pages/auth/LoginPage';
import RegisterPage from './pages/auth/RegisterPage';
import OtpPage from './pages/auth/OtpPage';
import VoterDashboard from './pages/voter/VoterDashboard';
import VotePage from './pages/voter/VotePage';
import VoteConfirmation from './pages/voter/VoteConfirmation';
import VoterResults from './pages/voter/VoterResults';
import AdminDashboard from './pages/admin/AdminDashboard';
import ManageElections from './pages/admin/ManageElections';
import ManageCandidates from './pages/admin/ManageCandidates';
import LiveResults from './pages/admin/LiveResults';
import AuditTrail from './pages/admin/AuditTrail';
import NotFound from './pages/NotFound';

function AdminLayout({ children }) {
  return (
    <div className="mx-auto grid max-w-7xl gap-4 p-4 md:grid-cols-[16rem_1fr]">
      <AdminSidebar />
      <div>{children}</div>
    </div>
  );
}

function PublicLayout({ children }) {
  return <div className="mx-auto max-w-7xl p-4">{children}</div>;
}

export default function App() {
  return (
    <ToastProvider>
      <Navbar />
      <Routes>
        <Route path="/" element={<Navigate to="/login" replace />} />
        <Route path="/login" element={<PublicLayout><LoginPage /></PublicLayout>} />
        <Route path="/register" element={<PublicLayout><RegisterPage /></PublicLayout>} />
        <Route path="/verify-otp" element={<PublicLayout><OtpPage /></PublicLayout>} />

        <Route
          path="/voter"
          element={<ProtectedRoute requiredRole="voter"><PublicLayout><VoterDashboard /></PublicLayout></ProtectedRoute>}
        />
        <Route
          path="/voter/elections/:id/vote"
          element={<ProtectedRoute requiredRole="voter"><PublicLayout><VotePage /></PublicLayout></ProtectedRoute>}
        />
        <Route
          path="/voter/elections/:id/confirmation"
          element={<ProtectedRoute requiredRole="voter"><PublicLayout><VoteConfirmation /></PublicLayout></ProtectedRoute>}
        />
        <Route
          path="/voter/elections/:id/results"
          element={<ProtectedRoute requiredRole="voter"><PublicLayout><VoterResults /></PublicLayout></ProtectedRoute>}
        />

        <Route
          path="/admin"
          element={<ProtectedRoute requiredRole="admin"><AdminLayout><AdminDashboard /></AdminLayout></ProtectedRoute>}
        />
        <Route
          path="/admin/elections"
          element={<ProtectedRoute requiredRole="admin"><AdminLayout><ManageElections /></AdminLayout></ProtectedRoute>}
        />
        <Route
          path="/admin/candidates"
          element={<ProtectedRoute requiredRole="admin"><AdminLayout><ManageCandidates /></AdminLayout></ProtectedRoute>}
        />
        <Route
          path="/admin/results"
          element={<ProtectedRoute requiredRole="admin"><AdminLayout><LiveResults /></AdminLayout></ProtectedRoute>}
        />
        <Route
          path="/admin/audit"
          element={<ProtectedRoute requiredRole="admin"><AdminLayout><AuditTrail /></AdminLayout></ProtectedRoute>}
        />

        <Route path="/unauthorized" element={<PublicLayout><NotFound /></PublicLayout>} />
        <Route path="*" element={<PublicLayout><NotFound /></PublicLayout>} />
      </Routes>
    </ToastProvider>
  );
}
