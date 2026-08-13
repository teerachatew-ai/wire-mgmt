// ดาวน์โหลดไฟล์ blob ที่ได้จาก server (PDF/Excel export ฯลฯ) ให้ทำงานได้แน่นอนในทุกเบราว์เซอร์รวมถึง Safari
//
// Safari (โดยเฉพาะ macOS) บล็อกการดาวน์โหลดแบบเงียบๆ — กดปุ่มแล้วไม่มีอะไรเกิดขึ้นเลย ไม่มี error ให้เห็น —
// ถ้า a.click() เกิดขึ้นหลัง await (เช่น รอ fetch ข้อมูล/สร้างไฟล์จาก server เสร็จก่อนค่อยดาวน์โหลด) เพราะ ณ ตอนนั้น
// หลุดจาก "user gesture" ที่แท้จริงไปแล้ว วิธีแก้: เปิดแท็บเปล่าไว้ก่อน "ทันที" ตอนกด (ยังอยู่ใน user gesture)
// ด้วย openDownloadTab() แล้วค่อยฉีดลิงก์ดาวน์โหลดเข้าไปในแท็บนั้นทีหลังหลัง await เสร็จ — เรียก openDownloadTab()
// เป็นบรรทัดแรกสุดของ onClick (ก่อน await ใดๆ) แล้วส่งค่าที่ได้เข้า downloadBlob ทีหลัง
export function openDownloadTab(): Window | null {
  try { return window.open('', '_blank'); } catch { return null; }
}

export function downloadBlob(blob: Blob, filename: string, tab?: Window | null) {
  const url = URL.createObjectURL(blob);
  if (tab && !tab.closed) {
    const doc = tab.document;
    const a = doc.createElement('a');
    a.href = url;
    a.download = filename;
    a.rel = 'noopener';
    doc.body.appendChild(a);
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    return;
  }
  // เบราว์เซอร์อื่น หรือแท็บเปล่าถูกบล็อกไปแล้ว — ใช้วิธีเดิม (ทำงานได้ปกติ นอก Safari)
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}
