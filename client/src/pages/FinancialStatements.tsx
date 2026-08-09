import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { reportApi } from '../api';
import {
  Factory, Scissors, TrendingUp, TrendingDown, ArrowLeftRight, Boxes, Clock,
  Info, FileDown, FileText, Loader2, Scale, PiggyBank, ArrowDownCircle, ArrowUpCircle,
} from 'lucide-react';
import { downloadBlob } from '../utils/downloadBlob';

const thb2 = (n: number) => Number(n || 0).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const monthLabel = (m: string) => {
  const [y, mo] = m.split('-');
  const names = ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน', 'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'];
  return `${names[parseInt(mo) - 1]} ${(parseInt(y) + 543)}`;
};

function StatCard({ icon: Icon, label, value, sub, theme }: any) {
  const t: any = {
    mint: { bg: 'from-emerald-50 to-teal-50', ring: 'ring-emerald-100', chip: 'bg-emerald-100 text-emerald-600', num: 'text-emerald-700' },
    peach: { bg: 'from-amber-50 to-orange-50', ring: 'ring-amber-100', chip: 'bg-amber-100 text-amber-600', num: 'text-amber-700' },
    sky: { bg: 'from-sky-50 to-blue-50', ring: 'ring-sky-100', chip: 'bg-sky-100 text-sky-600', num: 'text-sky-700' },
    pos: { bg: 'from-emerald-50 to-green-50', ring: 'ring-emerald-100', chip: 'bg-emerald-100 text-emerald-600', num: 'text-emerald-700' },
    neg: { bg: 'from-rose-50 to-red-50', ring: 'ring-rose-100', chip: 'bg-rose-100 text-rose-600', num: 'text-rose-700' },
  }[theme as string];
  return (
    <div className={`rounded-2xl bg-gradient-to-br ${t.bg} ring-1 ${t.ring} p-5 transition-all hover:shadow-md hover:-translate-y-0.5`}>
      <div className="flex items-center justify-between mb-3">
        <span className="text-sm font-medium text-slate-600">{label}</span>
        <span className={`p-2 rounded-xl ${t.chip}`}><Icon size={18} /></span>
      </div>
      <p className={`text-2xl md:text-[28px] font-bold tabular-nums leading-none ${t.num}`}>
        {value < 0 ? '−' : ''}฿{thb2(Math.abs(value))}
      </p>
      {sub && <p className="text-xs text-slate-500 mt-2.5 tabular-nums">{sub}</p>}
    </div>
  );
}

function LedgerRow({ label, value, cls, bold, indent }: any) {
  return (
    <div className={`flex justify-between ${bold ? 'font-semibold' : ''} ${indent ? 'pl-3' : ''}`}>
      <span className={indent ? 'text-slate-500 text-xs' : 'text-slate-600'}>{label}</span>
      <span className={`${cls} ${indent ? 'text-xs' : ''}`}>{value < 0 ? '−' : ''}฿{thb2(Math.abs(value))}</span>
    </div>
  );
}

export default function FinancialStatements() {
  const now = new Date();
  const defaultMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const [month, setMonth] = useState(defaultMonth);
  const [busy, setBusy] = useState<'' | 'xlsx' | 'pdf'>('');

  const { data, isLoading } = useQuery({
    queryKey: ['financial-statement', month],
    queryFn: () => reportApi.financialStatement(month),
  });

  const doExport = async (format?: 'pdf') => {
    setBusy(format === 'pdf' ? 'pdf' : 'xlsx');
    try {
      const blob = await reportApi.financialStatementExport(month, format);
      downloadBlob(blob, `งบการเงิน-${monthLabel(month)}.${format === 'pdf' ? 'pdf' : 'xlsx'}`);
    } catch {
      alert('สร้างรายงานไม่สำเร็จ');
    } finally {
      setBusy('');
    }
  };

  return (
    <div className="p-4 md:p-6 max-w-5xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-end justify-between flex-wrap gap-3">
        <div>
          <p className="text-xs tracking-wide uppercase text-slate-400 flex items-center gap-1.5">
            <Scale size={13} /> วิสาหกิจชุมชนตัดสายไฟ
          </p>
          <h1 className="text-2xl md:text-3xl font-bold text-slate-800 mt-0.5">งบการเงิน</h1>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <input type="month" className="input" value={month} onChange={e => setMonth(e.target.value)} />
          <button className="btn-secondary btn-sm flex items-center gap-1.5" disabled={busy === 'xlsx' || !data}
            onClick={() => doExport()}>
            {busy === 'xlsx' ? <Loader2 size={14} className="animate-spin" /> : <FileDown size={14} />} Excel
          </button>
          <button className="btn-primary btn-sm flex items-center gap-1.5" disabled={busy === 'pdf' || !data}
            onClick={() => doExport('pdf')}>
            {busy === 'pdf' ? <Loader2 size={14} className="animate-spin" /> : <FileText size={14} />} PDF
          </button>
        </div>
      </div>

      {/* Explainer banner */}
      <div className="rounded-2xl bg-indigo-50 border border-indigo-200 p-4 flex items-start gap-3">
        <span className="p-2 rounded-xl bg-indigo-100 text-indigo-600 shrink-0"><Info size={16} /></span>
        <div className="text-sm text-indigo-900">
          <p className="font-semibold">หลักการจับคู่ต้นทุน-รายรับ (Matching Principle)</p>
          <p className="text-indigo-700 mt-0.5">
            รายงานนี้คิดค่าแรงเฉพาะของงานที่ <b>ส่งออก/วางบิลจริงในเดือนนี้</b> เท่านั้น (ไม่ใช่ค่าแรงที่จ่ายตามรอบตัด ซึ่งอาจรวมงานของเดือนอื่นปนอยู่)
            เพื่อให้เห็นชัดว่าเดือนไหนกำไรจริงเท่าไร — แยกต่างหากจากหน้า "ภาพรวม" ที่ใช้ค่าแรงตามรอบจ่ายเหมือนเดิม
          </p>
        </div>
      </div>

      {isLoading || !data ? (
        <div className="p-8 text-slate-400 text-sm">กำลังโหลด…</div>
      ) : (
        <>
          {/* Hero stats */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <StatCard theme="mint" icon={Factory} label="รายรับ" value={data.revenue} sub={`เดือน ${monthLabel(data.month)}`} />
            <StatCard theme="peach" icon={Scissors} label="ต้นทุนขาย (COGS)" value={data.cogs} sub="ค่าแรงของที่ส่งออกจริง" />
            <StatCard theme="sky" icon={TrendingUp} label="กำไรขั้นต้น" value={data.gross} sub={data.revenue ? `${((data.gross / data.revenue) * 100).toFixed(1)}%` : undefined} />
            <StatCard theme={data.net_matched >= 0 ? 'pos' : 'neg'} icon={data.net_matched >= 0 ? TrendingUp : TrendingDown}
              label="กำไรสุทธิ (จับคู่แล้ว)" value={data.net_matched}
              sub={data.revenue ? `${((data.net_matched / data.revenue) * 100).toFixed(1)}%` : undefined} />
          </div>

          {/* Detailed ledger */}
          <div className="rounded-2xl bg-slate-50 border border-slate-200 p-4">
            <p className="text-[11px] font-semibold tracking-wide uppercase text-slate-400 mb-2">
              รายละเอียดงบกำไรขาดทุน (เดือน {monthLabel(data.month)})
            </p>
            <div className="space-y-1 text-sm tabular-nums max-w-lg">
              <LedgerRow label="รายรับจาก Amphenol (ส่งออกเดือนนี้)" value={data.revenue} cls="text-emerald-700" />
              <LedgerRow label="หัก ต้นทุนขาย — ค่าแรง (COGS)" value={-data.cogs} cls="text-rose-600" />
              <div className="flex justify-between pt-1.5 mt-1 border-t border-dashed border-slate-300 font-semibold">
                <span className="text-slate-700">กำไรขั้นต้น (Gross Profit)</span>
                <span className="text-sky-700">฿{thb2(data.gross)}</span>
              </div>
              <LedgerRow label={`หัก ภาษี ณ ที่จ่าย ${data.tax_pct}%`} value={-data.tax} cls="text-rose-600" />
              <LedgerRow label="หัก ค่าตอบแทนผู้บริหาร" value={-data.manager_comp} cls="text-rose-600" />
              {(data.manager_lines as any[]).filter(m => m.computed).map((m: any) => (
                <LedgerRow key={m.name} label={`↳ ${m.name}${m.role ? ` (${m.role})` : ''}`} value={m.computed} cls="text-slate-400" indent />
              ))}
              {(data.comp_exp_lines as any[]).map((e: any, i: number) => (
                <LedgerRow key={i} label={`↳ ${e.description || 'จ่ายพิเศษ'} → ${e.paid_to_name || ''}`} value={e.amount} cls="text-slate-400" indent />
              ))}
              <LedgerRow label="หัก ค่าใช้จ่ายบริหารจัดการ" value={-data.general_exp_total} cls="text-rose-600" />
              {(data.general_exp_lines as any[]).map((e: any, i: number) => (
                <LedgerRow key={i} label={`↳ ${e.description || ''}`} value={e.amount} cls="text-slate-400" indent />
              ))}
              <div className="flex justify-between pt-2 mt-1 border-t border-slate-300 font-bold text-base">
                <span className="text-slate-800">กำไรสุทธิ (แบบจับคู่ต้นทุน-รายรับ)</span>
                <span className={data.net_matched >= 0 ? 'text-emerald-700' : 'text-rose-600'}>
                  {data.net_matched < 0 ? '−' : ''}฿{thb2(Math.abs(data.net_matched))}
                </span>
              </div>
            </div>
          </div>

          {/* Comparison with old cash-basis method */}
          <div className="rounded-2xl bg-white border border-slate-100 shadow-sm overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-100 flex items-center gap-2">
              <span className="p-2 rounded-xl bg-amber-100 text-amber-600"><ArrowLeftRight size={16} /></span>
              <h2 className="font-bold text-slate-800">เทียบกับวิธีคิดแบบเดิม (ตามรอบจ่ายค่าแรง)</h2>
            </div>
            <div className="p-5 grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
              <div className="rounded-xl bg-slate-50 p-3">
                <p className="text-xs text-slate-400 mb-1">ค่าแรงตามรอบจ่าย (จ่ายจริงเดือนนี้)</p>
                <p className="text-lg font-bold tabular-nums text-slate-700">฿{thb2(data.cash_basis_wage)}</p>
              </div>
              <div className="rounded-xl bg-slate-50 p-3">
                <p className="text-xs text-slate-400 mb-1">กำไรสุทธิแบบเดิม (ตามรอบจ่าย)</p>
                <p className={`text-lg font-bold tabular-nums ${data.net_cash_basis >= 0 ? 'text-emerald-700' : 'text-rose-600'}`}>฿{thb2(data.net_cash_basis)}</p>
              </div>
              <div className="rounded-xl bg-amber-50 p-3 border border-amber-100">
                <p className="text-xs text-amber-500 mb-1">ส่วนต่าง (แบบเดิม − แบบจับคู่)</p>
                <p className="text-lg font-bold tabular-nums text-amber-700">฿{thb2(data.variance)}</p>
              </div>
            </div>
            <div className="px-5 pb-5 -mt-1">
              <p className="text-xs text-slate-500 leading-relaxed">
                ส่วนต่างเกิดจากค่าแรงตามรอบจ่ายรวมงานของเดือนอื่นปนอยู่ (ตัดเสร็จเดือนนี้แต่ยังไม่ส่งออก หรือส่งออกเดือนนี้แต่ตัดเสร็จเดือนก่อน)
                ทำให้ไม่ตรงกับรายรับที่รับรู้เดือนนี้ — ตัวเลข "กำไรสุทธิ (แบบจับคู่ต้นทุน-รายรับ)" ด้านบนคือกำไรที่แท้จริงของเดือนนี้
              </p>
            </div>
          </div>

          {/* Fund advance / loan mechanic */}
          <div className="rounded-2xl bg-white border border-slate-100 shadow-sm overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-100 flex items-center gap-2">
              <span className="p-2 rounded-xl bg-teal-100 text-teal-600"><PiggyBank size={16} /></span>
              <h2 className="font-bold text-slate-800">เงินทดรองจ่ายจากกองทุนวิสาหกิจ</h2>
            </div>
            <div className="px-5 pt-4 text-xs text-slate-500 leading-relaxed">
              เดือนไหนจ่ายค่าแรง (ตามรอบตัด) มากกว่าต้นทุนขายที่จับคู่ได้ (ตามรอบส่งออก) — คือตัดงานเก็บสต๊อกไว้มากกว่าที่ส่งออกเดือนนั้น —
              กลุ่มต้องขอยืมเงินกองทุนวิสาหกิจมาจ่ายให้สมาชิกไปก่อน แล้วเดือนที่ส่งของออกมากกว่าที่ตัดใหม่ (เบิกสต๊อกเก่ามาส่ง) จะมีกำไรส่วนเกินนำไปคืนกองทุนได้
            </div>
            <div className="p-5 grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
              {data.advance_needed > 0.005 ? (
                <div className="rounded-xl bg-rose-50 p-3 border border-rose-100">
                  <p className="text-xs text-rose-500 mb-1 flex items-center gap-1"><ArrowUpCircle size={12} /> ต้องยืมกองทุนเพิ่มเดือนนี้</p>
                  <p className="text-lg font-bold tabular-nums text-rose-700">฿{thb2(data.advance_needed)}</p>
                </div>
              ) : data.advance_needed < -0.005 ? (
                <div className="rounded-xl bg-emerald-50 p-3 border border-emerald-100">
                  <p className="text-xs text-emerald-600 mb-1 flex items-center gap-1"><ArrowDownCircle size={12} /> มีกำไรส่วนเกิน คืนกองทุนได้เดือนนี้</p>
                  <p className="text-lg font-bold tabular-nums text-emerald-700">฿{thb2(-data.advance_needed)}</p>
                </div>
              ) : (
                <div className="rounded-xl bg-slate-50 p-3">
                  <p className="text-xs text-slate-400 mb-1">ส่วนต่างเดือนนี้</p>
                  <p className="text-lg font-bold tabular-nums text-slate-600">พอดี ไม่ต้องยืม/คืน</p>
                </div>
              )}
              <div className="rounded-xl bg-slate-50 p-3">
                <p className="text-xs text-slate-400 mb-1">ยอดหนี้กองทุน ยกมา</p>
                <p className="text-lg font-bold tabular-nums text-slate-600">฿{thb2(data.fund_loan_open)}</p>
              </div>
              <div className="rounded-xl bg-teal-50 p-3 border border-teal-100">
                <p className="text-xs text-teal-600 mb-1 flex items-center gap-1"><PiggyBank size={12} /> ยอดหนี้กองทุน ยกไป</p>
                <p className="text-lg font-bold tabular-nums text-teal-700">฿{thb2(data.fund_loan_close)}</p>
                <p className="text-[11px] text-teal-400 mt-0.5">ยอดที่ยังติดค้างกองทุนอยู่สิ้นเดือนนี้</p>
              </div>
            </div>
            <div className="px-5 pb-5 -mt-1 space-y-1">
              <p className="text-xs text-slate-500 leading-relaxed">
                ยอดนี้ควรใกล้เคียงกับ "สินค้าคงเหลือ ยกไป" ในตารางด้านล่าง เพราะเป็นเงินที่จ่ายล่วงหน้าไปสำหรับงานที่ตัดเสร็จแต่ยังไม่ได้ส่งออก
              </p>
              <p className="text-xs text-amber-600 leading-relaxed">
                หมายเหตุ: เป็นยอดประมาณการสะสมจากข้อมูลในระบบตั้งแต่เดือน {data.fund_loan_earliest_month ? monthLabel(data.fund_loan_earliest_month) : '-'}
                {' '}ถ้ายอดยืม/คืนจริงในอดีตไม่ตรงตามสูตรนี้เป๊ะ หรือมีการยืมค้างไว้ก่อนเริ่มใช้ระบบ ควรตรวจสอบยอดกับบัญชีจริงของกลุ่มอีกครั้ง
              </p>
            </div>
          </div>

          {/* Balance snapshot */}
          <div className="rounded-2xl bg-white border border-slate-100 shadow-sm overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-100 flex items-center gap-2">
              <span className="p-2 rounded-xl bg-violet-100 text-violet-600"><Boxes size={16} /></span>
              <h2 className="font-bold text-slate-800">สินทรัพย์-หนี้สินที่เกี่ยวข้อง ณ สิ้นเดือน</h2>
              <span className="ml-auto text-xs text-slate-400">เฉพาะงานตัดสายไฟ — ไม่ใช่งบดุลฉบับเต็ม</span>
            </div>
            <div className="p-5 grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
              <div className="rounded-xl bg-slate-50 p-3">
                <p className="text-xs text-slate-400 mb-1">สินค้าคงเหลือ ยกมา</p>
                <p className={`text-lg font-bold tabular-nums ${data.inventory_open < 0 ? 'text-rose-600' : 'text-slate-600'}`}>
                  {data.inventory_open < 0 ? '−' : ''}฿{thb2(Math.abs(data.inventory_open))}
                </p>
              </div>
              <div className="rounded-xl bg-violet-50 p-3 border border-violet-100">
                <p className="text-xs text-violet-500 mb-1 flex items-center gap-1"><Boxes size={12} /> สินค้าคงเหลือ ยกไป</p>
                <p className={`text-lg font-bold tabular-nums ${data.inventory_close < 0 ? 'text-rose-600' : 'text-violet-700'}`}>
                  {data.inventory_close < 0 ? '−' : ''}฿{thb2(Math.abs(data.inventory_close))}
                </p>
              </div>
              <div className="rounded-xl bg-rose-50 p-3 border border-rose-100">
                <p className="text-xs text-rose-500 mb-1 flex items-center gap-1"><Clock size={12} /> ค่าแรงค้างจ่าย</p>
                <p className="text-lg font-bold tabular-nums text-rose-700">฿{thb2(data.accrued_wages_payable)}</p>
                <p className="text-[11px] text-rose-400 mt-0.5">จ่ายจริงวันที่ 25 เดือนถัดไป</p>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
