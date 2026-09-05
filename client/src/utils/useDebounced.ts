import { useState, useEffect } from 'react';

/** หน่วงค่าไว้ก่อนเอาไปคำนวณจริง — ใช้กับช่องค้นหาในหน้าที่มีข้อมูลเยอะ
 *  พิมพ์เร็วๆ จะไม่สั่งกรอง/เรนเดอร์ใหม่ทุกตัวอักษร (ตัวอักษรละหลายร้อย ms บนเครื่องช้า) */
export function useDebounced<T>(value: T, delay = 250): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}
