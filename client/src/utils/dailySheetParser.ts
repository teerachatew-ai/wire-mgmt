import * as XLSX from 'xlsx';

/* ── อ่านแบบฟอร์ม Excel "รับงานจากโรงงาน" (ตารางจ่ายงานรายวัน) แบบตรงตัว ไม่ต้องให้ AI เดาตัวเลข ──
   โครงสร้างที่รองรับ (ยืดหยุ่นตำแหน่งคอลัมน์ได้):
     แถวหัว: ที่ | วัน/เดือน/ปี ที่รับงาน | ชื่อ | จำนวนที่รับเข้า ป้ายขาว | … ป้ายชมพู | … สามสาย | … ชมพูใหม่ | วันที่ส่งงาน
     แถวหัวย่อย: 676 ยาว | 633 สั้น | 674 ยาว | 676 สั้น | 652 กลาง | 653 ยาว | 656 อ้วน | 674 ยาว | 675 สั้น
     แถวใต้หัวที่ไม่มีชื่อ (ยอดรับเข้า/ยกมา เช่น 7,000) และแถว "รวมรวมสิ้น" / "ยอดคงเหลือยกไป" = ไม่ใช่สมาชิก (ข้าม)
     1 คน = 2 บรรทัด (ผสานช่อง) ตัวเลขอยู่บรรทัดที่มีชื่อ · 1 ชีตอาจมีตาราง 2 ชุด (หน้า 1–2) → อ่านทุกชุด
   หัวกลุ่มอยู่ช่องแรกของช่วงที่ผสาน → เติมไปทางขวาจนถึงหัวกลุ่มถัดไป */

export type DailySheet = {
  sheet: string;
  date: string | null;                               // วันที่จากหัวกระดาษ (หรือวันที่ที่พบบ่อยสุดในคอลัมน์วันที่รับงาน)
  columns: { group: string; label: string }[];
  rows: { name: string; date: string | null; values: number[] }[];
  blocks: number;
};

const MONTHS: [string[], number][] = [
  [['มกราคม', 'มค', 'ม.ค'], 1], [['กุมภาพันธ์', 'กพ', 'ก.พ'], 2], [['มีนาคม', 'มีค', 'มี.ค'], 3], [['เมษายน', 'เมย', 'เม.ย'], 4],
  [['พฤษภาคม', 'พค', 'พ.ค'], 5], [['มิถุนายน', 'มิย', 'มิ.ย'], 6], [['กรกฎาคม', 'กค', 'ก.ค'], 7], [['สิงหาคม', 'สค', 'ส.ค'], 8],
  [['กันยายน', 'กย', 'ก.ย'], 9], [['ตุลาคม', 'ตค', 'ต.ค'], 10], [['พฤศจิกายน', 'พย', 'พ.ย'], 11], [['ธันวาคม', 'ธค', 'ธ.ค'], 12],
];
const pad = (n: number) => String(n).padStart(2, '0');
const iso = (y: number, m: number, d: number) => (y > 1900 && m >= 1 && m <= 12 && d >= 1 && d <= 31 ? `${y}-${pad(m)}-${pad(d)}` : null);

export function parseThaiDate(v: any): string | null {
  if (v == null || v === '') return null;
  if (v instanceof Date && !isNaN(v.getTime())) return iso(v.getFullYear(), v.getMonth() + 1, v.getDate());
  if (typeof v === 'number' && v > 30000 && v < 80000) {   // เลขวันที่ของ Excel
    const d = XLSX.SSF.parse_date_code(v);
    return d ? iso(d.y, d.m, d.d) : null;
  }
  const s = String(v).replace(/\s+/g, ' ');
  const m = s.match(/(\d{1,2})\s*([ก-๙.]+?)\s*(\d{2,4})/);
  if (!m) return null;
  const mon = m[2].replace(/\s/g, '');
  const found = MONTHS.find(([names]) => names.some(n => mon === n || mon === n.replace(/\./g, '') || mon.replace(/\./g, '') === n.replace(/\./g, '')));
  if (!found) return null;
  let y = Number(m[3]);
  if (y < 100) y += 2500;               // 69 → 2569
  if (y > 2400) y -= 543;               // พ.ศ. → ค.ศ.
  return iso(y, found[1], Number(m[1]));
}

const txt = (v: any) => (v == null ? '' : String(v).replace(/\s+/g, ' ').trim());
const num = (v: any) => {
  if (typeof v === 'number') return v;
  const n = parseFloat(String(v ?? '').replace(/,/g, ''));
  return Number.isFinite(n) ? n : 0;
};
const PRODUCT_LABEL = /^\d{3}\s*\S*/;
const SUMMARY = /รวม|คงเหลือ|ยกไป|ยกมา|ยอด/;

export function parseDailySheet(ws: XLSX.WorkSheet, sheetName: string): DailySheet | null {
  const grid: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null, blankrows: true });
  const colKey = new Map<string, number>();
  const columns: DailySheet['columns'] = [];
  const rows: DailySheet['rows'] = [];
  let titleDate: string | null = null;
  let blocks = 0;

  for (let r = 0; r < grid.length; r++) {
    const row = grid[r] || [];
    // หัวกระดาษ: วันที่เต็ม เช่น "วันพุธที่ 21 ตุลาคม 2569"
    if (!titleDate) for (const c of row) { const t = txt(c); if (/รับงาน|วันที่/.test(t) || /\d{4}/.test(t)) { const d = /[ก-๙]{4,}/.test(t) ? parseThaiDate(t) : null; if (d) { titleDate = d; break; } } }
    const nameCol = row.findIndex(c => txt(c) === 'ชื่อ');
    if (nameCol < 0) continue;
    // หาแถวหัวย่อย (รหัสสินค้า) ภายใน 2 แถวถัดไป
    let sub = -1;
    for (let k = r + 1; k <= r + 2 && k < grid.length; k++) {
      if ((grid[k] || []).filter((c: any) => PRODUCT_LABEL.test(txt(c))).length >= 2) { sub = k; break; }
    }
    if (sub < 0) continue;
    blocks++;
    const head = row, subRow = grid[sub] || [];
    const dateCol = head.findIndex(c => /รับงาน/.test(txt(c)) || (/วัน/.test(txt(c)) && /เดือน/.test(txt(c))));
    // คอลัมน์สินค้า + หัวกลุ่ม (เติมจากช่องซ้ายที่ใกล้สุด)
    const prodCols: { c: number; idx: number }[] = [];
    let group = '';
    const maxC = Math.max(head.length, subRow.length);
    for (let c = nameCol + 1; c < maxC; c++) {
      const h = txt(head[c]);
      if (h) group = h.replace(/^จำนวนที่รับเข้า\s*/, '').trim() || h;
      const lab = txt(subRow[c]);
      if (!PRODUCT_LABEL.test(lab)) continue;
      const key = `${group}|${lab}`;
      if (!colKey.has(key)) { colKey.set(key, columns.length); columns.push({ group, label: lab }); }
      prodCols.push({ c, idx: colKey.get(key)! });
    }
    // แถวข้อมูลจนถึงหัวตารางถัดไป
    for (let k = sub + 1; k < grid.length; k++) {
      const rr = grid[k] || [];
      if (rr.some((c: any) => txt(c) === 'ชื่อ')) break;
      const name = txt(rr[nameCol]);
      if (!name || SUMMARY.test(name) || rr.slice(0, nameCol).some((c: any) => SUMMARY.test(txt(c)))) continue;
      if (/^\d+([.,]\d+)?$/.test(name)) continue;
      const values = new Array(columns.length).fill(0);
      for (const pc of prodCols) values[pc.idx] = num(rr[pc.c]);
      rows.push({ name, date: dateCol >= 0 ? parseThaiDate(rr[dateCol]) : null, values });
    }
  }
  if (!blocks || !columns.length) return null;
  for (const r of rows) while (r.values.length < columns.length) r.values.push(0);
  // วันที่: หัวกระดาษก่อน ไม่มีก็ใช้วันที่ที่พบบ่อยสุดในคอลัมน์วันที่รับงาน
  let date = titleDate;
  if (!date) {
    const cnt = new Map<string, number>();
    for (const r of rows) if (r.date && r.values.some(v => v > 0)) cnt.set(r.date, (cnt.get(r.date) || 0) + 1);
    date = [...cnt.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || null;
  }
  return { sheet: sheetName, date, columns, rows, blocks };
}

/* อ่านทุกชีต — คืนเฉพาะชีตที่เป็นแบบฟอร์มนี้ · ชีตที่มีตัวเลขเบิกจริง (> 0) มาก่อน เรียงวันที่ใหม่สุดก่อน */
export function parseDailyWorkbook(wb: XLSX.WorkBook): DailySheet[] {
  const out: (DailySheet & { order: number; filled: number })[] = [];
  wb.SheetNames.forEach((n, i) => {
    const p = parseDailySheet(wb.Sheets[n], n);
    if (p) out.push({ ...p, order: i, filled: p.rows.filter(r => r.values.some(v => v > 0)).length });
  });
  return out.sort((a, b) => (b.filled > 0 ? 1 : 0) - (a.filled > 0 ? 1 : 0) || String(b.date || '').localeCompare(String(a.date || '')) || b.order - a.order);
}
