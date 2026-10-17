// เชื่อมกับ LINE Official Account (Messaging API) — ใช้ส่งแจ้งเตือนเข้ากลุ่มไลน์ตัดสายไฟ
// ต้องตั้ง env var 2 ตัว (ไม่ hardcode ในโค้ด — ดู README/DEPLOY สำหรับวิธีตั้งบน Render):
//   LINE_CHANNEL_ACCESS_TOKEN, LINE_CHANNEL_SECRET
import crypto from 'crypto';
import { prepare } from './db';

const CHANNEL_SECRET = process.env.LINE_CHANNEL_SECRET || '';
const CHANNEL_ACCESS_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN || '';

export function lineConfigured(): boolean {
  return !!CHANNEL_SECRET && !!CHANNEL_ACCESS_TOKEN;
}

// ตรวจลายเซ็นของ webhook (header x-line-signature) ว่ามาจาก LINE จริง ไม่ใช่ใครสุ่มยิงมา
// ต้องคำนวณจาก raw body ตัวเดิมก่อนแปลงเป็น JSON (ดู index.ts ที่ใส่ req.rawBody ไว้ให้)
export function verifyLineSignature(rawBody: Buffer, signature: string | undefined): boolean {
  if (!CHANNEL_SECRET || !signature || !rawBody) return false;
  const hash = crypto.createHmac('sha256', CHANNEL_SECRET).update(rawBody).digest('base64');
  try {
    return crypto.timingSafeEqual(Buffer.from(hash), Buffer.from(signature));
  } catch {
    return false; // ความยาวไม่เท่ากัน (signature รูปแบบผิด) ก็ถือว่าไม่ผ่าน
  }
}

function getSetting(key: string): string {
  const row = prepare(`SELECT value FROM settings WHERE key = ?`).get(key) as any;
  return row?.value || '';
}
function setSetting(key: string, value: string) {
  prepare(`INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)`).run(key, value);
}

// Group ID ของกลุ่มไลน์ตัดสายไฟ — จับอัตโนมัติจาก event แรกที่ webhook เห็นจากกลุ่มนั้น
// (LINE ไม่มีหน้าไหนให้ดู Group ID ตรงๆ ต้องอ่านจาก webhook payload เท่านั้น)
export function getLineGroupId(): string {
  return getSetting('line_group_id');
}
function rememberGroupId(groupId: string) {
  if (getSetting('line_group_id') !== groupId) {
    setSetting('line_group_id', groupId);
    console.log('LINE: บันทึก Group ID ของกลุ่มไว้แล้ว ->', groupId);
  }
}

// ข้อความที่ส่งไลน์ — ใช้แค่ text (+ quickReply ปุ่มลัดใต้ข้อความ) ตามรูปแบบ Messaging API
type LineMessage = { type: 'text'; text: string; quickReply?: any };
export const textMessage = (text: string): LineMessage => ({ type: 'text', text });

async function lineApi(url: string, body?: any): Promise<Response | null> {
  if (!CHANNEL_ACCESS_TOKEN) { console.error('LINE: ไม่ได้ตั้ง LINE_CHANNEL_ACCESS_TOKEN'); return null; }
  try {
    const r = await fetch(url, body === undefined
      ? { headers: { Authorization: `Bearer ${CHANNEL_ACCESS_TOKEN}` } }
      : { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${CHANNEL_ACCESS_TOKEN}` }, body: JSON.stringify(body) });
    if (!r.ok) { console.error('LINE API ล้มเหลว:', url.replace(/\/[^/]{20,}/g, '/…'), r.status, await r.text().catch(() => '')); return null; }
    return r;
  } catch (e: any) {
    console.error('LINE API error:', e?.message);
    return null;
  }
}

// ตอบกลับด้วย replyToken (ฟรี ไม่นับโควตาข้อความ ต่างจาก push) — token ใช้ได้ครั้งเดียวและหมดอายุเร็ว
export async function replyMessage(replyToken: string, messages: LineMessage[]): Promise<boolean> {
  if (!replyToken) return false;
  return !!(await lineApi('https://api.line.me/v2/bot/message/reply', { replyToken, messages }));
}

// ดาวน์โหลดไฟล์รูปที่สมาชิกส่งมา (LINE เก็บไว้ให้ดึงได้ระยะหนึ่งหลังส่ง)
export async function getMessageContent(messageId: string): Promise<Buffer | null> {
  const r = await lineApi(`https://api-data.line.me/v2/bot/message/${encodeURIComponent(messageId)}/content`);
  return r ? Buffer.from(await r.arrayBuffer()) : null;
}

// ชื่อที่แสดงในไลน์ของผู้ส่ง (ในกลุ่มต้องใช้ API ของกลุ่ม — คนที่ยังไม่ได้แอดบอทเป็นเพื่อนก็อ่านได้)
export async function getDisplayName(userId: string, groupId?: string | null): Promise<string | null> {
  const url = groupId
    ? `https://api.line.me/v2/bot/group/${encodeURIComponent(groupId)}/member/${encodeURIComponent(userId)}`
    : `https://api.line.me/v2/bot/profile/${encodeURIComponent(userId)}`;
  const r = await lineApi(url);
  if (!r) return null;
  const j: any = await r.json().catch(() => null);
  return j?.displayName || null;
}

// ที่อยู่เว็บของระบบ (ใส่ลิงก์อัลบั้มในข้อความตอบกลับ) — ตั้ง PUBLIC_BASE_URL ได้ ไม่งั้นจำจาก host ที่ LINE ยิง webhook มา
export function getPublicBaseUrl(): string {
  return (process.env.PUBLIC_BASE_URL || getSetting('public_base_url') || '').replace(/\/+$/, '');
}
export function rememberPublicBaseUrl(url: string) {
  if (!process.env.PUBLIC_BASE_URL && url && getSetting('public_base_url') !== url) setSetting('public_base_url', url);
}

// ส่งข้อความเข้ากลุ่ม/ผู้ใช้ (push = ส่งเองได้ทุกเมื่อ ไม่ต้องรอมีคนทักมาก่อน)
export async function pushMessage(to: string, messages: LineMessage[]): Promise<boolean> {
  if (!to) { console.error('LINE: ยังไม่รู้ Group ID (รอให้มีคนพิมพ์อะไรในกลุ่มสักครั้งก่อน)'); return false; }
  return !!(await lineApi('https://api.line.me/v2/bot/message/push', { to, messages }));
}

// ส่งข้อความเข้ากลุ่มที่จำ Group ID ไว้แล้ว (ทางลัดสำหรับ feature ต่างๆ ที่ยิงเข้ากลุ่มเดียว)
export async function pushToGroup(messages: LineMessage[]): Promise<boolean> {
  const groupId = getLineGroupId();
  return pushMessage(groupId, messages);
}

// ข้อความต้อนรับสมาชิกใหม่ + กฎระเบียบ — แก้ไขได้ทีหลังผ่าน settings (key: line_rules_message)
// โดยไม่ต้อง deploy ใหม่ ถ้ายังไม่ได้ตั้งจะใช้ข้อความ default นี้
const DEFAULT_WELCOME_MESSAGE = `ยินดีต้อนรับเข้ากลุ่มตัดสายไฟครับ 🙏

กฎระเบียบและข้อตกลงในการทำงาน:
(ยังไม่ได้ตั้งค่าข้อความนี้ — แจ้งแอดมินให้ตั้งค่าในระบบ)`;

export function getWelcomeMessage(): string {
  return getSetting('line_rules_message') || DEFAULT_WELCOME_MESSAGE;
}
export function setWelcomeMessage(text: string) {
  setSetting('line_rules_message', text);
}

// จัดการ event เดียวจาก webhook — ทำงานหลังตอบ 200 กลับ LINE ไปแล้ว (ไม่บล็อก response)
export async function handleLineEvent(ev: any): Promise<void> {
  const src = ev?.source || {};
  if (src.type === 'group' && src.groupId) rememberGroupId(src.groupId);

  if (ev.type === 'memberJoined' && src.type === 'group' && src.groupId) {
    await pushMessage(src.groupId, [textMessage(getWelcomeMessage())]);
    return;
  }
  // ข้อความ/รูป/การกดปุ่ม → ผู้ช่วยในกลุ่ม (ผูกบัญชี, เก็บรูปงาน NG ฯลฯ) ดู lineBot.ts
  await require('./lineBot').handleBotEvent(ev);
}
