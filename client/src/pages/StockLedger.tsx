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
      แบบ "รายเดือน" จับคู่ยอดส่งออกกับล็อตที่รับเข้า (ดู lotFlow ด้านล่าง)
      ช่วงวันที่แบบอื่น (ทั้งหมด / 14 วัน / กำหนดเอง) ใช้ยอดเข้า-ออกตามวันที่จริง */
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
const prevMonth = (ym: string) => {
  let [y, m] = ym.split('-').map(Number);
  m--; if (m < 1) { m = 12; y--; }
  return `${y}-${String(m).padStart(2, '0')}`;
};
const fmt = (n: number) => Number(n || 0).toLocaleString('th-TH', { maximumFractionDigits: 2 });
const isoOf = (d: Date) => new Intl.DateTimeFormat('en-CA').format(d);
const daysAgo = (n: number) => { const d = new Date(); d.setDate(d.getDate() - n); return isoOf(d); };

type Preset = 'all' | 'month' | '14d' | '7d' | 'custom';
type Mode = 'site' | 'factory';
type Move = { in: Record<number, number>; issue: Record<number, number>; ship: Record<number, number> };
type Flow = { d: string; pid: number; q: number; cyc: string };   // ยอดเข้า/ออก 1 ก้อน พร้อมรอบที่เป็นเจ้าของ

// ช่องรับเข้า/จ่ายออก: 0 = "วันนี้ไม่มีความเคลื่อนไหว" แสดงเป็นขีดจาง อ่านง่ายกว่าเลขศูนย์เต็มตาราง
const Cell = ({ v, cls = '' }: { v: number; cls?: string }) =>
  v ? <span className={cls}>{fmt(v)}</span> : <span className="text-gray-300">–</span>;


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

  const { data: products = [], isLoading: lp } = useQuery({ queryKey: ['products'], queryFn: productApi.list });
  const { data: receives = [], isLoading: lr } = useQuery({ queryKey: ['receives', 'ledger'], queryFn: () => receiveApi.list() });
  const { data: shipments = [], isLoading: ls } = useQuery({ queryKey: ['shipments', 'ledger'], queryFn: () => shipmentApi.list() });

  /* ── รอบเดือน ─────────────────────────────────────────────────────────────
     รอบของแต่ละเดือนเริ่มนับจาก "วันที่โรงงานส่งของครั้งสุดท้ายของเดือนก่อน" (กติกาเดียวกับ
     ตัวกรองรายเดือนในหน้าใบเบิกงาน) เช่น รอบเดือน ก.ย. เริ่ม 28 ส.ค.
     ของที่รับเข้าวันรอยต่อ = ของรอบใหม่ · ส่วนยอดส่งออกเป็นของรอบไหน ตัดสินด้วยการจับคู่ล็อต (lotFlow) */
  const { boundaries, lastRecvByMonth } = useMemo(() => {
    const lastRecvByMonth = new Map<string, string>();
    for (const r of (receives as any[])) {
      const d = String(r.received_at).slice(0, 10), ym = d.slice(0, 7);
      if (!lastRecvByMonth.has(ym) || d > lastRecvByMonth.get(ym)!) lastRecvByMonth.set(ym, d);
    }
    return { boundaries: new Set(lastRecvByMonth.values()), lastRecvByMonth };
  }, [receives]);

  const todayISO = isoOf(new Date());
  // ช่วงของรอบเดือนใดๆ — เดือนปัจจุบันยังไม่ปิดรอบ จึงเปิดถึงวันนี้
  // cycleOfDate: วันที่นี้ (ของที่รับเข้า) เป็นของรอบเดือนไหน
  const { cycleWindow, cycleOfDate } = useMemo(() => {
    const cycleWindow = (ym: string) => {
      const start = lastRecvByMonth.get(prevMonth(ym)) || monthRange(ym).from;
      const own = lastRecvByMonth.get(ym);
      const isCurrent = ym === todayISO.slice(0, 7);
      return { start, end: isCurrent ? todayISO : (own || monthRange(ym).to), closed: !isCurrent && !!own };
    };
    const months = [...lastRecvByMonth.keys()].sort();
    const cycleOfDate = (d: string) => {
      for (const m of months) {
        const w = cycleWindow(m);
        if (d >= w.start && (w.closed ? d < w.end : true)) return m;
      }
      return d.slice(0, 7);
    };
    return { cycleWindow, cycleOfDate };
  }, [lastRecvByMonth, todayISO]);
  const cycle = useMemo(() => cycleWindow(month), [cycleWindow, month]);

  const fromDate =
    preset === 'all' ? '' :
    preset === 'month' ? cycle.start :
    preset === 'custom' ? cFrom :
    daysAgo(preset === '14d' ? 14 : 7);
  const toDate = preset === 'month' ? cycle.end : preset === 'custom' ? cTo : '';

  // มุมมองสต็อกหน้างาน: รับเข้า/เบิกออกของวันปิดรอบ = ของรอบถัดไป (เฉพาะรอบที่ปิดแล้ว)
  const inBelongsToNext = mode === 'site' && preset === 'month' && cycle.closed && !!toDate && boundaries.has(toDate);

  /* จุด "เริ่มเดินยอด" ของโหมดสต็อกหน้างาน = STOCK_CUTOFF (ยอดก่อนหน้านั้นไม่ตรงกับของจริงหน้างาน)
     ทำงานอัตโนมัติเมื่อช่วงที่ดูอยู่เริ่มตั้งแต่เส้นเริ่มนับเป็นต้นไป — ไม่ต้องมีปุ่มให้กดเอง
     ถ้าย้อนไปดูก่อนหน้านั้น (เช่น เลือกเดือน ก.ค.) จะเดินยอดจากวันแรกของระบบแทน = ดูประวัติได้
     แต่มีหมายเหตุใต้ตารางเตือนว่ายอดอาจไม่ตรงกับของจริง */
  const countFrom = mode === 'site' && !!fromDate && fromDate >= STOCK_CUTOFF ? STOCK_CUTOFF : '';

  // ใบเบิกทั้งหมดมี ~2,900 แถว (1.3 MB) — โหลดเต็มเฉพาะตอนต้องเดินยอดจากวันแรกของระบบจริงๆ
  const issuesFrom = mode === 'site' && !countFrom ? '' : STOCK_CUTOFF;
  const { data: issues = [], isLoading: li } = useQuery({
    queryKey: ['issues', 'ledger', issuesFrom || 'all'],
    queryFn: () => issueApi.list(issuesFrom ? { from: issuesFrom } : {}),
  });
  const loading = lp || lr || ls || li;

  const outLabel = mode === 'site' ? 'เบิกออกให้สมาชิก' : 'ส่งงานออกโรงงาน';
  const balLabel = mode === 'site' ? 'คงเหลือหน้างาน' : 'ยอดความต่าง';
  /* ตารางรายวันโชว์แค่ของเข้า/ของออก แล้วสรุปตัวเลขสุดท้ายไว้ "ใต้ตาราง" แถวเดียว แบบไฟล์ Excel 交货明细
     (ไม่ไล่ยอดสะสมทุกบรรทัด — เคยทำแล้วงง เพราะแยกไม่ออกว่าเลขไหนเป็นยอดเคลื่อนไหว เลขไหนเป็นยอดคงเหลือ)
     - รับ-ส่งโรงงาน: ยอดความต่าง = รวมรับเข้า − รวมส่งออก ของที่แสดงในตาราง
       (แบบรายเดือน = ของที่รับเข้ารอบนี้ที่ยังไม่ได้ส่ง เพราะยอดส่งออกจับคู่ล็อตแล้ว)
     - สต็อกหน้างาน:  คงเหลือหน้างาน = ของที่เหลืออยู่จริง (เดินยอดจากเส้นเริ่มนับ) */
  const finalOf = (tin: number, tout: number, closing: number) => (mode === 'factory' ? tin - tout : closing);
  const lotMatched = mode === 'factory' && preset === 'month';

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

  /* ── จับคู่ยอดส่งออกกับล็อตที่รับเข้า (FIFO) ── ใช้กับมุมมองรับ-ส่งโรงงานแบบรายเดือน
     ของที่ส่งออกหักจากล็อตที่รับเข้ามาก่อน แล้วนับเป็นยอดของ "รอบที่ล็อตนั้นรับเข้า"
     เช่น ป้ายขาวรับล็อตสุดท้ายของ ก.ค. วันที่ 25 ก.ค. แล้วส่งออกวันที่ 3 ส.ค. → ยอดส่งนั้นเป็นของรอบ ก.ค.
     ผล: เดือนที่ส่งครบแล้วยอดความต่างเป็น 0 · เดือนปัจจุบันเหลือเท่ากับของที่ยังไม่ได้ส่งจริง
     (แทนกติกา "วันรอยต่อ" แบบเดิม ที่ตัดได้เฉพาะเที่ยวที่ส่งตรงวันรอยต่อพอดี — ส่งช้ากว่านั้นวันเดียวก็หลุดไปอีกเดือน
      ทำให้ ส.ค. เคยติดลบ −4,000 ทั้งที่เป็นของล็อต ก.ค.)
     ยอดส่งออกที่หาล็อตให้จับคู่ไม่ได้ (ข้อมูลช่วงแรกบางส่วน) นับเป็นของรอบตามวันที่ส่งจริง */
  const lotFlow = useMemo(() => {
    const recv: Flow[] = [];
    const lotsByPid = new Map<number, { d: string; left: number; cyc: string }[]>();
    for (const r of (receives as any[])) {
      const d = String(r.received_at).slice(0, 10);
      const q = Number(r.quantity) || 0;
      const cyc = cycleOfDate(d);
      recv.push({ d, pid: r.product_id, q, cyc });
      if (!lotsByPid.has(r.product_id)) lotsByPid.set(r.product_id, []);
      lotsByPid.get(r.product_id)!.push({ d, left: q, cyc });
    }
    for (const lots of lotsByPid.values()) lots.sort((a, b) => a.d.localeCompare(b.d));

    const ships: { d: string; pid: number; q: number }[] = [];
    for (const s of (shipments as any[])) {
      const d = String(s.shipped_at).slice(0, 10);
      for (const it of (s.items || [])) {
        ships.push({ d, pid: it.product_id, q: (it.received_qty ?? it.good_qty ?? 0) + (it.defect_qty || 0) });
      }
    }
    ships.sort((a, b) => a.d.localeCompare(b.d));

    const chunks: Flow[] = [];
    const cursor = new Map<number, number>();   // ล็อตแรกที่ยังเหลือของ ของแต่ละรุ่น
    for (const s of ships) {
      const lots = lotsByPid.get(s.pid) || [];
      let i = cursor.get(s.pid) || 0;
      let need = s.q;
      while (need > 0 && i < lots.length && lots[i].d <= s.d) {
        const take = Math.min(need, lots[i].left);
        if (take > 0) { chunks.push({ d: s.d, pid: s.pid, q: take, cyc: lots[i].cyc }); lots[i].left -= take; need -= take; }
        if (lots[i].left <= 0) i++;
      }
      cursor.set(s.pid, i);
      if (need > 0) chunks.push({ d: s.d, pid: s.pid, q: need, cyc: cycleOfDate(s.d) });
    }
    return { recv, chunks };
  }, [receives, shipments, cycleOfDate]);

  // แถวรายวันของรอบเดือนที่เลือก (มุมมองรับ-ส่งโรงงาน) — นับเฉพาะยอดที่เป็นของรอบนี้
  // ยอดส่งจริงในช่วงนี้แต่เป็นของรอบอื่น แสดงเป็นป้ายเล็กๆ ใต้ตัวเลข (ไม่นับรวม) ให้เทียบกับใบส่งของได้
  const lotRows = useMemo(() => {
    if (!lotMatched) return null;
    const add = (m: Map<string, Record<number, number>>, d: string, pid: number, q: number) => {
      let o = m.get(d);
      if (!o) { o = {}; m.set(d, o); }
      o[pid] = (o[pid] || 0) + q;
    };
    const inBy = new Map<string, Record<number, number>>();
    const outBy = new Map<string, Record<number, number>>();
    const prevBy = new Map<string, Record<number, number>>();
    const nextBy = new Map<string, Record<number, number>>();
    for (const r of lotFlow.recv) if (r.cyc === month) add(inBy, r.d, r.pid, r.q);
    for (const c of lotFlow.chunks) {
      if (c.cyc === month) add(outBy, c.d, c.pid, c.q);
      else if (c.d >= cycle.start && c.d <= cycle.end) add(c.cyc < month ? prevBy : nextBy, c.d, c.pid, c.q);
    }
    const EMPTY: Record<number, number> = {};
    const rows = new Map<string, any[]>();
    for (const d of [...new Set([...inBy.keys(), ...outBy.keys()])].sort()) {
      const inQ = inBy.get(d) || EMPTY, outQ = outBy.get(d) || EMPTY;
      for (const g of groups) {
        if (!g.items.some((p: any) => inQ[p.id] || outQ[p.id])) continue;
        if (!rows.has(g.key)) rows.set(g.key, []);
        rows.get(g.key)!.push({
          date: d, in: inQ, out: outQ,
          prev: prevBy.get(d) || EMPTY, next: nextBy.get(d) || EMPTY,
          afterClose: cycle.closed && d > cycle.end,   // ของรอบนี้ แต่ส่งออกหลังรอบปิดไปแล้ว
        });
      }
    }
    return rows;
  }, [lotMatched, lotFlow, month, cycle, groups]);

  // ── เดินยอดทีละวัน เก็บเฉพาะแถวที่อยู่ในช่วงที่เลือก (สต็อกหน้างาน / รับ-ส่งโรงงานแบบไม่ใช่รายเดือน) ──
  const ledger = useMemo(() => {
    const bal: Record<number, number> = {};
    const rows = new Map<string, any[]>();
    const EMPTY: Record<number, number> = {};

    for (const d of dates) {
      if (countFrom && d < countFrom) continue;      // ก่อนจุดเริ่มเดินยอด = ไม่นับเลย
      if (toDate && d > toDate) break;
      const mv = moves.get(d)!;
      const inRange = !fromDate || d >= fromDate;
      // วันปิดรอบ (สต็อกหน้างาน): ของที่รับเข้า/เบิกออกวันนั้นเป็นของรอบถัดไป
      const atEndSeam = inBelongsToNext && d === toDate;
      const inQty = atEndSeam ? EMPTY : mv.in;
      const outQty = mode === 'site' ? (atEndSeam ? EMPTY : mv.issue) : mv.ship;

      for (const [pid, q] of Object.entries(inQty)) bal[+pid] = (bal[+pid] || 0) + q;
      for (const [pid, q] of Object.entries(outQty)) bal[+pid] = (bal[+pid] || 0) - q;
      if (!inRange) continue;

      for (const g of groups) {
        if (!g.items.some((p: any) => inQty[p.id] || outQty[p.id])) continue;   // กลุ่มนี้ไม่มีความเคลื่อนไหววันนี้
        if (!rows.has(g.key)) rows.set(g.key, []);
        rows.get(g.key)!.push({ date: d, in: inQty, out: outQty });
      }
    }
    return { rows, closing: bal };
  }, [dates, moves, groups, fromDate, toDate, countFrom, mode, inBelongsToNext]);

  const rowsOf = (key: string): any[] => (lotRows ? lotRows.get(key) : ledger.rows.get(key)) || [];

  const shownGroups = groups.filter(g => scope === 'ALL' || g.key === scope);

  const summary = useMemo(() => {
    let tin = 0, tout = 0, closing = 0;
    for (const g of shownGroups) {
      for (const r of rowsOf(g.key)) {
        for (const p of g.items) { tin += r.in[p.id] || 0; tout += r.out[p.id] || 0; }
      }
      for (const p of g.items) closing += ledger.closing[p.id] || 0;
    }
    return { tin, tout, closing };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shownGroups, ledger, lotRows]);

  // Export ให้หน้าตาเหมือนไฟล์ Excel เดิม: รายวัน → แถว "รวม" → แถว "ยอดความต่าง" (ใต้คอลัมน์ส่งออก) ต่อกลุ่มงาน
  const exportRows = useMemo(() => {
    const out: Record<string, any>[] = [];
    for (const g of shownGroups) {
      const rows = rowsOf(g.key);
      if (rows.length === 0) continue;
      const names = g.items.map((p: any) => { const { num, label } = parseProductLabel(p.name); return `${num} ${label}`; });
      for (const r of rows) {
        const row: Record<string, any> = { 'กลุ่มงาน': projectLabel(g.key), 'วันที่': r.date };
        g.items.forEach((p: any, i: number) => {
          row[`รับเข้า ${names[i]}`] = r.in[p.id] || 0;
          row[`${outLabel} ${names[i]}`] = r.out[p.id] || 0;
        });
        out.push(row);
      }
      const total: Record<string, any> = { 'กลุ่มงาน': projectLabel(g.key), 'วันที่': 'รวม' };
      const diff: Record<string, any> = { 'กลุ่มงาน': projectLabel(g.key), 'วันที่': balLabel };
      g.items.forEach((p: any, i: number) => {
        const sIn = rows.reduce((a: number, r: any) => a + (r.in[p.id] || 0), 0);
        const sOut = rows.reduce((a: number, r: any) => a + (r.out[p.id] || 0), 0);
        total[`รับเข้า ${names[i]}`] = sIn;
        total[`${outLabel} ${names[i]}`] = sOut;
        diff[`รับเข้า ${names[i]}`] = '';
        diff[`${outLabel} ${names[i]}`] = mode === 'factory' ? sIn - sOut : (ledger.closing[p.id] || 0);
      });
      out.push(total, diff);
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shownGroups, ledger, lotRows, outLabel, balLabel, mode]);

  const pill = (active: boolean) =>
    `px-2.5 py-1 rounded-lg text-sm border transition ${active ? 'bg-slate-800 text-white border-slate-800' : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'}`;
  const datePill = (active: boolean) =>
    `px-2.5 py-1 rounded-lg text-sm border transition ${active ? 'bg-blue-600 text-white border-blue-600' : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'}`;

  // ป้ายอธิบายช่วงที่กำลังดูอยู่ (ให้รู้ทันทีว่ายอดคงเหลือคิดจากตรงไหน)
  const rangeNote =
    preset === 'all' ? 'ดูทั้งหมดตั้งแต่วันแรกของระบบ' :
    preset === 'month' ? `รอบเดือน ${monthTH(month)} · ${dateTH(cycle.start)} – ${dateTH(cycle.end)}` : '';

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
          <div className="flex items-center gap-1.5 text-xs text-gray-500"><Boxes size={13} className="text-slate-700" /> {balLabel}{mode === 'factory' ? 'ในช่วงนี้' : ' (ล่าสุด)'}</div>
          {(() => {
            const v = finalOf(summary.tin, summary.tout, summary.closing);
            return <div className={`text-xl font-bold tabular-nums mt-0.5 ${v < 0 ? 'text-rose-600' : 'text-slate-800'}`}>{fmt(v)}</div>;
          })()}
        </div>
      </div>

      {loading && <div className="card text-center text-gray-400 py-8"><Loader2 size={20} className="animate-spin mx-auto" /></div>}

      {/* ── ตารางแยกตามกลุ่มงาน ────────────────────────────── */}
      {!loading && shownGroups.map(g => {
        const rows = rowsOf(g.key);
        const view = newestFirst ? [...rows].reverse() : rows;
        const gIn = g.items.reduce((s: number, p: any) => s + rows.reduce((a: number, r: any) => a + (r.in[p.id] || 0), 0), 0);
        const gOut = g.items.reduce((s: number, p: any) => s + rows.reduce((a: number, r: any) => a + (r.out[p.id] || 0), 0), 0);
        const gBal = g.items.reduce((s: number, p: any) => s + (ledger.closing[p.id] || 0), 0);
        const gFinal = finalOf(gIn, gOut, gBal);
        const sumIn = (pid: number) => rows.reduce((a: number, r: any) => a + (r.in[pid] || 0), 0);
        const sumOut = (pid: number) => rows.reduce((a: number, r: any) => a + (r.out[pid] || 0), 0);
        const finalFor = (pid: number) => (mode === 'factory' ? sumIn(pid) - sumOut(pid) : (ledger.closing[pid] || 0));

        return (
          <div key={g.key} className="card !p-0 overflow-hidden">
            <div className="flex flex-wrap items-center gap-2 px-4 py-2.5 bg-slate-50 border-b">
              <span className="w-3 h-3 rounded-full border border-gray-300 shrink-0" style={{ backgroundColor: g.items[0]?.color || '#ccc' }} />
              <span className="font-semibold text-gray-800">{projectLabel(g.key)}</span>
              <span className="text-xs text-gray-400">{g.key}</span>
              <span className="ml-auto flex items-center gap-3 text-xs tabular-nums">
                <span className="text-emerald-700">รับเข้า <b>{fmt(gIn)}</b></span>
                <span className="text-blue-700">{outLabel} <b>{fmt(gOut)}</b></span>
                <span className={gFinal < 0 ? 'text-rose-600' : 'text-slate-800'}>{balLabel} <b>{fmt(gFinal)}</b></span>
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
                      <th colSpan={g.items.length} className="px-2 py-1.5 bg-blue-50 text-blue-800 font-semibold border-b">{mode === 'site' ? '👤' : '🚚'} {outLabel}</th>
                    </tr>
                    <tr className="text-[11px] text-gray-500">
                      <th className="sticky left-0 bg-white z-10 border-b border-r px-3 py-1" />
                      {(['in', 'out'] as const).map(kind => g.items.map((p: any, i: number) => {
                        const { num, label } = parseProductLabel(p.name);
                        const divider = kind === 'in' && i === g.items.length - 1;
                        return (
                          <th key={kind + p.id} className={`px-2 py-1 text-right font-medium border-b whitespace-nowrap ${divider ? 'border-r' : ''} ${kind === 'in' ? 'bg-emerald-50/40' : 'bg-blue-50/40'}`}>
                            <div className="font-semibold text-gray-700">{num}</div>
                            <div className="text-[10px] font-normal text-gray-400">{label}</div>
                          </th>
                        );
                      }))}
                    </tr>
                  </thead>
                  <tbody>
                    {view.map((r: any) => (
                      <tr key={r.date} className="border-b border-gray-50 hover:bg-blue-50/30">
                        <td className="sticky left-0 bg-white z-10 px-3 py-1.5 border-r whitespace-nowrap text-gray-700" title={r.date}>
                          {dateTH(r.date)}
                          {r.afterClose && <div className="text-[10px] text-amber-600 leading-tight" title="ของที่รับเข้ารอบนี้ แต่ส่งออกหลังรอบปิดไปแล้ว">ส่งหลังปิดรอบ</div>}
                        </td>
                        {g.items.map((p: any, i: number) => (
                          <td key={'i' + p.id} className={`px-2 py-1.5 text-right bg-emerald-50/20 ${i === g.items.length - 1 ? 'border-r' : ''}`}>
                            <Cell v={r.in[p.id] || 0} cls="text-emerald-700 font-medium" />
                          </td>
                        ))}
                        {g.items.map((p: any) => (
                          <td key={'o' + p.id} className="px-2 py-1.5 text-right bg-blue-50/20">
                            <Cell v={r.out[p.id] || 0} cls="text-blue-700 font-medium" />
                            {!!r.prev?.[p.id] && (
                              <div className="text-[10px] text-gray-400 leading-tight whitespace-nowrap" title="ส่งจริงวันนี้ แต่เป็นของล็อตที่รับเข้ารอบก่อน จึงไปนับรวมที่รอบก่อน">
                                + ของรอบก่อน {fmt(r.prev[p.id])}
                              </div>
                            )}
                            {!!r.next?.[p.id] && (
                              <div className="text-[10px] text-gray-400 leading-tight whitespace-nowrap" title="ส่งจริงวันนี้ แต่เป็นของล็อตที่รับเข้ารอบถัดไป จึงไปนับรวมที่รอบถัดไป">
                                + ของรอบถัดไป {fmt(r.next[p.id])}
                              </div>
                            )}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    {/* แถว Total — ยอดรวมของเข้า/ของออกในช่วง */}
                    <tr className="bg-gray-50 font-semibold border-t-2 border-gray-300">
                      <td className="sticky left-0 bg-gray-50 z-10 px-3 py-2 border-r text-gray-700">รวม</td>
                      {g.items.map((p: any, i: number) => (
                        <td key={'ti' + p.id} className={`px-2 py-2 text-right text-emerald-800 ${i === g.items.length - 1 ? 'border-r' : ''}`}>
                          {fmt(sumIn(p.id))}
                        </td>
                      ))}
                      {g.items.map((p: any) => (
                        <td key={'to' + p.id} className="px-2 py-2 text-right text-blue-800">{fmt(sumOut(p.id))}</td>
                      ))}
                    </tr>
                    {/* แถวยอดความต่าง — อยู่ใต้คอลัมน์ส่งออก ขีดเส้นใต้คู่ แบบไฟล์ Excel 交货明细 */}
                    <tr>
                      <td className="sticky left-0 bg-white z-10 px-3 py-2.5 border-r text-gray-800 font-semibold leading-tight">
                        {balLabel}
                        <div className="text-[10px] font-normal text-gray-400">
                          {mode === 'site' ? 'ของที่เหลืออยู่ตอนนี้' : lotMatched ? 'ของรอบนี้ที่ยังไม่ได้ส่ง' : 'รวมรับเข้า − รวมส่งออก'}
                        </div>
                      </td>
                      {g.items.map((p: any, i: number) => (
                        <td key={'di' + p.id} className={i === g.items.length - 1 ? 'border-r' : ''} />
                      ))}
                      {g.items.map((p: any) => {
                        const v = finalFor(p.id);
                        return (
                          <td key={'dv' + p.id} className="px-2 py-2.5 text-right">
                            <span className={`inline-block border-b-[3px] border-double border-gray-500 pb-0.5 text-base font-bold tabular-nums ${v < 0 ? 'text-rose-600' : 'text-slate-900'}`}>
                              {fmt(v)}
                            </span>
                          </td>
                        );
                      })}
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
                : <> · ช่วงนี้ย้อนไปก่อน {dateTH(STOCK_CUTOFF)} ยอดคงเหลืออาจไม่ตรงกับของจริงหน้างาน (ใช้ดูประวัติเท่านั้น)</>}
              {' '}· <span className="text-rose-600">ติดลบ</span> = จ่ายออกมากกว่าที่รับเข้าในช่วงนี้ (ใช้ของค้างจากรอบก่อน)</>
          : lotMatched
            ? <><b>ยอดความต่าง = ของที่รับเข้ารอบนี้ ที่ยังไม่ได้ส่งออก</b> · ยอดส่งออกจับคู่กับล็อตที่รับเข้ามาก่อน แล้วนับเป็นของรอบที่ล็อตนั้นรับเข้า
                (เช่น ของที่รับเข้าปลายเดือนก่อน แต่ส่งออกต้นเดือนนี้ นับเป็นของรอบเดือนก่อน) เดือนที่ส่งครบแล้วจึงเป็น 0
                · ป้าย "+ ของรอบก่อน" = ส่งจริงวันนั้นแต่ไปนับที่รอบก่อน · ส่งออกใช้ยอดที่โรงงานรับจริงถ้ายืนยันแล้ว</>
            : <><b>ยอดความต่าง = รวมรับเข้า − รวมส่งออก</b> ตามวันที่จริงในช่วงที่เลือก · ส่งออกใช้ยอดที่โรงงานรับจริงถ้ายืนยันแล้ว
                · <span className="text-rose-600">ติดลบ</span> = ช่วงนี้ส่งออกมากกว่ารับเข้า (ส่งของที่รับเข้ามาก่อนช่วงนี้)</>}
        {inBelongsToNext && (
          <><br /><b>วันรอยต่อรอบ:</b> ยอด "รับเข้า/เบิกออก" ของวันที่ {dateTH(toDate)} เป็นของรอบถัดไป (วันที่ของมาถึงคือวันเริ่มรอบใหม่)</>
        )}
      </p>
    </div>
  );
}
