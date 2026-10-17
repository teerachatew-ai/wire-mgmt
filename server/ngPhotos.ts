// รูปงาน NG จากกลุ่มไลน์ — บันทึกรูป + ประทับข้อความ (รุ่น / ผู้ส่ง / วันเวลา) ลงบนรูป
// เก็บ 2 ไฟล์ต่อรูป: o_<key> = รูปต้นฉบับ (ย่อแล้ว), s_<key> = รูปที่ประทับข้อความ
// แก้รุ่น/ผู้ส่งทีหลังได้ — ประทับใหม่จากต้นฉบับ (ไม่ประทับทับของเดิมซ้อนกัน)
import path from 'path';
import { prepare, randomToken } from './db';
import { putImage, getImage } from './imageStore';

// sharp โหลดตอนใช้ครั้งแรก — ถ้าติดตั้งไม่สำเร็จ (เช่นไม่มี binary ของเครื่องนั้น) ระบบส่วนอื่นยังทำงานได้
let _sharp: any = null;
function sharp() {
  if (!_sharp) _sharp = require('sharp');
  return _sharp;
}

const FONT_FILE = path.join(process.cwd(), 'fonts', 'THSarabun Bold.ttf');
const MAX_SIDE = 1600;

// เวลาไทย: iso สำหรับเก็บ/เรียง, label สำหรับประทับบนรูป (ปี พ.ศ.)
export function bangkokTime(ms: number) {
  const d = new Date(ms + 7 * 3600 * 1000);
  const p = (n: number) => String(n).padStart(2, '0');
  const y = d.getUTCFullYear(), mo = p(d.getUTCMonth() + 1), da = p(d.getUTCDate()), h = p(d.getUTCHours()), mi = p(d.getUTCMinutes());
  return {
    iso: `${y}-${mo}-${da} ${h}:${mi}:${p(d.getUTCSeconds())}`,
    label: `${Number(da)}/${Number(mo)}/${y + 543} ${h}:${mi} น.`,
  };
}

function isoToLabel(iso: string) {
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/.exec(iso || '');
  return m ? `${Number(m[3])}/${Number(m[2])}/${Number(m[1]) + 543} ${m[4]}:${m[5]} น.` : iso;
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// ข้อมูลที่ใช้ประทับ — ดึงชื่อสมาชิก/รุ่นล่าสุดจากฐานทุกครั้ง (แก้ชื่อสินค้าแล้วประทับใหม่ได้ชื่อใหม่)
function stampLines(photo: any): [string, string] {
  const prod = photo.product_id ? prepare(`SELECT name FROM products WHERE id = ?`).get(photo.product_id) as any : null;
  const mem = photo.member_id ? prepare(`SELECT code, name FROM members WHERE id = ?`).get(photo.member_id) as any : null;
  const who = mem ? `${mem.name} (${mem.code})` : (photo.sender_name || 'ไม่ทราบชื่อ');
  return [
    `งาน NG · รุ่น ${prod?.name || 'ยังไม่ระบุ'}`,
    `ส่งโดย ${who} · ${isoToLabel(photo.sent_at)}`,
  ];
}

async function renderStamp(original: Buffer, lines: [string, string]): Promise<Buffer> {
  const s = sharp();
  const meta = await s(original).metadata();
  const W = meta.width || 1000, H = meta.height || 1000;
  const fontPx = Math.max(22, Math.round(Math.min(W, H * 1.4) / 22));
  const pad = Math.round(fontPx * 0.45);
  const markup = `<span foreground="#FFD54A">${esc(lines[0])}</span>\n<span foreground="white">${esc(lines[1])}</span>`;
  const text = await s({
    text: { text: markup, font: `TH SarabunPSK Bold ${fontPx}`, fontfile: FONT_FILE, rgba: true, dpi: 72, width: W - pad * 2 },
  }).png().toBuffer();
  const tm = await s(text).metadata();
  const bandH = Math.min(H, (tm.height || fontPx * 2) + pad * 2);
  return s(original)
    .composite([
      { input: { create: { width: W, height: bandH, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0.62 } } }, top: H - bandH, left: 0 },
      { input: text, top: H - bandH + pad, left: pad },
    ])
    .jpeg({ quality: 82 })
    .toBuffer();
}

export interface NewNgPhoto {
  image: Buffer;
  line_message_id?: string | null;
  line_user_id?: string | null;
  group_id?: string | null;
  member_id?: number | null;
  sender_name?: string | null;
  product_id?: number | null;
  product_source?: string | null;
  sent_at: string;          // เวลาไทย 'YYYY-MM-DD HH:MM:SS'
}

// บันทึกรูปใหม่ 1 รูป → คืน id ของแถว ng_photos (ถ้ารูปจากไลน์ข้อความนี้เคยบันทึกแล้ว คืน id เดิม)
export async function saveNgPhoto(p: NewNgPhoto): Promise<number> {
  if (p.line_message_id) {
    const dup = prepare(`SELECT id FROM ng_photos WHERE line_message_id = ?`).get(p.line_message_id) as any;
    if (dup) return dup.id;
  }
  // หมุนตาม EXIF (รูปจากมือถือ) + ย่อด้านยาวไม่เกิน 1600px ประหยัดที่เก็บ
  const original = await sharp()(p.image).rotate()
    .resize({ width: MAX_SIDE, height: MAX_SIDE, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 82 }).toBuffer();
  const key = randomToken();
  await putImage('o_' + key, original);
  const row = {
    member_id: p.member_id ?? null, sender_name: p.sender_name ?? null,
    product_id: p.product_id ?? null, sent_at: p.sent_at,
  };
  await putImage('s_' + key, await renderStamp(original, stampLines(row)));
  const r = prepare(`INSERT INTO ng_photos (image_key, line_message_id, line_user_id, group_id, member_id, sender_name,
      product_id, product_source, sent_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(key, p.line_message_id ?? null, p.line_user_id ?? null, p.group_id ?? null, row.member_id, row.sender_name,
      row.product_id, p.product_source ?? null, p.sent_at);
  return r.lastInsertRowid;
}

// ประทับข้อความใหม่จากต้นฉบับ (หลังแก้รุ่น/ผู้ส่ง)
export async function restampNgPhoto(id: number): Promise<void> {
  const photo = prepare(`SELECT * FROM ng_photos WHERE id = ?`).get(id) as any;
  if (!photo) return;
  const orig = await getImage('o_' + photo.image_key);
  if (!orig) return;
  await putImage('s_' + photo.image_key, await renderStamp(orig.data, stampLines(photo)));
  prepare(`UPDATE ng_photos SET updated_at = datetime('now') WHERE id = ?`).run(id);
}

// ผูกบัญชี LINE กับสมาชิกแล้ว → รูปที่ส่งไว้ก่อนผูก (ยังไม่มีชื่อสมาชิก) เติมชื่อให้ + ประทับใหม่ (ทำเบื้องหลัง)
export function assignMemberToUnlinkedPhotos(lineUserId: string, memberId: number) {
  const rows = prepare(`SELECT id FROM ng_photos WHERE line_user_id = ? AND member_id IS NULL AND deleted_at IS NULL`).all(lineUserId) as any[];
  if (!rows.length) return;
  prepare(`UPDATE ng_photos SET member_id = ? WHERE line_user_id = ? AND member_id IS NULL`).run(memberId, lineUserId);
  (async () => {
    for (const r of rows) await restampNgPhoto(r.id).catch(e => console.error('restamp error:', e?.message));
  })();
}
