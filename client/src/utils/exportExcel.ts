// Export ตาราง (array of objects) เป็นไฟล์ .xlsx — ใช้ได้กับทุกเมนู
// ส่ง rows ที่กรอง/แสดงอยู่บนจอเข้ามา จะได้ไฟล์ตรงกับสิ่งที่ผู้ใช้เห็น
//
// วิธีดาวน์โหลด: submit ฟอร์มไปที่ /api/export/xlsx แล้ว server ส่งไฟล์กลับมาเป็น "ไฟล์แนบ"
// (Content-Disposition: attachment) ซึ่งเป็นการดาวน์โหลดไฟล์แบบปกติที่ทุกเบราว์เซอร์รองรับ
//
// เดิมสร้างไฟล์ในเบราว์เซอร์ด้วย xlsx แล้วดาวน์โหลดผ่าน blob: URL — วิธีนั้นใช้ไม่ได้กับ Safari
// บน macOS (ขึ้น "Safari ไม่สามารถเปิดหน้าเว็บได้") เพราะ Safari ไม่ยอมเปิด/ดาวน์โหลด blob: ของ
// ไฟล์ไบนารี และจะไปลองเปิดเป็นหน้าเว็บแทน · การ submit ฟอร์มยังนับเป็น user gesture เต็มๆ ด้วย
// จึงไม่โดน Safari บล็อกเหมือนการ click ลิงก์หลัง await
export function exportToExcel(filename: string, rows: Record<string, any>[], sheetName = 'Sheet1') {
  if (!rows || rows.length === 0) {
    alert('ไม่มีข้อมูลให้ export');
    return;
  }
  const form = document.createElement('form');
  form.method = 'POST';
  form.action = '/api/export/xlsx';
  form.style.display = 'none';
  // target = หน้าเดิม — คำตอบเป็นไฟล์แนบ เบราว์เซอร์จะดาวน์โหลดแล้วอยู่หน้าเดิมต่อ ไม่เปลี่ยนหน้า
  const add = (name: string, value: string) => {
    const input = document.createElement('input');
    input.type = 'hidden';
    input.name = name;
    input.value = value;
    form.appendChild(input);
  };
  add('filename', filename.endsWith('.xlsx') ? filename : `${filename}.xlsx`);
  add('sheet', sheetName);
  add('rows', JSON.stringify(rows));
  document.body.appendChild(form);
  form.submit();
  setTimeout(() => form.remove(), 1000);
}
