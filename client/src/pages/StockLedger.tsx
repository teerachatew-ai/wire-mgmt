import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { productApi, receiveApi, shipmentApi } from '../api';
import { projectLabel, parseProductLabel } from '../projectLabel';
import { sortByColorGroup, colorPriority } from '../productOrder';
import ExportExcelButton from '../components/ExportExcelButton';
import { ClipboardList, ArrowDownToLine, ArrowUpFromLine, Boxes, ArrowDownUp, Loader2 } from 'lucide-react';

/* บัตรสต็อกสินค้า — ไล่วันที่ลงมา เห็น "รับเข้าจากโรงงาน / ส่งออกไปโรงงาน / คงเหลือสะสม" ในตารางเดียว
   (แทนไฟล์ Excel 交货明细 ที่เคยทำมือ — แยกบล็อกซ้าย-ขวาแล้วต้องบวกยอดคงเหลือเอง)

   กติกาตัวเลข (ให้ตรงกับหน้า "สต็อค & ตรวจสอบ" เป๊ะ):
   - รับเข้า  = receives.quantity
   - ส่งออก  = ยอดที่โรงงานรับจริง (received_qty) ถ้ายืนยันแล้ว มิฉะนั้นใช้ยอดที่บันทึกส่ง (good_qty) + defect_qty
   - คงเหลือ = รับเข้าสะสม − ส่งออกสะสม (สะสมตั้งแต่วันแรกของระบบเสมอ ไม่ขึ้นกับช่วงวันที่ที่กรอง)
     ช่วงวันที่มีผลแค่ "แสดงแถวไหน" — ยอดยกมาต้นช่วงจึงยังถูกต้องแม้เลือกดูแค่ 30 วันล่าสุด */

const TH_M = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
const dateTH = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number);
  return `${d} ${TH_M[m - 1]} ${String((y + 543) % 100).padStart(2, '0')}`;
};
const fmt = (n: number) => Number(n || 0).toLocaleString('th-TH', { maximumFractionDigits: 2 });
const isoOf = (d: Date) => new Intl.DateTimeFormat('en-CA').format(d);
const daysAgo = (n: number) => { const d = new Date(); d.setDate(d.getDate() - n); return isoOf(d); };

type Preset = '30d' | '90d' | 'all' | 'custom';
type Move = { in: Record<number, number>; out: Record<number, number> };

// ตัวเลขในช่อง: 0 ให้จางลงเป็นขีด อ่านง่ายกว่าเลขศูนย์เต็มตาราง
const Cell = ({ v, cls = '' }: { v: number; cls?: string }) =>
  v ? <span className={cls}>{fmt(v)}</span> : <span className="text-gray-300">–</span>;

// แถว "ยกมา" = ยอดคงเหลือสะสมก่อนวันแรกของช่วงที่เลือก (ทำให้ยอดในตารางต่อเนื่องถูกต้องแม้กรองช่วงสั้นๆ)
const OpeningRow = ({ items, opening }: { items: any[]; opening: Record<number, number> }) => (
  <tr className="bg-amber-50/60 text-gray-600">
    <td className="sticky left-0 bg-amber-50/60 z-10 px-3 py-1.5 border-r text-xs">ยกมา</td>
    {items.map(p => <td key={'oi' + p.id} className="px-2 py-1.5 text-right text-gray-300">–</td>)}
    {items.map(p => <td key={'oo' + p.id} className="px-2 py-1.5 text-right text-gray-300">–</td>)}
    {items.map(p => (
      <td key={'ob' + p.id} className="px-2 py-1.5 text-right font-medium">
        <Cell v={opening[p.id] || 0} cls={(opening[p.id] || 0) < 0 ? 'text-rose-600' : ''} />
      </td>
    ))}
  </tr>
);

export default function StockLedger() {
  const { data: products = [], isLoading: lp } = useQuery({ queryKey: ['products'], queryFn: productApi.list });
  const { data: receives = [], isLoading: lr } = useQuery({ queryKey: ['receives', 'ledger'], queryFn: () => receiveApi.list() });
  const { data: shipments = [], isLoading: ls } = useQuery({ queryKey: ['shipments', 'ledger'], queryFn: () => shipmentApi.list() });
  const loading = lp || lr || ls;

  const [scope, setScope] = useState('ALL');          // รหัสกลุ่มงาน หรือ ALL
  const [preset, setPreset] = useState<Preset>('90d');
  const [cFrom, setCFrom] = useState('');
  const [cTo, setCTo] = useState('');
  const [newestFirst, setNewestFirst] = useState(false);   // ค่าเริ่มต้น: เก่า→ใหม่ (ยอดคงเหลือไหลลงตามธรรมชาติ)

  const fromDate = preset === 'all' ? '' : preset === 'custom' ? cFrom : preset === '30d' ? daysAgo(30) : daysAgo(90);
  const toDate = preset === 'custom' ? cTo : '';

  // ── รวมการเคลื่อนไหวทุกวัน (ทั้งระบบ ไม่ตัดตามช่วงวันที่) ──
  const { dates, moves } = useMemo(() => {
    const moves = new Map<string, Move>();
    const at = (d: string) => {
      let m = moves.get(d);
      if (!m) { m = { in: {}, out: {} }; moves.set(d, m); }
      return m;
    };
    for (const r of receives as any[]) {
      const d = String(r.received_at).slice(0, 10);
      at(d).in[r.product_id] = (at(d).in[r.product_id] || 0) + (Number(r.quantity) || 0);
    }
    for (const s of shipments as any[]) {
      const d = String(s.shipped_at).slice(0, 10);
      for (const it of (s.items || [])) {
        const qty = (it.received_qty ?? it.good_qty ?? 0) + (it.defect_qty || 0);
        at(d).out[it.product_id] = (at(d).out[it.product_id] || 0) + qty;
      }
    }
    return { dates: [...moves.keys()].sort(), moves };
  }, [receives, shipments]);

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

  // ── เดินยอดทีละวันจากวันแรกของระบบ เก็บเฉพาะแถวที่อยู่ในช่วงที่เลือก ──
  const ledger = useMemo(() => {
    const bal: Record<number, number> = {};
    const rows = new Map<string, any[]>();      // groupKey -> แถว
    const opening: Record<number, number> = {}; // ยอดยกมา ณ ต้นช่วง
    let captured = false;

    for (const d of dates) {
      if (toDate && d > toDate) break;
      const mv = moves.get(d)!;
      const inRange = !fromDate || d >= fromDate;
      if (inRange && !captured) { Object.assign(opening, bal); captured = true; }

      for (const [pid, q] of Object.entries(mv.in)) bal[+pid] = (bal[+pid] || 0) + q;
      for (const [pid, q] of Object.entries(mv.out)) bal[+pid] = (bal[+pid] || 0) - q;
      if (!inRange) continue;

      for (const g of groups) {
        if (!g.items.some((p: any) => mv.in[p.id] || mv.out[p.id])) continue;   // กลุ่มนี้ไม่มีความเคลื่อนไหววันนี้
        const snap: Record<number, number> = {};
        for (const p of g.items) snap[p.id] = bal[p.id] || 0;
        if (!rows.has(g.key)) rows.set(g.key, []);
        rows.get(g.key)!.push({ date: d, in: mv.in, out: mv.out, bal: snap });
      }
    }
    if (!captured) Object.assign(opening, bal);   // ไม่มีแถวในช่วงเลย -> ยกมา = ยอดล่าสุด
    return { rows, opening, closing: bal };
  }, [dates, moves, groups, fromDate, toDate]);

  const shownGroups = groups.filter(g => scope === 'ALL' || g.key === scope);

  // ── สรุปหัวหน้า (เฉพาะกลุ่มที่แสดงอยู่) ──
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

  // ── ข้อมูลสำหรับ Export Excel (แบนเป็นแถวเดียวต่อวัน/กลุ่ม) ──
  const exportRows = useMemo(() => {
    const out: Record<string, any>[] = [];
    for (const g of shownGroups) {
      for (const r of (ledger.rows.get(g.key) || [])) {
        const row: Record<string, any> = { 'กลุ่มงาน': projectLabel(g.key), 'วันที่': r.date };
        for (const p of g.items) {
          const { num, label } = parseProductLabel(p.name);
          const n = `${num} ${label}`;
          row[`รับเข้า ${n}`] = r.in[p.id] || 0;
          row[`ส่งออก ${n}`] = r.out[p.id] || 0;
          row[`คงเหลือ ${n}`] = r.bal[p.id] || 0;
        }
        out.push(row);
      }
    }
    return out;
  }, [shownGroups, ledger]);

  return (
    <div className="p-4 md:p-6 space-y-4">
      {/* ── หัวเรื่อง + ตัวกรอง ─────────────────────────────── */}
      <div className="flex items-center gap-2">
        <ClipboardList size={20} className="text-blue-600" />
        <h1 className="text-xl font-bold text-gray-800">สต็อกสินค้า — เข้า / ออก / คงเหลือ</h1>
      </div>

      <div className="card space-y-3">
        {/* กลุ่มงาน */}
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-xs text-gray-500 mr-1">กลุ่มงาน:</span>
          <button onClick={() => setScope('ALL')}
            className={`px-2.5 py-1 rounded-lg text-sm border transition ${scope === 'ALL' ? 'bg-slate-800 text-white border-slate-800' : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'}`}>
            ทุกกลุ่ม
          </button>
          {groups.map(g => (
            <button key={g.key} onClick={() => setScope(g.key)}
              className={`px-2.5 py-1 rounded-lg text-sm border flex items-center gap-1.5 transition ${scope === g.key ? 'bg-slate-800 text-white border-slate-800' : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'}`}>
              <span className="w-2.5 h-2.5 rounded-full border border-gray-300 shrink-0" style={{ backgroundColor: g.items[0]?.color || '#ccc' }} />
              {projectLabel(g.key)}
            </button>
          ))}
        </div>

        {/* ช่วงวันที่ + เรียงลำดับ + export */}
        <div className="flex flex-wrap items-center gap-2 border-t pt-3">
          <span className="text-xs text-gray-500">ช่วงวันที่:</span>
          {([['30d', '30 วันล่าสุด'], ['90d', '90 วันล่าสุด'], ['all', 'ทั้งหมด'], ['custom', 'กำหนดเอง']] as [Preset, string][]).map(([k, lbl]) => (
            <button key={k} onClick={() => setPreset(k)}
              className={`px-2.5 py-1 rounded-lg text-sm border transition ${preset === k ? 'bg-blue-600 text-white border-blue-600' : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'}`}>
              {lbl}
            </button>
          ))}
          {preset === 'custom' && (
            <>
              <input type="date" className="input w-36 text-sm" value={cFrom} onChange={e => setCFrom(e.target.value)} />
              <span className="text-gray-400 text-sm">ถึง</span>
              <input type="date" className="input w-36 text-sm" value={cTo} onChange={e => setCTo(e.target.value)} />
            </>
          )}

          <div className="ml-auto flex items-center gap-2">
            <button onClick={() => setNewestFirst(v => !v)} className="btn-secondary btn-sm flex items-center gap-1.5"
              title="สลับลำดับวันที่">
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
          <div className="flex items-center gap-1.5 text-xs text-gray-500"><ArrowUpFromLine size={13} className="text-blue-600" /> ส่งออกในช่วงนี้</div>
          <div className="text-xl font-bold text-blue-700 tabular-nums mt-0.5">{fmt(summary.tout)}</div>
        </div>
        <div className="card !p-3 border-l-4 border-l-slate-700">
          <div className="flex items-center gap-1.5 text-xs text-gray-500"><Boxes size={13} className="text-slate-700" /> คงเหลือล่าสุด (สะสมทั้งหมด)</div>
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
        const hasOpening = !!fromDate && g.items.some((p: any) => ledger.opening[p.id]);

        return (
          <div key={g.key} className="card !p-0 overflow-hidden">
            {/* หัวกลุ่ม */}
            <div className="flex flex-wrap items-center gap-2 px-4 py-2.5 bg-slate-50 border-b">
              <span className="w-3 h-3 rounded-full border border-gray-300 shrink-0" style={{ backgroundColor: g.items[0]?.color || '#ccc' }} />
              <span className="font-semibold text-gray-800">{projectLabel(g.key)}</span>
              <span className="text-xs text-gray-400">{g.key}</span>
              <span className="ml-auto flex items-center gap-3 text-xs tabular-nums">
                <span className="text-emerald-700">รับเข้า <b>{fmt(gIn)}</b></span>
                <span className="text-blue-700">ส่งออก <b>{fmt(gOut)}</b></span>
                <span className={gBal < 0 ? 'text-rose-600' : 'text-slate-800'}>คงเหลือล่าสุด <b>{fmt(gBal)}</b></span>
              </span>
            </div>

            {rows.length === 0 ? (
              <div className="px-4 py-6 text-center text-sm text-gray-400">ไม่มีความเคลื่อนไหวในช่วงวันที่ที่เลือก</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm tabular-nums">
                  <thead>
                    {/* แถวหัวกลุ่มคอลัมน์ */}
                    <tr className="text-xs">
                      <th className="sticky left-0 bg-white z-10 px-3 py-1.5 text-left font-medium text-gray-500 border-b border-r">วันที่</th>
                      <th colSpan={g.items.length} className="px-2 py-1.5 bg-emerald-50 text-emerald-800 font-semibold border-b border-r">📦 รับเข้าจากโรงงาน</th>
                      <th colSpan={g.items.length} className="px-2 py-1.5 bg-blue-50 text-blue-800 font-semibold border-b border-r">🚚 ส่งออกไปโรงงาน</th>
                      <th colSpan={g.items.length} className="px-2 py-1.5 bg-slate-100 text-slate-800 font-semibold border-b">📊 คงเหลือสะสม</th>
                    </tr>
                    {/* แถวชื่อสินค้า */}
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
                    {/* ยอดยกมาต้นช่วง — วางไว้ "ก่อนแถวแรกตามลำดับเวลา" เสมอ (บนสุดถ้าเรียงเก่า→ใหม่, ล่างสุดถ้ากลับลำดับ) */}
                    {hasOpening && !newestFirst && <OpeningRow items={g.items} opening={ledger.opening} />}

                    {view.map((r: any) => (
                      <tr key={r.date} className="border-b border-gray-50 hover:bg-blue-50/30">
                        <td className="sticky left-0 bg-white z-10 px-3 py-1.5 border-r whitespace-nowrap text-gray-700" title={r.date}>{dateTH(r.date)}</td>
                        {g.items.map((p: any) => <td key={'i' + p.id} className="px-2 py-1.5 text-right bg-emerald-50/20"><Cell v={r.in[p.id] || 0} cls="text-emerald-700 font-medium" /></td>)}
                        {g.items.map((p: any) => <td key={'o' + p.id} className="px-2 py-1.5 text-right bg-blue-50/20"><Cell v={r.out[p.id] || 0} cls="text-blue-700 font-medium" /></td>)}
                        {g.items.map((p: any) => (
                          <td key={'b' + p.id} className="px-2 py-1.5 text-right bg-slate-50/60 font-semibold">
                            <Cell v={r.bal[p.id] || 0} cls={r.bal[p.id] < 0 ? 'text-rose-600' : 'text-slate-800'} />
                          </td>
                        ))}
                      </tr>
                    ))}

                    {hasOpening && newestFirst && <OpeningRow items={g.items} opening={ledger.opening} />}
                  </tbody>
                  <tfoot>
                    <tr className="bg-gray-50 font-semibold border-t-2">
                      <td className="sticky left-0 bg-gray-50 z-10 px-3 py-2 border-r text-gray-700 leading-tight">
                        รวมช่วงนี้
                        <div className="text-[10px] font-normal text-gray-400">คงเหลือ = ยอดล่าสุด</div>
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

      <p className="text-xs text-gray-400 px-1">
        คงเหลือสะสม = รับเข้าสะสม − ส่งออกสะสม (นับตั้งแต่วันแรกของระบบเสมอ ไม่ขึ้นกับช่วงวันที่ที่เลือก) ·
        ส่งออกใช้ยอดที่โรงงานรับจริงถ้ายืนยันแล้ว · <span className="text-rose-600">ติดลบ</span> = ส่งออกมากกว่ารับเข้า (ของค้างจากรอบก่อนหน้า)
      </p>
    </div>
  );
}
