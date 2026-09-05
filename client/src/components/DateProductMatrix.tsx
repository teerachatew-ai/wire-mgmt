import { memo } from 'react';
import { sortByColorGroup } from '../productOrder';
import { parseProductLabel } from '../projectLabel';

const fmt = (n: number) => Number(n || 0).toLocaleString('th-TH', { maximumFractionDigits: 2 });

export interface MatrixEntry {
  date: string;
  product_name: string;
  color?: string | null;
  unit?: string | null;
  qty: number;
}

const THDAY = ['อาทิตย์', 'จันทร์', 'อังคาร', 'พุธ', 'พฤหัสบดี', 'ศุกร์', 'เสาร์'];
const THMON = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
function thDate(iso: string) {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return { main: iso, sub: '' };
  return { main: `${d.getDate()} ${THMON[d.getMonth()]} ${d.getFullYear() + 543}`, sub: THDAY[d.getDay()] };
}

/* ตารางสรุปแบบ matrix — แถว = วันที่ (ใหม่อยู่บน), คอลัมน์ = ประเภทงาน (จัดกลุ่มตามสีป้าย)
   ใช้ร่วมกันทั้งหน้า "รับของจากโรงงาน" และ "ส่งงานออกโรงงาน"
   คอลัมน์วันที่กับหัวตารางตรึงไว้ (sticky) เลื่อนดูงานหลายชนิดแล้วยังรู้ว่าแถวไหนวันไหน */
function DateProductMatrix({
  entries, accent = 'blue', unitLabel = 'เส้น', emptyText = 'ไม่มีรายการ',
}: {
  entries: MatrixEntry[];
  accent?: 'blue' | 'emerald';
  unitLabel?: string;
  emptyText?: string;
}) {
  if (entries.length === 0) {
    return <div className="card text-center text-gray-400 py-8">{emptyText}</div>;
  }

  // คอลัมน์: ประเภทงานทั้งหมดที่พบ จัดกลุ่มให้สีเดียวกันอยู่ติดกัน (ขาว -> ชมพู/แดง -> เขียว -> อื่นๆ)
  const prodMap: Record<string, { name: string; color?: string | null; unit?: string | null }> = {};
  for (const e of entries) prodMap[e.product_name] ??= { name: e.product_name, color: e.color, unit: e.unit };
  const products = sortByColorGroup(Object.values(prodMap), p => p.name, p => p.color);

  // แถว: วันที่ (ใหม่อยู่บน)
  const byDate: Record<string, Record<string, number>> = {};
  for (const e of entries) {
    (byDate[e.date] ??= {});
    byDate[e.date][e.product_name] = (byDate[e.date][e.product_name] || 0) + (Number(e.qty) || 0);
  }
  const dates = Object.keys(byDate).sort((a, b) => b.localeCompare(a));

  const rowTotal = (d: string) => products.reduce((s, p) => s + (byDate[d][p.name] || 0), 0);
  const colTotal = (p: string) => dates.reduce((s, d) => s + (byDate[d][p] || 0), 0);
  const grand = dates.reduce((s, d) => s + rowTotal(d), 0);

  const head = accent === 'emerald' ? 'bg-emerald-50 text-emerald-800' : 'bg-blue-50 text-blue-800';
  const totalCell = accent === 'emerald' ? 'text-emerald-800' : 'text-blue-800';
  const footTotal = accent === 'emerald' ? 'bg-emerald-100 text-emerald-900' : 'bg-blue-100 text-blue-900';

  return (
    <div className="card p-0 overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm tabular-nums border-separate border-spacing-0">
          <thead>
            <tr>
              <th className="sticky left-0 z-20 bg-gray-50 border-b border-r px-3 py-2.5 text-left text-xs font-medium text-gray-500 min-w-[150px] whitespace-nowrap">
                วันที่
              </th>
              {products.map(p => {
                const { num, label } = parseProductLabel(p.name);
                return (
                  <th key={p.name} className="bg-gray-50 border-b px-2 py-2 text-center min-w-[86px]" title={p.name}>
                    <span className="flex flex-col items-center gap-0.5">
                      {p.color && <span className="w-3.5 h-3.5 rounded-full border border-gray-300 shrink-0" style={{ backgroundColor: p.color }} />}
                      <span className="text-xs font-semibold text-gray-700 leading-tight">{label}</span>
                      {num && <span className="text-[10px] font-mono text-gray-400 leading-none">{num}</span>}
                    </span>
                  </th>
                );
              })}
              <th className={`border-b border-l px-3 py-2.5 text-right text-xs font-semibold min-w-[90px] ${head}`}>รวม</th>
            </tr>
          </thead>
          <tbody>
            {dates.map((d, idx) => {
              const { main, sub } = thDate(d);
              return (
                <tr key={d} className="group">
                  <td className={`sticky left-0 z-10 border-b border-r px-3 py-2 whitespace-nowrap ${idx % 2 ? 'bg-gray-50/60' : 'bg-white'} group-hover:bg-blue-50`}>
                    <span className="font-medium text-gray-800">{main}</span>
                    <span className="text-[11px] text-gray-400 ml-1.5">{sub}</span>
                  </td>
                  {products.map(p => {
                    const v = byDate[d][p.name] || 0;
                    return (
                      <td key={p.name} className={`border-b px-2 py-2 text-center ${idx % 2 ? 'bg-gray-50/60' : ''} group-hover:bg-blue-50/60`}>
                        {v > 0 ? <span className="font-semibold text-gray-800">{fmt(v)}</span> : <span className="text-gray-200">–</span>}
                      </td>
                    );
                  })}
                  <td className={`border-b border-l px-3 py-2 text-right font-bold ${totalCell} ${idx % 2 ? 'bg-gray-50/60' : ''} group-hover:bg-blue-50/60`}>
                    {fmt(rowTotal(d))}
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="font-bold">
              <td className="sticky left-0 z-10 bg-gray-100 border-r px-3 py-2.5 text-gray-700">รวมทั้งหมด</td>
              {products.map(p => (
                <td key={p.name} className="bg-gray-100 px-2 py-2.5 text-center text-gray-800">{fmt(colTotal(p.name))}</td>
              ))}
              <td className={`border-l px-3 py-2.5 text-right ${footTotal}`}>{fmt(grand)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
      <p className="px-4 py-2 text-[11px] text-gray-400 border-t">
        หน่วย: {unitLabel} · คอลัมน์เรียงตามสีป้าย (ขาว → ชมพู/แดง → เขียว) เหมือนหน้าเบิกงานและรายงานค่าแรง
      </p>
    </div>
  );
}

export default memo(DateProductMatrix);
