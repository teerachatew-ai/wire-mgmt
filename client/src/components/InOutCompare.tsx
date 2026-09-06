import type { SumGroup } from './DaySummary';
import { sortByColorGroup } from '../productOrder';

const fmt = (n: number) => Number(n || 0).toLocaleString('th-TH', { maximumFractionDigits: 2 });

/* ตารางเทียบ "รับเข้าจากโรงงาน vs เบิกออกให้สมาชิก" ในตารางเดียว แถวละชนิดงาน
   — เดิมแยกเป็น 2 การ์ดคนละที่ ต้องกวาดสายตาขึ้นลงเทียบเอง อ่านยาก
   คงเหลือรอเบิก = รับเข้า − เบิกออก (ติดลบ = เบิกออกมากกว่าที่รับเข้าในช่วงนี้) */
export default function InOutCompare({
  received, issued, note, memberCount,
}: { received: SumGroup[]; issued: SumGroup[]; note?: string; memberCount?: number }) {
  const byName: Record<string, { name: string; unit?: string; color?: string; inQty: number; outQty: number }> = {};
  for (const g of received) {
    (byName[g.name] ??= { name: g.name, unit: g.unit, color: g.color, inQty: 0, outQty: 0 }).inQty += g.qty || 0;
  }
  for (const g of issued) {
    const row = (byName[g.name] ??= { name: g.name, unit: g.unit, color: g.color, inQty: 0, outQty: 0 });
    row.outQty += g.qty || 0;
    row.unit ??= g.unit; row.color ??= g.color;
  }
  // จัดกลุ่มให้สีเดียวกันอยู่ติดกัน (กติกาเดียวกับตาราง matrix และรายงานค่าแรง)
  const rows = sortByColorGroup(Object.values(byName), r => r.name, r => r.color);
  if (rows.length === 0) return null;

  const totalIn = rows.reduce((s, r) => s + r.inQty, 0);
  const totalOut = rows.reduce((s, r) => s + r.outQty, 0);
  const totalDiff = totalIn - totalOut;

  const diffCls = (d: number) => d < 0 ? 'text-rose-600' : d > 0 ? 'text-emerald-700' : 'text-gray-400';

  return (
    <div className="card overflow-x-auto">
      <div className="flex items-center justify-between mb-2.5 flex-wrap gap-1">
        <span className="text-sm font-semibold text-gray-700">
          🔄 เทียบรับเข้า vs เบิกออก{note ? ` — ${note}` : ''}
        </span>
        {memberCount != null && memberCount > 0 && (
          <span className="text-sm bg-violet-50 border border-violet-200 text-violet-700 rounded-lg px-2.5 py-0.5">
            👥 สมาชิก <b>{memberCount}</b> คน
          </span>
        )}
      </div>

      <table className="w-full text-sm min-w-[420px] tabular-nums">
        <thead>
          <tr className="text-xs text-gray-500 border-b">
            <th className="px-2 py-2 font-medium text-left">ชนิดงาน</th>
            <th className="px-2 py-2 font-medium text-right">📦 รับเข้า</th>
            <th className="px-2 py-2 font-medium text-right">↑ เบิกออก</th>
            <th className="px-2 py-2 font-medium text-right">คงเหลือรอเบิก</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(r => {
            const diff = r.inQty - r.outQty;
            return (
              <tr key={r.name} className="border-b border-gray-50">
                <td className="px-2 py-1.5">
                  <span className="flex items-center gap-2">
                    {r.color && <span className="w-3 h-3 rounded-full border border-gray-300 shrink-0" style={{ backgroundColor: r.color }} />}
                    <span className="text-gray-700">{r.name}</span>
                  </span>
                </td>
                <td className="px-2 py-1.5 text-right font-medium text-emerald-700">{r.inQty ? fmt(r.inQty) : <span className="text-gray-300">-</span>}</td>
                <td className="px-2 py-1.5 text-right font-medium text-blue-700">{r.outQty ? fmt(r.outQty) : <span className="text-gray-300">-</span>}</td>
                <td className={`px-2 py-1.5 text-right font-semibold ${diffCls(diff)}`}>
                  {diff > 0 ? '+' : ''}{fmt(diff)}
                </td>
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr className="bg-gray-50 font-semibold">
            <td className="px-2 py-2 text-gray-700">รวมทั้งหมด</td>
            <td className="px-2 py-2 text-right text-emerald-800">{fmt(totalIn)}</td>
            <td className="px-2 py-2 text-right text-blue-800">{fmt(totalOut)}</td>
            <td className={`px-2 py-2 text-right ${diffCls(totalDiff)}`}>{totalDiff > 0 ? '+' : ''}{fmt(totalDiff)}</td>
          </tr>
        </tfoot>
      </table>

      <p className="text-xs text-gray-400 mt-2">
        คงเหลือรอเบิก = รับเข้า − เบิกออก · <span className="text-rose-600">ติดลบ</span> = ช่วงนี้เบิกออกมากกว่ารับเข้า (แจกงานที่ค้างมาจากก่อนหน้า)
      </p>
    </div>
  );
}
