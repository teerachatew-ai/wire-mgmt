import { useState } from 'react';
import { parseProductLabel, projectLabel } from '../projectLabel';
import { sortByColorGroup } from '../productOrder';

/* กำไรขั้นต้นแยกตาม "กลุ่มงาน" (model / โครงการ) — pie chart
   ผู้ใช้ขอให้รวมรุ่นย่อยในโครงการเดียวกันเป็นชิ้นเดียว เช่น ป้ายขาว COT091 = ขาวสั้น 633 + ขาวยาว 676
   กำไรขั้นต้นของกลุ่ม = รายรับจากโรงงาน − ค่าแรงตัด ของทุกรุ่นในกลุ่มรวมกัน
   ขนาดชิ้น = กำไร (บาท) · ตัวเลขบนชิ้น = อัตรากำไร (กำไร ÷ รายรับของรุ่นนั้น)
   รุ่นที่ขาดทุนวาดเป็นชิ้นใน pie ไม่ได้ (ขนาดติดลบ) — แสดงในตารางข้างๆ เป็นสีแดงแทน ไม่ซ่อน

   สี: ตามตระกูลงานที่ทุกคนคุ้นอยู่แล้ว (ป้ายขาว / ป้ายชมพู / 3 สาย / ชมพูใหม่) แยกเข้ม-อ่อนในตระกูล
   ป้ายขาวใช้โทนอำพันแทนสีเทา (เทาอ่านเป็น "ไม่มีสี" แยกชิ้นไม่ออก) — ชุดสีผ่านตัวตรวจตาบอดสีครบ
   สีผูกกับรุ่นเสมอ (ไม่ใช่ตามลำดับกำไร) เดือนไหนรุ่นเดิมก็สีเดิม */
const FAMILY: Record<string, string[]> = {
  white: ['#b45309', '#f59e0b'],
  pink: ['#be185d', '#f472b6'],
  green: ['#166534', '#1a9950', '#58cd88'],
  blue: ['#1d4ed8', '#60a5fa'],
  other: ['#64748b', '#94a3b8'],
};
// สีอ่อน -> ตัวหนังสือบนชิ้นใช้สีเข้ม (ตัวหนังสือใช้สีหมึก ไม่ใช้สีของชิ้น)
const LIGHT = new Set(['#f59e0b', '#f472b6', '#58cd88', '#60a5fa', '#94a3b8']);
// 1 กลุ่มงาน = 1 สี (ตัวแทนของตระกูลจากชุดสีด้านบน ซึ่งผ่านตัวตรวจตาบอดสีแล้ว)
const GROUP_COLOR: Record<string, string> = { white: '#f59e0b', pink: '#be185d', green: '#1a9950', blue: '#1d4ed8', other: '#64748b' };

function familyOf(hex?: string | null): string {
  const c = String(hex || '').replace('#', '');
  if (c.length !== 6) return 'other';
  const r = parseInt(c.slice(0, 2), 16), g = parseInt(c.slice(2, 4), 16), b = parseInt(c.slice(4, 6), 16);
  if (r > 200 && g > 200 && b > 200) return 'white';
  if (g > r && g > b) return 'green';
  if (b > r && b > g) return 'blue';
  if (r > g && r > b) return 'pink';
  return 'other';
}

const thb2 = (n: number) => Number(n || 0).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const pct = (n: number) => `${n > 0 ? '' : ''}${n.toFixed(Math.abs(n) < 10 ? 1 : 0)}%`;

type Row = { id: string; name: string; short: string; models: string; color: string; revenue: number; wage: number; profit: number; margin: number };

export default function ProfitPie({ products, period, periodLabel }: {
  products: any[]; period: 'month' | 'all'; periodLabel: string;
}) {
  const [hover, setHover] = useState<string | null>(null);
  const isM = period === 'month';

  // รวมตามกลุ่มงาน (project) — ลำดับแบบเดียวกับทุกหน้า (ขาว -> ชมพู -> เขียว -> อื่นๆ) ใช้รุ่นแรกของกลุ่มเป็นตัวกำหนด
  const ordered = sortByColorGroup(products, (p: any) => p.name, (p: any) => p.color);
  const groups = new Map<string, Row>();
  for (const p of ordered) {
    const revenue = Number(isM ? p.revenue_month : p.revenue_all) || 0;
    const wage = Number(isM ? p.wage_month : p.wage_all) || 0;
    if (!(revenue > 0 || wage > 0)) continue;
    const key = p.project || `p${p.id}`;   // สินค้าที่ไม่ได้ผูกโครงการ แยกเป็นกลุ่มของตัวเอง
    const { num, label } = parseProductLabel(p.name);
    const model = `${label.replace(/ป้าย|เส้น|สาย/g, '').replace(/\s+/g, '')} ${num}`.trim();
    const g = groups.get(key) || {
      id: key, name: p.project ? `${projectLabel(p.project)} (${p.project})` : p.name,
      short: p.project ? projectLabel(p.project).replace(/^งาน\s*/, '') : model,
      models: '', color: GROUP_COLOR[familyOf(p.color)], revenue: 0, wage: 0, profit: 0, margin: 0,
    };
    g.revenue += revenue; g.wage += wage;
    g.models = g.models ? `${g.models} + ${model}` : model;
    groups.set(key, g);
  }
  const rows: Row[] = [...groups.values()].map(g => {
    const profit = g.revenue - g.wage;
    return { ...g, profit, margin: g.revenue > 0 ? (profit / g.revenue) * 100 : 0 };
  });

  if (rows.length === 0) {
    return <p className="px-5 py-8 text-center text-sm text-slate-400">ยังไม่มีรายรับ{isM ? 'ในเดือนนี้' : ''} — เริ่มเมื่อมีการส่งงานออกโรงงาน</p>;
  }

  const gains = rows.filter(r => r.profit > 0);
  const losses = rows.filter(r => r.profit < 0);
  const totalGain = gains.reduce((s, r) => s + r.profit, 0);
  const net = rows.reduce((s, r) => s + r.profit, 0);
  const totalRev = rows.reduce((s, r) => s + r.revenue, 0);

  // เรขาคณิต pie
  const S = 260, cx = S / 2, cy = S / 2, R = 112;
  let a0 = -Math.PI / 2;
  const slices = gains.map(r => {
    const frac = r.profit / totalGain;
    const a1 = a0 + frac * Math.PI * 2;
    const mid = (a0 + a1) / 2;
    const s = { r, a0, a1, mid, frac };
    a0 = a1;
    return s;
  });
  const pt = (ang: number, rad: number) => [cx + rad * Math.cos(ang), cy + rad * Math.sin(ang)];
  const hovered = rows.find(r => r.id === hover) || null;

  // ตำแหน่งตัวเลข: ชิ้นใหญ่ -> ในชิ้น · ชิ้นเล็ก -> นอกวงพร้อมเส้นชี้ และดันออกไปอีกชั้นถ้าชนป้ายข้างๆ
  // (เดิมชิ้นเล็กสองชิ้นติดกันตัวเลขทับกันจนอ่านไม่ออก)
  const labelPos = new Map<string, { x: number; y: number; inside: boolean; lx1: number; ly1: number }>();
  const placed: { x: number; y: number }[] = [];
  for (const sl of slices) {
    const [lx1, ly1] = pt(sl.mid, R + 2);
    if (sl.frac >= 0.07) {
      const [x, y] = pt(sl.mid, R * 0.64);
      labelPos.set(sl.r.id, { x, y, inside: true, lx1, ly1 });
      continue;
    }
    let rad = R + 20;
    let [x, y] = pt(sl.mid, rad);
    while (placed.some(q => Math.abs(q.x - x) < 36 && Math.abs(q.y - y) < 16) && rad < R + 100) {
      rad += 16; [x, y] = pt(sl.mid, rad);
    }
    placed.push({ x, y });
    labelPos.set(sl.r.id, { x, y, inside: false, lx1, ly1 });
  }

  return (
    <div className="px-5 py-4 grid gap-6 md:grid-cols-[260px_1fr] items-start">
      <div className="flex flex-col items-center">
        {gains.length === 0 ? (
          <div className="w-[260px] h-[260px] rounded-full border-2 border-dashed border-rose-200 flex items-center justify-center text-sm text-rose-600 text-center px-8">
            ทุกกลุ่มงานขาดทุนในช่วงนี้ — ดูรายละเอียดในตาราง
          </div>
        ) : (
          <svg viewBox={`0 0 ${S} ${S}`} width={S} height={S} role="img"
            aria-label={`กำไรขั้นต้นแยกตามกลุ่มงาน ${periodLabel}`} className="overflow-visible">
            {slices.map(({ r, a0, a1, mid }) => {
              const off = hover === r.id ? 6 : 0;
              const dx = off * Math.cos(mid), dy = off * Math.sin(mid);
              const [x1, y1] = pt(a0, R), [x2, y2] = pt(a1, R);
              const large = a1 - a0 > Math.PI ? 1 : 0;
              const d = slices.length === 1
                ? `M ${cx} ${cy - R} A ${R} ${R} 0 1 1 ${cx - 0.01} ${cy - R} Z`
                : `M ${cx} ${cy} L ${x1} ${y1} A ${R} ${R} 0 ${large} 1 ${x2} ${y2} Z`;
              const lp = labelPos.get(r.id)!;
              const inside = lp.inside;
              return (
                <g key={r.id} transform={`translate(${dx} ${dy})`}
                  onMouseEnter={() => setHover(r.id)} onMouseLeave={() => setHover(null)} style={{ cursor: 'default' }}>
                  <path d={d} fill={r.color} stroke="#ffffff" strokeWidth={2} strokeLinejoin="round"
                    opacity={hover === null || hover === r.id ? 1 : 0.45} />
                  {!inside && (
                    <line x1={lp.lx1} y1={lp.ly1} x2={lp.x - 9 * Math.cos(mid)} y2={lp.y - 9 * Math.sin(mid)}
                      stroke="#9ca3af" strokeWidth={1} />
                  )}
                  <text x={lp.x} y={lp.y} textAnchor="middle" dominantBaseline="central"
                    className="tabular-nums" fontSize={inside ? 13 : 11} fontWeight={700}
                    fill={inside ? (LIGHT.has(r.color) ? '#1f2937' : '#ffffff') : '#374151'}>
                    {pct(r.margin)}
                  </text>
                </g>
              );
            })}
          </svg>
        )}
        {/* บอกค่าของชิ้นที่ชี้อยู่ — ไม่ต้องไปไล่หาในตาราง */}
        <div className="mt-2 h-10 text-center text-xs leading-tight">
          {hovered ? (
            <>
              <div className="font-semibold text-slate-700">{hovered.short} <span className="font-normal text-slate-400">({hovered.models})</span></div>
              <div className="text-slate-500 tabular-nums">
                กำไร ฿{thb2(hovered.profit)} · อัตรากำไร {pct(hovered.margin)} · {totalGain > 0 && hovered.profit > 0 ? `${((hovered.profit / totalGain) * 100).toFixed(0)}% ของกำไรรวม` : 'ขาดทุน'}
              </div>
            </>
          ) : (
            <div className="text-slate-400">ตัวเลขบนชิ้น = อัตรากำไรของกลุ่มงานนั้น · ชี้ที่ชิ้นเพื่อดูยอดเงิน</div>
          )}
        </div>
      </div>

      {/* ตารางคู่ pie — บอกชื่อ/ยอดเงินครบทุกรุ่น (รวมรุ่นที่ขาดทุน) · สีเป็นแค่ตัวบอกว่าตรงกับชิ้นไหน */}
      <div className="overflow-x-auto">
        <table className="w-full text-sm tabular-nums">
          <thead>
            <tr className="text-xs text-slate-400 border-b border-slate-100">
              <th className="py-2 pr-2 text-left font-medium">กลุ่มงาน (model)</th>
              <th className="py-2 px-2 text-right font-medium">รายรับ</th>
              <th className="py-2 px-2 text-right font-medium">ค่าแรงตัด</th>
              <th className="py-2 px-2 text-right font-medium">กำไรขั้นต้น</th>
              <th className="py-2 pl-2 text-right font-medium">อัตรากำไร</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => {
              const loss = r.profit < 0;
              return (
                <tr key={r.id} className={`border-b border-slate-50 last:border-0 transition-colors ${hover === r.id ? 'bg-slate-100' : ''}`}
                  onMouseEnter={() => setHover(r.id)} onMouseLeave={() => setHover(null)}>
                  <td className="py-2 pr-2">
                    <span className="flex items-center gap-2">
                      <span className="w-3 h-3 rounded-sm shrink-0"
                        style={loss ? { border: `2px solid ${r.color}` } : { backgroundColor: r.color }} />
                      <span className="text-slate-700 font-medium" title={r.name}>{r.short}</span>
                      {r.id.startsWith('COT') && <span className="text-[10px] text-slate-400">{r.id.replace('COT', '')}</span>}
                      {loss && <span className="text-[10px] font-semibold text-rose-700 bg-rose-50 border border-rose-200 rounded px-1">ขาดทุน</span>}
                    </span>
                    <span className="block pl-5 text-[11px] text-slate-400">{r.models}</span>
                  </td>
                  <td className="py-2 px-2 text-right text-slate-500">{thb2(r.revenue)}</td>
                  <td className="py-2 px-2 text-right text-slate-500">{thb2(r.wage)}</td>
                  <td className={`py-2 px-2 text-right font-semibold ${loss ? 'text-rose-600' : 'text-slate-800'}`}>
                    {loss ? '−' : ''}฿{thb2(Math.abs(r.profit))}
                  </td>
                  <td className={`py-2 pl-2 text-right font-semibold ${loss ? 'text-rose-600' : 'text-slate-700'}`}>{pct(r.margin)}</td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="bg-slate-50 font-semibold text-slate-800">
              <td className="py-2 pr-2">รวม {rows.length} กลุ่มงาน</td>
              <td className="py-2 px-2 text-right">{thb2(totalRev)}</td>
              <td className="py-2 px-2 text-right">{thb2(rows.reduce((s, r) => s + r.wage, 0))}</td>
              <td className={`py-2 px-2 text-right ${net < 0 ? 'text-rose-600' : ''}`}>{net < 0 ? '−' : ''}฿{thb2(Math.abs(net))}</td>
              <td className="py-2 pl-2 text-right">{pct(totalRev > 0 ? (net / totalRev) * 100 : 0)}</td>
            </tr>
          </tfoot>
        </table>
        <p className="text-[11px] text-slate-400 mt-2 leading-relaxed">
          กำไรขั้นต้นของกลุ่มงาน = รายรับจากโรงงาน − ค่าแรงตัด ของทุกรุ่นในกลุ่มรวมกัน (จำนวนที่ส่งออก × ค่าแรงต่อเส้น) · อัตรากำไร = กำไร ÷ รายรับของกลุ่มนั้น
          {losses.length > 0 && <> · <span className="text-rose-600">กลุ่มที่ขาดทุนไม่มีชิ้นใน pie</span> (วาดยอดติดลบเป็นชิ้นไม่ได้)</>}
          {' '}· ยอดรวมอาจต่างจาก "กำไรขั้นต้น" ด้านบนเล็กน้อย เพราะด้านบนใช้ค่าแรงที่จ่ายจริงตามรอบบัญชี
        </p>
      </div>
    </div>
  );
}
