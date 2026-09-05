import { Eye } from 'lucide-react';
import { parseProductLabel } from '../projectLabel';
import { sortByColorGroup } from '../productOrder';

const fmt = (n: number) => Number(n || 0).toLocaleString('th-TH', { maximumFractionDigits: 2 });

// ชื่อสมาชิกบางคนมีชื่อเล่นพ่วงมาในชื่อจริงอยู่แล้ว -> ไม่ต้องต่อท้ายซ้ำอีก
const nickOf = (name: string, nickname?: string) =>
  nickname && !String(name || '').includes(nickname) ? nickname : '';

/* ตารางสรุปใบเบิกแบบ matrix — แถว = สมาชิก, คอลัมน์ = ประเภทงาน, แยกเป็นวันๆ
   อ่านทีเดียวเห็นทั้งวันว่าใครเบิกอะไรไปเท่าไหร่ ไม่ต้องไล่อ่านทีละใบ
   คอลัมน์ชื่อสมาชิกกับหัวตารางตรึงไว้ (sticky) เลื่อนดูงานหลายชนิดแล้วยังรู้ว่าแถวไหนของใคร */
export default function IssueMatrix({ issues, onOpen }: { issues: any[]; onOpen?: (id: number) => void }) {
  if (issues.length === 0) return null;

  // ── จัดกลุ่ม: วันที่ -> สมาชิก -> ประเภทงาน ──
  const byDate: Record<string, any[]> = {};
  for (const i of issues) (byDate[i.issued_at] ??= []).push(i);
  const dates = Object.keys(byDate).sort((a, b) => b.localeCompare(a)); // วันล่าสุดอยู่บน

  const thDate = (iso: string) => {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return iso;
    const TH = ['อาทิตย์', 'จันทร์', 'อังคาร', 'พุธ', 'พฤหัสบดี', 'ศุกร์', 'เสาร์'];
    const M = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
    return `${TH[d.getDay()]}ที่ ${d.getDate()} ${M[d.getMonth()]} ${d.getFullYear() + 543}`;
  };

  return (
    <div className="space-y-4">
      {dates.map(date => {
        const rows = byDate[date];

        // ประเภทงานที่มีการเบิกในวันนั้น — จัดกลุ่มให้สีเดียวกันอยู่ติดกัน (ขาว -> ชมพู/แดง -> เขียว)
        // ใช้กติกาเดียวกับรายงานค่าแรงที่พิมพ์ออกมา ลำดับคอลัมน์บนจอกับในเอกสารจะได้ตรงกัน
        const prodMap: Record<string, { name: string; color?: string; unit?: string }> = {};
        for (const i of rows) prodMap[i.product_name] ??= { name: i.product_name, color: i.color, unit: i.unit };
        const products = sortByColorGroup(Object.values(prodMap), p => p.name, p => p.color);

        // รวมยอดต่อสมาชิก x ประเภทงาน
        const memMap: Record<string, any> = {};
        for (const i of rows) {
          const key = String(i.member_id ?? i.member_code ?? i.member_name);
          const m = (memMap[key] ??= {
            key, code: i.member_code, name: i.member_name, nickname: i.member_nickname,
            qty: {} as Record<string, number>, ids: {} as Record<string, number[]>,
            total: 0, returned: 0,
          });
          m.qty[i.product_name] = (m.qty[i.product_name] || 0) + (Number(i.quantity) || 0);
          (m.ids[i.product_name] ??= []).push(i.id);
          m.total += Number(i.quantity) || 0;
          m.returned += (Number(i.returned_good) || 0) + (Number(i.returned_defect) || 0) + (Number(i.returned_waste) || 0);
        }
        const members = Object.values(memMap).sort((a: any, b: any) =>
          String(a.code || '').localeCompare(String(b.code || ''), 'th'));

        const colTotal = (p: string) => members.reduce((s: number, m: any) => s + (m.qty[p] || 0), 0);
        const grandTotal = members.reduce((s: number, m: any) => s + m.total, 0);
        const grandPending = members.reduce((s: number, m: any) => s + Math.max(0, m.total - m.returned), 0);

        return (
          <div key={date} className="card p-0 overflow-hidden">
            {/* หัวข้อวัน */}
            <div className="px-4 py-3 border-b bg-gradient-to-r from-amber-50 to-transparent flex items-center justify-between gap-3 flex-wrap">
              <div className="flex items-baseline gap-2">
                <span className="font-bold text-gray-800">{thDate(date)}</span>
                <span className="text-xs text-gray-400 font-mono">{date}</span>
              </div>
              <div className="flex items-center gap-2 text-xs">
                <span className="bg-violet-50 border border-violet-200 text-violet-700 rounded-lg px-2.5 py-1">
                  👥 <b>{members.length}</b> คน
                </span>
                <span className="bg-blue-50 border border-blue-200 text-blue-700 rounded-lg px-2.5 py-1">
                  เบิกรวม <b>{fmt(grandTotal)}</b> เส้น
                </span>
                {grandPending > 0 && (
                  <span className="bg-amber-50 border border-amber-200 text-amber-700 rounded-lg px-2.5 py-1">
                    ค้างส่ง <b>{fmt(grandPending)}</b>
                  </span>
                )}
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-sm tabular-nums border-separate border-spacing-0">
                <thead>
                  <tr>
                    <th className="sticky left-0 z-20 bg-gray-50 border-b border-r px-3 py-2.5 text-left text-xs font-medium text-gray-500 min-w-[190px]">
                      สมาชิก
                    </th>
                    {products.map(p => {
                      // "MA020-633_A (ป้ายขาวสั้น)" -> ชื่อเรียก "ป้ายขาวสั้น" เด่น + เลขรุ่น "633" ตัวเล็ก
                      const { num, label } = parseProductLabel(p.name);
                      return (
                        <th key={p.name} className="bg-gray-50 border-b px-2 py-2 text-center min-w-[84px]" title={p.name}>
                          <span className="flex flex-col items-center gap-0.5">
                            {p.color && <span className="w-3.5 h-3.5 rounded-full border border-gray-300 shrink-0" style={{ backgroundColor: p.color }} />}
                            <span className="text-xs font-semibold text-gray-700 leading-tight">{label}</span>
                            {num && <span className="text-[10px] font-mono text-gray-400 leading-none">{num}</span>}
                          </span>
                        </th>
                      );
                    })}
                    <th className="bg-blue-50 border-b border-l px-3 py-2.5 text-right text-xs font-semibold text-blue-800 min-w-[80px]">รวม</th>
                    <th className="bg-gray-50 border-b px-3 py-2.5 text-right text-xs font-medium text-gray-500 min-w-[76px]">ค้างส่ง</th>
                  </tr>
                </thead>
                <tbody>
                  {members.map((m: any, idx: number) => {
                    const pending = Math.max(0, m.total - m.returned);
                    return (
                      <tr key={m.key} className="group">
                        <td className={`sticky left-0 z-10 border-b border-r px-3 py-2 ${idx % 2 ? 'bg-gray-50/60' : 'bg-white'} group-hover:bg-blue-50`}>
                          <span className="font-mono text-[11px] text-gray-400 mr-1.5">{m.code}</span>
                          <span className="font-medium text-gray-800">{m.name}</span>
                          {nickOf(m.name, m.nickname) && <span className="text-xs text-gray-400"> ({m.nickname})</span>}
                        </td>
                        {products.map(p => {
                          const v = m.qty[p.name] || 0;
                          const ids: number[] = m.ids[p.name] || [];
                          return (
                            <td key={p.name}
                              className={`border-b px-2 py-2 text-center ${idx % 2 ? 'bg-gray-50/60' : ''} group-hover:bg-blue-50/60`}>
                              {v > 0 ? (
                                onOpen && ids.length === 1 ? (
                                  <button type="button" onClick={() => onOpen(ids[0])}
                                    className="font-semibold text-gray-800 hover:text-blue-600 hover:underline">
                                    {fmt(v)}
                                  </button>
                                ) : (
                                  <span className="font-semibold text-gray-800">{fmt(v)}</span>
                                )
                              ) : (
                                <span className="text-gray-200">–</span>
                              )}
                            </td>
                          );
                        })}
                        <td className={`border-b border-l px-3 py-2 text-right font-bold text-blue-800 ${idx % 2 ? 'bg-blue-50/50' : 'bg-blue-50/30'} group-hover:bg-blue-50`}>
                          {fmt(m.total)}
                        </td>
                        <td className={`border-b px-3 py-2 text-right ${idx % 2 ? 'bg-gray-50/60' : ''} group-hover:bg-blue-50/60`}>
                          {pending > 0
                            ? <span className="font-semibold text-amber-600">{fmt(pending)}</span>
                            : <span className="text-emerald-600" title="ส่งครบแล้ว">✓</span>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr className="font-bold">
                    <td className="sticky left-0 z-10 bg-gray-100 border-r px-3 py-2.5 text-gray-700">รวมทั้งวัน</td>
                    {products.map(p => (
                      <td key={p.name} className="bg-gray-100 px-2 py-2.5 text-center text-gray-800">{fmt(colTotal(p.name))}</td>
                    ))}
                    <td className="bg-blue-100 border-l px-3 py-2.5 text-right text-blue-900">{fmt(grandTotal)}</td>
                    <td className="bg-gray-100 px-3 py-2.5 text-right text-amber-700">{grandPending > 0 ? fmt(grandPending) : '–'}</td>
                  </tr>
                </tfoot>
              </table>
            </div>

            {onOpen && (
              <p className="px-4 py-2 text-[11px] text-gray-400 border-t flex items-center gap-1.5">
                <Eye size={12} /> คลิกที่ตัวเลขเพื่อดูรายละเอียดใบเบิก (เฉพาะช่องที่มีใบเดียว)
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
}
