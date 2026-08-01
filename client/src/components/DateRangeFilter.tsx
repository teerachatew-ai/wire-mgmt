import { useState } from 'react';

// ค่าตัวกรองวันที่ — ชื่อ field ตรงกับ query param ที่ backend รับอยู่แล้วเป๊ะ (date/from/to)
// ใส่ date เป็น "YYYY-MM" (จากช่อง month) ได้ด้วย เพราะ backend ใช้ LIKE '${date}%' ครอบคลุมทั้งเดือนอยู่แล้ว
export interface DateFilterValue {
  date?: string;
  from?: string;
  to?: string;
}

type Mode = 'all' | 'day' | 'month' | 'range';

function modeOf(v: DateFilterValue): Mode {
  if (v.from || v.to) return 'range';
  if (v.date && v.date.length === 7) return 'month';
  if (v.date) return 'day';
  return 'all';
}

const TH_MONTHS = ['', 'ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];

// ป้ายข้อความอ่านง่ายของตัวกรองปัจจุบัน — ใช้แทนที่ dayFilter ตรงๆ ในที่ที่เคยส่งเป็น note (เช่น DaySummary)
export function dateFilterLabel(v: DateFilterValue): string {
  const mode = modeOf(v);
  if (mode === 'day') return v.date!;
  if (mode === 'month') {
    const [y, m] = v.date!.split('-');
    return `${TH_MONTHS[parseInt(m, 10)]} ${parseInt(y, 10) + 543}`;
  }
  if (mode === 'range') {
    if (v.from && v.to) return `${v.from} ถึง ${v.to}`;
    if (v.from) return `ตั้งแต่ ${v.from}`;
    return `ถึง ${v.to}`;
  }
  return 'ทั้งหมด';
}

export default function DateRangeFilter({ value, onChange }: { value: DateFilterValue; onChange: (v: DateFilterValue) => void }) {
  const [mode, setMode] = useState<Mode>(modeOf(value));

  const changeMode = (m: Mode) => {
    setMode(m);
    onChange({});
  };

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <select className="input w-auto text-sm" value={mode} onChange={e => changeMode(e.target.value as Mode)} title="รูปแบบตัวกรองวันที่">
        <option value="all">ทุกวันที่</option>
        <option value="day">วันเดียว</option>
        <option value="month">รายเดือน</option>
        <option value="range">ช่วงวันที่</option>
      </select>
      {mode === 'day' && (
        <input type="date" className="input w-40 text-sm" value={value.date || ''} onChange={e => onChange({ date: e.target.value || undefined })} />
      )}
      {mode === 'month' && (
        <input type="month" className="input w-40 text-sm" value={value.date || ''} onChange={e => onChange({ date: e.target.value || undefined })} />
      )}
      {mode === 'range' && (
        <>
          <input type="date" className="input w-36 text-sm" value={value.from || ''} onChange={e => onChange({ from: e.target.value || undefined, to: value.to })} />
          <span className="text-gray-400 text-sm">ถึง</span>
          <input type="date" className="input w-36 text-sm" value={value.to || ''} onChange={e => onChange({ from: value.from, to: e.target.value || undefined })} />
        </>
      )}
      {mode !== 'all' && (value.date || value.from || value.to) && (
        <button className="text-xs text-gray-500 hover:text-gray-700 underline" onClick={() => changeMode('all')}>ล้างตัวกรอง</button>
      )}
    </div>
  );
}
