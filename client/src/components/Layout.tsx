import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard, Users, Package, ArrowDownToLine,
  ArrowUpFromLine, RotateCcw, DollarSign,
  ScanLine, Settings, Menu, X, Layers, ChevronRight, Truck, FileText
} from 'lucide-react';

const nav = [
  { to: '/stock',    icon: Layers,          label: 'สต็อค & ตรวจสอบ',    short: 'สต็อค' },
  { to: '/',         icon: LayoutDashboard, label: 'ภาพรวม',            short: 'ภาพรวม' },
  { to: '/members',  icon: Users,           label: 'สมาชิก',             short: 'สมาชิก' },
  { to: '/products', icon: Package,         label: 'ประเภทสินค้า',        short: 'สินค้า' },
  { to: '/receives', icon: ArrowDownToLine, label: 'รับของจากโรงงาน',    short: 'รับของ' },
  { to: '/issues',   icon: ArrowUpFromLine, label: 'เบิกงานให้สมาชิก',   short: 'เบิกงาน' },
  { to: '/returns',  icon: RotateCcw,       label: 'รับคืนงาน',          short: 'รับคืน' },
  { to: '/shipments',icon: Truck,           label: 'ส่งงานออกโรงงาน',    short: 'ส่งออก' },
  { to: '/payroll',  icon: DollarSign,      label: 'สรุปค่าแรง',         short: 'ค่าแรง' },
  { to: '/billing',  icon: FileText,        label: 'ใบแจ้งหนี้/วางบิล',  short: 'วางบิล' },
  { to: '/ocr',      icon: ScanLine,        label: 'สแกนฟอร์ม (OCR)',    short: 'สแกน' },
  { to: '/settings', icon: Settings,        label: 'ตั้งค่าระบบ',         short: 'ตั้งค่า' },
];

// Bottom nav shows these 5 (most used)
const bottomNav = ['/', '/issues', '/returns', '/shipments'];

export default function Layout({ children }: { children: React.ReactNode }) {
  const [sideOpen, setSideOpen] = useState(false);
  const loc = useLocation();
  const navigate = useNavigate();

  const bottomItems = nav.filter(n => bottomNav.includes(n.to));

  return (
    <div className="flex h-screen bg-slate-50">
      {/* ── DESKTOP SIDEBAR ─────────────────────────────── */}
      <aside className="hidden md:flex w-64 flex-col bg-slate-900 text-white shrink-0">
        <div className="px-5 py-4 border-b border-slate-700">
          <p className="text-xs text-slate-400 mb-0.5">ระบบบริหารงานกลุ่ม</p>
          <p className="text-base font-bold text-white">จ้างเหมาตัดสายไฟ</p>
        </div>
        <nav className="flex-1 py-2 overflow-y-auto">
          {nav.map(({ to, icon: Icon, label }) => {
            const active = loc.pathname === to;
            return (
              <Link key={to} to={to}
                className={`flex items-center gap-3 px-5 py-3 text-base transition-colors ${active ? 'bg-blue-600 text-white font-semibold' : 'text-slate-300 hover:bg-slate-800 hover:text-white'}`}
              >
                <Icon size={20} className="shrink-0" />
                <span>{label}</span>
                {active && <ChevronRight size={14} className="ml-auto" />}
              </Link>
            );
          })}
        </nav>
        <div className="px-5 py-3 border-t border-slate-700 text-sm text-slate-500">
          วิสาหกิจชุมชน v1.0
        </div>
      </aside>

      {/* ── MOBILE DRAWER OVERLAY ────────────────────────── */}
      {sideOpen && (
        <div className="fixed inset-0 z-40 md:hidden">
          <div className="absolute inset-0 bg-black/50" onClick={() => setSideOpen(false)} />
          <aside className="absolute left-0 top-0 h-full w-72 bg-slate-900 text-white flex flex-col z-50">
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-700">
              <div>
                <p className="text-xs text-slate-400">ระบบบริหารงานกลุ่ม</p>
                <p className="text-base font-bold text-white">จ้างเหมาตัดสายไฟ</p>
              </div>
              <button onClick={() => setSideOpen(false)} className="text-slate-400 p-2 rounded-lg hover:bg-slate-800">
                <X size={22} />
              </button>
            </div>
            <nav className="flex-1 py-2 overflow-y-auto">
              {nav.map(({ to, icon: Icon, label }) => {
                const active = loc.pathname === to;
                return (
                  <Link key={to} to={to} onClick={() => setSideOpen(false)}
                    className={`flex items-center gap-4 px-5 py-3.5 text-base transition-colors ${active ? 'bg-blue-600 text-white font-semibold' : 'text-slate-300 hover:bg-slate-800'}`}
                  >
                    <Icon size={22} className="shrink-0" />
                    <span>{label}</span>
                  </Link>
                );
              })}
            </nav>
          </aside>
        </div>
      )}

      {/* ── MAIN CONTENT ─────────────────────────────────── */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Mobile top bar */}
        <header className="md:hidden flex items-center gap-3 bg-slate-900 text-white px-4 py-3 shrink-0 sticky top-0 z-30">
          <button onClick={() => setSideOpen(true)} className="p-2 rounded-lg hover:bg-slate-800 active:bg-slate-700">
            <Menu size={24} />
          </button>
          <div className="flex-1">
            <p className="text-sm font-bold text-white">
              {nav.find(n => n.to === loc.pathname)?.label || 'ระบบบริหารงาน'}
            </p>
          </div>
          <p className="text-xs text-slate-400">วิสาหกิจชุมชน</p>
        </header>

        {/* Page content */}
        <main className="flex-1 overflow-y-auto pb-24 md:pb-0">
          {children}
        </main>

        {/* ── MOBILE BOTTOM NAV ─────────────────────────── */}
        <nav className="md:hidden fixed bottom-0 left-0 right-0 z-30 bg-white/95 backdrop-blur border-t border-gray-200 shadow-[0_-2px_12px_rgba(0,0,0,0.06)] safe-area-pb">
          <div className="flex px-1 py-1.5">
            {bottomItems.map(({ to, icon: Icon, short }) => {
              const active = loc.pathname === to;
              return (
                <Link key={to} to={to}
                  className="flex-1 flex flex-col items-center justify-center gap-1"
                >
                  <span className={`flex items-center justify-center w-full py-1 rounded-xl transition-colors ${active ? 'bg-blue-50' : ''}`}>
                    <Icon size={23} strokeWidth={active ? 2.5 : 1.8} className={active ? 'text-blue-600' : 'text-gray-500'} />
                  </span>
                  <span className={`text-[11px] leading-none ${active ? 'text-blue-600 font-semibold' : 'text-gray-500'}`}>{short}</span>
                </Link>
              );
            })}
            {/* More button */}
            <button
              onClick={() => setSideOpen(true)}
              className="flex-1 flex flex-col items-center justify-center gap-1"
            >
              <span className="flex items-center justify-center w-full py-1 rounded-xl">
                <Menu size={23} strokeWidth={1.8} className="text-gray-500" />
              </span>
              <span className="text-[11px] leading-none text-gray-500">เพิ่มเติม</span>
            </button>
          </div>
        </nav>
      </div>
    </div>
  );
}
