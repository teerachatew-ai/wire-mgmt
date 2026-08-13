import * as XLSX from 'xlsx';
import { downloadBlob } from './downloadBlob';

// Export ตาราง (array of objects) เป็นไฟล์ .xlsx จริง ดาวน์โหลดฝั่งเบราว์เซอร์ทันที ไม่ต้องผ่าน server
// ใช้ได้กับทุกเมนู — ส่ง rows ที่กรอง/แสดงอยู่บนจอเข้ามา จะได้ตรงกับสิ่งที่ผู้ใช้เห็น
//
// ใช้ XLSX.write() สร้างไบต์ของไฟล์เอง แล้วดาวน์โหลดผ่าน downloadBlob (utility เดียวกับที่ใช้ทั่วทั้งระบบ)
// แทนการเรียก XLSX.writeFile() ตรงๆ — เพราะกลไกดาวน์โหลดในตัวของ XLSX.writeFile() มีปัญหากับ Safari บน macOS
// (ขึ้นหน้า error "cannot open"/"not found" โดยเฉพาะไฟล์ที่มีข้อมูลเยอะ) ส่วน downloadBlob ผ่านการทดสอบแล้วว่า
// ใช้ได้กับ Safari
export function exportToExcel(filename: string, rows: Record<string, any>[], sheetName = 'Sheet1') {
  if (!rows || rows.length === 0) {
    alert('ไม่มีข้อมูลให้ export');
    return;
  }
  const ws = XLSX.utils.json_to_sheet(rows);
  // ความกว้างคอลัมน์อัตโนมัติ คร่าวๆ ตามความยาวข้อความ (กันตัวหนังสือถูกตัด)
  const headers = Object.keys(rows[0]);
  ws['!cols'] = headers.map(h => {
    const maxLen = Math.max(h.length, ...rows.map(r => String(r[h] ?? '').length));
    return { wch: Math.min(Math.max(maxLen + 2, 10), 45) };
  });
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName);
  const bytes = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  const blob = new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  downloadBlob(blob, filename.endsWith('.xlsx') ? filename : `${filename}.xlsx`);
}
