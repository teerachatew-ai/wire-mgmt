// การเรียงลำดับสินค้าให้ "สีเดียวกันอยู่ติดกัน" — ใช้กติกาเดียวกับรายงานค่าแรง
// (server/scripts/payroll_detail_export.py: color_priority / color_sort_key)
// เพื่อให้ลำดับคอลัมน์บนหน้าจอตรงกับลำดับในเอกสารที่พิมพ์ออกมา ไม่ต้องแปลตำแหน่งใหม่ทุกครั้ง

// ลำดับที่ต้องการ: ขาวก่อน -> ชมพู/แดง -> เขียว -> สีอื่นๆ -> ไม่มีสี
export function colorPriority(hex?: string | null): number {
  const h = normHex(hex);
  if (!h) return 9;
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  if (r > 200 && g > 200 && b > 200) return 0;   // ขาว/อ่อนมาก
  if (g > r && g > b) return 2;                   // เขียว
  if (r >= g && r >= b) return 1;                 // แดง/ชมพู/ส้ม/เหลือง
  return 3;                                       // ฟ้า/น้ำเงิน/ม่วง ฯลฯ
}

function normHex(c?: string | null): string | null {
  if (!c) return null;
  let s = String(c).replace('#', '').trim();
  if (s.length === 3) s = s.split('').map(ch => ch + ch).join('');
  return /^[0-9a-fA-F]{6}$/.test(s) ? s.toUpperCase() : null;
}

// เลขรุ่นจากชื่อสินค้า "MA020-633_A (ป้ายขาวสั้น)" -> "633" (ใช้เรียงภายในกลุ่มสีเดียวกัน)
function codeNum(name: string): string {
  const prefix = String(name || '').split(' (')[0].trim();
  return prefix.match(/-(\d+)/)?.[1] ?? prefix.match(/(\d+)/)?.[1] ?? '';
}

/** เรียงรายการสินค้าให้สีเดียวกันอยู่ติดกัน แล้วเรียงตามเลขรุ่นภายในกลุ่ม */
export function sortByColorGroup<T>(items: T[], getName: (x: T) => string, getColor: (x: T) => string | undefined | null): T[] {
  return [...items].sort((a, b) => {
    const pa = colorPriority(getColor(a)), pb = colorPriority(getColor(b));
    if (pa !== pb) return pa - pb;
    const ha = normHex(getColor(a)) ?? 'ZZZZZZ', hb = normHex(getColor(b)) ?? 'ZZZZZZ';
    if (ha !== hb) return ha.localeCompare(hb);
    const ca = codeNum(getName(a)), cb = codeNum(getName(b));
    if (ca !== cb) return ca.localeCompare(cb, undefined, { numeric: true });
    return getName(a).localeCompare(getName(b), 'th');
  });
}
