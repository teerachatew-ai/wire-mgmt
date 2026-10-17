// ผู้ช่วยในกลุ่มไลน์ตัดสายไฟ (Phase 1)
//  - ผูกบัญชี LINE กับสมาชิก: พิมพ์ "ผูก M001"
//  - เก็บรูปงาน NG: ส่งรูป + พิมพ์ข้อความที่มีคำว่า "NG" (ก่อนหรือหลังรูปภายใน 5 นาที) → บันทึกเข้าอัลบั้ม
//    พร้อมประทับ รุ่น / ผู้ส่ง / วันเวลา ลงบนรูป · รูปที่ไม่มีข้อความ NG กำกับ บอทจะไม่ดาวน์โหลด/ไม่เก็บ
//  - ตอบกลับทุกครั้งด้วย replyToken (ฟรี) ไม่ใช้ push ที่กินโควตาข้อความรายเดือน
import { prepare } from './db';
import { replyMessage, getMessageContent, getDisplayName, getPublicBaseUrl, textMessage } from './line';
import { saveNgPhoto, restampNgPhoto, bangkokTime, assignMemberToUnlinkedPhotos } from './ngPhotos';

const WINDOW_MS = 5 * 60 * 1000;   // รูปกับข้อความ NG ห่างกันได้ไม่เกินนี้
const BATCH_MS = 4000;             // ส่งรูปหลายรูปติดกัน → รอรวมแล้วตอบครั้งเดียว

type PendingImage = { messageId: string; ts: number; groupId: string | null };
const pendingImages = new Map<string, PendingImage[]>();      // รูปที่ยังไม่รู้ว่าเป็น NG ไหม (เก็บแค่เลขข้อความ)
const ngWindows = new Map<string, { until: number; productId: number | null; groupId: string | null }>();
const batches = new Map<string, { photoIds: number[]; replyToken: string; timer: NodeJS.Timeout | null; productId: number | null; guessed: boolean; failed: number }>();

// ── สมาชิก / บัญชี LINE ─────────────────────────────────────────────
function lineUser(userId: string): any {
  return prepare(`SELECT lu.*, m.code AS member_code, m.name AS member_name FROM line_users lu
    LEFT JOIN members m ON m.id = lu.member_id WHERE lu.user_id = ?`).get(userId);
}

// จำผู้ใช้ที่พิมพ์ในกลุ่ม — เขียนฐานเฉพาะครั้งแรก/ทุก 1 ชม. (บน cloud ทุกการเขียน = อัปโหลดฐานทั้งก้อน)
async function touchUser(userId: string, groupId: string | null): Promise<any> {
  let u = lineUser(userId);
  if (!u) {
    const name = await getDisplayName(userId, groupId);
    prepare(`INSERT OR IGNORE INTO line_users (user_id, display_name, last_seen) VALUES (?, ?, datetime('now'))`).run(userId, name);
  } else if (!u.display_name || !u.last_seen || Date.now() - Date.parse(u.last_seen + 'Z') > 3600 * 1000) {
    const name = (await getDisplayName(userId, groupId)) || u.display_name;
    prepare(`UPDATE line_users SET display_name = ?, last_seen = datetime('now') WHERE user_id = ?`).run(name, userId);
  } else return u;
  return lineUser(userId);
}

const whoText = (u: any) => u?.member_id ? `${u.member_name} (${u.member_code})` : (u?.display_name || 'ไม่ทราบชื่อ');

// "M1", "m001", "1", "001" → M001 · ถ้าในระบบมีรหัสตรงตัวอักษรอยู่แล้วใช้ตัวนั้นก่อน
function findMemberByCode(raw: string): any {
  const code = raw.trim().toUpperCase();
  const exact = prepare(`SELECT id, code, name FROM members WHERE UPPER(code) = ?`).get(code);
  if (exact) return exact;
  const m = /^M?0*(\d+)$/.exec(code);
  return m ? prepare(`SELECT id, code, name FROM members WHERE UPPER(code) = ?`).get('M' + m[1].padStart(3, '0')) : undefined;
}

function linkCommand(userId: string, rawCode: string): string {
  const mem = findMemberByCode(rawCode);
  if (!mem) return `❌ ไม่พบรหัสสมาชิก "${rawCode}" ในระบบ\nตรวจรหัสอีกครั้ง (เช่น ผูก M001) หรือสอบถามแอดมิน`;
  const me = lineUser(userId);
  if (me?.member_id === mem.id) return `✅ บัญชีนี้ผูกกับ ${mem.name} (${mem.code}) อยู่แล้ว`;
  const other = prepare(`SELECT user_id FROM line_users WHERE member_id = ? AND user_id <> ?`).get(mem.id, userId);
  if (other) return `⚠️ รหัส ${mem.code} ผูกกับบัญชี LINE อื่นไว้แล้ว\nถ้าเปลี่ยนเครื่อง/บัญชีใหม่ ให้แจ้งแอดมินปลดผูกให้ก่อน`;
  if (me?.member_id) return `⚠️ บัญชีนี้ผูกกับ ${me.member_name} (${me.member_code}) อยู่แล้ว\nพิมพ์ "ยกเลิกผูก" ก่อน แล้วค่อยผูกใหม่`;
  prepare(`UPDATE line_users SET member_id = ?, linked_at = datetime('now'), linked_by = 'self' WHERE user_id = ?`).run(mem.id, userId);
  // รูป NG ที่ส่งไว้ก่อนผูกบัญชี — ใส่ชื่อสมาชิกให้ด้วย + ประทับใหม่
  assignMemberToUnlinkedPhotos(userId, mem.id);
  return `✅ ผูกบัญชีเรียบร้อย\nLINE นี้ = ${mem.name} (${mem.code})\nรูปงาน NG ที่ส่งต่อจากนี้จะขึ้นชื่อนี้ให้อัตโนมัติ`;
}

const HELP = `🤖 วิธีใช้ผู้ช่วยกลุ่มตัดสายไฟ
• ผูกบัญชี: พิมพ์ "ผูก รหัสสมาชิก" เช่น ผูก M001
• ส่งรูปงาน NG: ส่งรูป แล้วพิมพ์ "NG" ตามด้วยรุ่น เช่น NG 676_A
   (พิมพ์ก่อนหรือหลังรูปก็ได้ ภายใน 5 นาที ส่งหลายรูปพร้อมกันได้)
   ถ้าไม่ได้พิมพ์รุ่น บอทจะมีปุ่มให้เลือก
• เช็คบัญชี: พิมพ์ "บัญชีฉัน"
• ยกเลิกผูก: พิมพ์ "ยกเลิกผูก"`;

// ── จับคู่รุ่นสินค้าจากข้อความ ──────────────────────────────────────────
// ชื่อสินค้าเช่น "MA020-676_A (ป้ายขาวยาว)" → คีย์ที่ใช้จับ: "ma020676a", "676a", "ป้ายขาวยาว"
// เลือกคีย์ที่ยาวที่สุดที่เจอในข้อความ ("676_A" ชนะ "676") · คีย์ยาวเท่ากันแต่คนละรุ่น = กำกวม ไม่เดา
const norm = (s: string) => String(s || '').toLowerCase().replace(/[\s\-_.,()\[\]/\\:#]+/g, '');
function productKeys(p: any): string[] {
  const name = String(p.name || '');
  const main = name.split('(')[0];
  const keys = [norm(main), norm(p.code)];
  const tail = /-([^-\s(]+)\s*$/.exec(main.trim());
  if (tail) keys.push(norm(tail[1]));
  const paren = /\(([^)]+)\)/.exec(name);
  if (paren) keys.push(norm(paren[1]));
  return [...new Set(keys.filter(k => k.length >= 3))];
}
export function matchProductInText(text: string): number | null {
  const t = norm(text);
  let best: { len: number; ids: Set<number> } = { len: 0, ids: new Set() };
  for (const p of activeProducts()) {
    for (const k of productKeys(p)) {
      if (!t.includes(k)) continue;
      if (k.length > best.len) best = { len: k.length, ids: new Set([p.id]) };
      else if (k.length === best.len) best.ids.add(p.id);
    }
  }
  return best.ids.size === 1 ? [...best.ids][0] : null;
}
function activeProducts(): any[] {
  return prepare(`SELECT id, code, name FROM products WHERE active = 1 ORDER BY code`).all();
}
// ไม่ได้พิมพ์รุ่นมา → ถ้าสมาชิกเบิกงานไปแค่รุ่นเดียวใน 10 วันล่าสุด เดาว่าเป็นรุ่นนั้น (ยังมีปุ่มให้แก้)
function guessProduct(memberId: number | null): number | null {
  if (!memberId) return null;
  const rows = prepare(`SELECT DISTINCT product_id FROM issues WHERE member_id = ? AND issued_at >= date('now', '-10 days')`).all(memberId) as any[];
  return rows.length === 1 ? rows[0].product_id : null;
}
const shortName = (name: string) => String(name || '').split('(')[0].trim().slice(0, 20) || String(name).slice(0, 20);

function productQuickReply(photoIds: number[]) {
  const items = activeProducts().slice(0, 13).map(p => ({
    type: 'action',
    action: { type: 'postback', label: shortName(p.name), data: `a=ngp&ids=${photoIds.join(',')}&p=${p.id}`, displayText: `รุ่น ${p.name}` },
  }));
  return items.length ? { items } : undefined;
}

// ── รูป NG ─────────────────────────────────────────────────────────
const isNgText = (t: string) => /(^|[^a-z])ng([^a-z]|$)/i.test(t) || /เอ็นจี|งานเสีย/.test(t);

async function captureImage(userId: string, img: PendingImage, productId: number | null, guessed: boolean, replyToken: string) {
  let b = batches.get(userId);
  if (!b) { b = { photoIds: [], replyToken, timer: null, productId, guessed, failed: 0 }; batches.set(userId, b); }
  b.replyToken = replyToken || b.replyToken;
  try {
    const buf = await getMessageContent(img.messageId);
    if (!buf) throw new Error('ดาวน์โหลดรูปจาก LINE ไม่ได้');
    const u = lineUser(userId);
    const id = await saveNgPhoto({
      image: buf, line_message_id: img.messageId, line_user_id: userId, group_id: img.groupId,
      member_id: u?.member_id ?? null, sender_name: u?.display_name ?? null,
      product_id: productId, product_source: productId ? (guessed ? 'guess' : 'text') : null,
      sent_at: bangkokTime(img.ts).iso,
    });
    b.photoIds.push(id);
  } catch (e: any) {
    b.failed++;
    console.error('LINE: บันทึกรูป NG ไม่สำเร็จ:', e?.message);
  }
  if (b.timer) clearTimeout(b.timer);
  b.timer = setTimeout(() => flushBatch(userId).catch(e => console.error('LINE reply error:', e?.message)), BATCH_MS);
}

async function flushBatch(userId: string) {
  const b = batches.get(userId);
  batches.delete(userId);
  if (!b) return;
  const u = lineUser(userId);
  const lines: string[] = [];
  if (b.photoIds.length) {
    lines.push(`📸 บันทึกรูปงาน NG เข้าอัลบั้มแล้ว ${b.photoIds.length} รูป`);
    lines.push(`ผู้ส่ง: ${whoText(u)}`);
    const prod = b.productId ? prepare(`SELECT name FROM products WHERE id = ?`).get(b.productId) as any : null;
    if (prod) lines.push(`รุ่น: ${prod.name}${b.guessed ? ' (เดาจากงานที่เบิกล่าสุด ถ้าไม่ใช่กดเลือกใหม่ 👇)' : ''}`);
    else lines.push('รุ่น: ยังไม่ระบุ — กดเลือกรุ่นด้านล่าง 👇');
  }
  if (b.failed) lines.push(`⚠️ มี ${b.failed} รูปบันทึกไม่สำเร็จ ลองส่งใหม่อีกครั้ง`);
  if (b.photoIds.length && !u?.member_id) lines.push('ℹ️ บัญชีนี้ยังไม่ได้ผูกกับสมาชิก — พิมพ์ "ผูก รหัสสมาชิก" เช่น ผูก M001');
  const base = getPublicBaseUrl();
  if (b.photoIds.length && base) lines.push(`ดูอัลบั้ม: ${base}/ng-album`);
  if (!lines.length) return;
  const msg = textMessage(lines.join('\n'));
  if (b.photoIds.length && (!b.productId || b.guessed)) msg.quickReply = productQuickReply(b.photoIds);
  await replyMessage(b.replyToken, [msg]);
}

function prune(userId: string) {
  const now = Date.now();
  const list = (pendingImages.get(userId) || []).filter(i => now - i.ts < WINDOW_MS);
  if (list.length) pendingImages.set(userId, list); else pendingImages.delete(userId);
  const w = ngWindows.get(userId);
  if (w && w.until < now) ngWindows.delete(userId);
}

// ── เลือกรุ่นจากปุ่ม ───────────────────────────────────────────────
async function handlePostback(ev: any) {
  const q = new URLSearchParams(String(ev.postback?.data || ''));
  if (q.get('a') !== 'ngp') return;
  const pid = Number(q.get('p'));
  const ids = String(q.get('ids') || '').split(',').map(Number).filter(Boolean).slice(0, 50);
  const prod = prepare(`SELECT id, name FROM products WHERE id = ?`).get(pid) as any;
  if (!prod || !ids.length) return;
  let n = 0;
  for (const id of ids) {
    // แก้ได้เฉพาะรูปที่ส่งมาไม่เกิน 2 วัน (ปุ่มเก่าในแชทกดย้อนหลังไม่ได้แล้ว) — เกินนั้นแก้ในเว็บ
    const r = prepare(`SELECT id FROM ng_photos WHERE id = ? AND deleted_at IS NULL AND created_at >= datetime('now', '-2 days')`).get(id);
    if (!r) continue;
    prepare(`UPDATE ng_photos SET product_id = ?, product_source = 'pick' WHERE id = ?`).run(pid, id);
    await restampNgPhoto(id).catch(e => console.error('restamp error:', e?.message));
    n++;
  }
  await replyMessage(ev.replyToken, [textMessage(n
    ? `✅ ตั้งรุ่นเป็น ${prod.name} แล้ว (${n} รูป)`
    : '⚠️ ปุ่มนี้หมดอายุแล้ว (เกิน 2 วัน) — แก้รุ่นได้ที่หน้าอัลบั้ม NG ในเว็บ')]);
}

// ── ตัวรับ event ──────────────────────────────────────────────────
export async function handleBotEvent(ev: any): Promise<void> {
  const src = ev?.source || {};
  const userId: string | undefined = src.userId;
  if (!userId) return;
  const groupId: string | null = src.groupId || src.roomId || null;

  if (ev.type === 'postback') return handlePostback(ev);
  if (ev.type !== 'message') return;
  const m = ev.message || {};
  await touchUser(userId, groupId);
  prune(userId);

  if (m.type === 'image') {
    const img: PendingImage = { messageId: m.id, ts: ev.timestamp || Date.now(), groupId };
    const w = ngWindows.get(userId);
    if (w) {
      // อยู่ในช่วงหลังพิมพ์ NG แล้ว → เก็บเลย
      const productId = w.productId ?? guessProduct(lineUser(userId)?.member_id ?? null);
      await captureImage(userId, img, productId, !w.productId && !!productId, ev.replyToken);
    } else {
      // ยังไม่รู้ว่าเป็นรูป NG ไหม → จำเลขข้อความไว้ 5 นาที เผื่อตามด้วยข้อความ NG
      const list = pendingImages.get(userId) || [];
      list.push(img);
      pendingImages.set(userId, list.slice(-20));
    }
    return;
  }

  if (m.type !== 'text') return;
  const text = String(m.text || '').trim();

  const link = /^ผูก(?:บัญชี)?\s*[:：]?\s*([A-Za-z]*\s*\d+)$/i.exec(text);
  if (link) { await replyMessage(ev.replyToken, [textMessage(linkCommand(userId, link[1].replace(/\s+/g, '')))]); return; }
  if (/^(ยกเลิกผูก|ยกเลิกการผูก)(บัญชี)?$/.test(text)) {
    const u = lineUser(userId);
    if (u?.member_id) prepare(`UPDATE line_users SET member_id = NULL, linked_at = NULL, linked_by = NULL WHERE user_id = ?`).run(userId);
    await replyMessage(ev.replyToken, [textMessage(u?.member_id ? `ปลดผูกบัญชีจาก ${u.member_name} (${u.member_code}) แล้ว` : 'บัญชีนี้ยังไม่ได้ผูกกับสมาชิก')]);
    return;
  }
  if (/^(บัญชีฉัน|เช็คบัญชี|ฉันคือใคร)$/.test(text)) {
    const u = lineUser(userId);
    await replyMessage(ev.replyToken, [textMessage(u?.member_id
      ? `บัญชี LINE นี้ผูกกับ ${u.member_name} (${u.member_code})`
      : 'บัญชีนี้ยังไม่ได้ผูกกับสมาชิก\nพิมพ์ "ผูก รหัสสมาชิก" เช่น ผูก M001')]);
    return;
  }
  if (/^(บอท|bot|help|วิธีใช้|คำสั่ง|ช่วยเหลือ)$/i.test(text)) { await replyMessage(ev.replyToken, [textMessage(HELP)]); return; }

  if (isNgText(text)) {
    const textProduct = matchProductInText(text);
    ngWindows.set(userId, { until: Date.now() + WINDOW_MS, productId: textProduct, groupId });
    const before = pendingImages.get(userId) || [];
    pendingImages.delete(userId);
    if (!before.length) return; // ยังไม่มีรูป — รอรูปที่ตามมา (เงียบไว้ ไม่ตอบให้รกกลุ่ม)
    const productId = textProduct ?? guessProduct(lineUser(userId)?.member_id ?? null);
    for (const img of before) await captureImage(userId, img, productId, !textProduct && !!productId, ev.replyToken);
  }
}
