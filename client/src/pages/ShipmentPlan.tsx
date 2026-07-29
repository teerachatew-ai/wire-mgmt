import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { reportApi } from '../api';
import { Target, Loader2, CheckCircle2, AlertTriangle, PackageCheck, Info } from 'lucide-react';

const fmt = (n: number) => Number(n || 0).toLocaleString('th-TH', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
const money = (n: number) => `฿${fmt(n || 0)}`;
const fmtQty = (n: number) => Number(n || 0).toLocaleString();

const TH_MONTHS = ['', 'ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
function monthLabel(m?: string) {
  if (!m) return '';
  const [y, mo] = m.split('-');
  return `${TH_MONTHS[parseInt(mo)]} ${parseInt(y) + 543}`;
}
function dateLabel(s?: string) {
  if (!s) return '-';
  const [y, m, d] = s.split('-');
  return `${d}/${m}/${parseInt(y) + 543}`;
}

// แถวในตารางสรุปยอด (แบบสมุดบัญชี) — ชื่อรายการทางซ้าย ตัวเลขทางขวา
function LedgerRow({ label, sub, value, bold, tone }: { label: string; sub?: string; value: number; bold?: boolean; tone?: string }) {
  return (
    <div className={`flex items-start justify-between gap-3 py-1 ${bold ? 'font-bold' : ''}`}>
      <span className={tone || 'text-gray-600'}>
        {label}
        {sub && <span className="block text-[11px] font-normal text-gray-400">{sub}</span>}
      </span>
      <span className={`tabular-nums shrink-0 ${tone || 'text-gray-800'}`}>{money(value)}</span>
    </div>
  );
}

export default function ShipmentPlan() {
  const now = new Date();
  const defaultMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const [month, setMonth] = useState(defaultMonth);
  const { data, isLoading } = useQuery({ queryKey: ['shipment-plan', month], queryFn: () => reportApi.shipmentPlan(month) });

  const suggestions = ((data?.suggestions || []) as any[]).filter(p => p.suggested_qty > 0);
  const stock = (data?.stock || []) as any[];
  const totalNeeded = data ? data.reserve_open + data.worst_case_wage + data.overhead_total : 0;

  return (
    <div className="p-4 md:p-6 space-y-4 max-w-5xl mx-auto">
      <div className="flex items-center gap-2">
        <Target size={22} className="text-blue-600" />
        <h1 className="text-xl font-bold text-gray-800">วางแผนการส่งงาน</h1>
      </div>

      <div className="card flex flex-wrap items-end gap-4">
        <div>
          <label className="label">รอบเดือน</label>
          <input type="month" className="input" value={month} onChange={e => setMonth(e.target.value)} />
        </div>
        <p className="text-xs text-gray-500 pb-2 max-w-xl">
          หน้านี้เช็คว่า<b>ส่งงานให้โรงงาน (วางบิล) พอครอบคลุมค่าแรง + ค่าใช้จ่ายของเดือนนี้แล้วหรือยัง</b>
          ถ้ายังไม่พอ จะแนะนำว่าควรส่งสายไฟชนิดไหนเพิ่มอย่างน้อยเท่าไหร่
        </p>
      </div>

      {isLoading || !data ? (
        <div className="py-12 text-center text-gray-400"><Loader2 size={24} className="animate-spin mx-auto" /></div>
      ) : (
        <>
          {!data.is_current_month && (
            <div className="rounded-xl border border-slate-300 bg-slate-50 p-3 text-xs text-slate-600 flex items-start gap-2">
              <Info size={14} className="shrink-0 mt-0.5 text-slate-400" />
              <span>
                กำลังดูเดือนที่ผ่านมาแล้ว ({monthLabel(month)}) — ตัวเลขเงินด้านล่างเป็นของเดือนนั้น แต่ "สต๊อกงานดีค้าง"
                เป็นสต๊อก<b>ปัจจุบัน ณ วันนี้</b>เสมอ (ของที่เคยค้างตอนนั้นอาจถูกส่งออกไปแล้วหลังจากนั้น) เทียบกันตรงๆ ไม่ได้
                — วางแผนได้แม่นยำเฉพาะตอนดู "เดือนปัจจุบัน" เท่านั้น
              </span>
            </div>
          )}

          {/* สถานะหลัก */}
          <div className={`rounded-2xl border-2 p-5 ${
            data.covered ? 'border-green-200 bg-gradient-to-br from-green-50 to-emerald-50'
            : data.is_last_week ? 'border-rose-300 bg-gradient-to-br from-rose-50 to-orange-50'
            : 'border-amber-200 bg-gradient-to-br from-amber-50 to-orange-50'
          }`}>
            <div className="flex items-center gap-2 mb-3">
              <span className={`p-2 rounded-xl ${data.covered ? 'bg-green-100 text-green-600' : data.is_last_week ? 'bg-rose-100 text-rose-600' : 'bg-amber-100 text-amber-600'}`}>
                {data.covered ? <CheckCircle2 size={18} /> : <AlertTriangle size={18} />}
              </span>
              <span className={`text-base font-bold ${data.covered ? 'text-green-800' : data.is_last_week ? 'text-rose-800' : 'text-amber-800'}`}>
                {data.covered
                  ? '✅ ส่งงานพอแล้ว ไม่ต้องรีบส่งเพิ่ม'
                  : data.is_last_week
                  ? `🔴 ใกล้วันตัดยอดแล้ว (เหลือ ${data.days_to_cutoff} วัน) — ต้องรีบส่งเพิ่ม`
                  : '⚠️ ยังส่งไม่พอ ต้องส่งเพิ่ม'}
              </span>
            </div>

            <p className={`text-sm ${data.covered ? 'text-green-700' : data.is_last_week ? 'text-rose-700' : 'text-amber-700'}`}>
              {data.covered ? 'กำไรคงเหลือ หลังหักค่าแรงและค่าใช้จ่ายทั้งหมดแล้ว' : 'ยอดที่ยังขาด ต้องส่งของเพิ่มให้ครบก่อนวันตัดยอด'}
            </p>
            <p className={`text-3xl md:text-[34px] font-bold tabular-nums leading-tight ${data.covered ? 'text-green-700' : data.is_last_week ? 'text-rose-700' : 'text-amber-700'}`}>
              {money(data.covered ? data.surplus : data.target_remaining)}
            </p>

            {/* ตารางสรุปยอดแบบสมุดบัญชี — อ่านจากบนลงล่างเหมือนบวกลบเลขปกติ */}
            <div className="mt-4 bg-white/70 rounded-xl p-4 text-sm">
              <p className="text-xs font-semibold text-gray-500 mb-2">ยอดที่ต้องมีในเดือนนี้</p>
              <LedgerRow
                label="ค่าแรงค้างจากเดือนก่อน"
                sub="จ่ายสมาชิกไปแล้วเดือนก่อน แต่ตอนนั้นงานยังไม่ถูกส่งขายให้โรงงาน"
                value={data.reserve_open}
              />
              <LedgerRow
                label="ค่าแรงตัดของเดือนนี้ (กรณีเลวร้ายสุด)"
                sub={`คืนงานแล้ว ${money(data.current_cycle_wage)}${data.outstanding_wage > 0 ? ` + เบิกไปแล้วแต่ยังไม่คืน ${money(data.outstanding_wage)}` : ''}`}
                value={data.worst_case_wage}
              />
              <LedgerRow
                label="ค่าตอบแทนผู้บริหาร"
                sub={data.manager_comp_extra > 0 ? `อัตโนมัติ ${money(data.manager_comp_auto)} + จ่ายให้บุคคลเพิ่มเอง ${money(data.manager_comp_extra)}` : 'คิดจากยอดขายปัจจุบัน'}
                value={data.manager_comp_month}
              />
              <LedgerRow label="ค่าบริหารจัดการ" value={data.general_expenses_month} />
              <div className="border-t mt-1.5 pt-1.5">
                <LedgerRow label="รวมที่ต้องมี" value={totalNeeded} bold />
              </div>

              <p className="text-xs font-semibold text-gray-500 mt-3 mb-2">ยอดที่มีแล้ว</p>
              <LedgerRow label="ส่งออกแล้วเดือนนี้ (สะสมถึงวันนี้)" value={data.shipped_revenue_mtd} />

              <div className="border-t-2 border-gray-300 mt-1.5 pt-1.5">
                <LedgerRow
                  label={data.covered ? 'เหลือ (กำไร)' : 'ยังขาด — ต้องส่งเพิ่ม'}
                  value={data.covered ? data.surplus : data.target_remaining}
                  bold
                  tone={data.covered ? 'text-green-700' : 'text-amber-700'}
                />
              </div>
            </div>

            <div className="mt-3 text-[11px] text-gray-400 space-y-0.5">
              <p>วันตัดยอดของเดือนนี้: <b className="text-gray-500">{dateLabel(data.cutoff)}</b></p>
              <p>ถ้าส่งของเพิ่มตามคำแนะนำ ค่าตอบแทนผู้บริหาร/ค่าบริหารจัดการอาจขยับขึ้นตามไปด้วยเล็กน้อย (คิดจากยอดขาย)</p>
              <p>💡 ถ้าหน้า "ภาพรวม" เลือกจ่ายรายการ "เพิ่มเองรายเดือน" ให้ผู้บริหาร/สมาชิกคนใดคนหนึ่ง จะถูกนับรวมในค่าตอบแทนผู้บริหาร ไม่ใช่ค่าบริหารจัดการ</p>
              {data.covered && <p>ไม่มีความจำเป็นเร่งด่วนต้องระบายของเพิ่ม แต่แนะนำให้ทยอยส่งสต๊อกเก่าต่อเนื่อง (ดูรายการด้านล่าง) เพื่อไม่ให้ค้างสะสมนาน</p>}
            </div>
          </div>

          {/* รายการแนะนำ (เฉพาะกรณียังไม่ครอบคลุม) */}
          {!data.covered && (
            <div className="card p-0 overflow-hidden">
              <div className="px-4 py-3 border-b bg-slate-50 flex items-center gap-2">
                <PackageCheck size={15} className="text-slate-600" />
                <span className="font-semibold text-slate-700 text-sm">แนะนำ — ส่งออกอย่างน้อยเท่านี้ต่อชนิด</span>
              </div>
              {suggestions.length === 0 ? (
                <div className="p-6 text-center text-sm text-gray-400">
                  ไม่มีสต๊อกงานดีค้างให้ระบายเพิ่มแล้ว — ยอดที่ยังขาดต้องรอสมาชิกคืนงานเพิ่มก่อนถึงจะส่งออกได้
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50 border-b text-xs text-gray-500">
                      <tr className="text-left">
                        <th className="px-4 py-2.5">สายไฟ</th>
                        <th className="px-4 py-2.5 text-right">สต๊อกค้างทั้งหมด</th>
                        <th className="px-4 py-2.5 text-right">แนะนำส่งอย่างน้อย</th>
                        <th className="px-4 py-2.5 text-right">คิดเป็นรายรับ</th>
                      </tr>
                    </thead>
                    <tbody>
                      {suggestions.map((p: any) => (
                        <tr key={p.id} className="border-b border-gray-50 last:border-0">
                          <td className="px-4 py-2.5">
                            <span className="inline-flex items-center gap-1.5">
                              {p.color && <span className="w-2.5 h-2.5 rounded-full border border-gray-300 shrink-0" style={{ backgroundColor: p.color }} />}
                              <span className="text-gray-800">{p.name}</span>
                            </span>
                          </td>
                          <td className="px-4 py-2.5 text-right tabular-nums text-gray-500">{fmtQty(p.stock_qty)} {p.unit}</td>
                          <td className="px-4 py-2.5 text-right tabular-nums font-bold text-blue-700">{fmtQty(p.suggested_qty)} {p.unit}</td>
                          <td className="px-4 py-2.5 text-right tabular-nums text-emerald-700">{money(p.suggested_value)}</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr className="bg-blue-50 border-t font-semibold">
                        <td className="px-4 py-2.5 text-gray-700" colSpan={3}>รวมรายรับจากที่แนะนำ</td>
                        <td className="px-4 py-2.5 text-right text-blue-800">{money(data.total_suggested_value)}</td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              )}
              <div className="px-4 py-2.5 border-t bg-amber-50/60 flex items-start gap-2 text-xs text-amber-700">
                <Info size={14} className="shrink-0 mt-0.5" />
                <span>เป็นปริมาณ<b>ขั้นต่ำที่สุด</b>ที่ต้องส่งเพื่อคุมค่าแรง — ไม่ใช่คำแนะนำให้ส่งของทั้งหมดที่มี (ปกติแล้วแทบเป็นไปไม่ได้ที่จะระบายของทั้งหมดออกในครั้งเดียว) เลือกส่งเกินกว่านี้ได้ตามความเหมาะสมของแต่ละรุ่น</span>
              </div>
            </div>
          )}

          {/* สต๊อกงานดีค้างทั้งหมด (อ้างอิง) */}
          <div className="card p-0 overflow-hidden">
            <div className="px-4 py-3 border-b bg-gray-50 flex items-center gap-2">
              <span className="font-semibold text-gray-700 text-sm">สต๊อกงานดีค้างทั้งหมด (คืนแล้วยังไม่ส่งออก) — ณ วันนี้ ({dateLabel(data.today)})</span>
            </div>
            {stock.length === 0 ? (
              <div className="p-6 text-center text-sm text-gray-400">ไม่มีสต๊อกค้าง — ส่งออกครบหมดแล้ว</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 border-b text-xs text-gray-500">
                    <tr className="text-left">
                      <th className="px-4 py-2.5">สายไฟ</th>
                      <th className="px-4 py-2.5 text-right">คงค้าง</th>
                      <th className="px-4 py-2.5 text-right">ราคาโรงงาน/หน่วย</th>
                      <th className="px-4 py-2.5 text-right">มูลค่ารวม</th>
                    </tr>
                  </thead>
                  <tbody>
                    {stock.map((p: any) => (
                      <tr key={p.id} className="border-b border-gray-50 last:border-0">
                        <td className="px-4 py-2.5">
                          <span className="inline-flex items-center gap-1.5">
                            {p.color && <span className="w-2.5 h-2.5 rounded-full border border-gray-300 shrink-0" style={{ backgroundColor: p.color }} />}
                            <span className="text-gray-800">{p.name}</span>
                          </span>
                        </td>
                        <td className="px-4 py-2.5 text-right tabular-nums text-gray-700">{fmtQty(p.stock_qty)} {p.unit}</td>
                        <td className="px-4 py-2.5 text-right tabular-nums text-gray-500">{p.factory_price}</td>
                        <td className="px-4 py-2.5 text-right tabular-nums font-medium text-gray-800">{money(p.stock_value)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="bg-gray-50 border-t font-semibold">
                      <td className="px-4 py-2.5 text-gray-700" colSpan={3}>รวมมูลค่าสต๊อกค้างทั้งหมด</td>
                      <td className="px-4 py-2.5 text-right text-gray-800">{money(data.total_stock_value)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
