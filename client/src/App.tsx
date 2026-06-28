import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import Layout from './components/Layout';
import Dashboard from './pages/Dashboard';
import Members from './pages/Members';
import Products from './pages/Products';
import Receives from './pages/Receives';
import Issues from './pages/Issues';
import Returns from './pages/Returns';
import Payroll from './pages/Payroll';
import Billing from './pages/Billing';
import OCR from './pages/OCR';
import SettingsPage from './pages/SettingsPage';
import StockFlow from './pages/StockFlow';
import Shipments from './pages/Shipments';
import FormPrint from './pages/FormPrint';
import PdpaConsent from './pages/PdpaConsent';
import Login from './pages/Login';
import { AuthProvider, useAuth, canAccess, homePath } from './auth';

// จำกัดสิทธิ์ตาม role — ถ้าเข้าไม่ได้ ส่งกลับหน้าแรกของ role นั้น
function Guard({ path, children }: { path: string; children: JSX.Element }) {
  const { user } = useAuth();
  if (!user) return <Navigate to="/" replace />;
  if (!canAccess(user.role, path)) return <Navigate to={homePath(user.role)} replace />;
  return children;
}

function AppRoutes() {
  const { user } = useAuth();
  if (!user) return <Login />;
  return (
    <Layout>
      <Routes>
        <Route path="/" element={<Guard path="/"><Dashboard /></Guard>} />
        <Route path="/members" element={<Guard path="/members"><Members /></Guard>} />
        <Route path="/products" element={<Guard path="/products"><Products /></Guard>} />
        <Route path="/receives" element={<Guard path="/receives"><Receives /></Guard>} />
        <Route path="/issues" element={<Guard path="/issues"><Issues /></Guard>} />
        <Route path="/returns" element={<Guard path="/returns"><Returns /></Guard>} />
        <Route path="/stock" element={<Guard path="/stock"><StockFlow /></Guard>} />
        <Route path="/shipments" element={<Guard path="/shipments"><Shipments /></Guard>} />
        <Route path="/payroll" element={<Guard path="/payroll"><Payroll /></Guard>} />
        <Route path="/billing" element={<Guard path="/billing"><Billing /></Guard>} />
        <Route path="/ocr" element={<Guard path="/ocr"><OCR /></Guard>} />
        <Route path="/settings" element={<Guard path="/settings"><SettingsPage /></Guard>} />
        <Route path="*" element={<Navigate to={homePath(user.role)} replace />} />
      </Routes>
    </Layout>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          {/* print page — no layout/auth wrapper */}
          <Route path="/print" element={<FormPrint />} />
          <Route path="/pdpa" element={<PdpaConsent />} />
          <Route path="/*" element={<AppRoutes />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}
