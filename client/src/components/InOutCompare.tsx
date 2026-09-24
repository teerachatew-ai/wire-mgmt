import type { SumGroup } from './DaySummary';
import { sortByColorGroup } from '../productOrder';

const fmt = (n: number) => Number(n || 0).toLocaleString('th-TH', { maximumFractionDigits: 2 });
const TH_M = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
const lotTH = (iso: string) => { const [, m, d] = String(iso).split('-').map(Number); return `${d} ${TH_M[m - 1]}`; };

/** ยอดที่ยังไม่ได้แจกให้สมาชิก ณ ตอนนี้ ของสินค้าหนึ่ง (รวมทุกล็อต) — มาจาก /api/receives/lots */
// suspect = ล็อตเก่ายังเหลือค้าง ทั้งที่สมาชิกเริ่มเบิกล็อตใหม่กว่าไปแล้ว (ปกติต้องแจกล็อตเก่าให้หมดก่อน)
// ยอดคลาดเล็กน้อย server ปิดให้อัตโนมัติแล้ว (server/receivedActual.ts) ที่ยังเหลือให้เห็นคือคลาดเกินเกณฑ์
export type Waiting = { qty: number; lots: { date: string; qty: number }[]; color?: string; unit?: string; suspect?: boolean };

/* ตารางเทียบ "รับเข้าจากโรงงาน vs เบิกออกให้สมาชิก" แถวละชนิดงาน

   2 คอลัมน์แรก = ยอดเคลื่อนไหว "ในช่วงวันที่ที่เลือก" (เปลี่ยนตามตัวกรอง)
   คอลัมน์สุดท้าย = คงเหลือรอเบิก "ณ ตอนนี้" (ไม่ขึ้นกับตัวกรอง — เลขเดียวกับหน้าสต็อก/ช่องเลือกล็อตตอนเบิก)

   เดิมคอลัมน์สุดท้ายคิดเป็น รับเข้า − เบิกออก "ในช่วงนั้น" ซึ่งไม่ใช่ยอดคงเหลือจริง เลยได้คนละเลข
   ตามช่วงที่เลือก (เลือกวันเดียว ป้ายชมพูได้ 750 · เลือกทั้งเดือนได้ 749/751 · งาน 3 สายติดลบ −1,000
   เพราะวันนั้นแจกของล็อตเก่า) ทำให้เจ้าของงงว่าตกลงเหลือเท่าไหร่กันแน่

   ใต้ยอดคงเหลือแตกให้เห็นว่ามาจากล็อตไหนบ้าง (เมื่อมีมากกว่า 1 ล็อต) — ถ้าล็อตเก่ายังค้างทั้งที่เริ่มแจก
   ล็อตใหม่แล้ว จะเป็นสีส้ม เตือนให้ตรวจ แก้ได้ด้วยปุ่ม "นับของหน้างาน" ที่หน้าสต็อก */
export default function InOutCompare({
  received, issued, waiting, note, memberCount,
}: { received: SumGroup[]; issued: SumGroup[]; waiting?: Record<string, Waiting>; note?: string; memberCount?: number }) {
  const byName: Record<string, { name: string; unit?: string; color?: string; inQty: number; outQty: number }> = {};
  const rowOf = (name: string, unit?: string, color?: string) =>
    (byName[name] ??= { name, unit, color, inQty: 0, outQty: 0 });
  for (const g of received) rowOf(g.name, g.unit, g.color).inQty += g.qty || 0;
  for (const g of issued) {
    const row = rowOf(g.name, g.unit, g.color);
    row.outQty += g.qty || 0;
    row.unit ??= g.unit; row.color ??= g.color;
  }
  // ชนิดที่ยังมีของรอเบิกอยู่ แต่ไม่มีความเคลื่อนไหวในช่วงที่เลือก ก็ต้องเห็นด้วย ไม่งั้นเลือกวันเดียวแล้วของค้างจะหายไปจากตาราง
  for (const [name, w] of Object.entries(waiting || {})) if (w.qty > 0) rowOf(name, w.unit, w.color);

  const rows = sortByColorGroup(Object.values(byName), r => r.name, r => r.color);
  if (rows.length === 0) return null;

  const totalIn = rows.reduce((s, r) => s + r.inQty, 0);
  const totalOut = rows.reduce((s, r) => s + r.outQty, 0);
  const totalWaiting = rows.reduce((s, r) => s + (waiting?.[r.name]?.qty || 0), 0);

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

      <table className="w-full text-sm min-w-[460px] tabular-nums">
        <thead>
          <tr className="text-xs text-gray-500 border-b">
            <th className="px-2 py-2 font-medium text-left">ชนิดงาน</th>
            <th className="px-2 py-2 font-medium text-right">
              📦 รับเข้า<div className="text-[10px] font-normal text-gray-400">ช่วงที่เลือก</div>
            </th>
            <th className="px-2 py-2 font-medium text-right">
              ↑ เบิกออก<div className="text-[10px] font-normal text-gray-400">ช่วงที่เลือก</div>
            </th>
            <th className="px-2 py-2 font-medium text-right bg-violet-50/60">
              <span className="text-violet-700">คงเหลือรอเบิก</span>
              <div className="text-[10px] font-normal text-violet-400">ณ ตอนนี้</div>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map(r => {
            const w = waiting?.[r.name];
            const lots = (w?.lots || []).slice().sort((a, b) => a.date.localeCompare(b.date));
            const hasGhost = !!w?.suspect;
            return (
              <tr key={r.name} className="border-b border-gray-50 align-top">
                <td className="px-2 py-1.5">
                  <span className="flex items-center gap-2">
                    {r.color && <span className="w-3 h-3 rounded-full border border-gray-300 shrink-0" style={{ backgroundColor: r.color }} />}
                    <span className="text-gray-700">{r.name}</span>
                  </span>
                </td>
                <td className="px-2 py-1.5 text-right font-medium text-emerald-700">{r.inQty ? fmt(r.inQty) : <span className="text-gray-300">–</span>}</td>
                <td className="px-2 py-1.5 text-right font-medium text-blue-700">{r.outQty ? fmt(r.outQty) : <span className="text-gray-300">–</span>}</td>
                <td className="px-2 py-1.5 text-right bg-violet-50/60">
                  {!waiting
                    ? <span className="text-gray-300">…</span>
                    : w && w.qty > 0
                      ? <span className="font-semibold text-violet-700">{fmt(w.qty)}</span>
                      : <span className="text-gray-300">0</span>}
                  {lots.length > 1 && (
                    <div className={`text-[10px] leading-tight mt-0.5 ${hasGhost ? 'text-amber-600' : 'text-gray-400'}`}
                      title={hasGhost ? 'ล็อตเก่ายังเหลือค้าง ทั้งที่เริ่มแจกล็อตใหม่แล้ว — ถ้าของจริงไม่มีแล้ว ไปที่หน้าสต็อก กด "นับของหน้างาน"' : undefined}>
                      {lots.map(l => `${lotTH(l.date)} ${fmt(l.qty)}`).join(' · ')}
                      {hasGhost && ' ⚠'}
                    </div>
                  )}
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
            <td className="px-2 py-2 text-right text-violet-800 bg-violet-50">{waiting ? fmt(totalWaiting) : '…'}</td>
          </tr>
        </tfoot>
      </table>

      <p className="text-xs text-gray-400 mt-2 leading-relaxed">
        <b className="text-gray-500">รับเข้า / เบิกออก</b> = ยอดในช่วงวันที่ที่เลือกด้านบน ·{' '}
        <b className="text-violet-600">คงเหลือรอเบิก</b> = ของที่ยังไม่ได้แจก ณ ตอนนี้ (ไม่ขึ้นกับช่วงวันที่ · ตรงกับหน้าสต็อก)
        {' '}· ตัวเลขเล็กใต้ยอด = แยกตามล็อตวันที่รับของ · ล็อตเก่าที่คลาดไม่กี่เส้น (โรงงานนับไม่ละเอียด) ระบบปิดให้เองอัตโนมัติ
        {' '}<span className="text-amber-600">สีส้ม ⚠</span> = ล็อตเก่ายังค้างทั้งที่เริ่มแจกล็อตใหม่แล้ว ควรตรวจของจริง
      </p>
    </div>
  );
}
