import { memo } from 'react';
import { Eye, Pencil, RotateCcw, Trash2, X, History } from 'lucide-react';
import { parseProductLabel } from '../projectLabel';
import { sortByColorGroup } from '../productOrder';

const fmt = (n: number) => Number(n || 0).toLocaleString('th-TH', { maximumFractionDigits: 2 });

const TH_MONTH = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
// "2026-09-07" -> "7 ก.ย." — ป้ายล็อตต้องสั้นที่สุด ไม่งั้นตารางรก
export const shortLot = (iso: string) => {
  const [, m, d] = String(iso || '').split('-');
  return m && d ? `${Number(d)} ${TH_MONTH[Number(m) - 1]}` : String(iso || '');
};

/* ── ประวัติการคืนของใบเบิก (return_log จาก server: "วันที่|จำนวน|รอบค่าแรง;...") ──
   ค่าแรงคิดตาม "วันที่คืนของแต่ละครั้ง" — แบ่งคืน 2 ครั้งคร่อมวัน Cut-off = ค่าแรงแยกจ่าย 2 รอบ */
export type ReturnEntry = {
  date: string; qty: number; cycle: string;
  // แยกชนิดงานที่คืน (server ส่งมาต่อท้าย) — ข้อมูลเก่าที่ไม่มีช่องเหล่านี้ = 0
  good?: number; ngFactory?: number; ngCut?: number; ngRope?: number; rework?: number; lost?: number; uncut?: number;
  kind?: string; note?: string;
};
export const parseReturnLog = (log?: string | null): ReturnEntry[] =>
  String(log || '').split(';').filter(Boolean).map(x => {
    const [date, qty, cycle, good, ngf, ngc, ngr, rew, lost, uncut, kind, note] = x.split('|');
    const n = (v?: string) => Number(v) || 0;
    return { date, qty: n(qty), cycle: cycle || '', good: n(good), ngFactory: n(ngf), ngCut: n(ngc), ngRope: n(ngr),
      rework: n(rew), lost: n(lost), uncut: n(uncut), kind: kind || '', note: note || '' };
  });
// "2026-10" -> "รอบ ต.ค."
export const cycleLabel = (ym: string) => {
  const [, m] = String(ym || '').split('-');
  return m ? `รอบ ${TH_MONTH[Number(m) - 1]}` : '';
};
// รวมการคืนของหลายใบ (ทั้งแถว) ตามวันที่คืน — คืนพร้อมกันหลายชนิดงานวันเดียวกัน = 1 ครั้ง
export const groupReturns = (items: any[]): ReturnEntry[] => {
  const m = new Map<string, ReturnEntry>();
  for (const i of items) for (const e of parseReturnLog(i.return_log)) {
    const k = `${e.date}|${e.cycle}`;
    const g = m.get(k) || { date: e.date, qty: 0, cycle: e.cycle };
    g.qty += e.qty; m.set(k, g);
  }
  return [...m.values()].sort((a, b) => a.date.localeCompare(b.date));
};

// ชื่อสมาชิกบางคนมีชื่อเล่นพ่วงมาในชื่อจริงอยู่แล้ว -> ไม่ต้องต่อท้ายซ้ำอีก
const nickOf = (name: string, nickname?: string) =>
  nickname && !String(name || '').includes(nickname) ? nickname : '';

/* ตารางสรุปใบเบิกแบบ matrix — แถว = สมาชิก, คอลัมน์ = ประเภทงาน, แยกเป็นวันๆ
   อ่านทีเดียวเห็นทั้งวันว่าใครเบิกอะไรไปเท่าไหร่ ไม่ต้องไล่อ่านทีละใบ
   คอลัมน์ชื่อสมาชิกกับหัวตารางตรึงไว้ (sticky) เลื่อนดูงานหลายชนิดแล้วยังรู้ว่าแถวไหนของใคร */
// ช่องที่ถูกคลิก — ใบเบิกทุกใบของสมาชิกคนนี้ × งานชนิดนี้ × วันนี้ (ปกติ 1 ใบ แต่อาจเบิกหลายรอบในวันเดียว)
export interface MatrixCell { date: string; memberCode: string; memberName: string; productName: string; color?: string; items: any[] }
// แถวที่ถูกคลิก — ใบเบิกทุกใบของสมาชิกคนนี้ ทุกชนิดงาน ในวันนี้ (คลิกที่ชื่อ แก้ได้ทีเดียวทั้งแถว รวมทั้งย้ายวันที่)
export interface MatrixRow { date: string; memberCode: string; memberName: string; items: any[] }

function IssueMatrix({ issues, onOpen, onEdit, onEditRow, onReturnRow, onDeleteRow, onUndoReturnRow, onLateNgRow, onMoveLot, onHistoryRow }: {
  issues: any[]; onOpen?: (id: number) => void; onEdit?: (cell: MatrixCell) => void; onEditRow?: (row: MatrixRow) => void;
  onReturnRow?: (row: MatrixRow) => void;
  onDeleteRow?: (row: MatrixRow) => void;       // ลบใบเบิกทุกชนิดของคนนี้วันนี้ (ทั้งบรรทัด)
  onUndoReturnRow?: (row: MatrixRow) => void;   // ยกเลิกการรับคืน ให้กลับไปเป็นค้างส่งเหมือนเดิม
  onLateNgRow?: (row: MatrixRow) => void;       // แจ้ง NG ภายหลัง (โรงงานเจองานเสียหลังรับคืนแล้ว)
  onMoveLot?: (cell: MatrixCell) => void;        // คลิกป้ายล็อต → ย้ายล็อตของใบเบิกในช่องนั้น
  onHistoryRow?: (row: MatrixRow) => void;       // ดูประวัติการคืน (งานดี / NG โรงงาน / NG ตัดเสีย / ดึงเชือก …)
}) {
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
            qty: {} as Record<string, number>, items: {} as Record<string, any[]>,
            total: 0, returned: 0, lastReturnedAt: '',
          });
          m.qty[i.product_name] = (m.qty[i.product_name] || 0) + (Number(i.quantity) || 0);
          (m.items[i.product_name] ??= []).push(i);
          m.total += Number(i.quantity) || 0;
          m.returned += (Number(i.returned_good) || 0) + (Number(i.returned_defect) || 0) + (Number(i.returned_waste) || 0);
          // วันที่คืนงานล่าสุดของงานทุกชนิดที่เบิกวันนี้ — ใช้โชว์เป็น "วันที่คืนครบ" ตอนไม่มีค้างส่งแล้ว
          if (i.last_returned_at && i.last_returned_at > m.lastReturnedAt) m.lastReturnedAt = i.last_returned_at;
        }
        const members = Object.values(memMap).sort((a: any, b: any) =>
          String(a.code || '').localeCompare(String(b.code || ''), 'th'));

        const colTotal = (p: string) => members.reduce((s: number, m: any) => s + (m.qty[p] || 0), 0);
        const grandTotal = members.reduce((s: number, m: any) => s + m.total, 0);
        const grandPending = members.reduce((s: number, m: any) => s + Math.max(0, m.total - m.returned), 0);

        // รวมยอดแยกตามล็อต — ต่อชนิดงาน (ใต้ยอดรวมแต่ละคอลัมน์) และรวมทั้งวันข้ามทุกชนิดงาน (ใต้ยอดรวมทั้งวัน)
        // ไม่รู้ล็อต (ข้อมูลเก่าก่อนมีฟีเจอร์นี้) ไม่นับรวมในนี้ — โชว์เฉพาะที่รู้ล็อตจริง
        const lotByProduct: Record<string, Record<string, number>> = {};
        const lotGrand: Record<string, number> = {};
        for (const i of rows) {
          if (!i.lot_date) continue;
          const q = Number(i.quantity) || 0;
          (lotByProduct[i.product_name] ??= {})[i.lot_date] = (lotByProduct[i.product_name]?.[i.lot_date] || 0) + q;
          lotGrand[i.lot_date] = (lotGrand[i.lot_date] || 0) + q;
        }
        const lotChip = (lot: string, qty: number, key: string) => (
          <span key={key} className={`inline-block rounded px-1 py-px text-[9px] font-normal whitespace-nowrap border ${
            lot === date ? 'bg-white border-gray-300 text-gray-500' : 'bg-violet-50 border-violet-200 text-violet-600'}`}>
            {shortLot(lot)}: {fmt(qty)}
          </span>
        );

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
                          <span className="flex items-start gap-1.5">
                          {onDeleteRow && (
                            <button type="button"
                              onClick={() => onDeleteRow({ date, memberCode: m.code, memberName: m.name, items: Object.values(m.items).flat() })}
                              title="ลบใบเบิกทุกชนิดของคนนี้ในวันนี้ (ทั้งบรรทัด)"
                              className="mt-0.5 p-0.5 rounded text-gray-300 hover:text-red-600 hover:bg-red-50 shrink-0">
                              <Trash2 size={14} />
                            </button>
                          )}
                          <span className="min-w-0">
                          {onEditRow ? (
                            // คลิกที่ชื่อ -> แก้จำนวน/วันที่ของงานทุกชนิดที่คนนี้เบิกวันนี้ได้ทีเดียว (ทุกใบในแถว)
                            <button type="button"
                              onClick={() => onEditRow({ date, memberCode: m.code, memberName: m.name, items: Object.values(m.items).flat() })}
                              title="คลิกเพื่อแก้จำนวน/วันที่ของงานทุกชนิดที่คนนี้เบิกวันนี้"
                              className="text-left hover:underline decoration-dotted underline-offset-2 cursor-pointer">
                              <span className="font-mono text-[11px] text-gray-400 mr-1.5">{m.code}</span>
                              <span className="font-medium text-gray-800 hover:text-blue-700">{m.name}</span>
                              {nickOf(m.name, m.nickname) && <span className="text-xs text-gray-400"> ({m.nickname})</span>}
                            </button>
                          ) : (
                            <>
                              <span className="font-mono text-[11px] text-gray-400 mr-1.5">{m.code}</span>
                              <span className="font-medium text-gray-800">{m.name}</span>
                              {nickOf(m.name, m.nickname) && <span className="text-xs text-gray-400"> ({m.nickname})</span>}
                            </>
                          )}
                          </span>
                          </span>
                        </td>
                        {products.map(p => {
                          const v = m.qty[p.name] || 0;
                          const items: any[] = m.items[p.name] || [];
                          // ป้ายล็อต — โชว์ทุกครั้งที่รู้ล็อต จะได้ตรวจสอบย้อนกลับได้ทุกตัวเลข
                          // สีเทา = ล็อตวันเดียวกับที่เบิก (ปกติ) · สีม่วง = ล็อตวันอื่น (ของเก่าที่ยังแจกไม่หมด)
                          const lots = [...new Set(items.map((i: any) => i.lot_date).filter(Boolean))] as string[];
                          const otherLots = lots.filter(d => d !== date);
                          return (
                            <td key={p.name}
                              className={`border-b px-2 py-2 text-center ${idx % 2 ? 'bg-gray-50/60' : ''} group-hover:bg-blue-50/60`}>
                              {v > 0 ? (
                                onEdit ? (
                                  // คลิกแล้วแก้จำนวนได้ทันที ไม่ว่าช่องนั้นจะมีกี่ใบ
                                  <button type="button"
                                    onClick={() => onEdit({ date, memberCode: m.code, memberName: m.name, productName: p.name, color: p.color, items })}
                                    title={items.length > 1 ? `${items.length} ใบ — คลิกเพื่อแก้จำนวน` : 'คลิกเพื่อแก้จำนวน'}
                                    className="font-semibold text-gray-800 rounded px-1.5 -mx-1.5 hover:bg-blue-100 hover:text-blue-700 cursor-pointer">
                                    {fmt(v)}
                                  </button>
                                ) : onOpen && items.length === 1 ? (
                                  <button type="button" onClick={() => onOpen(items[0].id)}
                                    className="font-semibold text-gray-800 hover:text-blue-600 hover:underline">
                                    {fmt(v)}
                                  </button>
                                ) : (
                                  <span className="font-semibold text-gray-800">{fmt(v)}</span>
                                )
                              ) : (
                                <span className="text-gray-200">–</span>
                              )}
                              {(() => {
                                const ent = items.flatMap((i: any) => parseReturnLog(i.return_log));
                                const ngf = ent.reduce((t, e) => t + (e.ngFactory || 0), 0);
                                const ngm = ent.reduce((t, e) => t + (e.ngCut || 0) + (e.ngRope || 0), 0);
                                const other = ent.reduce((t, e) => t + (e.lost || 0) + (e.uncut || 0), 0);
                                if (!ngf && !ngm && !other) return null;
                                const parts = [ngf ? `NG รง. ${fmt(ngf)}` : '', ngm ? `NG ${fmt(ngm)}` : '', other ? `หาย/ไม่ตัด ${fmt(other)}` : ''].filter(Boolean);
                                return <div className="text-[10px] leading-tight text-rose-600 whitespace-nowrap" title="คลิก ดูการคืน ที่ช่องสถานะเพื่อดูรายละเอียด">{parts.join(' · ')}</div>;
                              })()}
                              {(lots.length > 0 || (onMoveLot && v > 0)) && (
                                <div className="mt-0.5 leading-none">
                                  {(() => {
                                    const cls = `inline-block rounded px-1 py-px text-[9px] font-medium whitespace-nowrap border ${
                                      otherLots.length > 0 ? 'bg-violet-50 border-violet-200 text-violet-600' : 'bg-gray-50 border-gray-200 text-gray-400'}`;
                                    const label = lots.length === 0 ? 'ไม่ระบุล็อต' : lots.length === 1 ? `ล็อต ${shortLot(lots[0])}` : `${lots.length} ล็อต`;
                                    const tip = lots.length === 0 ? 'ยังไม่ได้ระบุล็อต'
                                      : otherLots.length > 0
                                        ? `งานล็อตที่โรงงานส่งมาวันที่ ${otherLots.map(shortLot).join(', ')} (ไม่ใช่ล็อตวันเดียวกับที่เบิก)`
                                        : `งานล็อตที่โรงงานส่งมาวันที่ ${lots.map(shortLot).join(', ')}`;
                                    return onMoveLot ? (
                                      <button type="button" className={`${cls} cursor-pointer hover:border-blue-300 hover:text-blue-700 hover:bg-blue-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-300`}
                                        title={`${tip} — คลิกเพื่อย้ายล็อต`}
                                        onClick={() => onMoveLot({ date, memberCode: m.code, memberName: m.name, productName: p.name, color: p.color, items })}>
                                        {label}
                                      </button>
                                    ) : <span className={cls} title={tip}>{label}</span>;
                                  })()}
                                </div>
                              )}
                            </td>
                          );
                        })}
                        <td className={`border-b border-l px-3 py-2 text-right font-bold text-blue-800 ${idx % 2 ? 'bg-blue-50/50' : 'bg-blue-50/30'} group-hover:bg-blue-50`}>
                          {fmt(m.total)}
                        </td>
                        <td className={`border-b px-3 py-2 text-right ${idx % 2 ? 'bg-gray-50/60' : ''} group-hover:bg-blue-50/60`}>
                          {/* บรรทัดบน = สถานะหลัก (ยอดค้างส่ง/ส่งครบ) · บรรทัดล่าง = ข้อมูลรอง (คืนบางส่วน/วันที่คืน) + ปุ่ม Undo แบบไอคอนเล็ก
                              Undo จางไว้จนกว่าจะชี้ที่แถว (จอใหญ่) กันตาลายทั้งคอลัมน์ · จอมือถือไม่มี hover จึงโชว์ปกติ */}
                          <div className="flex flex-col items-end gap-0.5">
                            {pending > 0 ? (
                              onReturnRow ? (
                                // คลิกยอดค้างส่ง -> เปิดกล่องรับคืนงานทุกใบของคนนี้วันนี้ทีเดียว ไม่ต้องไปหน้า "รับคืนงาน" แยก
                                <button type="button"
                                  onClick={() => onReturnRow({ date, memberCode: m.code, memberName: m.name, items: Object.values(m.items).flat() })}
                                  title="คลิกเพื่อรับคืนงานของคนนี้"
                                  className="inline-flex items-center gap-1 font-semibold text-amber-600 rounded px-1.5 -mx-1.5 hover:bg-amber-100 hover:text-amber-800 cursor-pointer">
                                  {fmt(pending)} <RotateCcw size={11} className="opacity-60" />
                                </button>
                              ) : (
                                <span className="font-semibold text-amber-600">{fmt(pending)}</span>
                              )
                            ) : (
                              <span className="text-emerald-600 font-semibold" title={m.lastReturnedAt ? `ส่งครบแล้ว — คืนล่าสุด ${m.lastReturnedAt}` : 'ส่งครบแล้ว'}>✓</span>
                            )}
                            {(m.returned > 0 || (pending <= 0 && m.lastReturnedAt)) && (
                              <div className="flex items-center gap-1 leading-none">
                                {pending > 0 ? (
                                  <span className="text-[10px] font-medium text-sky-700 bg-sky-50 border border-sky-200 rounded-full px-1.5 py-0.5 whitespace-nowrap"
                                    title={`คืนแล้ว ${fmt(m.returned)} จาก ${fmt(m.total)}`}>คืนบางส่วน</span>
                                ) : m.lastReturnedAt && groupReturns(Object.values(m.items).flat()).length < 2 ? (
                                  <span className="text-[10px] text-gray-400" title={`คืนล่าสุด ${m.lastReturnedAt}`}>{shortLot(m.lastReturnedAt)}</span>
                                ) : null}
                                {onHistoryRow && m.returned > 0 && (
                                  <button type="button"
                                    onClick={() => onHistoryRow({ date, memberCode: m.code, memberName: m.name, items: Object.values(m.items).flat() })}
                                    title="ดูการคืน — งานดี / NG โรงงาน / NG ตัดเสีย / NG ดึงเชือก แยกตามครั้งที่คืน"
                                    className="inline-flex items-center gap-0.5 rounded border border-sky-200 bg-sky-50 px-1.5 py-px text-[10px] font-semibold text-sky-700 hover:bg-sky-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300 whitespace-nowrap">
                                    <History size={10} /> ดูการคืน
                                  </button>
                                )}
                                {onUndoReturnRow && m.returned > 0 && (
                                  <button type="button"
                                    onClick={() => onUndoReturnRow({ date, memberCode: m.code, memberName: m.name, items: Object.values(m.items).flat() })}
                                    title="Undo — ยกเลิกการรับคืน ให้กลับไปเป็นค้างส่ง"
                                    className="inline-flex items-center rounded border border-slate-200 bg-white px-1.5 py-px text-[10px] font-semibold tracking-wide text-slate-500 md:opacity-60 md:group-hover:opacity-100 focus-visible:opacity-100 hover:!text-rose-600 hover:border-rose-200 hover:bg-rose-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-300 transition whitespace-nowrap">
                                    Undo
                                  </button>
                                )}
                                {onLateNgRow && m.returned > 0 && (
                                  <button type="button"
                                    onClick={() => onLateNgRow({ date, memberCode: m.code, memberName: m.name, items: Object.values(m.items).flat() })}
                                    title="แจ้ง NG ภายหลัง — โรงงานเจองานตัดเสียของคนนี้หลังรับคืนแล้ว (หักค่าแรงย้อนหลัง)"
                                    className="inline-flex items-center rounded border border-rose-200 bg-white px-1.5 py-px text-[10px] font-semibold text-rose-600 md:opacity-60 md:group-hover:opacity-100 focus-visible:opacity-100 hover:bg-rose-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-300 transition whitespace-nowrap">
                                    + NG
                                  </button>
                                )}
                              </div>
                            )}
                            {(() => {
                              // แบ่งคืนหลายครั้ง -> บอกวันที่ จำนวน และรอบค่าแรงของแต่ละครั้ง (คร่อม Cut-off = ค่าแรงแยก 2 รอบ)
                              const log = groupReturns(Object.values(m.items).flat());
                              if (log.length < 2) return null;
                              const cycles = new Set(log.map(e => e.cycle).filter(Boolean));
                              return (
                                <div className="mt-0.5 text-[10px] leading-tight text-right whitespace-nowrap"
                                  title={log.map(e => `คืน ${e.date} ${fmt(e.qty)} เส้น → ค่าแรง${cycleLabel(e.cycle)}`).join('\n')}>
                                  <div className={`font-medium ${cycles.size > 1 ? 'text-violet-700' : 'text-gray-500'}`}>
                                    แบ่งคืน {log.length} ครั้ง{cycles.size > 1 && ` · ค่าแรง ${cycles.size} รอบ`}
                                  </div>
                                  {log.map(e => (
                                    <div key={`${e.date}|${e.cycle}`} className="text-gray-400 tabular-nums">
                                      {shortLot(e.date)} <span className="text-gray-600">{fmt(e.qty)}</span>
                                      {cycles.size > 1 && <span className="text-violet-600"> · {cycleLabel(e.cycle)}</span>}
                                    </div>
                                  ))}
                                </div>
                              );
                            })()}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr className="font-bold">
                    <td className="sticky left-0 z-10 bg-gray-100 border-r px-3 py-2.5 text-gray-700 align-top">รวมทั้งวัน</td>
                    {products.map(p => {
                      const lots = Object.entries(lotByProduct[p.name] || {}).sort(([a], [b]) => a.localeCompare(b));
                      return (
                        <td key={p.name} className="bg-gray-100 px-2 py-2.5 text-center text-gray-800 align-top">
                          <div>{fmt(colTotal(p.name))}</div>
                          {/* แยกตามล็อตเสมอ (แม้มีล็อตเดียว) ให้สอดคล้องกับป้ายล็อตที่โชว์ทุกช่องด้านบน */}
                          {lots.length > 0 && (
                            <div className="mt-1 flex flex-col items-center gap-0.5 font-normal">
                              {lots.map(([lot, qty]) => lotChip(lot, qty, lot))}
                            </div>
                          )}
                        </td>
                      );
                    })}
                    <td className="bg-blue-100 border-l px-3 py-2.5 text-right text-blue-900 align-top">
                      <div>{fmt(grandTotal)}</div>
                      {Object.keys(lotGrand).length > 0 && (
                        <div className="mt-1 flex flex-col items-end gap-0.5 font-normal">
                          {Object.entries(lotGrand).sort(([a], [b]) => a.localeCompare(b)).map(([lot, qty]) => lotChip(lot, qty, 'g' + lot))}
                        </div>
                      )}
                    </td>
                    <td className="bg-gray-100 px-3 py-2.5 text-right text-amber-700 align-top">{grandPending > 0 ? fmt(grandPending) : '–'}</td>
                  </tr>
                </tfoot>
              </table>
            </div>

            {(onEdit || onOpen || onEditRow || onReturnRow) && (
              <p className="px-4 py-2 text-[11px] text-gray-400 border-t flex flex-wrap items-center gap-x-4 gap-y-1">
                {onEdit && <span className="flex items-center gap-1.5"><Pencil size={12} /> คลิกที่ตัวเลขเพื่อแก้จำนวนเบิกได้ทันที (ถ้าวันนั้นมีหลายใบ จะแก้ได้ทีละใบในกล่องเดียว)</span>}
                {onEditRow && <span className="flex items-center gap-1.5"><Pencil size={12} /> คลิกที่ชื่อสมาชิกเพื่อแก้จำนวน/ย้ายวันที่ของงานทุกชนิดที่เบิกวันนั้นทีเดียว</span>}
                {onReturnRow && <span className="flex items-center gap-1.5"><RotateCcw size={12} /> คลิกที่ยอดค้างส่ง (สีส้ม) เพื่อรับคืนงานทุกชนิดที่ค้างของคนนั้นทีเดียว</span>}
                {onUndoReturnRow && <span className="flex items-center gap-1.5"><span className="rounded border border-slate-200 bg-white px-1 text-[10px] font-semibold text-slate-500">Undo</span> = ยกเลิกการรับคืน ให้กลับไปเป็นค้างส่ง</span>}
                {onLateNgRow && <span className="flex items-center gap-1.5"><span className="rounded border border-rose-200 bg-white px-1 text-[10px] font-semibold text-rose-600">+ NG</span> = โรงงานแจ้ง NG ภายหลัง (หักค่าแรงย้อนหลัง)</span>}
                {onDeleteRow && <span className="flex items-center gap-1.5"><Trash2 size={12} /> ถังขยะหน้าชื่อ = ลบใบเบิกทั้งบรรทัดของคนนั้น</span>}
                {!onEdit && onOpen && <span className="flex items-center gap-1.5"><Eye size={12} /> คลิกที่ตัวเลขเพื่อดูรายละเอียดใบเบิก (เฉพาะช่องที่มีใบเดียว)</span>}
                <span className="flex items-center gap-1.5 flex-wrap">
                  <span className="inline-block bg-gray-50 border border-gray-200 text-gray-400 rounded px-1 py-px text-[9px] font-medium">ล็อต 12 ก.ย.</span>
                  = ล็อตวันเดียวกับที่เบิก ·
                  <span className="inline-block bg-violet-50 border border-violet-200 text-violet-600 rounded px-1 py-px text-[9px] font-medium">ล็อต 7 ก.ย.</span>
                  = เบิกงานของล็อตที่โรงงานส่งมาวันอื่น
                </span>
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
}

// memo — ตารางนี้หนักที่สุดในหน้า (หลายสิบตาราง หลายพันช่อง)
// ไม่ต้องสร้างใหม่ถ้า issues ชุดเดิม (เช่นตอนกดปุ่มอื่น/เปิดกล่องในหน้าเดียวกัน)
export default memo(IssueMatrix);

/* ── หน้าต่าง "ดูการคืน" — ทุกครั้งที่คืนของสมาชิกคนนี้ (ใบเบิกวันเดียวกัน) แยกชนิดงานที่คืน ── */
export function ReturnHistoryDialog({ row, onClose }: { row: MatrixRow; onClose: () => void }) {
  const fmt = (n: number) => (n ? Number(n).toLocaleString('th-TH') : '–');
  const lines = row.items.flatMap((i: any) => parseReturnLog(i.return_log).map(e => ({ ...e, product: i.product_name, color: i.color, issued: Number(i.quantity) || 0 })))
    .sort((a, b) => a.date.localeCompare(b.date) || String(a.product).localeCompare(String(b.product)));
  const cols: { k: keyof ReturnEntry; label: string; cls: string }[] = [
    { k: 'good', label: 'งานดี', cls: 'text-emerald-700' },
    { k: 'ngFactory', label: 'NG โรงงาน', cls: 'text-orange-600' },
    { k: 'ngCut', label: 'NG ตัดเสีย', cls: 'text-rose-600' },
    { k: 'ngRope', label: 'NG ดึงเชือก', cls: 'text-rose-600' },
    { k: 'rework', label: 'งานแก้', cls: 'text-amber-700' },
    { k: 'lost', label: 'ของหาย', cls: 'text-gray-600' },
    { k: 'uncut', label: 'ไม่ได้ตัด', cls: 'text-gray-600' },
  ];
  const used = cols.filter(c => c.k === 'good' || lines.some(l => Number(l[c.k]) > 0));
  // สรุปต่อชนิดงาน
  const byProd = new Map<string, any>();
  for (const i of row.items) {
    const e = byProd.get(i.product_name) || { product: i.product_name, color: i.color, issued: 0 };
    e.issued += Number(i.quantity) || 0; byProd.set(i.product_name, e);
  }
  for (const l of lines) { const e = byProd.get(l.product)!; for (const c of used) e[c.k] = (e[c.k] || 0) + (Number(l[c.k]) || 0); }
  const name = (p: string) => { const { num, label } = parseProductLabel(p || ''); return `${label} ${num}`.trim() || p; };
  const dot = (c?: string) => c ? <span className="inline-block w-2.5 h-2.5 rounded-full border border-gray-300 mr-1.5 align-middle" style={{ background: c }} /> : null;
  return (
    <div className="fixed inset-0 z-[60] bg-black/40 flex items-center justify-center p-3" onClick={onClose}>
      <div role="dialog" aria-labelledby="rh-title" className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl max-h-[90vh] flex flex-col overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="px-5 py-4 border-b flex items-start gap-3">
          <span className="p-2 rounded-xl bg-sky-100 text-sky-700"><History size={18} /></span>
          <div className="flex-1">
            <h3 id="rh-title" className="font-bold text-gray-900">ประวัติการคืนงาน</h3>
            <p className="text-xs text-gray-500 mt-0.5"><span className="font-mono">{row.memberCode}</span> {row.memberName} · ใบเบิกวันที่ {shortLot(row.date)}</p>
          </div>
          <button type="button" onClick={onClose} aria-label="ปิด" className="text-gray-400 hover:text-gray-700"><X size={18} /></button>
        </div>
        <div className="p-5 space-y-5 overflow-y-auto">
          <section>
            <h4 className="text-xs font-semibold text-gray-500 mb-1.5">สรุปต่อชนิดงาน</h4>
            <div className="overflow-x-auto border rounded-xl">
              <table className="w-full text-sm tabular-nums">
                <thead className="bg-gray-50 text-xs text-gray-500">
                  <tr><th className="px-3 py-2 text-left">ชนิดงาน</th><th className="px-3 py-2 text-right">เบิก</th>
                    {used.map(c => <th key={c.k} className="px-3 py-2 text-right whitespace-nowrap">{c.label}</th>)}
                    <th className="px-3 py-2 text-right">ค้างคืน</th></tr>
                </thead>
                <tbody>
                  {[...byProd.values()].map(e => {
                    const back = used.reduce((t, c) => t + (c.k === 'rework' ? 0 : (e[c.k] || 0)), 0);
                    const pend = Math.max(0, e.issued - back);
                    return (
                      <tr key={e.product} className="border-t">
                        <td className="px-3 py-2 whitespace-nowrap">{dot(e.color)}{name(e.product)}</td>
                        <td className="px-3 py-2 text-right text-gray-500">{fmt(e.issued)}</td>
                        {used.map(c => <td key={c.k} className={`px-3 py-2 text-right font-semibold ${e[c.k] ? c.cls : 'text-gray-300'}`}>{fmt(e[c.k])}</td>)}
                        <td className={`px-3 py-2 text-right ${pend ? 'text-amber-600 font-semibold' : 'text-gray-300'}`}>{fmt(pend)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <p className="text-[11px] text-gray-500 mt-1">งานแก้นับอยู่ในงานดีแล้ว (หักค่าแรงบางส่วน) · NG โรงงาน/ของหาย ได้ค่าแรงเต็ม · NG ตัดเสีย/ดึงเชือก ได้ค่าแรงเต็มแล้วหักค่าปรับแยก (งานล็อตตั้งแต่ 28 ส.ค. 69)</p>
          </section>
          <section>
            <h4 className="text-xs font-semibold text-gray-500 mb-1.5">แยกตามครั้งที่คืน ({new Set(lines.map(l => l.date)).size} ครั้ง)</h4>
            {lines.length === 0 ? <p className="text-sm text-gray-400">ยังไม่มีการคืน</p> : (
              <div className="overflow-x-auto border rounded-xl">
                <table className="w-full text-sm tabular-nums">
                  <thead className="bg-gray-50 text-xs text-gray-500">
                    <tr><th className="px-3 py-2 text-left">วันที่คืน</th><th className="px-3 py-2 text-left">ชนิดงาน</th>
                      {used.map(c => <th key={c.k} className="px-3 py-2 text-right whitespace-nowrap">{c.label}</th>)}
                      <th className="px-3 py-2 text-left">รอบค่าแรง</th><th className="px-3 py-2 text-left">หมายเหตุ</th></tr>
                  </thead>
                  <tbody>
                    {lines.map((l, k) => (
                      <tr key={k} className={`border-t ${l.kind === 'late_ng' ? 'bg-rose-50/50' : ''}`}>
                        <td className="px-3 py-2 whitespace-nowrap">{shortLot(l.date)}</td>
                        <td className="px-3 py-2 whitespace-nowrap">{dot(l.color)}{name(l.product)}</td>
                        {used.map(c => {
                          const v = Number(l[c.k]) || 0;
                          // late_ng: งานดีติดลบ = หักส่วนที่ไม่ได้ตัดคืน (โชว์ – เพราะอยู่ในช่อง "ไม่ได้ตัด" แล้ว)
                          const show = c.k === 'good' && l.kind === 'late_ng' ? 0 : v;
                          return <td key={c.k} className={`px-3 py-2 text-right ${show ? c.cls + ' font-semibold' : 'text-gray-300'}`}>{fmt(show)}</td>;
                        })}
                        <td className="px-3 py-2 text-xs text-gray-500 whitespace-nowrap">{cycleLabel(l.cycle)}</td>
                        <td className="px-3 py-2 text-xs text-gray-600">{l.kind === 'late_ng' ? <span className="text-rose-600 font-medium">โรงงานแจ้งภายหลัง</span> : null}{l.kind === 'late_ng' && l.note ? ' · ' : ''}{l.note}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>
        <div className="border-t px-5 py-3 flex justify-end"><button type="button" className="btn-secondary" onClick={onClose}>ปิด</button></div>
      </div>
    </div>
  );
}
