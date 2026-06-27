import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { reportApi, expenseApi } from '../api';
import {
  Factory, Wallet, Sparkles, Truck, ShieldCheck, Clock,
  AlertTriangle, Users, FileStack, Plus, Trash2, Receipt
} from 'lucide-react';

/* ── Monthly management expenses manager ── */
function ExpensesManager({ month }: { month: string }) {
  const qc = useQueryClient();
  const { data: list = [] } = useQuery({ queryKey: ['expenses', month], queryFn: () => expenseApi.list(month) });
  const [desc, setDesc] = useState('');
  const [amt, setAmt] = useState('');
  const refresh = () => { qc.invalidateQueries({ queryKey: ['expenses', month] }); qc.invalidateQueries({ queryKey: ['performance'] }); };
  const add = useMutation({ mutationFn: () => expenseApi.create({ month, description: desc, amount: amt }), onSuccess: () => { setDesc(''); setAmt(''); refresh(); } });
  const del = useMutation({ mutationFn: (id: number) => expenseApi.delete(id), onSuccess: refresh });
  const total = (list as any[]).reduce((s, e) => s + e.amount, 0);
  const fmt2 = (n: number) => Number(n || 0).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  return (
    <div className="rounded-2xl bg-white border border-slate-100 shadow-sm overflow-hidden">
      <div className="px-5 py-4 border-b border-slate-100 flex items-center gap-2">
        <span className="p-2 rounded-xl bg-orange-100 text-orange-600"><Receipt size={16} /></span>
        <h2 className="font-bold text-slate-800">ค่าใช้จ่ายบริหารจัดการ</h2>
        <span className="ml-auto text-xs text-slate-400">เพิ่มเองรายเดือน</span>
      </div>
      <div className="p-4 space-y-2">
        {(list as any[]).length === 0 && <p className="text-sm text-slate-400 text-center py-2">ยังไม่มีรายการ</p>}
        {(list as any[]).map((e: any) => (
          <div key={e.id} className="flex items-center gap-2 text-sm border-b border-slate-50 pb-2">
            <span className="flex-1 text-slate-700">{e.description || '(ไม่มีคำอธิบาย)'}</span>
            <span className="tabular-nums font-medium text-orange-700">฿{fmt2(e.amount)}</span>
            <button className="text-gray-300 hover:text-red-500" onClick={() => del.mutate(e.id)}><Trash2 size={14} /></button>
          </div>
        ))}
        {/* add form */}
        <div className="flex flex-wrap items-center gap-2 pt-1">
          <input className="input flex-1 !min-h-[40px] !py-2 min-w-[140px]" placeholder="รายการ เช่น ค่าน้ำมัน, ค่าไฟ" value={desc} onChange={e => setDesc(e.target.value)} />
          <input type="number" step="0.01" className="input w-32 !min-h-[40px] !py-2" placeholder="จำนวน" value={amt} onChange={e => setAmt(e.target.value)} />
          <button className="btn-primary btn-sm" disabled={!amt || add.isPending} onClick={() => add.mutate()}>
            <Plus size={15} /> เพิ่ม
          </button>
        </div>
        {total > 0 && (
          <div className="flex justify-between pt-2 border-t border-slate-100 text-sm font-semibold">
            <span className="text-slate-600">รวมค่าใช้จ่ายเดือนนี้</span>
            <span className="tabular-nums text-orange-700">฿{fmt2(total)}</span>
          </div>
        )}
      </div>
    </div>
  );
}

const thb = (n: number) => Number(n || 0).toLocaleString('th-TH', { maximumFractionDigits: 0 });
const thb2 = (n: number) => Number(n || 0).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const monthLabel = (m: string) => {
  const [y, mo] = m.split('-');
  const names = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
  return `${names[parseInt(mo) - 1]} ${(parseInt(y) + 543).toString().slice(-2)}`;
};

/* ── Hero financial card — soft pastel, period-aware ── */
function HeroCard({ icon: Icon, label, value, sub, theme }: any) {
  const t: any = {
    mint:   { bg: 'from-emerald-50 to-teal-50', ring: 'ring-emerald-100', chip: 'bg-emerald-100 text-emerald-600', num: 'text-emerald-700' },
    peach:  { bg: 'from-amber-50 to-orange-50', ring: 'ring-amber-100',   chip: 'bg-amber-100 text-amber-600',     num: 'text-amber-700' },
    violet: { bg: 'from-violet-50 to-indigo-50', ring: 'ring-violet-100', chip: 'bg-violet-100 text-violet-600',   num: 'text-violet-700' },
  }[theme as string];
  return (
    <div className={`rounded-2xl bg-gradient-to-br ${t.bg} ring-1 ${t.ring} p-5 transition-all hover:shadow-md hover:-translate-y-0.5`}>
      <div className="flex items-center justify-between mb-3">
        <span className="text-sm font-medium text-slate-600">{label}</span>
        <span className={`p-2 rounded-xl ${t.chip}`}><Icon size={18} /></span>
      </div>
      <p className={`text-3xl md:text-[34px] font-bold tabular-nums leading-none ${t.num}`}>฿{value}</p>
      {sub && <p className="text-xs text-slate-500 mt-2.5 tabular-nums">{sub}</p>}
    </div>
  );
}

/* ── Mini stat — pastel icon chip ── */
function MiniStat({ icon: Icon, label, value, unit, chip, alert }: any) {
  return (
    <div className={`rounded-2xl bg-white border p-4 flex items-center gap-3 transition-all hover:shadow-sm ${alert ? 'border-rose-200 bg-rose-50/40' : 'border-slate-100'}`}>
      <span className={`p-2.5 rounded-xl shrink-0 ${chip}`}><Icon size={19} /></span>
      <div className="min-w-0">
        <p className="text-xs text-slate-400 leading-tight">{label}</p>
        <p className={`text-xl font-bold tabular-nums ${alert ? 'text-rose-600' : 'text-slate-800'}`}>
          {value}{unit && <span className="text-xs font-normal text-slate-400 ml-1">{unit}</span>}
        </p>
      </div>
    </div>
  );
}

/* ── Interactive revenue/wage chart ── */
function TrendChart({ trend, selected, onSelect }: { trend: any[]; selected?: string; onSelect?: (m: string) => void }) {
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(...trend.map(t => Math.max(t.revenue, t.wage)), 1);
  const active = hover != null ? trend[hover] : trend[trend.length - 1];

  return (
    <div className="rounded-2xl bg-white border border-slate-100 p-5 shadow-sm">
      <div className="flex items-start justify-between mb-4">
        <div>
          <h2 className="font-bold text-slate-800">แนวโน้มรายรับ vs ค่าแรง</h2>
          <p className="text-xs text-slate-400">6 เดือนล่าสุด · คลิกแท่งเพื่อดูข้อมูลเดือนนั้นทั้งหน้า</p>
        </div>
        {active && (
          <div className="text-right">
            <p className="text-xs text-slate-400">{monthLabel(active.month)}</p>
            <p className="text-sm font-bold text-emerald-600 tabular-nums">รายรับ ฿{thb2(active.revenue)}</p>
            <p className="text-xs text-amber-600 tabular-nums">ค่าแรง ฿{thb2(active.wage)} · กำไร ฿{thb2(active.profit)}</p>
          </div>
        )}
      </div>
      <div className="flex items-end justify-between gap-2 md:gap-5 h-44 pt-2">
        {trend.map((t, i) => {
          const on = hover === i;
          const isSel = selected === t.month;
          return (
            <div key={t.month} className="flex-1 flex flex-col items-center justify-end h-full cursor-pointer"
                 onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}
                 onClick={() => onSelect?.(t.month)}>
              <div className={`w-full flex items-end justify-center gap-1 flex-1 rounded-t-lg ${isSel ? 'bg-slate-100' : ''}`}>
                <div className={`w-1/2 max-w-[20px] rounded-t-lg transition-all ${on || isSel ? 'bg-emerald-500' : 'bg-emerald-300'}`}
                     style={{ height: `${Math.max((t.revenue / max) * 100, 2)}%` }} />
                <div className={`w-1/2 max-w-[20px] rounded-t-lg transition-all ${on || isSel ? 'bg-amber-400' : 'bg-amber-200'}`}
                     style={{ height: `${Math.max((t.wage / max) * 100, 2)}%` }} />
              </div>
              <span className={`text-[11px] mt-1.5 whitespace-nowrap transition-colors ${on || isSel ? 'text-slate-700 font-semibold' : 'text-slate-400'}`}>
                {monthLabel(t.month)}
              </span>
            </div>
          );
        })}
      </div>
      <div className="flex items-center gap-4 text-xs text-slate-500 mt-3 pt-3 border-t border-slate-100">
        <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-emerald-400" /> รายรับ (Amphenol)</span>
        <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-amber-300" /> ค่าแรงสมาชิก</span>
      </div>
    </div>
  );
}

export default function Dashboard() {
  const [period, setPeriod] = useState<'month' | 'all'>('month');
  const [selectedMonth, setSelectedMonth] = useState<string | undefined>(undefined); // undefined = เดือนปัจจุบัน
  const { data, isLoading } = useQuery({
    queryKey: ['performance', selectedMonth || 'current'],
    queryFn: () => reportApi.performance(selectedMonth),
  });

  if (isLoading || !data) return <div className="p-8 text-slate-400 text-sm">กำลังโหลด…</div>;

  const isM = period === 'month';
  const revenue = isM ? data.revenue_month : data.revenue_all;
  const wage    = isM ? data.wage_month : data.wage_all;
  const profit  = isM ? data.profit_month : data.profit_all;
  const finalNet = isM ? data.final_net_month : data.final_net_all;
  const margin  = revenue > 0 ? (finalNet / revenue) * 100 : 0;
  const taxPct  = data.withholding_tax_pct ?? 3;
  const products = (data.products as any[]).filter(p => p.revenue_all > 0 || p.revenue_month > 0);

  const onSelectMonth = (m: string) => { setSelectedMonth(m); setPeriod('month'); };

  return (
    <div className="p-4 md:p-6 max-w-6xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-end justify-between flex-wrap gap-3">
        <div>
          <p className="text-xs tracking-wide uppercase text-slate-400">วิสาหกิจชุมชนตัดสายไฟ</p>
          <h1 className="text-2xl md:text-3xl font-bold text-slate-800 mt-0.5">ภาพรวมผลประกอบการ</h1>
        </div>
        {/* Period toggle */}
        <div className="inline-flex rounded-xl bg-slate-100 p-1 text-sm">
          {([['month', `เดือน ${monthLabel(data.month)}`], ['all', 'สะสมทั้งหมด']] as const).map(([k, lbl]: any) => (
            <button key={k} onClick={() => setPeriod(k)}
              className={`px-4 py-1.5 rounded-lg font-medium transition-all ${period === k ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>
              {lbl}
            </button>
          ))}
        </div>
      </div>

      {/* Hero financial cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <HeroCard theme="mint"   icon={Factory} label="รายรับจาก Amphenol" value={thb2(revenue)}
          sub={isM ? `สะสม ฿${thb2(data.revenue_all)}` : `เดือนนี้ ฿${thb2(data.revenue_month)}`} />
        <HeroCard theme="peach"  icon={Wallet} label="ค่าแรงจ่ายสมาชิก" value={thb2(wage)}
          sub={isM ? `สะสม ฿${thb2(data.wage_all)}` : `เดือนนี้ ฿${thb2(data.wage_month)}`} />
        <HeroCard theme="violet" icon={Sparkles} label="กำไรสุทธิ" value={thb2(finalNet)}
          sub={`หลังหักทุกรายการ · อัตรากำไร ${margin.toFixed(0)}%`} />
      </div>
      {/* กำไรสุทธิสุดท้าย — หักครบทุกอย่าง */}
      <div className="rounded-2xl bg-slate-50 border border-slate-200 p-4 -mt-2">
        <p className="text-[11px] font-semibold tracking-wide uppercase text-slate-400 mb-2">สรุปกำไรสุทธิ ({isM ? `เดือน ${monthLabel(data.month)}` : 'สะสม'})</p>
        <div className="space-y-1 text-sm tabular-nums max-w-md">
          {[
            ['รายรับจาก Amphenol', revenue, 'text-emerald-700'],
            [`หัก ภาษี ณ ที่จ่าย ${taxPct}%`, -(isM ? data.tax_month : data.tax_all), 'text-rose-600'],
            ['หัก ค่าแรงสมาชิก', -wage, 'text-rose-600'],
            ['หัก ค่าตอบแทนผู้บริหาร', -(isM ? data.manager_comp_month : data.manager_comp_all), 'text-rose-600'],
            ['หัก ค่าใช้จ่ายบริหารจัดการ', -(isM ? data.expenses_month : data.expenses_all), 'text-rose-600'],
          ].map(([label, val, cls]: any) => (
            <div key={label} className="flex justify-between">
              <span className="text-slate-600">{label}</span>
              <span className={cls}>{val < 0 ? '−' : ''}฿{thb2(Math.abs(val))}</span>
            </div>
          ))}
          <div className="flex justify-between pt-2 mt-1 border-t border-slate-300 font-bold text-base">
            <span className="text-slate-800">กำไรสุทธิสุดท้าย</span>
            <span className="text-violet-700">฿{thb2(isM ? data.final_net_month : data.final_net_all)}</span>
          </div>
        </div>
      </div>

      {/* Operational mini stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <MiniStat icon={Truck} label={`ส่งออกโรงงาน (${monthLabel(data.month)})`} value={thb(data.shipped_units_month)} unit="หน่วย" chip="bg-sky-100 text-sky-600" />
        <MiniStat icon={ShieldCheck} label="คุณภาพงานดี" value={`${data.quality_month_pct.toFixed(0)}%`} chip="bg-emerald-100 text-emerald-600" />
        <MiniStat icon={Clock} label="คงค้างกับสมาชิก" value={thb(data.with_members_units)} unit="หน่วย" chip="bg-amber-100 text-amber-600" />
        <MiniStat icon={AlertTriangle} label="เกินกำหนดคืน" value={data.overdue_count} unit="ใบ" chip="bg-rose-100 text-rose-600" alert={data.overdue_count > 0} />
      </div>

      {/* Forecast from incoming work */}
      <div className="rounded-2xl bg-sky-50 border border-sky-200 p-4">
        <p className="text-[11px] font-semibold tracking-wide uppercase text-sky-500 mb-3">
          ประมาณการจากงานที่รับเข้า ({isM ? `เดือน ${monthLabel(data.month)}` : 'สะสม'}) · แม้ยังไม่แจกจ่ายสมาชิก
        </p>
        <div className="grid grid-cols-3 gap-3 text-center">
          <div className="rounded-xl bg-white p-3 border border-sky-100">
            <p className="text-xl md:text-2xl font-bold tabular-nums text-emerald-700 leading-none">฿{thb2(isM ? data.forecast_revenue_month : data.forecast_revenue_all)}</p>
            <p className="text-xs text-slate-500 mt-1.5">ประมาณการรายรับ</p>
          </div>
          <div className="rounded-xl bg-white p-3 border border-sky-100">
            <p className="text-xl md:text-2xl font-bold tabular-nums text-amber-700 leading-none">฿{thb2(isM ? data.forecast_wage_month : data.forecast_wage_all)}</p>
            <p className="text-xs text-slate-500 mt-1.5">ประมาณการค่าแรงตัด</p>
          </div>
          <div className="rounded-xl bg-white p-3 border border-sky-100">
            <p className="text-xl md:text-2xl font-bold tabular-nums text-violet-700 leading-none">฿{thb2(isM ? data.forecast_gross_month : data.forecast_gross_all)}</p>
            <p className="text-xs text-slate-500 mt-1.5">ประมาณการกำไรขั้นต้น</p>
          </div>
        </div>
      </div>

      {/* Trend */}
      <TrendChart trend={data.trend} selected={isM ? data.month : undefined} onSelect={onSelectMonth} />

      {/* Management expenses for the selected month */}
      {isM && <ExpensesManager month={data.month} />}

      {/* Revenue by product */}
      <div className="rounded-2xl bg-white border border-slate-100 shadow-sm overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-100 flex items-center gap-2">
          <span className="p-2 rounded-xl bg-emerald-100 text-emerald-600"><Factory size={16} /></span>
          <h2 className="font-bold text-slate-800">รายรับ-กำไร แยกตามรุ่นสายไฟ</h2>
          <span className="ml-auto text-xs text-slate-400">{isM ? `เดือน ${monthLabel(data.month)}` : 'สะสมทั้งหมด'}</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[640px]">
            <thead>
              <tr className="text-xs text-slate-400 border-b border-slate-100">
                <th className="px-5 py-3 text-left font-medium">รุ่นสายไฟ</th>
                <th className="px-4 py-3 text-right font-medium">ส่งออกแล้ว</th>
                <th className="px-4 py-3 text-right font-medium">ราคาโรงงาน</th>
                <th className="px-4 py-3 text-right font-medium">รายรับ</th>
                <th className="px-4 py-3 text-right font-medium">ค่าแรง</th>
                <th className="px-5 py-3 text-right font-medium">กำไร</th>
              </tr>
            </thead>
            <tbody className="tabular-nums">
              {products.length === 0 && (
                <tr><td colSpan={6} className="py-10 text-center text-slate-400">ยังไม่มีรายรับ — เริ่มเมื่อมีการส่งงานออกโรงงาน</td></tr>
              )}
              {products.map((p: any) => (
                <tr key={p.id} className="border-b border-slate-50 last:border-0 hover:bg-slate-50/70 transition-colors">
                  <td className="px-5 py-3 text-slate-800">
                    <span className="font-mono text-xs text-slate-400 mr-2">{p.code}</span>{p.name}
                  </td>
                  <td className="px-4 py-3 text-right text-slate-500">{thb(isM ? p.shipped_good_month : p.shipped_good_all)} {p.unit}</td>
                  <td className="px-4 py-3 text-right text-slate-500">{Number(p.factory_price || 0).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 4 })}</td>
                  <td className="px-4 py-3 text-right font-medium text-emerald-700">฿{thb2(isM ? p.revenue_month : p.revenue_all)}</td>
                  <td className="px-4 py-3 text-right text-amber-700">฿{thb2(isM ? p.wage_month : p.wage_all)}</td>
                  <td className="px-5 py-3 text-right font-bold text-violet-700">฿{thb2(isM ? p.profit_month : p.profit_all)}</td>
                </tr>
              ))}
              {products.length > 0 && (
                <tr className="bg-slate-50 font-semibold text-slate-800">
                  <td className="px-5 py-3">รวม</td>
                  <td></td><td></td>
                  <td className="px-4 py-3 text-right text-emerald-700">฿{thb2(revenue)}</td>
                  <td className="px-4 py-3 text-right text-amber-700">฿{thb2(wage)}</td>
                  <td className="px-5 py-3 text-right text-violet-700">฿{thb2(profit)}</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* People */}
      <div className="grid grid-cols-2 gap-3">
        <MiniStat icon={Users} label="สมาชิกที่มีงานอยู่" value={data.members_with_work} unit={`/ ${data.active_members} คน`} chip="bg-violet-100 text-violet-600" />
        <MiniStat icon={FileStack} label="ใบเบิกค้างทั้งหมด" value={data.pending_issues_count} unit="ใบ" chip="bg-slate-100 text-slate-500" />
      </div>
    </div>
  );
}
