import type { SumGroup } from './DaySummary';
import { sortByColorGroup } from '../productOrder';

const fmt = (n: number) => Number(n || 0).toLocaleString('th-TH', { maximumFractionDigits: 2 });
const TH_M = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
const lotTH = (iso: string) => { const [, m, d] = String(iso).split('-').map(Number); return `${d} ${TH_M[m - 1]}`; };

/** ยอดที่ยังไม่ได้แจกให้สมาชิก ณ ตอนนี้ ของสินค้าหนึ่ง (รวมทุกล็อต รวมล็อตที่ติดลบ) — มาจาก /api/receives/lots */
// suspect = ล็อตเก่ายังเหลือค้าง ทั้งที่สมาชิกเริ่มเบิกล็อตใหม่กว่าไปแล้ว (ปกติต้องแจกล็อตเก่าให้หมดก่อน)
// ยอดคลาดเล็กน้อย server ปิดให้อัตโนมัติแล้ว (server/receivedActual.ts) ที่ยังเหลือให้เห็นคือคลาดเกินเกณฑ์
export type Waiting = { qty: number; lots: { date: string; qty: number }[]; color?: string; unit?: string; suspect?: boolean };
/** ยกมา/คงเหลือของช่วงที่เลือก — มาจาก /api/receives/balance */
export type Balance = { opening: number; received: number; issued: number; adjusted?: number; closing: number; now: number; outside: number };

/* ตารางเทียบ "รับเข้าจากโรงงาน vs เบิกออกให้สมาชิก" แถวละชนิดงาน — อ่านเป็นสมการเดียวจบ:
     ยอดยกมา (ต้นช่วง) + รับเข้า − เบิกออก = คงเหลือรอเบิก (ท้ายช่วง)

   เดิมมีแค่ รับเข้า/เบิกออก ในช่วง + คงเหลือ ณ ตอนนี้ ช่วงที่แจกของเก่าที่รับมาก่อนช่วง เบิกออกจะดูมากกว่ารับเข้า
   ทั้งที่ข้อมูลไม่ผิด — ยอดยกมาทำให้เห็นว่าของที่แจกมาจากไหน
   ยกมา/คงเหลือ = ของรอแจกจ่ายตามระบบล็อต (เหมือนหน้าสต็อก) รวมล็อตที่ติดลบ — ติดลบ = เบิกเกินของที่รับจริง (สีแดง)
   แถวที่ไม่ลงตัว = มีของก่อนวันเริ่มนับสต็อกเข้ามาเกี่ยว (บอกยอดไว้ใต้แถว) */
export default function InOutCompare({
  received, issued, waiting, balance, stockCutoff, note, memberCount,
}: {
  received: SumGroup[]; issued: SumGroup[]; waiting?: Record<string, Waiting>; balance?: Record<string, Balance>;
  stockCutoff?: string; note?: string; memberCount?: number;
}) {
  const byName: Record<string, { name: string; unit?: string; color?: string; inQty: number; outQty: number }> = {};
  const rowOf = (name: string, unit?: string, color?: string) =>
    (byName[name] ??= { name, unit, color, inQty: 0, outQty: 0 });
  for (const g of received) rowOf(g.name, g.unit, g.color).inQty += g.qty || 0;
  for (const g of issued) {
    const row = rowOf(g.name, g.unit, g.color);
    row.outQty += g.qty || 0;
    row.unit ??= g.unit; row.color ??= g.color;
  }
  // ชนิดที่ยังมีของรอเบิก/ยกมา แต่ไม่มีความเคลื่อนไหวในช่วงที่เลือก ก็ต้องเห็นด้วย
  for (const [name, w] of Object.entries(waiting || {})) if (w.qty !== 0) rowOf(name, w.unit, w.color);
  for (const [name, b] of Object.entries(balance || {})) if (b.opening || b.closing) rowOf(name);

  const rows = sortByColorGroup(Object.values(byName), r => r.name, r => r.color);
  if (rows.length === 0) return null;

  const totalIn = rows.reduce((s, r) => s + r.inQty, 0);
  const totalOut = rows.reduce((s, r) => s + r.outQty, 0);
  const sumB = (k: keyof Balance) => rows.reduce((s, r) => s + (balance?.[r.name]?.[k] || 0), 0);
  const totalWaiting = rows.reduce((s, r) => s + (waiting?.[r.name]?.qty || 0), 0);
  // ท้ายช่วง = วันนี้ (เลือกช่วงที่ยังไม่จบ) → คงเหลือท้ายช่วงคือยอด ณ ตอนนี้ แตกล็อตให้ดูได้
  const endsNow = !!balance && rows.every(r => !balance[r.name] || balance[r.name].closing === balance[r.name].now);
  const cutoffTH = stockCutoff ? lotTH(stockCutoff) : '';
  const numCls = (n: number, base: string) => (n < 0 ? 'text-rose-600 font-semibold' : base);

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

      <table className="w-full text-sm min-w-[560px] tabular-nums">
        <thead>
          <tr className="text-xs text-gray-500 border-b">
            <th className="px-2 py-2 font-medium text-left">ชนิดงาน</th>
            {balance && (
              <th className="px-2 py-2 font-medium text-right">
                ยอดยกมา<div className="text-[10px] font-normal text-gray-400">ต้นช่วง</div>
              </th>
            )}
            <th className="px-2 py-2 font-medium text-right">
              {balance && <span className="text-gray-400 mr-0.5">+</span>}📦 รับเข้า<div className="text-[10px] font-normal text-gray-400">ช่วงที่เลือก</div>
            </th>
            <th className="px-2 py-2 font-medium text-right">
              {balance && <span className="text-gray-400 mr-0.5">−</span>}↑ เบิกออก<div className="text-[10px] font-normal text-gray-400">ช่วงที่เลือก</div>
            </th>
            <th className="px-2 py-2 font-medium text-right bg-violet-50/60">
              <span className="text-violet-700">{balance && <span className="text-violet-400 mr-0.5">=</span>}คงเหลือรอเบิก</span>
              <div className="text-[10px] font-normal text-violet-400">{balance ? (endsNow ? 'ท้ายช่วง = ณ ตอนนี้' : 'ท้ายช่วง') : 'ณ ตอนนี้'}</div>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map(r => {
            const w = waiting?.[r.name];
            const b = balance?.[r.name];
            const lots = (w?.lots || []).slice().sort((a, b2) => a.date.localeCompare(b2.date));
            const hasGhost = !!w?.suspect;
            const closing = b ? b.closing : (w?.qty || 0);
            const showLots = (!b || endsNow) && (lots.length > 1 || lots.some(l => l.qty < 0));
            return (
              <tr key={r.name} className="border-b border-gray-50 align-top">
                <td className="px-2 py-1.5">
                  <span className="flex items-center gap-2">
                    {r.color && <span className="w-3 h-3 rounded-full border border-gray-300 shrink-0" style={{ backgroundColor: r.color }} />}
                    <span className="text-gray-700">{r.name}</span>
                  </span>
                </td>
                {balance && (
                  <td className={`px-2 py-1.5 text-right ${numCls(b?.opening || 0, 'text-gray-600')}`}
                    title={(b?.opening || 0) < 0 ? 'ติดลบ = ก่อนช่วงนี้เบิกเกินของที่รับจริง' : undefined}>
                    {b?.opening ? fmt(b.opening) : <span className="text-gray-300">0</span>}
                  </td>
                )}
                <td className="px-2 py-1.5 text-right font-medium text-emerald-700">{r.inQty ? fmt(r.inQty) : <span className="text-gray-300">–</span>}</td>
                <td className="px-2 py-1.5 text-right font-medium text-blue-700">{r.outQty ? fmt(r.outQty) : <span className="text-gray-300">–</span>}</td>
                <td className="px-2 py-1.5 text-right bg-violet-50/60">
                  {!waiting && !balance
                    ? <span className="text-gray-300">…</span>
                    : closing !== 0
                      ? <span className={numCls(closing, 'font-semibold text-violet-700')} title={closing < 0 ? 'ติดลบ = เบิกเกินของที่รับจริง ต้องตรวจ' : undefined}>
                          {closing < 0 && '⚠ '}{fmt(closing)}
                        </span>
                      : <span className="text-gray-300">0</span>}
                  {b && !endsNow && b.now !== b.closing && (
                    <div className="text-[10px] text-gray-400 leading-tight mt-0.5">ณ ตอนนี้ {fmt(b.now)}</div>
                  )}
                  {showLots && (
                    <div className={`text-[10px] leading-tight mt-0.5 ${hasGhost ? 'text-amber-600' : 'text-gray-400'}`}
                      title={hasGhost ? 'ล็อตเก่ายังเหลือค้าง ทั้งที่เริ่มแจกล็อตใหม่แล้ว — ถ้าของจริงไม่มีแล้ว ไปที่หน้าสต็อก กด "นับของหน้างาน"' : undefined}>
                      {lots.map((l, i) => (
                        <span key={l.date}>{i > 0 && ' · '}<span className={l.qty < 0 ? 'text-rose-600 font-semibold' : ''}>{lotTH(l.date)} {fmt(l.qty)}</span></span>
                      ))}
                      {hasGhost && ' ⚠'}
                    </div>
                  )}
                  {b && !!b.adjusted && (
                    <div className="text-[10px] leading-tight mt-0.5 text-gray-500"
                      title="ส่วนต่างจากการนับของหน้างาน (ของออกไปโดยไม่มีใบเบิก / ลงเบิกเกิน) — ยอดรับจากโรงงานไม่เปลี่ยน ดูรายล็อตได้ที่หน้ารับของ">
                      รวมปรับยอดนับหน้างาน {b.adjusted > 0 ? '+' : ''}{fmt(b.adjusted)}
                    </div>
                  )}
                  {b && b.outside !== 0 && (
                    <div className={`text-[10px] leading-tight mt-0.5 ${b.outside > 0 ? 'text-amber-600' : 'text-gray-400'}`}
                      title={`ยกมา + รับเข้า − เบิกออก ไม่เท่าคงเหลือ เพราะมีของก่อนวันเริ่มนับสต็อก (${cutoffTH}) เข้ามาเกี่ยว`}>
                      {b.outside > 0
                        ? <>เบิกของก่อน {cutoffTH} เกินที่รับ {fmt(b.outside)} ⚠</>
                        : <>รับก่อน {cutoffTH} {fmt(-b.outside)} (นอกระบบล็อต)</>}
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
            {balance && <td className={`px-2 py-2 text-right ${numCls(sumB('opening'), 'text-gray-700')}`}>{fmt(sumB('opening'))}</td>}
            <td className="px-2 py-2 text-right text-emerald-800">{fmt(totalIn)}</td>
            <td className="px-2 py-2 text-right text-blue-800">{fmt(totalOut)}</td>
            <td className="px-2 py-2 text-right text-violet-800 bg-violet-50">
              {balance ? fmt(sumB('closing')) : waiting ? fmt(totalWaiting) : '…'}
            </td>
          </tr>
        </tfoot>
      </table>

      <p className="text-xs text-gray-400 mt-2 leading-relaxed">
        {balance ? (
          <>
            อ่านแต่ละแถว: <b className="text-gray-500">ยอดยกมา + รับเข้า − เบิกออก (± ปรับยอดนับหน้างาน) = คงเหลือรอเบิก</b> ·
            ยกมา/คงเหลือ = ของที่ยังไม่ได้แจกตามระบบล็อต (นับตั้งแต่ {cutoffTH} เหมือนหน้าสต็อก) ·{' '}
            <span className="text-rose-600 font-semibold">ตัวแดง ⚠</span> = ติดลบ คือเบิกเกินของที่รับจริง ต้องตรวจ ·
            ตัวเลขเล็กใต้ยอด = แยกตามล็อตวันที่รับของ
          </>
        ) : (
          <>
            <b className="text-gray-500">รับเข้า / เบิกออก</b> = ยอดในช่วงวันที่ที่เลือกด้านบน ·{' '}
            <b className="text-violet-600">คงเหลือรอเบิก</b> = ของที่ยังไม่ได้แจก ณ ตอนนี้ · ตัวเลขเล็กใต้ยอด = แยกตามล็อตวันที่รับของ
          </>
        )}
        {' '}· ล็อตเก่าที่คลาดไม่กี่เส้น (โรงงานนับไม่ละเอียด) ระบบปิดให้เองอัตโนมัติ
        {' '}<span className="text-amber-600">สีส้ม ⚠</span> = ล็อตเก่ายังค้างทั้งที่เริ่มแจกล็อตใหม่แล้ว ควรตรวจของจริง
      </p>
    </div>
  );
}
