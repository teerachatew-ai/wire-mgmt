import { Download } from 'lucide-react';
import { exportToExcel } from '../utils/exportExcel';

// ปุ่ม Export Excel มาตรฐาน ใช้ซ้ำได้ทุกเมนู — ส่ง rows ที่พร้อม export (มักกรองตามหน้าจอ) เข้ามา
export default function ExportExcelButton({ filename, rows, label = 'Export Excel', sheetName }: {
  filename: string; rows: Record<string, any>[]; label?: string; sheetName?: string;
}) {
  return (
    <button
      type="button"
      className="btn-secondary btn-sm flex items-center gap-1.5"
      onClick={() => exportToExcel(filename, rows, sheetName)}
      title="ดาวน์โหลดข้อมูลตารางนี้เป็นไฟล์ Excel"
    >
      <Download size={14} /> {label}
    </button>
  );
}
