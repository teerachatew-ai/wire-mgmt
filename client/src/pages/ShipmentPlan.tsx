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

export default function ShipmentPlan() {
  const now = new Date();
  const defaultMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const [month, setMonth] = useState(defaultMonth);
  const { data, isLoading } = useQuery({ queryKey: ['shipment-plan', month], queryFn: () => reportApi.shipmentPlan(month) });

  const suggestions = ((data?.suggestions || []) as any[]).filter(p => p.suggested_qty > 0);
  const stock = (data?.stock || []) as any[];

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
          แนะนำปริมาณ<b>อย่างน้อยที่สุด</b>ที่ควรส่งออกแต่ละชนิดสินค้า เพื่อให้รายรับเดือนนี้เพียงพอ
          คุ้ม<b>ค่าแรงที่จ่ายสมาชิกไปแล้วในเดือนก่อน</b> ซึ่งงานยังไม่ถูกส่งออก/วางบิล
        </p>
      </div>

      {isLoading || !data ? (
        <div className="py-12 text-center text-gray-400"><Loader2 size={24} className="animate-spin mx-auto" /></div>
      ) : (
        <>
          {/* สถานะหลัก */}
          <div className={`rounded-2xl border-2 p-5 ${
            data.covered ? 'border-green-200 bg-gradient-to-br from-green-50 to-emerald-50'
            : data.is_last_week ? 'border-rose-300 bg-gradient-to-br from-rose-50 to-orange-50'
            : 'border-amber-200 bg-gradient-to-br from-amber-50 to-orange-50'
          }`}>
            <div className="flex items-center gap-2 mb-1">
              <span className={`p-2 rounded-xl ${data.covered ? 'bg-green-100 text-green-600' : data.is_last_week ? 'bg-rose-100 text-rose-600' : 'bg-amber-100 text-amber-600'}`}>
                {data.covered ? <CheckCircle2 size={18} /> : <AlertTriangle size={18} />}
              </span>
              <span className={`text-sm font-semibold ${data.covered ? 'text-green-800' : data.is_last_week ? 'text-rose-800' : 'text-amber-800'}`}>
                {data.covered
                  ? 'รายรับเดือนนี้ครอบคลุมค่าแรงที่จ่ายล่วงหน้าไปแล้ว'
                  : data.is_last_week
                  ? `⚠️ ใกล้วันตัดยอด (เหลือ ${data.days_to_cutoff} วัน) — ยังส่งออกไม่พอคุมค่าแรงที่จ่ายไปก่อน`
                  : 'ยังส่งออกไม่พอคุมค่าแรงที่จ่ายไปก่อน'}
              </span>
            </div>

            {data.covered ? (
              <>
                <p className="text-3xl md:text-[34px] font-bold text-green-700 tabular-nums leading-none">{money(data.surplus)}</p>
                <p className="text-xs text-green-700/80 mt-2">
                  = ส่วนเกินหลังหักเงินที่ต้องคืนค่าแรงเดือนก่อนแล้ว — เป็น<b>กำไร/งบผู้บริหารได้ตามปกติ</b>
                  <br />ไม่มีความจำเป็นเร่งด่วนต้องระบายของเพิ่ม แต่แนะนำให้ทยอยระบายสต๊อกเก่าต่อเนื่อง (ดูรายการด้านล่าง) เพื่อไม่ให้ค้างสะสมนาน
                </p>
              </>
            ) : (
              <>
                <p className={`text-3xl md:text-[34px] font-bold tabular-nums leading-none ${data.is_last_week ? 'text-rose-700' : 'text-amber-700'}`}>{money(data.target_remaining)}</p>
                <p className={`text-xs mt-2 ${data.is_last_week ? 'text-rose-700/80' : 'text-amber-700/80'}`}>
                  = ยอดรายรับที่<b>ยังต้องระบายของเพิ่ม</b>ให้ครบก่อนวันตัดยอด ({dateLabel(data.cutoff)})
                  เพื่อคืนเงินค่าแรงที่จ่ายสมาชิกไปแล้วในเดือนก่อน — ดูรายการแนะนำด้านล่าง
                </p>
              </>
            )}

            <div className="mt-3 pt-3 border-t border-black/5 flex flex-wrap gap-x-6 gap-y-1 text-xs text-gray-600">
              <span>เงินกันยกมา (ค่าแรงจ่ายไปแล้ว เดือนก่อน): <b>{money(data.reserve_open)}</b></span>
              <span>รายรับจากส่งออกเดือนนี้ (สะสมถึงวันนี้): <b>{money(data.shipped_revenue_mtd)}</b></span>
              <span>เส้นตัดยอด: <b>{dateLabel(data.cutoff)}</b></span>
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
              <span className="font-semibold text-gray-700 text-sm">สต๊อกงานดีค้างทั้งหมด (คืนแล้วยังไม่ส่งออก) — {monthLabel(month)}</span>
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
