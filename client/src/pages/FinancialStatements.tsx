import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { reportApi } from '../api';
import {
  Factory, Scissors, TrendingUp, TrendingDown, ArrowLeftRight, Boxes, Clock,
  Info, FileDown, FileText, Loader2, Scale, PiggyBank, ArrowDownCircle, ArrowUpCircle, Layers, Wallet,
} from 'lucide-react';
import { downloadBlob, openDownloadTab } from '../utils/downloadBlob';

const thb2 = (n: number) => Number(n || 0).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const monthLabel = (m: string) => {
  const [y, mo] = m.split('-');
  const names = ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน', 'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'];
  return `${names[parseInt(mo) - 1]} ${(parseInt(y) + 543)}`;
};

const TH_SHORT = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
const thDate = (d: string) => { const [y, m, dd] = String(d || '').split('-').map(Number); return y ? `${dd} ${TH_SHORT[m - 1]} ${String(y + 543).slice(-2)}` : '-'; };
const cycleLabel = (m: string) => { const [y, mo] = m.split('-').map(Number); return `${TH_SHORT[mo - 1]} ${String(y + 543).slice(-2)}`; };
const signed = (n: number) => `${n < 0 ? '−' : ''}฿${thb2(Math.abs(n))}`;
const qty = (n: number) => Number(n || 0).toLocaleString('th-TH', { maximumFractionDigits: 2 });

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
    const tab = openDownloadTab();
    setBusy(format === 'pdf' ? 'pdf' : 'xlsx');
    try {
      const blob = await reportApi.financialStatementExport(month, format);
      downloadBlob(blob, `งบการเงิน-${monthLabel(month)}.${format === 'pdf' ? 'pdf' : 'xlsx'}`, tab);
    } catch {
      tab?.close();
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
          <p className="font-semibold">ค่าแรงในงบ = ค่าแรงที่จ่ายจริงของรอบจ่ายเดือนนี้ แบ่งเป็น 2 ชั้น</p>
          <p className="text-indigo-700 mt-0.5">
            <b>① ค่าแรงตามปริมาณงานที่ส่งออกโรงงาน</b> (จับคู่กับรายรับเดือนนี้) และ <b>② ส่วนเกินที่สำรองจ่ายสมาชิก</b>
            สำหรับงานที่ตัดเสร็จ/คืนแล้วแต่ยังไม่ได้ส่งออก — ค่าแรงที่ยังค้างจ่ายสมาชิก ณ สิ้นเดือน ดูในหมายเหตุท้ายหน้า
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
            <StatCard theme="peach" icon={Scissors} label="ค่าแรงที่จ่ายจริง" value={data.wage_paid}
              sub={data.wage_breakdown ? `ก่อนหักค่าปรับ ${signed(data.wage_breakdown.gross)} · ค่าปรับ ${signed(data.wage_breakdown.penalty)}` : `ตามงานส่งออก ${signed(data.wage_matched)} · สำรองจ่าย ${signed(data.wage_excess)}`} />
            <StatCard theme="sky" icon={TrendingUp} label="กำไรขั้นต้น" value={data.gross_paid} sub={data.revenue ? `${((data.gross_paid / data.revenue) * 100).toFixed(1)}%` : undefined} />
            <StatCard theme={data.net_paid >= 0 ? 'pos' : 'neg'} icon={data.net_paid >= 0 ? TrendingUp : TrendingDown}
              label="กำไรสุทธิ" value={data.net_paid}
              sub={data.revenue ? `${((data.net_paid / data.revenue) * 100).toFixed(1)}%` : undefined} />
          </div>

          {/* Detailed ledger */}
          <div className="rounded-2xl bg-slate-50 border border-slate-200 p-4">
            <p className="text-[11px] font-semibold tracking-wide uppercase text-slate-400 mb-2">
              รายละเอียดงบกำไรขาดทุน (เดือน {monthLabel(data.month)})
            </p>
            <div className="space-y-1 text-sm tabular-nums max-w-lg">
              <LedgerRow label="รายรับจาก Amphenol (ส่งออกเดือนนี้)" value={data.revenue} cls="text-emerald-700" />
              <LedgerRow label={`หัก ค่าแรงสมาชิกที่จ่ายจริง (รอบ ${cycleLabel(data.month)} · จ่าย ${thDate(data.wages_owed.cycle_pay_date)})`} value={-data.wage_paid} cls="text-rose-600" />
              {data.wage_breakdown && (
                <div className="ml-3 my-1 rounded-lg border border-slate-200 bg-white px-3 py-2 space-y-0.5">
                  <p className="text-[10px] font-semibold tracking-wide text-slate-400 mb-0.5">คำนวณค่าแรงสุทธิ</p>
                  <LedgerRow label="ค่าแรงตัด (ก่อนหักค่าปรับ)" value={data.wage_breakdown.gross} cls="text-slate-700" />
                  <LedgerRow label="หัก ค่าปรับ NG" value={-data.wage_breakdown.penalty} cls="text-rose-600" />
                  <div className="flex justify-between border-t border-slate-200 pt-1 font-semibold">
                    <span className="text-slate-700">ค่าแรงสุทธิที่จ่ายสมาชิก</span>
                    <span className="text-rose-600">฿{thb2(data.wage_breakdown.net)}</span>
                  </div>
                </div>
              )}
              <p className="ml-3 text-[10px] font-semibold tracking-wide text-slate-400 pt-1">แยกตามที่มาของค่าแรง</p>
              <WageLayerBar matched={data.wage_matched} excess={data.wage_excess} />
              <LedgerRow label="① ค่าแรงตามปริมาณงานที่ส่งออกโรงงาน" value={data.wage_matched} cls="text-slate-500" indent />
              <LedgerRow label={data.wage_excess >= 0 ? '② ส่วนเกินที่สำรองจ่ายสมาชิก (งานยังไม่ได้ส่งออก)' : '② ส่งออกงานที่สำรองจ่ายไว้รอบก่อน (จ่ายน้อยกว่างานที่ส่ง)'}
                value={data.wage_excess} cls={data.wage_excess >= 0 ? 'text-amber-600' : 'text-emerald-600'} indent />
              <div className="flex justify-between pt-1.5 mt-1 border-t border-dashed border-slate-300 font-semibold">
                <span className="text-slate-700">กำไรขั้นต้น (Gross Profit)</span>
                <span className="text-sky-700">{signed(data.gross_paid)}</span>
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
                <span className="text-slate-800">กำไรสุทธิ</span>
                <span className={data.net_paid >= 0 ? 'text-emerald-700' : 'text-rose-600'}>{signed(data.net_paid)}</span>
              </div>
              <p className="text-xs text-slate-500 pt-1">
                ถ้าไม่นับส่วน ② (คิดค่าแรงเฉพาะงานที่ส่งออก) กำไรสุทธิจะเป็น <b className="tabular-nums">{signed(data.net_matched)}</b>
                {' '}— ส่วน ② ไม่ได้หายไป แต่จะกลับมาเป็นรายรับเมื่อส่งงานนั้นออกโรงงานรอบถัดไป
              </p>
            </div>
          </div>

          {/* ที่มาของค่าแรง 2 ชั้น */}
          <div className="rounded-2xl bg-white border border-slate-100 shadow-sm overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-100 flex items-center gap-2">
              <span className="p-2 rounded-xl bg-amber-100 text-amber-600"><Layers size={16} /></span>
              <h2 className="font-bold text-slate-800">ค่าแรงที่จ่ายจริง แยกตามชนิดงาน</h2>
            </div>
            <div className="p-5 space-y-4">
              <div className="overflow-x-auto">
                <table className="w-full text-sm tabular-nums">
                  <thead>
                    <tr className="text-xs text-slate-500 border-b border-slate-200">
                      <th className="text-left font-medium py-2 pr-2">ชนิดงาน</th>
                      <th className="text-right font-medium py-2 px-2">ส่งออก</th>
                      <th className="text-right font-medium py-2 px-2">① ตามงานส่งออก</th>
                      <th className="text-right font-medium py-2 px-2">ค่าแรงตามรอบจ่าย</th>
                      <th className="text-right font-medium py-2 pl-2">② สำรองจ่าย</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(data.layer_products as any[]).map((p: any) => (
                      <tr key={p.id} className="border-b border-slate-100">
                        <td className="py-1.5 pr-2 text-slate-700">{p.name}</td>
                        <td className="py-1.5 px-2 text-right text-slate-500">{qty(p.ship_qty)}</td>
                        <td className="py-1.5 px-2 text-right">{signed(p.matched)}</td>
                        <td className="py-1.5 px-2 text-right text-slate-500">{signed(p.paid_gross)}</td>
                        <td className={`py-1.5 pl-2 text-right font-medium ${p.excess > 0.005 ? 'text-amber-600' : p.excess < -0.005 ? 'text-emerald-600' : 'text-slate-400'}`}>{signed(p.excess)}</td>
                      </tr>
                    ))}
                    <tr className="border-b border-slate-100">
                      <td className="py-1.5 pr-2 text-slate-500" colSpan={3}>หักค่าปรับ NG และปัดเศษขึ้นเต็มบาทต่อคน</td>
                      <td className="py-1.5 px-2 text-right text-slate-500">{signed(data.excess_parts.adjust)}</td>
                      <td className="py-1.5 pl-2 text-right text-slate-500">{signed(data.excess_parts.adjust)}</td>
                    </tr>
                  </tbody>
                  <tfoot>
                    <tr className="font-semibold">
                      <td className="py-2 pr-2 text-slate-800" colSpan={2}>รวม</td>
                      <td className="py-2 px-2 text-right">{signed(data.wage_matched)}</td>
                      <td className="py-2 px-2 text-right text-rose-600">{signed(data.wage_paid)}</td>
                      <td className={`py-2 pl-2 text-right ${data.wage_excess >= 0 ? 'text-amber-700' : 'text-emerald-700'}`}>{signed(data.wage_excess)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
              <div className="rounded-xl bg-amber-50 border border-amber-100 p-3 text-sm">
                <p className="text-xs font-semibold text-amber-700 mb-1.5">ที่มาของส่วน ② สำรองจ่าย {signed(data.wage_excess)}</p>
                <div className="space-y-1 max-w-lg">
                  <LedgerRow label="งานที่สมาชิกคืนแล้ว แต่ยังไม่ได้ส่งออกโรงงาน (เปลี่ยนแปลงในเดือน)" value={data.excess_parts.dFG} cls="text-slate-700" />
                  <LedgerRow label="งานคืนหลัง/ก่อนวันตัดยอด (รอบจ่ายเหลื่อมกับเดือนปฏิทิน)" value={data.excess_parts.timing} cls="text-slate-700" />
                  <LedgerRow label="ค่าแรงงาน NG โรงงาน / ของหาย / NG สมาชิก − หักงานแก้" value={data.excess_parts.extra} cls="text-slate-700" />
                  <LedgerRow label="ค่าปรับ NG และปัดเศษ" value={data.excess_parts.adjust} cls="text-slate-700" />
                </div>
              </div>
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
                <p className="text-xs text-rose-500 mb-1 flex items-center gap-1"><Clock size={12} /> ค่าแรงค้างจ่ายสมาชิก</p>
                <p className="text-lg font-bold tabular-nums text-rose-700">฿{thb2(data.accrued_wages_payable)}</p>
                <p className="text-[11px] text-rose-400 mt-0.5">ณ {thDate(data.wages_owed.as_of)} · รายละเอียดในหมายเหตุด้านล่าง</p>
              </div>
            </div>
          </div>

          <OwedWagesNote o={data.wages_owed} />
        </>
      )}
    </div>
  );
}

// แถบแสดงสัดส่วนค่าแรง 2 ชั้น (① ตามงานส่งออก · ② สำรองจ่าย)
function WageLayerBar({ matched, excess }: { matched: number; excess: number }) {
  const total = Math.max(matched, 0) + Math.max(excess, 0);
  if (total <= 0) return null;
  const pm = (Math.max(matched, 0) / total) * 100;
  return (
    <div className="pl-3 py-1">
      <div className="flex h-2.5 rounded-full overflow-hidden bg-slate-200" aria-hidden>
        <div className="bg-sky-400" style={{ width: `${pm}%` }} />
        <div className="bg-amber-400" style={{ width: `${100 - pm}%` }} />
      </div>
    </div>
  );
}

// หมายเหตุ: ค่าแรงที่ยังค้างจ่ายสมาชิก ณ สิ้นเดือน
function OwedWagesNote({ o }: { o: any }) {
  const [showAll, setShowAll] = useState(false);
  const members = (o.members || []) as any[];
  const shown = showAll ? members : members.slice(0, 12);
  return (
    <div className="rounded-2xl bg-white border border-rose-100 shadow-sm overflow-hidden">
      <div className="px-5 py-4 border-b border-rose-100 bg-rose-50/50 flex items-center gap-2 flex-wrap">
        <span className="p-2 rounded-xl bg-rose-100 text-rose-600"><Wallet size={16} /></span>
        <h2 className="font-bold text-slate-800">หมายเหตุ: ค่าแรงที่ยังค้างจ่ายสมาชิก ณ {thDate(o.as_of)}</h2>
        <span className="ml-auto text-xl font-bold tabular-nums text-rose-700">฿{thb2(o.total)}</span>
      </div>
      <div className="p-5 space-y-4 text-sm">
        <p className="text-xs text-slate-500 leading-relaxed">
          งานที่สมาชิกคืนแล้ว (ได้ค่าแรงแล้ว) แต่ยังไม่ถึงวันจ่าย ณ สิ้นเดือน — ค่าแรงรอบก่อนหน้าจ่ายไปแล้ววันที่ 25 ของเดือนนี้ จึงไม่ค้าง
        </p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className="rounded-xl bg-slate-50 p-3">
            <p className="text-xs text-slate-500">(ก) ค่าแรงรอบ {cycleLabel(o.cycle)} · คืนงาน {thDate(o.cycle_start)} – {thDate(o.cycle_end)}</p>
            <p className="text-lg font-bold tabular-nums text-slate-800 mt-0.5">฿{thb2(o.cycle_total)}</p>
            <p className="text-[11px] text-slate-500 mt-0.5">กำหนดจ่าย {thDate(o.cycle_pay_date)} · สุทธิหลังหักค่าปรับ ปัดขึ้นเต็มบาทต่อคน</p>
          </div>
          <div className="rounded-xl bg-slate-50 p-3">
            <p className="text-xs text-slate-500">(ข) งานคืนหลังวันตัดยอด {o.after_from <= o.as_of ? `${thDate(o.after_from)} – ${thDate(o.as_of)}` : '(ไม่มีช่วงนี้)'}</p>
            <p className="text-lg font-bold tabular-nums text-slate-800 mt-0.5">฿{thb2(o.after_total)}</p>
            <p className="text-[11px] text-slate-500 mt-0.5">ยกไปรวมรอบ {cycleLabel(o.after_cycle)} · กำหนดจ่าย {thDate(o.after_pay_date)}{o.after_penalty > 0 ? ` · หักค่าปรับแล้ว ฿${thb2(o.after_penalty)}` : ''}</p>
          </div>
        </div>

        {o.after_products?.length > 0 && (
          <div>
            <p className="text-xs font-semibold text-slate-600 mb-1">(ข) แยกตามชนิดงาน</p>
            <div className="overflow-x-auto">
              <table className="w-full max-w-lg text-sm tabular-nums">
                <tbody>
                  {(o.after_products as any[]).map((p: any) => (
                    <tr key={p.id} className="border-b border-slate-100">
                      <td className="py-1 pr-2 text-slate-700">{p.name}</td>
                      <td className="py-1 px-2 text-right text-slate-500">{qty(p.qty)} {p.unit || ''} × {qty(p.wage)}</td>
                      <td className="py-1 pl-2 text-right">฿{thb2(p.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {members.length > 0 && (
          <div>
            <p className="text-xs font-semibold text-slate-600 mb-1">รายสมาชิก ({members.length} คน)</p>
            <div className="overflow-x-auto">
              <table className="w-full text-sm tabular-nums">
                <thead>
                  <tr className="text-xs text-slate-500 border-b border-slate-200">
                    <th className="text-left font-medium py-1.5 pr-2">สมาชิก</th>
                    <th className="text-right font-medium py-1.5 px-2">(ก) รอบ {cycleLabel(o.cycle)}</th>
                    <th className="text-right font-medium py-1.5 px-2">(ข) หลังวันตัดยอด</th>
                    <th className="text-right font-medium py-1.5 pl-2">รวมค้างจ่าย</th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map((m: any) => (
                    <tr key={m.member_id} className="border-b border-slate-100">
                      <td className="py-1 pr-2 text-slate-700">
                        <span className="font-mono text-xs text-slate-400 mr-1.5">{m.code}</span>{m.name}
                        {m.nickname && <span className="text-slate-400 text-xs"> ({m.nickname})</span>}
                      </td>
                      <td className="py-1 px-2 text-right">{m.cycle ? thb2(m.cycle) : '-'}</td>
                      <td className="py-1 px-2 text-right">{m.after ? thb2(m.after) : '-'}</td>
                      <td className="py-1 pl-2 text-right font-semibold text-rose-700">{thb2(m.total)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="font-semibold border-t border-slate-300">
                    <td className="py-1.5 pr-2 text-slate-800">รวม</td>
                    <td className="py-1.5 px-2 text-right">{thb2(o.cycle_total)}</td>
                    <td className="py-1.5 px-2 text-right">{thb2(o.after_total)}</td>
                    <td className="py-1.5 pl-2 text-right text-rose-700">{thb2(o.total)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
            {members.length > 12 && (
              <button type="button" className="mt-2 text-xs text-indigo-600 hover:underline" onClick={() => setShowAll(v => !v)}>
                {showAll ? 'ย่อรายการ' : `แสดงทั้งหมด ${members.length} คน`}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
