// ย่อ/บีบอัดรูปภาพให้เล็กก่อนเก็บลงฐานข้อมูล (data URL) — กันไฟล์ฐานข้อมูลบวมจากรูปต้นฉบับขนาดใหญ่
export function compressImageToDataUrl(file: File, maxWidth = 900, quality = 0.72): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const scale = Math.min(1, maxWidth / img.width);
      const w = Math.round(img.width * scale);
      const h = Math.round(img.height * scale);
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      if (!ctx) { URL.revokeObjectURL(url); return reject(new Error('canvas not supported')); }
      ctx.drawImage(img, 0, 0, w, h);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL('image/jpeg', quality));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('อ่านรูปไม่สำเร็จ')); };
    img.src = url;
  });
}
