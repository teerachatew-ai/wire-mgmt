import { BrowserRouter, Routes, Route } from 'react-router-dom';
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

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        {/* print page — no layout wrapper */}
        <Route path="/print" element={<FormPrint />} />
        <Route path="/pdpa" element={<PdpaConsent />} />
        <Route path="/*" element={
          <Layout>
            <Routes>
              <Route path="/" element={<Dashboard />} />
              <Route path="/members" element={<Members />} />
              <Route path="/products" element={<Products />} />
              <Route path="/receives" element={<Receives />} />
              <Route path="/issues" element={<Issues />} />
              <Route path="/returns" element={<Returns />} />
              <Route path="/stock" element={<StockFlow />} />
              <Route path="/shipments" element={<Shipments />} />
              <Route path="/payroll" element={<Payroll />} />
              <Route path="/billing" element={<Billing />} />
              <Route path="/ocr" element={<OCR />} />
              <Route path="/settings" element={<SettingsPage />} />
            </Routes>
          </Layout>
        } />
      </Routes>
    </BrowserRouter>
  );
}
