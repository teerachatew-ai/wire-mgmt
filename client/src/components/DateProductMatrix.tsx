import { memo } from 'react';
import { Pencil } from 'lucide-react';
import { sortByColorGroup } from '../productOrder';
import { parseProductLabel } from '../projectLabel';

const fmt = (n: number) => Number(n || 0).toLocaleString('th-TH', { maximumFractionDigits: 2 });

export interface MatrixEntry {
  date: string;
  product_name: string;
  color?: string | null;
  unit?: string | null;
  qty: number;
  // ส่วนต่างระหว่างยอดจริงกับยอดที่บันทึกไว้ตอนแรก (qty = ยอดจริงแล้ว) — ไม่ใส่มาก็ได้ ถือว่าไม่มีส่วนต่าง
  variance?: number;
  product_id?: number;
  // โหมด split (หน้ารับของ): ยอดตามใบส่งของ + ที่มาของส่วนต่าง (qty = ยอดรับจริง)
  note?: number;
  adjust?: { counted?: number; member?: number; auto?: number };
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
  entries, accent = 'blue', unitLabel = 'เส้น', emptyText = 'ไม่มีรายการ', onDateClick, onVarianceClick, split,
}: {
  entries: MatrixEntry[];
  accent?: 'blue' | 'emerald';
  unitLabel?: string;
  emptyText?: string;
  // คลิกที่วันที่เพื่อไปแก้ไขยอดของวันนั้น (สลับไปมุมมองรายการทีละใบ + กรองเหลือวันนั้นวันเดียว)
  onDateClick?: (date: string) => void;
  // คลิกช่องที่มีส่วนต่าง (▲/▼) เพื่อดูว่าส่วนต่างมาจากอะไร และล้างกลับเป็นยอดตามใบส่งของ
  onVarianceClick?: (date: string, productId: number, productName: string) => void;
  // แยกแต่ละวันเป็น 2 แถวย่อย: ยอดตามใบส่งของ / ยอดรับจริง (หน้ารับของจากโรงงาน)
  split?: boolean;
}) {
  if (entries.length === 0) {
    return <div className="card text-center text-gray-400 py-8">{emptyText}</div>;
  }
  if (split) return <SplitMatrix entries={entries} accent={accent} unitLabel={unitLabel} onDateClick={onDateClick} onVarianceClick={onVarianceClick} />;

  // คอลัมน์: ประเภทงานทั้งหมดที่พบ จัดกลุ่มให้สีเดียวกันอยู่ติดกัน (ขาว -> ชมพู/แดง -> เขียว -> อื่นๆ)
  const prodMap: Record<string, { name: string; color?: string | null; unit?: string | null }> = {};
  for (const e of entries) prodMap[e.product_name] ??= { name: e.product_name, color: e.color, unit: e.unit };
  const pidOf: Record<string, number | undefined> = {};
  for (const e of entries) if (e.product_id) pidOf[e.product_name] ??= e.product_id;
  const products = sortByColorGroup(Object.values(prodMap), p => p.name, p => p.color);

  // แถว: วันที่ (ใหม่อยู่บน)
  const byDate: Record<string, Record<string, number>> = {};
  const varOf: Record<string, Record<string, number>> = {};   // ส่วนต่างยอดจริง แยกตามวัน x ประเภทงาน
  for (const e of entries) {
    (byDate[e.date] ??= {});
    byDate[e.date][e.product_name] = (byDate[e.date][e.product_name] || 0) + (Number(e.qty) || 0);
    if (e.variance) {
      (varOf[e.date] ??= {});
      varOf[e.date][e.product_name] = (varOf[e.date][e.product_name] || 0) + Number(e.variance);
    }
  }
  const hasVariance = Object.keys(varOf).length > 0;
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
                    {onDateClick ? (
                      <button type="button" onClick={() => onDateClick(d)}
                        className="inline-flex items-center gap-1 hover:text-blue-700 hover:underline decoration-dotted underline-offset-2"
                        title="คลิกเพื่อแก้ไขยอดของวันนี้">
                        <span className="font-medium text-gray-800">{main}</span>
                        <span className="text-[11px] text-gray-400">{sub}</span>
                        <Pencil size={11} className="text-gray-300 group-hover:text-blue-500 shrink-0" />
                      </button>
                    ) : (
                      <>
                        <span className="font-medium text-gray-800">{main}</span>
                        <span className="text-[11px] text-gray-400 ml-1.5">{sub}</span>
                      </>
                    )}
                  </td>
                  {products.map(p => {
                    const v = byDate[d][p.name] || 0;
                    // ยอดที่โชว์คือยอดจริง — ถ้าต่างจากที่บันทึกไว้ตอนแรก เปลี่ยนสี + ใส่ลูกศร และบอกยอดเดิมไว้ใต้ตัวเลข
                    const diff = varOf[d]?.[p.name] || 0;
                    return (
                      <td key={p.name} className={`border-b px-2 py-2 text-center ${idx % 2 ? 'bg-gray-50/60' : ''} group-hover:bg-blue-50/60`}>
                        {v > 0 || diff ? (
                          <span title={diff ? `ตามใบส่งของ ${fmt(v - diff)} · รับจริง ${fmt(v)} (${diff > 0 ? 'เกิน' : 'ขาด'} ${fmt(Math.abs(diff))})${onVarianceClick ? ' — คลิกดูที่มา/ล้างส่วนต่าง' : ''}` : undefined}
                            {...(diff && onVarianceClick && pidOf[p.name] ? {
                              role: 'button', tabIndex: 0,
                              className: 'inline-block cursor-pointer rounded px-1 -mx-1 hover:bg-amber-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300',
                              onClick: () => onVarianceClick(d, pidOf[p.name]!, p.name),
                              onKeyDown: (e: any) => { if (e.key === 'Enter') onVarianceClick(d, pidOf[p.name]!, p.name); },
                            } : {})}>
                            <span className={`font-semibold ${diff > 0 ? 'text-emerald-600' : diff < 0 ? 'text-rose-600' : 'text-gray-800'}`}>
                              {diff !== 0 && <span className="text-[10px] mr-0.5">{diff > 0 ? '▲' : '▼'}</span>}
                              {fmt(v)}
                            </span>
                            {diff !== 0 && (
                              <span className="block text-[10px] text-gray-400 leading-tight">ใบส่ง {fmt(v - diff)}</span>
                            )}
                          </span>
                        ) : <span className="text-gray-200">–</span>}
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
        {onDateClick && <> · <Pencil size={10} className="inline -mt-0.5" /> คลิกที่วันที่เพื่อแก้ไขยอดของวันนั้น</>}
        {hasVariance && (
          <>
            <br />ตัวเลขคือ<b>ยอดรับจริง</b> ·{' '}
            <span className="text-emerald-600 font-semibold">▲ เขียว</span> = ได้เกินใบส่งของ ·{' '}
            <span className="text-rose-600 font-semibold">▼ แดง</span> = ได้ขาดจากใบส่งของ (ระบบปรับให้เองจากยอดที่แก้ในใบเบิก)
            {onVarianceClick && <> · <b>คลิกที่ตัวเลข</b> เพื่อดูที่มาของส่วนต่าง และย้อนกลับเป็นยอดตามใบส่งของ</>}
          </>
        )}
      </p>
    </div>
  );
}

/* ── มุมมอง "ใบส่งของ / รับจริง" (หน้ารับของจากโรงงาน) ──────────────────────────────
   1 วัน = 2 แถวย่อย: บน = ยอดตามใบส่งของ (ตัวเทา) · ล่าง = ยอดรับจริงที่ระบบใช้คิดสต็อก (ตัวหนา)
   ถ้าต่างกัน แถวล่างมีป้าย ±ส่วนต่าง + บอกที่มา (กำหนด/นับเอง · จากใบเบิกที่สมาชิกนับในมัดได้ไม่ตรง · ระบบปิดล็อต)
   คลิกตัวเลขแถวล่างเพื่อดูรายละเอียด/ล้างส่วนต่าง (เหมือนเดิม) */
const SRC: Record<string, string> = { counted: 'กำหนด/นับเอง', member: 'จากใบเบิก', auto: 'ปิดล็อตอัตโนมัติ' };
const SRC_SHORT: Record<string, string> = { counted: 'นับเอง', member: 'ใบเบิก', auto: 'ปิดล็อต' };   // ป้ายในช่อง — สั้นพอให้อยู่บรรทัดเดียว
const signed = (n: number) => `${n > 0 ? '+' : n < 0 ? '−' : ''}${fmt(Math.abs(n))}`;

function SplitMatrix({ entries, accent, unitLabel, onDateClick, onVarianceClick }: {
  entries: MatrixEntry[]; accent: 'blue' | 'emerald'; unitLabel: string;
  onDateClick?: (date: string) => void;
  onVarianceClick?: (date: string, productId: number, productName: string) => void;
}) {
  const prodMap: Record<string, { name: string; color?: string | null }> = {};
  const pidOf: Record<string, number | undefined> = {};
  for (const e of entries) { prodMap[e.product_name] ??= { name: e.product_name, color: e.color }; if (e.product_id) pidOf[e.product_name] ??= e.product_id; }
  const products = sortByColorGroup(Object.values(prodMap), p => p.name, p => p.color);

  type Cell = { note: number; actual: number; adj: { counted: number; member: number; auto: number } };
  const cells: Record<string, Record<string, Cell>> = {};
  for (const e of entries) {
    const c = ((cells[e.date] ??= {})[e.product_name] ??= { note: 0, actual: 0, adj: { counted: 0, member: 0, auto: 0 } });
    c.note += Number(e.note ?? e.qty) || 0;
    c.actual += Number(e.qty) || 0;
    if (e.adjust) { c.adj.counted += e.adjust.counted || 0; c.adj.member += e.adjust.member || 0; c.adj.auto += e.adjust.auto || 0; }
  }
  const dates = Object.keys(cells).sort((a, b) => b.localeCompare(a));
  const sumDay = (d: string, k: 'note' | 'actual') => products.reduce((s, p) => s + (cells[d][p.name]?.[k] || 0), 0);
  const sumCol = (p: string, k: 'note' | 'actual') => dates.reduce((s, d) => s + (cells[d][p]?.[k] || 0), 0);
  const grand = (k: 'note' | 'actual') => dates.reduce((s, d) => s + sumDay(d, k), 0);

  const head = accent === 'emerald' ? 'bg-emerald-50 text-emerald-800' : 'bg-blue-50 text-blue-800';
  const diffCls = (n: number) => (n > 0 ? 'text-emerald-700' : n < 0 ? 'text-rose-700' : 'text-gray-900');
  const pillCls = (n: number) => (n > 0 ? 'bg-emerald-50 text-emerald-700 ring-emerald-200' : 'bg-rose-50 text-rose-700 ring-rose-200');
  const srcOf = (a: Cell['adj']) => (Object.keys(SRC) as (keyof Cell['adj'])[]).filter(k => a[k]);

  return (
    <div className="card p-0 overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm tabular-nums border-separate border-spacing-0">
          <thead>
            <tr>
              <th colSpan={2} className="sticky left-0 z-20 bg-gray-50 border-b border-r px-3 py-2.5 text-left text-xs font-medium text-gray-500 min-w-[210px]">วันที่</th>
              {products.map(p => {
                const { num, label } = parseProductLabel(p.name);
                return (
                  <th key={p.name} className="bg-gray-50 border-b px-2 py-2 text-center min-w-[96px]" title={p.name}>
                    <span className="flex flex-col items-center gap-0.5">
                      {p.color && <span className="w-3.5 h-3.5 rounded-full border border-gray-300 shrink-0" style={{ backgroundColor: p.color }} />}
                      <span className="text-xs font-semibold text-gray-700 leading-tight">{label}</span>
                      {num && <span className="text-[10px] font-mono text-gray-400 leading-none">{num}</span>}
                    </span>
                  </th>
                );
              })}
              <th className={`border-b border-l px-3 py-2.5 text-right text-xs font-semibold min-w-[96px] ${head}`}>รวม</th>
            </tr>
          </thead>
          <tbody>
            {dates.map((d, idx) => {
              const { main, sub } = thDate(d);
              const bg = idx % 2 ? 'bg-slate-50' : 'bg-white';
              const dayDiff = sumDay(d, 'actual') - sumDay(d, 'note');
              return [
                <tr key={d + 'n'} className="group">
                  <td rowSpan={2} className={`sticky left-0 z-10 border-b-2 border-gray-200 px-3 py-2 whitespace-nowrap align-middle w-[140px] ${bg}`}>
                    {onDateClick ? (
                      <button type="button" onClick={() => onDateClick(d)} title="คลิกเพื่อแก้ไขยอดของวันนี้"
                        className="inline-flex flex-col items-start hover:text-blue-700">
                        <span className="font-medium text-gray-800 inline-flex items-center gap-1">{main} <Pencil size={11} className="text-gray-300" /></span>
                        <span className="text-[11px] text-gray-400">{sub}</span>
                      </button>
                    ) : (<><span className="font-medium text-gray-800 block">{main}</span><span className="text-[11px] text-gray-400">{sub}</span></>)}
                  </td>
                  <td className={`sticky left-[140px] z-10 border-r border-b border-dashed border-gray-200 px-2 py-1 text-[11px] text-gray-400 whitespace-nowrap w-[70px] ${bg}`}>ใบส่งของ</td>
                  {products.map(p => {
                    const c = cells[d][p.name];
                    return (
                      <td key={p.name} className={`border-b border-dashed border-gray-200 px-2 py-1 text-center text-gray-500 ${bg}`}>
                        {c ? fmt(c.note) : <span className="text-gray-200">–</span>}
                      </td>
                    );
                  })}
                  <td className={`border-b border-dashed border-gray-200 border-l px-3 py-1 text-right text-gray-500 ${bg}`}>{fmt(sumDay(d, 'note'))}</td>
                </tr>,
                <tr key={d + 'a'} className="group">
                  <td className={`sticky left-[140px] z-10 border-r border-b-2 border-gray-200 px-2 py-1.5 text-[11px] font-semibold text-gray-700 whitespace-nowrap ${bg}`}>รับจริง</td>
                  {products.map(p => {
                    const c = cells[d][p.name];
                    if (!c) return <td key={p.name} className={`border-b-2 border-gray-200 px-2 py-1.5 text-center ${bg}`}><span className="text-gray-200">–</span></td>;
                    const diff = c.actual - c.note;
                    const srcs = srcOf(c.adj);
                    const clickable = diff !== 0 && onVarianceClick && pidOf[p.name];
                    const tip = diff !== 0
                      ? `ใบส่งของ ${fmt(c.note)} → รับจริง ${fmt(c.actual)} (${signed(diff)})\n` + srcs.map(k => `• ${SRC[k]} ${signed(c.adj[k])}`).join('\n') + (clickable ? '\nคลิกเพื่อดูรายละเอียด/ล้างส่วนต่าง' : '')
                      : undefined;
                    return (
                      <td key={p.name} className={`border-b-2 border-gray-200 px-2 py-1.5 text-center ${bg}`}>
                        <span title={tip}
                          {...(clickable ? {
                            role: 'button', tabIndex: 0,
                            className: 'inline-flex flex-col items-center cursor-pointer rounded px-1 -mx-1 hover:bg-amber-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300',
                            onClick: () => onVarianceClick!(d, pidOf[p.name]!, p.name),
                            onKeyDown: (e: any) => { if (e.key === 'Enter') onVarianceClick!(d, pidOf[p.name]!, p.name); },
                          } : { className: 'inline-flex flex-col items-center' })}>
                          <span className={`font-bold ${diffCls(diff)}`}>{fmt(c.actual)}</span>
                          {diff !== 0 && (
                            <span className={`mt-0.5 whitespace-nowrap rounded px-1 text-[10px] font-semibold leading-4 ring-1 ${pillCls(diff)}`}>
                              {signed(diff)} {srcs.length === 1 ? SRC_SHORT[srcs[0]] : srcs.length > 1 ? 'หลายที่มา' : ''}
                            </span>
                          )}
                        </span>
                      </td>
                    );
                  })}
                  <td className={`border-b-2 border-gray-200 border-l px-3 py-1.5 text-right ${bg}`}>
                    <span className={`font-bold ${accent === 'emerald' ? 'text-emerald-800' : 'text-blue-800'}`}>{fmt(sumDay(d, 'actual'))}</span>
                    {dayDiff !== 0 && <span className={`block text-[10px] font-semibold ${diffCls(dayDiff)}`}>{signed(dayDiff)}</span>}
                  </td>
                </tr>,
              ];
            })}
          </tbody>
          <tfoot>
            <tr>
              <td rowSpan={2} className="sticky left-0 z-10 bg-gray-100 px-3 py-2 font-bold text-gray-700 align-middle w-[140px]">รวมทั้งหมด</td>
              <td className="sticky left-[140px] z-10 bg-gray-100 border-r border-b border-dashed border-gray-300 px-2 py-1 text-[11px] text-gray-500">ใบส่งของ</td>
              {products.map(p => <td key={p.name} className="bg-gray-100 border-b border-dashed border-gray-300 px-2 py-1 text-center text-gray-500">{fmt(sumCol(p.name, 'note'))}</td>)}
              <td className="bg-gray-100 border-b border-dashed border-gray-300 border-l px-3 py-1 text-right text-gray-500">{fmt(grand('note'))}</td>
            </tr>
            <tr className="font-bold">
              <td className="sticky left-[140px] z-10 bg-gray-100 border-r px-2 py-2 text-[11px] text-gray-700">รับจริง</td>
              {products.map(p => {
                const df = sumCol(p.name, 'actual') - sumCol(p.name, 'note');
                return (
                  <td key={p.name} className="bg-gray-100 px-2 py-2 text-center text-gray-900">
                    {fmt(sumCol(p.name, 'actual'))}
                    {df !== 0 && <span className={`block text-[10px] ${diffCls(df)}`}>{signed(df)}</span>}
                  </td>
                );
              })}
              <td className={`border-l px-3 py-2 text-right ${accent === 'emerald' ? 'bg-emerald-100 text-emerald-900' : 'bg-blue-100 text-blue-900'}`}>{fmt(grand('actual'))}</td>
            </tr>
          </tfoot>
        </table>
      </div>
      <p className="px-4 py-2 text-[11px] text-gray-500 border-t leading-relaxed">
        หน่วย: {unitLabel} · แต่ละวันมี 2 แถว: <span className="text-gray-400">ใบส่งของ</span> = ยอดที่โรงงานเขียนมา ·{' '}
        <b>รับจริง</b> = ยอดที่ระบบใช้คิดสต็อก/ยอดรอเบิก · ป้าย <span className="text-rose-700 font-semibold">−</span>/<span className="text-emerald-700 font-semibold">+</span> = ส่วนต่างและที่มา:{' '}
        <b>กำหนด/นับเอง</b> (นับของตอนรับ หรือกำหนดยอดรับจริงของล็อต) · <b>จากใบเบิก</b> (แก้ยอดเบิกแบบสมาชิกนับในมัดได้ไม่ตรง) ·{' '}
        <b>ปิดล็อตอัตโนมัติ</b> (ล็อตเก่าคลาดไม่กี่เส้น ระบบปิดให้)
        {onVarianceClick && <> · <b>คลิกตัวเลขรับจริง</b> ที่มีป้าย เพื่อดูว่ามาจากใบไหน และย้อนกลับเป็นยอดตามใบส่งของได้</>}
        {onDateClick && <> · <Pencil size={10} className="inline -mt-0.5" /> คลิกวันที่เพื่อแก้ไขยอดของวันนั้น</>}
      </p>
    </div>
  );
}

export default memo(DateProductMatrix);
