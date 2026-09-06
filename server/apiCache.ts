import type { Request, Response, NextFunction } from 'express';
import { dataVersion } from './db';

/* cache คำตอบของ GET /api/* ไว้ในหน่วยความจำ
 *
 * ทำไมต้องมี: เซิร์ฟเวอร์ (Render free) มี CPU แค่ 0.1 core และ Node ทำงานทีละอย่าง
 * เปิดหน้าเว็บ 1 หน้ายิง API ~6 เส้น ถ้า 3 คนเปิดพร้อมกัน = 18 request ต่อคิวกันบน CPU เดียว
 * (วัดจริง: 1 คน 890ms -> 3 คนพร้อมกัน 1,500ms)
 * ข้อมูลที่แต่ละคนขอเป็นชุดเดียวกันเป๊ะ (API ไม่ได้แยกตามผู้ใช้) จึงคำนวณครั้งเดียวพอ
 * คนที่ 2 และ 3 อ่านจาก cache ได้เลย ไม่กิน CPU ซ้ำ — ยิ่งคนเยอะยิ่งได้ผล
 *
 * ความถูกต้อง: กุญแจ cache ผูกกับ "เลขเวอร์ชันข้อมูล" ที่ขยับทุกครั้งที่มีการเขียน (db.save())
 * พอมีใครบันทึกอะไร ของเก่าในนี้จะถือว่าหมดอายุทันทีทั้งหมด ไม่มีทางอ่านได้ข้อมูลเก่า
 */

interface Entry { version: number; body: string; at: number; }

const cache = new Map<string, Entry>();
const MAX_ENTRIES = 200;
const MAX_BODY_BYTES = 2 * 1024 * 1024;   // ไม่ cache คำตอบที่ใหญ่เกินไป กันกินหน่วยความจำ

// endpoint ที่ไม่ควร cache
function skip(url: string) {
  return url.startsWith('/ping')            // มี timestamp + ใช้เป็น health check ต้องสดเสมอ
    || url.startsWith('/smartcard')         // อ่านจากเครื่องอ่านบัตรจริง ต้องสดเสมอ
    || url.includes('-export');             // ไฟล์ดาวน์โหลด (ไม่ใช่ JSON)
}

export function apiCache(req: Request, res: Response, next: NextFunction) {
  if (req.method !== 'GET' || skip(req.url)) return next();

  const key = req.originalUrl;
  const version = dataVersion();
  const hit = cache.get(key);
  if (hit && hit.version === version) {
    res.setHeader('X-Cache', 'HIT');
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    return res.send(hit.body);
  }

  // ดักตอนตอบกลับเพื่อเก็บผลลัพธ์ไว้ใช้ซ้ำ
  const origJson = res.json.bind(res);
  res.json = (body: any) => {
    try {
      if (res.statusCode === 200) {
        const text = JSON.stringify(body);
        if (text.length <= MAX_BODY_BYTES) {
          // จำกัดจำนวนรายการ — ทิ้งอันที่เก่าสุดเมื่อเต็ม
          if (cache.size >= MAX_ENTRIES) {
            const oldest = [...cache.entries()].sort((a, b) => a[1].at - b[1].at)[0];
            if (oldest) cache.delete(oldest[0]);
          }
          cache.set(key, { version, body: text, at: Date.now() });
        }
      }
    } catch { /* cache พังไม่ควรทำให้ request พัง */ }
    res.setHeader('X-Cache', 'MISS');
    return origJson(body);
  };
  next();
}
