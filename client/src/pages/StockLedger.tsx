import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { productApi, receiveApi, issueApi, shipmentApi } from '../api';
import { projectLabel, parseProductLabel } from '../projectLabel';
import { sortByColorGroup, colorPriority } from '../productOrder';
import ExportExcelButton from '../components/ExportExcelButton';
import { ClipboardList, ArrowDownToLine, ArrowUpFromLine, Boxes, ArrowDownUp, Loader2, Truck } from 'lucide-react';

/* บัตรสต็อกสินค้า — ไล่วันที่ลงมา เห็นของเข้า ของออก และยอดคงเหลือในตารางเดียว
   (แทนไฟล์ Excel 交货明细 ที่เคยทำมือ — แยกบล็อกซ้าย-ขวาแล้วต้องบวกยอดคงเหลือเอง)

   2 มุมมอง:
   1) สต็อกหน้างาน = รับเข้าจากโรงงาน − เบิกออกให้สมาชิก
      คือของที่ยังอยู่หน้างานรอแจกจ่าย — ตรงกับการ์ด "เทียบรับเข้า vs เบิกออก" ในหน้าใบเบิกงาน
      ค่าเริ่มต้นนับจาก STOCK_CUTOFF เพราะยอดสะสมช่วงก่อนหน้าไม่ตรงกับของจริงหน้างาน
      (แต่ยังเลือกดูย้อนก่อนหน้านั้นได้ ถ้าต้องการดูประวัติ)
   2) รับ-ส่ง โรงงาน = รับเข้าจากโรงงาน − ส่งงานออกโรงงาน (ยอดที่โรงงานรับจริงถ้ายืนยันแล้ว)
      ค่าเริ่มต้นดูทั้งหมด ไม่ตัดที่ STOCK_CUTOFF เพราะเป็นการกระทบยอดกับโรงงานย้อนหลัง */
const STOCK_CUTOFF = '2026-08-28';

const TH_M = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
const dateTH = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number);
  return `${d} ${TH_M[m - 1]} ${String((y + 543) % 100).padStart(2, '0')}`;
};
const monthTH = (ym: string) => {
  const [y, m] = ym.split('-').map(Number);
  return `${TH_M[m - 1]} ${y + 543}`;
};
const monthRange = (ym: string) => {
  const [y, m] = ym.split('-').map(Number);
  const last = new Date(y, m, 0).getDate();
  return { from: `${ym}-01`, to: `${ym}-${String(last).padStart(2, '0')}` };
};
const fmt = (n: number) => Number(n || 0).toLocaleString('th-TH', { maximumFractionDigits: 2 });
const isoOf = (d: Date) => new Intl.DateTimeFormat('en-CA').format(d);
const daysAgo = (n: number) => { const d = new Date(); d.setDate(d.getDate() - n); return isoOf(d); };

type Preset = 'all' | 'month' | '14d' | '7d' | 'custom';
type Mode = 'site' | 'factory';
type Move = { in: Record<number, number>; issue: Record<number, number>; ship: Record<number, number> };

// ช่องรับเข้า/จ่ายออก: 0 = "วันนี้ไม่มีความเคลื่อนไหว" แสดงเป็นขีดจาง อ่านง่ายกว่าเลขศูนย์เต็มตาราง
const Cell = ({ v, cls = '' }: { v: number; cls?: string }) =>
  v ? <span className={cls}>{fmt(v)}</span> : <span className="text-gray-300">–</span>;

// ช่องคงเหลือ: ต้องโชว์เลข 0 เสมอ เพราะ "เหลือ 0" เป็นข้อมูลจริง (ของหมด) คนละความหมายกับ "ไม่มีความเคลื่อนไหว"
const BalCell = ({ v }: { v: number }) => (
  <span className={v < 0 ? 'text-rose-600' : v === 0 ? 'text-gray-400' : 'text-slate-800'}>{fmt(v)}</span>
);

// แถว "ยกมา" = ยอดคงเหลือสะสมก่อนวันแรกของช่วงที่เลือก (ทำให้ยอดต่อเนื่องถูกต้องแม้กรองช่วงสั้นๆ)
const OpeningRow = ({ items, opening }: { items: any[]; opening: Record<number, number> }) => (
  <tr className="bg-amber-50/60 text-gray-600">
    <td className="sticky left-0 bg-amber-50/60 z-10 px-3 py-1.5 border-r text-xs">ยกมา</td>
    {items.map(p => <td key={'oi' + p.id} className="px-2 py-1.5 text-right text-gray-300">–</td>)}
    {items.map(p => <td key={'oo' + p.id} className="px-2 py-1.5 text-right text-gray-300">–</td>)}
    {items.map(p => (
      <td key={'ob' + p.id} className="px-2 py-1.5 text-right font-medium"><BalCell v={opening[p.id] || 0} /></td>
    ))}
  </tr>
);

export default function StockLedger() {
  const [mode, setMode] = useState<Mode>('factory');   // เปิดหน้ามาเจอ "รับ-ส่ง โรงงาน" ก่อน (ดูทั้งหมดย้อนหลังได้)
  const [scope, setScope] = useState('ALL');
  const [preset, setPreset] = useState<Preset>('month');   // เปิดหน้ามาเจอเดือนปัจจุบันก่อน
  const [month, setMonth] = useState(isoOf(new Date()).slice(0, 7));
  const [cFrom, setCFrom] = useState('');
  const [cTo, setCTo] = useState('');
  const [newestFirst, setNewestFirst] = useState(false);   // ค่าเริ่มต้น เก่า→ใหม่ (ยอดคงเหลือไหลลงตามธรรมชาติ)

  // สลับมุมมองแล้วคงช่วงวันที่เดิมไว้ — จะได้เทียบเดือนเดียวกันระหว่าง 2 มุมมองได้ทันที
  const switchMode = (m: Mode) => setMode(m);

  const mRange = monthRange(month);
  const fromDate =
    preset === 'all' ? '' :
    preset === 'month' ? mRange.from :
    preset === 'custom' ? cFrom :
    daysAgo(preset === '14d' ? 14 : 7);
  const toDate = preset === 'month' ? mRange.to : preset === 'custom' ? cTo : '';

  /* จุด "เริ่มเดินยอด" ของโหมดสต็อกหน้างาน = STOCK_CUTOFF (ยอดก่อนหน้านั้นไม่ตรงกับของจริงหน้างาน)
     ทำงานอัตโนมัติเมื่อช่วงที่ดูอยู่เริ่มตั้งแต่เส้นเริ่มนับเป็นต้นไป — ไม่ต้องมีปุ่มให้กดเอง
     ถ้าย้อนไปดูก่อนหน้านั้น (เช่น เลือกเดือน ก.ค.) จะเดินยอดจากวันแรกของระบบแทน = ดูประวัติได้
     แต่มีหมายเหตุใต้ตารางเตือนว่ายอดอาจไม่ตรงกับของจริง */
  const countFrom = mode === 'site' && !!fromDate && fromDate >= STOCK_CUTOFF ? STOCK_CUTOFF : '';

  // ใบเบิกทั้งหมดมี ~2,900 แถว (1.3 MB) — โหลดเต็มเฉพาะตอนต้องเดินยอดจากวันแรกของระบบจริงๆ
  const issuesFrom = mode === 'site' && !countFrom ? '' : STOCK_CUTOFF;

  const { data: products = [], isLoading: lp } = useQuery({ queryKey: ['products'], queryFn: productApi.list });
  const { data: receives = [], isLoading: lr } = useQuery({ queryKey: ['receives', 'ledger'], queryFn: () => receiveApi.list() });
  const { data: shipments = [], isLoading: ls } = useQuery({ queryKey: ['shipments', 'ledger'], queryFn: () => shipmentApi.list() });
  const { data: issues = [], isLoading: li } = useQuery({
    queryKey: ['issues', 'ledger', issuesFrom || 'all'],
    queryFn: () => issueApi.list(issuesFrom ? { from: issuesFrom } : {}),
  });
  const loading = lp || lr || ls || li;

  const outLabel = mode === 'site' ? 'เบิกออกให้สมาชิก' : 'ส่งงานออกโรงงาน';
  const balLabel = mode === 'site' ? 'คงเหลือหน้างาน' : 'ส่วนต่างสะสม';

  // ── รวมความเคลื่อนไหวรายวัน ──
  const { dates, moves } = useMemo(() => {
    const moves = new Map<string, Move>();
    const at = (d: string) => {
      let m = moves.get(d);
      if (!m) { m = { in: {}, issue: {}, ship: {} }; moves.set(d, m); }
      return m;
    };
    for (const r of (receives as any[])) {
      const m = at(String(r.received_at).slice(0, 10));
      m.in[r.product_id] = (m.in[r.product_id] || 0) + (Number(r.quantity) || 0);
    }
    for (const i of (issues as any[])) {
      const m = at(String(i.issued_at).slice(0, 10));
      m.issue[i.product_id] = (m.issue[i.product_id] || 0) + (Number(i.quantity) || 0);
    }
    for (const s of (shipments as any[])) {
      const m = at(String(s.shipped_at).slice(0, 10));
      for (const it of (s.items || [])) {
        // ยอดที่โรงงานรับจริง (received_qty) ถ้ายืนยันแล้ว มิฉะนั้นใช้ยอดที่บันทึกส่ง
        const qty = (it.received_qty ?? it.good_qty ?? 0) + (it.defect_qty || 0);
        m.ship[it.product_id] = (m.ship[it.product_id] || 0) + qty;
      }
    }
    return { dates: [...moves.keys()].sort(), moves };
  }, [receives, issues, shipments]);

  // ── จัดสินค้าเป็นกลุ่มงาน เรียงสีเดียวกันติดกัน (กติกาเดียวกับรายงานค่าแรง/ตาราง matrix) ──
  const groups = useMemo(() => {
    const byProject = new Map<string, any[]>();
    for (const p of (products as any[])) {
      const k = p.project || 'อื่นๆ';
      if (!byProject.has(k)) byProject.set(k, []);
      byProject.get(k)!.push(p);
    }
    return [...byProject.entries()]
      .map(([key, items]) => ({ key, items: sortByColorGroup(items, (p: any) => p.name, (p: any) => p.color) }))
      .sort((a, b) => colorPriority(a.items[0]?.color) - colorPriority(b.items[0]?.color) || a.key.localeCompare(b.key));
  }, [products]);

  // ── เดินยอดทีละวัน เก็บเฉพาะแถวที่อยู่ในช่วงที่เลือก ──
  const ledger = useMemo(() => {
    const bal: Record<number, number> = {};
    const rows = new Map<string, any[]>();
    const opening: Record<number, number> = {};
    let captured = false;

    for (const d of dates) {
      if (countFrom && d < countFrom) continue;      // ก่อนจุดเริ่มเดินยอด = ไม่นับเลย
      if (toDate && d > toDate) break;
      const mv = moves.get(d)!;
      const outMap = mode === 'site' ? mv.issue : mv.ship;
      const inRange = !fromDate || d >= fromDate;
      if (inRange && !captured) { Object.assign(opening, bal); captured = true; }

      for (const [pid, q] of Object.entries(mv.in)) bal[+pid] = (bal[+pid] || 0) + q;
      for (const [pid, q] of Object.entries(outMap)) bal[+pid] = (bal[+pid] || 0) - q;
      if (!inRange) continue;

      for (const g of groups) {
        if (!g.items.some((p: any) => mv.in[p.id] || outMap[p.id])) continue;   // กลุ่มนี้ไม่มีความเคลื่อนไหววันนี้
        const snap: Record<number, number> = {};
        for (const p of g.items) snap[p.id] = bal[p.id] || 0;
        if (!rows.has(g.key)) rows.set(g.key, []);
        rows.get(g.key)!.push({ date: d, in: mv.in, out: outMap, bal: snap });
      }
    }
    if (!captured) Object.assign(opening, bal);
    return { rows, opening, closing: bal };
  }, [dates, moves, groups, fromDate, toDate, countFrom, mode]);

  const shownGroups = groups.filter(g => scope === 'ALL' || g.key === scope);

  const summary = useMemo(() => {
    let tin = 0, tout = 0, closing = 0;
    for (const g of shownGroups) {
      for (const r of (ledger.rows.get(g.key) || [])) {
        for (const p of g.items) { tin += r.in[p.id] || 0; tout += r.out[p.id] || 0; }
      }
      for (const p of g.items) closing += ledger.closing[p.id] || 0;
    }
    return { tin, tout, closing };
  }, [shownGroups, ledger]);

  const exportRows = useMemo(() => {
    const out: Record<string, any>[] = [];
    for (const g of shownGroups) {
      for (const r of (ledger.rows.get(g.key) || [])) {
        const row: Record<string, any> = { 'กลุ่มงาน': projectLabel(g.key), 'วันที่': r.date };
        for (const p of g.items) {
          const { num, label } = parseProductLabel(p.name);
          const n = `${num} ${label}`;
          row[`รับเข้า ${n}`] = r.in[p.id] || 0;
          row[`${outLabel} ${n}`] = r.out[p.id] || 0;
          row[`${balLabel} ${n}`] = r.bal[p.id] || 0;
        }
        out.push(row);
      }
    }
    return out;
  }, [shownGroups, ledger, outLabel, balLabel]);

  const pill = (active: boolean) =>
    `px-2.5 py-1 rounded-lg text-sm border transition ${active ? 'bg-slate-800 text-white border-slate-800' : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'}`;
  const datePill = (active: boolean) =>
    `px-2.5 py-1 rounded-lg text-sm border transition ${active ? 'bg-blue-600 text-white border-blue-600' : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'}`;

  // ป้ายอธิบายช่วงที่กำลังดูอยู่ (ให้รู้ทันทีว่ายอดคงเหลือคิดจากตรงไหน)
  const rangeNote =
    preset === 'all' ? 'ดูทั้งหมดตั้งแต่วันแรกของระบบ' :
    preset === 'month' ? `เดือน ${monthTH(month)}` : '';

  return (
    <div className="p-4 md:p-6 space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <ClipboardList size={20} className="text-blue-600" />
        <h1 className="text-xl font-bold text-gray-800">สต็อกสินค้า — เข้า / ออก / คงเหลือ</h1>
        {rangeNote && (
          <span className="text-xs bg-amber-50 border border-amber-200 text-amber-700 rounded-lg px-2 py-0.5">{rangeNote}</span>
        )}
      </div>

      <div className="card space-y-3">
        {/* มุมมอง */}
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-xs text-gray-500 mr-1">มุมมอง:</span>
          <button onClick={() => switchMode('factory')} className={`${pill(mode === 'factory')} flex items-center gap-1.5`}>
            <Truck size={13} /> รับ-ส่ง โรงงาน
          </button>
          <button onClick={() => switchMode('site')} className={`${pill(mode === 'site')} flex items-center gap-1.5`}>
            <Boxes size={13} /> สต็อกหน้างาน
          </button>
          <span className="text-xs text-gray-400 ml-1">
            {mode === 'site' ? 'ของที่ยังอยู่หน้างานรอแจกจ่าย = รับเข้า − เบิกออกให้สมาชิก' : 'เทียบของที่รับจากโรงงาน กับที่ส่งกลับไปโรงงาน (ดูย้อนหลังได้ทั้งหมด)'}
          </span>
        </div>

        {/* กลุ่มงาน */}
        <div className="flex flex-wrap items-center gap-1.5 border-t pt-3">
          <span className="text-xs text-gray-500 mr-1">กลุ่มงาน:</span>
          <button onClick={() => setScope('ALL')} className={pill(scope === 'ALL')}>ทุกกลุ่ม</button>
          {groups.map(g => (
            <button key={g.key} onClick={() => setScope(g.key)} className={`${pill(scope === g.key)} flex items-center gap-1.5`}>
              <span className="w-2.5 h-2.5 rounded-full border border-gray-300 shrink-0" style={{ backgroundColor: g.items[0]?.color || '#ccc' }} />
              {projectLabel(g.key)}
            </button>
          ))}
        </div>

        {/* ช่วงวันที่ + เรียงลำดับ + export */}
        <div className="flex flex-wrap items-center gap-2 border-t pt-3">
          <span className="text-xs text-gray-500">ช่วงวันที่:</span>
          <button onClick={() => setPreset('month')} className={datePill(preset === 'month')}>รายเดือน</button>
          <button onClick={() => setPreset('all')} className={datePill(preset === 'all')}>ทั้งหมด</button>
          <button onClick={() => setPreset('14d')} className={datePill(preset === '14d')}>14 วันล่าสุด</button>
          <button onClick={() => setPreset('custom')} className={datePill(preset === 'custom')}>กำหนดเอง</button>

          {preset === 'month' && (
            <input type="month" className="input w-40 text-sm" value={month} onChange={e => setMonth(e.target.value || month)} />
          )}
          {preset === 'custom' && (
            <>
              <input type="date" className="input w-36 text-sm" value={cFrom} onChange={e => setCFrom(e.target.value)} />
              <span className="text-gray-400 text-sm">ถึง</span>
              <input type="date" className="input w-36 text-sm" value={cTo} onChange={e => setCTo(e.target.value)} />
            </>
          )}

          <div className="ml-auto flex items-center gap-2">
            <button onClick={() => setNewestFirst(v => !v)} className="btn-secondary btn-sm flex items-center gap-1.5" title="สลับลำดับวันที่">
              <ArrowDownUp size={14} /> {newestFirst ? 'ใหม่ → เก่า' : 'เก่า → ใหม่'}
            </button>
            <ExportExcelButton filename={`สต็อกสินค้า-${isoOf(new Date())}`} rows={exportRows} />
          </div>
        </div>
      </div>

      {/* ── สรุปยอดรวม ─────────────────────────────────────── */}
      <div className="grid grid-cols-3 gap-3">
        <div className="card !p-3 border-l-4 border-l-emerald-500">
          <div className="flex items-center gap-1.5 text-xs text-gray-500"><ArrowDownToLine size={13} className="text-emerald-600" /> รับเข้าในช่วงนี้</div>
          <div className="text-xl font-bold text-emerald-700 tabular-nums mt-0.5">{fmt(summary.tin)}</div>
        </div>
        <div className="card !p-3 border-l-4 border-l-blue-500">
          <div className="flex items-center gap-1.5 text-xs text-gray-500"><ArrowUpFromLine size={13} className="text-blue-600" /> {outLabel}ในช่วงนี้</div>
          <div className="text-xl font-bold text-blue-700 tabular-nums mt-0.5">{fmt(summary.tout)}</div>
        </div>
        <div className="card !p-3 border-l-4 border-l-slate-700">
          <div className="flex items-center gap-1.5 text-xs text-gray-500"><Boxes size={13} className="text-slate-700" /> {balLabel} (ล่าสุดของช่วง)</div>
          <div className={`text-xl font-bold tabular-nums mt-0.5 ${summary.closing < 0 ? 'text-rose-600' : 'text-slate-800'}`}>{fmt(summary.closing)}</div>
        </div>
      </div>

      {loading && <div className="card text-center text-gray-400 py-8"><Loader2 size={20} className="animate-spin mx-auto" /></div>}

      {/* ── ตารางแยกตามกลุ่มงาน ────────────────────────────── */}
      {!loading && shownGroups.map(g => {
        const rows = ledger.rows.get(g.key) || [];
        const view = newestFirst ? [...rows].reverse() : rows;
        const gIn = g.items.reduce((s: number, p: any) => s + rows.reduce((a: number, r: any) => a + (r.in[p.id] || 0), 0), 0);
        const gOut = g.items.reduce((s: number, p: any) => s + rows.reduce((a: number, r: any) => a + (r.out[p.id] || 0), 0), 0);
        const gBal = g.items.reduce((s: number, p: any) => s + (ledger.closing[p.id] || 0), 0);
        const hasOpening = g.items.some((p: any) => ledger.opening[p.id]);

        return (
          <div key={g.key} className="card !p-0 overflow-hidden">
            <div className="flex flex-wrap items-center gap-2 px-4 py-2.5 bg-slate-50 border-b">
              <span className="w-3 h-3 rounded-full border border-gray-300 shrink-0" style={{ backgroundColor: g.items[0]?.color || '#ccc' }} />
              <span className="font-semibold text-gray-800">{projectLabel(g.key)}</span>
              <span className="text-xs text-gray-400">{g.key}</span>
              <span className="ml-auto flex items-center gap-3 text-xs tabular-nums">
                <span className="text-emerald-700">รับเข้า <b>{fmt(gIn)}</b></span>
                <span className="text-blue-700">{outLabel} <b>{fmt(gOut)}</b></span>
                <span className={gBal < 0 ? 'text-rose-600' : 'text-slate-800'}>{balLabel} <b>{fmt(gBal)}</b></span>
              </span>
            </div>

            {rows.length === 0 ? (
              <div className="px-4 py-6 text-center text-sm text-gray-400">ไม่มีความเคลื่อนไหวในช่วงวันที่ที่เลือก</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm tabular-nums">
                  <thead>
                    <tr className="text-xs">
                      <th className="sticky left-0 bg-white z-10 px-3 py-1.5 text-left font-medium text-gray-500 border-b border-r">วันที่</th>
                      <th colSpan={g.items.length} className="px-2 py-1.5 bg-emerald-50 text-emerald-800 font-semibold border-b border-r">📦 รับเข้าจากโรงงาน</th>
                      <th colSpan={g.items.length} className="px-2 py-1.5 bg-blue-50 text-blue-800 font-semibold border-b border-r">{mode === 'site' ? '👤' : '🚚'} {outLabel}</th>
                      <th colSpan={g.items.length} className="px-2 py-1.5 bg-slate-100 text-slate-800 font-semibold border-b">📊 {balLabel}</th>
                    </tr>
                    <tr className="text-[11px] text-gray-500">
                      <th className="sticky left-0 bg-white z-10 border-b border-r px-3 py-1" />
                      {(['in', 'out', 'bal'] as const).map(kind => g.items.map((p: any, i: number) => {
                        const { num, label } = parseProductLabel(p.name);
                        const last = i === g.items.length - 1;
                        return (
                          <th key={kind + p.id} className={`px-2 py-1 text-right font-medium border-b whitespace-nowrap ${last ? 'border-r' : ''} ${kind === 'in' ? 'bg-emerald-50/40' : kind === 'out' ? 'bg-blue-50/40' : 'bg-slate-50'}`}>
                            <div className="font-semibold text-gray-700">{num}</div>
                            <div className="text-[10px] font-normal text-gray-400">{label}</div>
                          </th>
                        );
                      }))}
                    </tr>
                  </thead>
                  <tbody>
                    {hasOpening && !newestFirst && <OpeningRow items={g.items} opening={ledger.opening} />}

                    {view.map((r: any) => (
                      <tr key={r.date} className="border-b border-gray-50 hover:bg-blue-50/30">
                        <td className="sticky left-0 bg-white z-10 px-3 py-1.5 border-r whitespace-nowrap text-gray-700" title={r.date}>{dateTH(r.date)}</td>
                        {g.items.map((p: any) => <td key={'i' + p.id} className="px-2 py-1.5 text-right bg-emerald-50/20"><Cell v={r.in[p.id] || 0} cls="text-emerald-700 font-medium" /></td>)}
                        {g.items.map((p: any) => <td key={'o' + p.id} className="px-2 py-1.5 text-right bg-blue-50/20"><Cell v={r.out[p.id] || 0} cls="text-blue-700 font-medium" /></td>)}
                        {g.items.map((p: any) => (
                          <td key={'b' + p.id} className="px-2 py-1.5 text-right bg-slate-50/60 font-semibold"><BalCell v={r.bal[p.id] || 0} /></td>
                        ))}
                      </tr>
                    ))}

                    {hasOpening && newestFirst && <OpeningRow items={g.items} opening={ledger.opening} />}
                  </tbody>
                  <tfoot>
                    <tr className="bg-gray-50 font-semibold border-t-2">
                      <td className="sticky left-0 bg-gray-50 z-10 px-3 py-2 border-r text-gray-700 leading-tight">
                        รวมช่วงนี้
                        <div className="text-[10px] font-normal text-gray-400">{balLabel} = ยอดล่าสุด</div>
                      </td>
                      {g.items.map((p: any) => (
                        <td key={'ti' + p.id} className="px-2 py-2 text-right text-emerald-800">
                          <Cell v={rows.reduce((a: number, r: any) => a + (r.in[p.id] || 0), 0)} />
                        </td>
                      ))}
                      {g.items.map((p: any) => (
                        <td key={'to' + p.id} className="px-2 py-2 text-right text-blue-800">
                          <Cell v={rows.reduce((a: number, r: any) => a + (r.out[p.id] || 0), 0)} />
                        </td>
                      ))}
                      {g.items.map((p: any) => (
                        <td key={'tb' + p.id} className={`px-2 py-2 text-right ${(ledger.closing[p.id] || 0) < 0 ? 'text-rose-600' : 'text-slate-900'}`}>
                          {fmt(ledger.closing[p.id] || 0)}
                        </td>
                      ))}
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </div>
        );
      })}

      <p className="text-xs text-gray-400 px-1 leading-relaxed">
        {mode === 'site'
          ? <><b>สต็อกหน้างาน = รับเข้าจากโรงงาน − เบิกออกให้สมาชิก</b> คือของที่ยังอยู่หน้างานรอแจกจ่าย (ยังไม่รวมงานที่สมาชิกคืนกลับมาแล้วรอส่งโรงงาน)
              {countFrom
                ? <> · เดินยอดตั้งแต่ <b>{dateTH(STOCK_CUTOFF)}</b> เป็นต้นมา ซึ่งเป็นยอดที่ตรงกับของจริงหน้างาน</>
                : <> · ช่วงนี้ย้อนไปก่อน {dateTH(STOCK_CUTOFF)} ยอดคงเหลืออาจไม่ตรงกับของจริงหน้างาน (ใช้ดูประวัติเท่านั้น)</>}</>
          : <><b>ส่วนต่างสะสม = รับเข้าจากโรงงาน − ส่งงานออกโรงงาน</b> · ส่งออกใช้ยอดที่โรงงานรับจริงถ้ายืนยันแล้ว · ดูย้อนหลังได้ทั้งหมด ไม่ตัดที่เส้นเริ่มนับสต็อก</>}
        {' '}· <span className="text-rose-600">ติดลบ</span> = จ่ายออกมากกว่าที่รับเข้าในช่วงนี้ (ใช้ของค้างจากรอบก่อน)
      </p>
    </div>
  );
}
