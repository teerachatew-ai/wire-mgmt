import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { auditApi } from '../api';
import { History, Search, ChevronDown, ChevronUp, AlertTriangle, Loader2, Undo2 } from 'lucide-react';

/* ประวัติการแก้ไข — ทุกการกดบันทึกที่เปลี่ยนข้อมูล: ใคร เวลาไหน ทำอะไร แถวไหน ค่าเดิม → ค่าใหม่
   ข้อมูลมาจาก server/audit.ts (trigger จับทุกการเพิ่ม/แก้/ลบ) — เริ่มเก็บตั้งแต่วันที่เปิดใช้เมนูนี้ */

const isoOf = (d: Date) => new Intl.DateTimeFormat('en-CA').format(d);
const addDays = (iso: string, n: number) => { const d = new Date(iso + 'T00:00:00'); d.setDate(d.getDate() + n); return isoOf(d); };
const thDate = (iso: string) => new Date(iso.slice(0, 10) + 'T00:00:00').toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: '2-digit' });

const TABLE: Record<string, string> = {
  issues: 'ใบเบิก', returns: 'รับคืน', receives: 'ใบรับของ', shipments: 'ใบส่งงาน', shipment_items: 'รายการส่งงาน',
  stock_adjustments: 'ปรับยอดสต็อก', settings: 'ตั้งค่า', members: 'สมาชิก', products: 'สินค้า', managers: 'ผู้บริหาร',
  manager_month: 'ค่าตอบแทนผู้บริหาร', expenses: 'ค่าใช้จ่าย', recurring_expenses: 'ค่าใช้จ่ายประจำ', assets: 'สินทรัพย์',
  asset_repayments: 'คืนเงินสินทรัพย์', return_requests: 'คำขอคืนงาน', issue_requests: 'คำขอเบิกงาน',
};
const FIELD: Record<string, string> = {
  quantity: 'จำนวน', orig_quantity: 'ยอดฐานล็อต', actual_qty: 'ยอดรับจริง (นับ)', actual_note: 'หมายเหตุยอดนับ', actual_by: 'นับโดย', actual_at: 'เวลานับ',
  issued_at: 'วันที่เบิก', member_id: 'สมาชิก', product_id: 'สินค้า', lot_date: 'ล็อต', due_date: 'กำหนดคืน', status: 'สถานะ', notes: 'หมายเหตุ',
  issue_id: 'ใบเบิก', returned_at: 'วันที่คืน', good_qty: 'งานดี', defect_qty: 'งานเสีย', waste_qty: 'เศษเสีย', lost_qty: 'หาย',
  ng_cut: 'NG ตัดโดนสายไฟ', ng_rope: 'NG ดึงเชือก', ng_factory: 'NG โรงงาน', rework_qty: 'งานแก้ไข', pay_cycle: 'รอบค่าแรง', inspector: 'ผู้ตรวจ',
  received_at: 'วันที่รับ', factory_ref: 'เลขอ้างอิง', shipped_at: 'วันที่ส่ง', received_qty: 'โรงงานรับจริง', bill_ng_qty: 'NG โรงงานแจ้ง',
  adjusted_at: 'วันที่ปรับ', reason: 'เหตุผล', value: 'ค่า', key: 'หัวข้อ', name: 'ชื่อ', nickname: 'ชื่อเล่น', phone: 'โทร',
  bank_account: 'เลขบัญชี', bank_name: 'ธนาคาร', wage_per_unit: 'ค่าแรง/เส้น', factory_price: 'ราคาโรงงาน', amount: 'จำนวนเงิน',
  month: 'เดือน', description: 'รายละเอียด', code: 'เลขที่', created_by: 'บันทึกโดย', active: 'ใช้งาน',
};
// ช่องที่โชว์ตอน "เพิ่ม/ลบ" แถว (ที่เหลือซ่อนไว้ให้อ่านง่าย)
const KEY_FIELDS: Record<string, string[]> = {
  issues: ['quantity', 'lot_date', 'notes'],
  returns: ['good_qty', 'ng_factory', 'ng_cut', 'ng_rope', 'rework_qty', 'defect_qty', 'waste_qty', 'lost_qty', 'notes'],
  receives: ['quantity', 'actual_qty', 'factory_ref', 'notes'],
  shipment_items: ['good_qty', 'defect_qty', 'received_qty', 'bill_ng_qty'],
  shipments: ['notes'],
  stock_adjustments: ['quantity', 'reason'],
  settings: ['value'],
};
const CAT_STYLE: Record<string, string> = {
  'เบิก': 'bg-blue-50 text-blue-700 ring-blue-200', 'รับคืน': 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  'รับของ/ล็อต': 'bg-amber-50 text-amber-800 ring-amber-200', 'ส่งออก/วางบิล': 'bg-violet-50 text-violet-700 ring-violet-200',
  'การเงิน': 'bg-rose-50 text-rose-700 ring-rose-200', 'ข้อมูลหลัก': 'bg-slate-100 text-slate-700 ring-slate-200',
  'ตั้งค่า': 'bg-slate-100 text-slate-700 ring-slate-200', 'อื่นๆ': 'bg-gray-50 text-gray-600 ring-gray-200',
};
const OP: Record<string, [string, string]> = {
  insert: ['เพิ่ม', 'bg-emerald-100 text-emerald-800'], update: ['แก้', 'bg-amber-100 text-amber-800'], delete: ['ลบ', 'bg-rose-100 text-rose-800'],
};

function fmtVal(v: any) {
  if (v == null || v === '') return '—';
  if (typeof v === 'number') return v.toLocaleString('th-TH', { maximumFractionDigits: 3 });
  return String(v);
}

// เหตุผล/ค่าที่กรอกตอนกดบันทึก (จาก body) — แปลงเป็นภาษาคน
function reasonOf(e: any): string[] {
  const b = e.body;
  if (!b || typeof b !== 'object') return [];
  const out: string[] = [];
  if (b.reason === 'count') out.push('เหตุผล: นับในมัดได้ไม่ตรง (ปรับยอดรับจริงของล็อตตาม)');
  else if (b.reason === 'correction') out.push('เหตุผล: แก้พิมพ์ผิด (ไม่กระทบยอดรับของล็อต)');
  else if (typeof b.reason === 'string' && b.reason) out.push(`เหตุผล: ${b.reason}`);
  if (e.path === '/receives/lot-set-actual' && b.actual != null) out.push(`กำหนดยอดรับจริงของล็อต ${b.lot_date} = ${fmtVal(Number(b.actual))} เส้น`);
  if (e.path === '/receives/count-waiting' && b.counted_qty != null) out.push(`นับของหน้างานได้ ${fmtVal(Number(b.counted_qty))} เส้น`);
  if (e.path === '/receives/lot-reset') out.push(`ล้างส่วนต่างของล็อต ${b.lot_date}${b.clear_counted ? ' (รวมยอดนับเอง)' : ''}`);
  if (e.path === '/issues/transfer' && b.issued_at) out.push(`วันที่มีผล ${b.issued_at}`);
  if (b.adjust_issue) out.push('ปรับยอดเบิกให้เท่ายอดคืน');
  if (typeof b.note === 'string' && b.note) out.push(`หมายเหตุ: ${b.note}`);
  return out;
}

// แก้ยอดเบิกแบบ "นับในมัดไม่ตรง" = ยอดรับจริงของล็อตเปลี่ยนตาม — เตือนให้เห็นชัด
function lotImpact(c: any): string | null {
  if (c.t === 'issues' && c.op === 'update' && c.f?.quantity && !c.f?.orig_quantity) return 'ยอดรับจริงของล็อตเปลี่ยนตาม';
  if (c.t === 'receives' && c.op === 'update' && c.f?.actual_qty) return 'ยอดรับจริงของล็อตเปลี่ยน';
  return null;
}

function ChangeRow({ c }: { c: any }) {
  const [label, cls] = OP[c.op] || [c.op, 'bg-gray-100'];
  const impact = lotImpact(c);
  const keyFields = KEY_FIELDS[c.t];
  const rowFields = c.row ? Object.entries(c.row).filter(([k]) => keyFields ? keyFields.includes(k) : !['id', 'code', 'member_id', 'product_id', 'issue_id', 'created_by'].includes(k)).slice(0, 6) : [];
  return (
    <li className="py-2 flex gap-2.5 items-start">
      <span className={`shrink-0 mt-0.5 rounded px-1.5 py-0.5 text-[11px] font-bold ${cls}`}>{label}</span>
      <div className="min-w-0 flex-1">
        <div className="text-[13px] text-gray-800 break-words">
          <span className="text-gray-400 mr-1">{TABLE[c.t] || c.t}{c.t === 'settings' ? ':' : ''}</span>{c.label}
        </div>
        <div className="mt-1 flex flex-wrap gap-1.5">
          {c.op === 'update' && Object.entries(c.f || {}).map(([k, [o, n]]: any) => (
            <span key={k} className="inline-flex items-center gap-1 rounded-md bg-gray-50 ring-1 ring-gray-200 px-2 py-0.5 text-xs tabular-nums">
              <span className="text-gray-500">{FIELD[k] || k}</span>
              <span className="text-rose-700 line-through decoration-rose-300">{fmtVal(o)}</span>
              <span className="text-gray-400">→</span>
              <b className="text-gray-900">{fmtVal(n)}</b>
            </span>
          ))}
          {rowFields.map(([k, v]) => (
            <span key={k} className="inline-flex items-center gap-1 rounded-md bg-gray-50 ring-1 ring-gray-200 px-2 py-0.5 text-xs tabular-nums">
              <span className="text-gray-500">{FIELD[k] || k}</span><b className="text-gray-900">{fmtVal(v)}</b>
            </span>
          ))}
          {impact && (
            <span className="inline-flex items-center gap-1 rounded-md bg-amber-50 ring-1 ring-amber-300 px-2 py-0.5 text-xs font-semibold text-amber-800">
              <AlertTriangle size={12} /> {impact}
            </span>
          )}
        </div>
      </div>
    </li>
  );
}

const OP_UNDO: Record<string, string> = { insert: 'ลบรายการที่เพิ่ม', update: 'คืนค่าเดิม', delete: 'กู้คืนรายการที่ถูกลบ' };

function RevertDialog({ e, onClose }: { e: any; onClose: () => void }) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<{ error: string; conflicts?: string[] } | null>(null);
  const counts: Record<string, number> = {};
  for (const c of e.changes || []) counts[c.op] = (counts[c.op] || 0) + 1;
  const go = async () => {
    setBusy(true); setErr(null);
    try {
      await auditApi.revert(e.id);
      qc.invalidateQueries();   // ข้อมูลหลายหน้าเปลี่ยน (เบิก/สต็อก/ค่าแรง) — โหลดใหม่ทั้งหมด
      onClose();
    } catch (x: any) { setErr(x?.response?.data || { error: 'ย้อนไม่สำเร็จ' }); }
    finally { setBusy(false); }
  };
  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div role="dialog" aria-labelledby="revert-title" className="bg-white rounded-2xl shadow-2xl w-full max-w-md max-h-[90vh] flex flex-col overflow-hidden" onClick={x => x.stopPropagation()}>
        <div className="px-5 py-4 border-b bg-rose-50">
          <h3 id="revert-title" className="font-bold text-rose-900 flex items-center gap-2"><Undo2 size={18} /> ย้อนการกระทำนี้?</h3>
          <p className="text-xs text-rose-800/80 mt-0.5">{e.action} · {String(e.at_th).slice(11, 16)} น. {thDate(e.at_th)} · โดย {e.user || '-'}</p>
        </div>
        <div className="p-5 space-y-3 text-sm overflow-y-auto">
          <p className="text-gray-700">ระบบจะทำให้ข้อมูลกลับไปเหมือนก่อนกดบันทึกครั้งนี้:</p>
          <ul className="space-y-1">
            {Object.entries(counts).map(([op, n]) => (
              <li key={op} className="flex items-center gap-2">
                <span className={`rounded px-1.5 py-0.5 text-[11px] font-bold ${OP[op]?.[1] || ''}`}>{OP[op]?.[0] || op}</span>
                <span>{OP_UNDO[op]} <b>{n}</b> รายการ</span>
              </li>
            ))}
          </ul>
          {e.source === 'backfill' && (
            <p className="rounded-lg bg-amber-50 ring-1 ring-amber-200 px-3 py-2 text-xs text-amber-900">
              รายการนี้เป็นข้อมูลเก่า การย้อน = <b>ลบรายการที่สร้างไว้ทิ้ง</b> ยอดสต็อก/ค่าแรงที่เกี่ยวข้องจะเปลี่ยนตาม
            </p>
          )}
          <p className="text-xs text-gray-500">ถ้ามีแถวไหนถูกแก้ต่อหลังจากรายการนี้ ระบบจะไม่ย้อนเลยสักแถวและบอกว่าติดตรงไหน · การย้อนจะถูกบันทึกในประวัติด้วย</p>
          {err && (
            <div className="rounded-lg bg-rose-50 ring-1 ring-rose-200 px-3 py-2 text-xs text-rose-800 space-y-1">
              <b>{err.error}</b>
              {(err.conflicts || []).map((c, i) => <div key={i}>• {c}</div>)}
            </div>
          )}
        </div>
        <div className="border-t px-5 py-3 flex gap-2 justify-end">
          <button type="button" className="btn-secondary" onClick={onClose}>ยกเลิก</button>
          <button type="button" className="btn-primary !bg-rose-600 hover:!bg-rose-700 disabled:opacity-40" disabled={busy} onClick={go}>
            {busy ? 'กำลังย้อน...' : 'ย้อนเลย'}
          </button>
        </div>
      </div>
    </div>
  );
}

function EntryCard({ e }: { e: any }) {
  const [open, setOpen] = useState(false);
  const [asking, setAsking] = useState(false);
  const changes: any[] = e.changes || [];
  const shown = open ? changes : changes.slice(0, 4);
  const reasons = reasonOf(e);
  const time = String(e.at_th || '').slice(11, 16);
  return (
    <div className={`card !p-0 overflow-hidden ${e.reverted_at ? 'opacity-60' : ''}`}>
      <div className="px-4 py-3 flex items-start gap-3 border-b border-gray-100">
        <div className="text-lg font-bold tabular-nums text-gray-900 w-14 shrink-0">{time}</div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`font-semibold text-gray-900 ${e.reverted_at ? 'line-through decoration-gray-400' : ''}`}>{e.action}</span>
            <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ${CAT_STYLE[e.category] || CAT_STYLE['อื่นๆ']}`}>{e.category}</span>
            {e.source === 'backfill' && <span className="rounded-full px-2 py-0.5 text-[11px] font-semibold bg-slate-100 text-slate-600 ring-1 ring-slate-200">ย้อนหลัง</span>}
            {e.revert_of && <span className="rounded-full px-2 py-0.5 text-[11px] font-semibold bg-rose-100 text-rose-700">ย้อนรายการก่อนหน้า</span>}
            {e.reverted_at && <span className="rounded-full px-2 py-0.5 text-[11px] font-semibold bg-gray-200 text-gray-700">ย้อนแล้ว · {e.reverted_by || '-'} {String(e.reverted_at).slice(11, 16)} น.</span>}
            {e.status >= 400 && <span className="rounded-full px-2 py-0.5 text-[11px] font-semibold bg-rose-100 text-rose-700">ไม่สำเร็จ ({e.status})</span>}
          </div>
          <div className="text-xs text-gray-500 mt-0.5">โดย <b className="text-gray-700">{e.user || 'ไม่ระบุ'}</b> · {thDate(e.at_th)} · {e.n_changes} รายการเปลี่ยน</div>
          {e.approx_note && <div className="text-xs text-amber-800 mt-0.5">ⓘ {e.approx_note}</div>}
          {reasons.map((r, i) => <div key={i} className="text-xs text-blue-800 mt-0.5">{r}</div>)}
        </div>
        {e.revertable && (
          <button type="button" onClick={() => setAsking(true)} title="ย้อนการกระทำนี้"
            className="shrink-0 inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-semibold text-rose-700 ring-1 ring-rose-200 hover:bg-rose-50">
            <Undo2 size={14} /> ย้อน
          </button>
        )}
      </div>
      <ul className="px-4 divide-y divide-gray-100">
        {shown.map((c, i) => <ChangeRow key={i} c={c} />)}
      </ul>
      {changes.length > 4 && (
        <button type="button" onClick={() => setOpen(o => !o)}
          className="w-full px-4 py-2 text-xs font-semibold text-blue-700 hover:bg-blue-50 border-t border-gray-100 flex items-center justify-center gap-1">
          {open ? <><ChevronUp size={14} /> ย่อ</> : <><ChevronDown size={14} /> ดูทั้งหมด {e.n_changes} รายการ</>}
        </button>
      )}
      {e.n_changes > changes.length && open && (
        <p className="px-4 pb-2 text-[11px] text-gray-400">แสดง {changes.length} จาก {e.n_changes} รายการ (เก็บรายละเอียดสูงสุด 300 รายการต่อครั้ง)</p>
      )}
      {asking && <RevertDialog e={e} onClose={() => setAsking(false)} />}
    </div>
  );
}

export default function AuditLog() {
  const today = isoOf(new Date());
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(today);
  const [user, setUser] = useState('');
  const [category, setCategory] = useState('');
  const [q, setQ] = useState('');
  const [qLive, setQLive] = useState('');

  const { data: meta } = useQuery({ queryKey: ['audit-meta'], queryFn: auditApi.meta });
  const { data: entries = [], isLoading, isFetching } = useQuery({
    queryKey: ['audit', from, to, user, category, q],
    queryFn: () => auditApi.list({ from, to, user: user || undefined, category: category || undefined, q: q || undefined }),
  });

  // จัดกลุ่มตามวัน (กรณีเลือกหลายวัน)
  const byDay = useMemo(() => {
    const m = new Map<string, any[]>();
    for (const e of entries as any[]) { const d = String(e.at_th).slice(0, 10); if (!m.has(d)) m.set(d, []); m.get(d)!.push(e); }
    return [...m.entries()];
  }, [entries]);
  const catCount = useMemo(() => {
    const m: Record<string, number> = {};
    for (const e of entries as any[]) m[e.category] = (m[e.category] || 0) + 1;
    return m;
  }, [entries]);

  const quick = (a: string, b: string) => { setFrom(a); setTo(b); };
  const isRange = (a: string, b: string) => from === a && to === b;

  return (
    <div className="p-4 md:p-6 space-y-4 max-w-4xl mx-auto">
      <div className="flex items-center gap-2">
        <History size={20} className="text-blue-600" />
        <h1 className="text-xl font-bold text-gray-800">ประวัติการแก้ไข</h1>
        {isFetching && !isLoading && <Loader2 size={14} className="animate-spin text-gray-400" />}
      </div>
      <p className="text-xs text-gray-500 leading-relaxed">
        ทุกครั้งที่มีการบันทึก แก้ไข หรือลบข้อมูล จะถูกเก็บไว้ที่นี่: ใครทำ เวลาไหน และค่าเดิม → ค่าใหม่
        {meta?.since ? <> · บันทึกจริงเริ่ม <b>{thDate(meta.since)} {String(meta.since).slice(11, 16)} น.</b></> : <> · บันทึกจริงเริ่มวันนี้</>}
        {meta?.backfill_since && <> · ก่อนหน้านั้นเป็น<b>ข้อมูลย้อนหลัง</b>ที่สร้างจากข้อมูลในระบบ (ตั้งแต่ {thDate(meta.backfill_since)}) — มีเฉพาะการสร้างรายการและยอดที่มีเวลาบันทึกไว้ การแก้/ลบในอดีตที่ไม่มีร่องรอยกู้ไม่ได้</>}
      </p>

      <div className="card space-y-3">
        <div className="flex flex-wrap items-end gap-2">
          <div>
            <label className="label" htmlFor="audit-from">ตั้งแต่</label>
            <input id="audit-from" type="date" className="input !min-h-[38px] !py-1.5" value={from} max={to} onChange={e => setFrom(e.target.value)} />
          </div>
          <div>
            <label className="label" htmlFor="audit-to">ถึง</label>
            <input id="audit-to" type="date" className="input !min-h-[38px] !py-1.5" value={to} min={from} onChange={e => setTo(e.target.value)} />
          </div>
          <div className="flex gap-1.5">
            {[['วันนี้', today, today], ['เมื่อวาน', addDays(today, -1), addDays(today, -1)], ['7 วัน', addDays(today, -6), today], ['30 วัน', addDays(today, -29), today]].map(([l, a, b]) => (
              <button key={l} type="button" onClick={() => quick(a, b)}
                className={`rounded-lg px-3 py-2 text-sm font-medium ring-1 ${isRange(a, b) ? 'bg-blue-600 text-white ring-blue-600' : 'bg-white text-gray-700 ring-gray-300 hover:bg-gray-50'}`}>{l}</button>
            ))}
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-[180px_1fr] gap-2">
          <select aria-label="ผู้บันทึก" className="input !min-h-[38px] !py-1.5" value={user} onChange={e => setUser(e.target.value)}>
            <option value="">ทุกคน</option>
            {(meta?.users || []).map((u: string) => <option key={u} value={u}>{u}</option>)}
          </select>
          <form className="relative" onSubmit={e => { e.preventDefault(); setQ(qLive.trim()); }}>
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input aria-label="ค้นหา" className="input !min-h-[38px] !py-1.5 !pl-9" placeholder="ค้นหาเลขใบเบิก / ชื่อสมาชิก / รุ่นสินค้า แล้วกด Enter"
              value={qLive} onChange={e => { setQLive(e.target.value); if (!e.target.value) setQ(''); }} />
          </form>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <button type="button" onClick={() => setCategory('')}
            className={`rounded-full px-3 py-1 text-xs font-semibold ring-1 ${!category ? 'bg-gray-900 text-white ring-gray-900' : 'bg-white text-gray-600 ring-gray-300'}`}>
            ทั้งหมด {(entries as any[]).length > 0 && !category ? `(${(entries as any[]).length})` : ''}
          </button>
          {(meta?.categories || []).map((c: string) => (
            <button key={c} type="button" onClick={() => setCategory(category === c ? '' : c)}
              className={`rounded-full px-3 py-1 text-xs font-semibold ring-1 ${category === c ? 'bg-gray-900 text-white ring-gray-900' : `${CAT_STYLE[c] || ''}`}`}>
              {c}{catCount[c] && !category ? ` (${catCount[c]})` : ''}
            </button>
          ))}
        </div>
      </div>

      {isLoading ? (
        <div className="py-16 text-center text-gray-400"><Loader2 className="animate-spin mx-auto" size={22} /></div>
      ) : (entries as any[]).length === 0 ? (
        <div className="card text-center py-12 text-gray-500 text-sm">ไม่มีการแก้ไขในช่วงที่เลือก</div>
      ) : (
        byDay.map(([day, list]) => (
          <section key={day} className="space-y-2">
            {byDay.length > 1 && <h2 className="text-sm font-bold text-gray-600 pt-2">{thDate(day)} · {list.length} ครั้ง</h2>}
            {list.map((e: any) => <EntryCard key={e.id} e={e} />)}
          </section>
        ))
      )}
      {(entries as any[]).length >= 500 && <p className="text-center text-xs text-gray-400">แสดง 500 รายการล่าสุด — เลือกช่วงวันให้แคบลงเพื่อดูเพิ่ม</p>}
    </div>
  );
}
