// ดาวน์โหลดไฟล์ blob ที่ได้จาก server (PDF/Excel export ฯลฯ) ให้ทำงานได้แน่นอนในทุกเบราว์เซอร์รวมถึง Safari
// Safari (โดยเฉพาะบน Mac/iOS) ต้อง append <a> ลง DOM ก่อน click ไม่งั้นบางเวอร์ชันจะไม่ทำอะไรเลย
export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}
