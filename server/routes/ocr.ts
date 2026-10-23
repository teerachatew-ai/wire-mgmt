import { Router } from 'express';
import multer from 'multer';
import Anthropic from '@anthropic-ai/sdk';
import fs from 'fs';
import path from 'path';
import { prepare } from '../db';

const router = Router();
const uploadDir = path.join(__dirname, '..', '..', 'uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
const upload = multer({ dest: uploadDir, limits: { fileSize: 10 * 1024 * 1024 } });

function requireApiKey(req: any, res: any): boolean {
  if (!process.env.ANTHROPIC_API_KEY) {
    if (req.file) try { fs.unlinkSync(req.file.path); } catch {}
    res.status(503).json({ error: 'ยังไม่ได้ตั้งค่า ANTHROPIC_API_KEY' });
    return false;
  }
  return true;
}

function fileBlock(filePath: string, mimeType: string): any {
  const base64 = fs.readFileSync(filePath).toString('base64');
  return mimeType === 'application/pdf'
    ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: base64 } }
    : { type: 'image', source: { type: 'base64', media_type: mimeType as any, data: base64 } };
}

async function callClaude(filePath: string, mimeType: string, prompt: string, maxTokens = 1024) {
  const client = new Anthropic();
  const response = await client.messages.create({
    model: 'claude-opus-4-5',
    max_tokens: maxTokens,
    messages: [{ role: 'user', content: [ fileBlock(filePath, mimeType), { type: 'text', text: prompt } ] }]
  });
  return (response.content[0] as any).text as string;
}

// อ่านหลายไฟล์/หลายหน้าในครั้งเดียว
async function callClaudeMulti(files: { path: string; mime: string }[], prompt: string, maxTokens = 4096) {
  const client = new Anthropic();
  const content: any[] = files.map(f => fileBlock(f.path, f.mime));
  content.push({ type: 'text', text: prompt });
  const response = await client.messages.create({
    model: 'claude-opus-4-5',
    max_tokens: maxTokens,
    messages: [{ role: 'user', content }]
  });
  return (response.content[0] as any).text as string;
}

/* ── OCR ฟอร์มเบิก/คืน ── */
router.post('/read-form', upload.single('image'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'กรุณาแนบไฟล์ (รูปภาพ หรือ PDF)' });
  if (!requireApiKey(req, res)) return;
  try {
    const text = await callClaude(req.file.path, req.file.mimetype, `อ่านแบบฟอร์มเบิก/คืนงานตัดสายไฟนี้ แล้วตอบเป็น JSON เท่านั้น:
{
  "form_type": "issue" หรือ "return",
  "issue_code": "รหัสใบเบิก เช่น IS001",
  "member_code": "รหัสสมาชิก เช่น M001",
  "member_name": "ชื่อสมาชิก",
  "product_code": "รหัสสินค้า",
  "product_name": "ชื่อสินค้า",
  "date": "YYYY-MM-DD",
  "quantity": จำนวน (ตัวเลข หรือ null),
  "due_date": "YYYY-MM-DD หรือ null",
  "good_qty": จำนวนงานดี (null ถ้าเป็นใบเบิก),
  "defect_qty": จำนวนงานเสีย (null ถ้าเป็นใบเบิก),
  "waste_qty": จำนวนเศษ (null ถ้าเป็นใบเบิก),
  "notes": "หมายเหตุ หรือ null",
  "confidence": "high/medium/low",
  "uncertain_fields": ["ชื่อ field ที่อ่านไม่ชัด"]
}
ตอบ JSON เท่านั้น`);
    fs.unlinkSync(req.file.path);
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return res.status(422).json({ error: 'ไม่สามารถอ่านฟอร์มได้', raw: text });
    res.json({ extracted: JSON.parse(match[0]) });
  } catch (err: any) {
    if (req.file) try { fs.unlinkSync(req.file.path); } catch {}
    res.status(500).json({ error: err.message || 'เกิดข้อผิดพลาด' });
  }
});

/* ── อ่านใบรายชื่อผู้รับสายไฟรายวัน (รูป / PDF / Excel) → ร่างใบเบิกหลายคน ──
   ส่งได้ 2 แบบ: multipart "file" (รูป/PDF) หรือ JSON { csv } (หน้าเว็บแปลง Excel เป็น CSV ให้แล้ว)
   ส่งรายชื่อสินค้า + สมาชิก (ชื่อเล่น) ไปด้วย ให้จับคู่คอลัมน์/ชื่อเป็น id เลย — หน้าเว็บให้ตรวจ/แก้ก่อนบันทึกเสมอ
   ไม่บันทึกอะไรลงฐานข้อมูล (แค่อ่าน) */
/* ── จับคู่ชื่อในใบเบิก → สมาชิก ─────────────────────────────────────────────
   1) ชื่อที่เคยจับคู่ไว้แล้ว (member_aliases — ระบบจำจากการนำเข้าครั้งก่อน)  2) ชื่อเล่น/ชื่อตรงกันหลังตัดคำนำหน้า
   (พี่/น้า/ป้า/น้อง/ยาย/ลุง ฯลฯ) และคำบอกที่อยู่ (ม.7, หมู่ 10) — รวมชื่อในวงเล็บของชื่อเล่น เช่น "เอิญ หมู่ 10 (บอย)" = บอย
   ถ้าตรงคนเดียว = มั่นใจ · ตรงหลายคน/ไม่ตรงเลย = ให้ AI ช่วย (หรือให้ผู้ใช้เลือกเอง) */
const PREFIX = /^(พี่|น้า|ป้า|น้อง|ยาย|ลุง|คุณ|นางสาว|นาง|นาย|น\.ส\.|ด\.ช\.|ด\.ญ\.)\s*/;
export const normAlias = (s: string) => String(s || '').replace(/\s+/g, ' ').trim().toLowerCase();
const coreName = (s: string) => {
  let t = String(s || '').replace(/[()]/g, ' ').replace(/(ม\.|หมู่)\s*\d+/g, ' ').replace(/\d+/g, ' ').trim();
  for (let i = 0; i < 3; i++) t = t.replace(PREFIX, '').trim();
  return t.replace(/[\u0E47-\u0E4C]/g, '').replace(/\s+/g, '');   // ไม่สนวรรณยุกต์/ไม้ไต่คู้ (เจ็ก = เจ๊ก)
};
function memberTokens(m: any): string[] {
  const out = new Set<string>();
  const nick = String(m.nickname || ''), full = String(m.name || '');
  const inParen = (x: string) => (x.match(/\(([^)]*)\)/g) || []).map(p => p.slice(1, -1));
  const first = full.replace(/\([^)]*\)/g, ' ').replace(PREFIX, '').trim().split(/\s+/)[0] || '';
  const parts = [nick, nick.replace(/\([^)]*\)/g, ' '), ...inParen(nick), ...inParen(full), first];
  for (const p of parts) {
    const c = coreName(p); if (c) out.add(c);
    for (const w of p.split(/[+,/&\s]|และ/)) { const c2 = coreName(w); if (c2 && c2.length >= 2) out.add(c2); }
  }
  for (const w of nick.replace(/[()]/g, ' ').split(/\s+/)) { const c = coreName(w); if (c && c.length >= 2) out.add(c); }
  return [...out];
}
function matchMembers(names: string[], members: any[]): Map<string, { member_id: number | null; conf: string; candidates: number[] }> {
  const aliases = new Map((prepare(`SELECT alias, member_id FROM member_aliases`).all() as any[]).map(a => [a.alias, Number(a.member_id)]));
  const active = new Set(members.map(m => m.id));
  const toks = members.map(m => ({ id: m.id, t: memberTokens(m) }));
  const out = new Map<string, { member_id: number | null; conf: string; candidates: number[] }>();
  for (const name of names) {
    const a = aliases.get(normAlias(name));
    if (a && active.has(a)) { out.set(name, { member_id: a, conf: 'high', candidates: [a] }); continue; }
    const c = coreName(name);
    const hits = c ? toks.filter(x => x.t.includes(c)).map(x => x.id) : [];
    out.set(name, hits.length === 1 ? { member_id: hits[0], conf: 'high', candidates: hits } : { member_id: null, conf: 'low', candidates: hits });
  }
  return out;
}

// หัวกลุ่มในใบ → โครงการ · รหัส 3 หลัก + ยาว/สั้น/กลาง/อ้วน → สินค้า
const GROUP_PROJECT: [RegExp, string][] = [[/ชมพูใหม่|109/, 'COT109'], [/ป้ายชมพู|ชมพู|092/, 'COT092'], [/สามสาย|3\s*สาย|ป้ายเหลือง|102/, 'COT102'], [/ป้ายขาว|ขาว|091/, 'COT091']];
function matchProduct(group: string, label: string, products: any[]): number | null {
  const proj = GROUP_PROJECT.find(([re]) => re.test(group))?.[1];
  const code = (String(label).match(/\d{3}/) || [])[0];
  if (!code) return null;
  const kw = ['ยาว', 'สั้น', 'กลาง', 'อ้วน', 'ผอม'].find(k => String(label).includes(k));
  let cand = products.filter(p => String(p.name).includes(code) && (!proj || p.project === proj));
  if (cand.length > 1 && kw) { const k2 = cand.filter(p => String(p.name).includes(kw)); if (k2.length) cand = k2; }
  if (!cand.length && !proj) cand = products.filter(p => String(p.name).includes(code));   // รู้กลุ่มแล้วห้ามข้ามไปกลุ่มอื่น (674 มีทั้งชมพูเดิม/ชมพูใหม่)
  return cand.length === 1 ? cand[0].id : null;
}

// ระบบจำชื่อในใบ → สมาชิก (เรียกหลังบันทึกใบเบิกจากการนำเข้าสำเร็จ)
router.post('/issue-aliases', (req, res) => {
  const pairs = Array.isArray(req.body?.pairs) ? req.body.pairs : [];
  let n = 0;
  for (const p of pairs) {
    const alias = normAlias(p?.alias);
    const mid = Number(p?.member_id);
    if (!alias || !Number.isFinite(mid) || mid <= 0) continue;
    prepare(`INSERT OR REPLACE INTO member_aliases (alias, member_id, updated_at) VALUES (?, ?, datetime('now'))`).run(alias, mid);
    n++;
  }
  res.json({ ok: true, saved: n });
});

router.post('/read-issue-sheet', upload.single('file'), async (req, res) => {
  const csv = typeof req.body?.csv === 'string' ? req.body.csv : '';
  let parsed: any = null;
  try { parsed = typeof req.body?.parsed === 'string' ? JSON.parse(req.body.parsed) : (req.body?.parsed || null); } catch { parsed = null; }
  if (!req.file && !csv.trim() && !parsed) return res.status(400).json({ error: 'กรุณาแนบรูป / PDF / Excel' });
  const products = prepare(`SELECT id, name, project FROM products WHERE active = 1 ORDER BY project, id`).all() as any[];
  const members = prepare(`SELECT id, code, name, nickname FROM members WHERE status = 'active' ORDER BY code`).all() as any[];

  /* Excel แบบฟอร์ม "รับงานจากโรงงาน" ที่หน้าเว็บแยกตารางมาให้แล้ว (อ่านตัวเลขตรงจากไฟล์ — ไม่ต้องเดา)
     เหลือแค่จับคู่คอลัมน์→สินค้า และชื่อ→สมาชิก · ชื่อที่จับคู่เองไม่ได้ค่อยถาม AI (ถ้ามีคีย์) */
  if (parsed && Array.isArray(parsed.columns) && Array.isArray(parsed.rows)) {
    const colPid = parsed.columns.map((c: any) => matchProduct(String(c.group || ''), String(c.label || ''), products));
    const names = [...new Set(parsed.rows.map((r: any) => String(r.name || '').trim()).filter(Boolean))] as string[];
    const mm = matchMembers(names, members);
    const unsure = names.filter(n => !mm.get(n)!.member_id);
    if (unsure.length && process.env.ANTHROPIC_API_KEY) {
      try {
        const client = new Anthropic();
        const prompt = `จับคู่ชื่อเล่นในใบเบิกงาน กับรายชื่อสมาชิก (id | รหัส | ชื่อ | ชื่อเล่น):
${members.map(m => `${m.id} | ${m.code} | ${m.name} | ${m.nickname || '-'}`).join('\n')}
คำนำหน้า พี่/น้า/ป้า/น้อง/ยาย ไม่ต้องสนใจ · ม.7 / หมู่ 10 = หมู่บ้าน · ชื่อในวงเล็บของชื่อเล่นเป็นชื่อเรียกอีกชื่อ
ชื่อที่ต้องจับคู่: ${unsure.map(n => JSON.stringify(n)).join(', ')}
ตอบ JSON เท่านั้น: {"ชื่อในใบ": {"member_id": id หรือ null, "confidence": "high/medium/low"}} — ไม่แน่ใจให้ null`;
        const ask = (model: string) => client.messages.create({ model, max_tokens: 2048, messages: [{ role: 'user', content: prompt }] });
        let r: any; try { r = await ask('claude-opus-5-5'); } catch { r = await ask('claude-opus-4-5'); }
        const t = (r.content.find((c: any) => c.type === 'text') as any)?.text || '';
        const j = JSON.parse((t.match(/\{[\s\S]*\}/) || ['{}'])[0]);
        const ok = new Set(members.map(m => m.id));
        for (const n of unsure) {
          const v = j[n];
          if (v && ok.has(Number(v.member_id))) mm.set(n, { member_id: Number(v.member_id), conf: v.confidence === 'high' ? 'medium' : 'low', candidates: [] });
        }
      } catch { /* จับคู่ไม่ได้ก็ให้ผู้ใช้เลือกเอง */ }
    }
    const rows = parsed.rows.map((r: any) => {
      const m = mm.get(String(r.name || '').trim()) || { member_id: null, conf: 'low' };
      const lines = (r.values || []).map((v: any, i: number) => ({ product_id: colPid[i], qty: Number(v) || 0 }))
        .filter((l: any) => l.product_id && l.qty > 0);
      return { sheet_name: String(r.name || '').trim(), member_id: m.member_id, member_confidence: m.conf, lines, issue_date: r.date || null };
    }).filter((r: any) => r.lines.length > 0);
    const missingCols = parsed.columns.filter((_: any, i: number) => !colPid[i]).map((c: any) => `${c.group} ${c.label}`.trim());
    return res.json({
      date: parsed.date || null, rows,
      columns: parsed.columns.map((c: any, i: number) => ({ header: `${c.group} ${c.label}`.trim(), product_id: colPid[i] })),
      notes: missingCols.length ? `จับคู่คอลัมน์ไม่ได้: ${missingCols.join(', ')}` : null,
      source: 'excel-form',
    });
  }

  if (!requireApiKey(req, res)) return;
  const prompt = `นี่คือใบ "รายชื่อผู้รับสายไฟรายวัน" ของกลุ่มตัดสายไฟ: แถว = สมาชิก (ชื่อเล่น), คอลัมน์ = ชนิดสายไฟ, ตัวเลขในช่อง = จำนวนเส้นที่เบิกไป
หัวคอลัมน์มักมีหัวกลุ่ม (เช่น ป้ายขาว / ป้ายชมพู / 3 สาย ป้ายเหลือง / สามสาย / ชมพูใหม่ / COT109) และรหัส+ชนิด (เช่น 676 ยาว, 633 สั้น, 652 กลาง)

แบบฟอร์มที่พบบ่อย "รับงานจากโรงงาน วัน...ที่ ... 2569": คอลัมน์ ที่ | วัน/เดือน/ปี ที่รับงาน | ชื่อ | จำนวนที่รับเข้า ป้ายขาว (676 ยาว, 633 สั้น)
| ป้ายชมพู (674 ยาว, 676 สั้น) | สามสาย (652 กลาง, 653 ยาว, 656 อ้วน) | ชมพูใหม่ (674 ยาว, 675 สั้น) | วันที่ส่งงาน
- แถวตัวเลขที่อยู่ใต้หัวตารางทันทีแต่ไม่มีชื่อ (เช่น 7,000 / 2,350) = ยอดรับเข้าจากโรงงาน/ยอดยกมา ไม่ใช่สมาชิก — ห้ามใส่
- แถว "รวมรวมสิ้น" / "ยอดคงเหลือยกไป" = แถวสรุป ห้ามใส่ · คอลัมน์ "วันที่ส่งงาน" ไม่ต้องอ่าน
- 1 คนใช้ 2 บรรทัด (ช่องผสาน) — ตัวเลขของคนนั้นอยู่บรรทัดเดียวกับชื่อ · ใน 1 หน้าอาจมีตาราง 2 ชุด (ลำดับ 1–13 และ 14–26) อ่านทั้งสองชุด
- ระวัง: 676 มีทั้งในป้ายขาว (ยาว) และป้ายชมพู (สั้น) · 674 มีทั้งป้ายชมพูและชมพูใหม่ — ต้องดูหัวกลุ่มเหนือคอลัมน์เสมอ

รายชื่อสินค้าในระบบ (id | ชื่อ | โครงการ):
${products.map(p => `${p.id} | ${p.name} | ${p.project || '-'}`).join('\n')}
คำแนะนำจับคู่: ป้ายขาว = COT091 · ป้ายชมพู = COT092 · 3 สาย/ป้ายเหลือง = COT102 · COT109 = ชมพูใหม่ (รหัสซ้ำกันข้ามกลุ่มได้ เช่น 676 ยาว ในป้ายขาว ≠ 676 สั้น ในป้ายชมพู ให้ดูหัวกลุ่มด้วย)

รายชื่อสมาชิก (id | รหัส | ชื่อ | ชื่อเล่น):
${members.map(m => `${m.id} | ${m.code} | ${m.name} | ${m.nickname || '-'}`).join('\n')}
จับคู่ชื่อในใบกับสมาชิก: ใช้ชื่อเล่น/ชื่อที่ใกล้ที่สุด (คำนำหน้า พี่/น้า/ป้า/น้อง/ยาย ไม่ต้องสนใจ, วงเล็บ เช่น (ทีมพี่ฝน) เป็นส่วนเสริม) ถ้าไม่แน่ใจให้ member_id = null

ตอบเป็น JSON เท่านั้น:
{
  "date": "YYYY-MM-DD หรือ null (วันที่ในหัวกระดาษ ถ้าเป็น พ.ศ. ให้แปลงเป็น ค.ศ.)",
  "columns": [{ "header": "ข้อความหัวคอลัมน์", "product_id": id หรือ null }],
  "rows": [{ "sheet_name": "ชื่อตามที่เขียนในใบ", "member_id": id หรือ null, "member_confidence": "high/medium/low",
             "lines": [{ "product_id": id, "qty": จำนวน }] }],
  "notes": "สิ่งที่อ่านไม่ชัด หรือ null"
}
- ใส่เฉพาะแถวสมาชิก ไม่เอาแถวสรุป (จ่ายงานออกทั้งหมด / งานคงเหลือ / งานรวม / ขาด-เกิน)
- lines ใส่เฉพาะช่องที่มีตัวเลข > 0 · ช่องว่าง/ขีด = ไม่มี`;
  try {
    const client = new Anthropic();
    const content: any[] = req.file
      ? [fileBlock(req.file.path, req.file.mimetype), { type: 'text', text: prompt }]
      : [{ type: 'text', text: `ข้อมูลจากไฟล์ Excel (CSV):\n${csv.slice(0, 60000)}\n\n${prompt}` }];
    const ask = (model: string) => client.messages.create({ model, max_tokens: 8192, messages: [{ role: 'user', content }] });
    let response: any;
    try { response = await ask('claude-opus-5-5'); } catch { response = await ask('claude-opus-4-5'); }
    if (req.file) try { fs.unlinkSync(req.file.path); } catch {}
    const text = (response.content.find((c: any) => c.type === 'text') as any)?.text || '';
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return res.status(422).json({ error: 'อ่านใบไม่ออก ลองถ่ายรูปให้ชัดขึ้น', raw: text });
    const out = JSON.parse(match[0]);
    const pid = new Set(products.map(p => p.id)), mid = new Set(members.map(m => m.id));
    const known = matchMembers((out.rows || []).map((r: any) => String(r.sheet_name || '').trim()).filter(Boolean), members);
    out.rows = (out.rows || []).map((r: any) => ({
      ...r, ...(() => { const k = known.get(String(r.sheet_name || '').trim()); return k?.member_id ? { member_id: k.member_id, member_confidence: 'high' } : {}; })(),
      member_id: (() => { const k = known.get(String(r.sheet_name || '').trim()); return k?.member_id ?? (mid.has(Number(r.member_id)) ? Number(r.member_id) : null); })(),
      lines: (r.lines || []).filter((l: any) => pid.has(Number(l.product_id)) && Number(l.qty) > 0)
        .map((l: any) => ({ product_id: Number(l.product_id), qty: Number(l.qty) })),
    })).filter((r: any) => r.lines.length > 0);
    res.json(out);
  } catch (err: any) {
    if (req.file) try { fs.unlinkSync(req.file.path); } catch {}
    res.status(500).json({ error: err.message || 'เกิดข้อผิดพลาด' });
  }
});

/* ── OCR บัตรประชาชน ── */
router.post('/read-id-card', upload.single('image'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'กรุณาแนบรูปบัตรประชาชน' });
  if (!requireApiKey(req, res)) return;
  try {
    const text = await callClaude(req.file.path, req.file.mimetype, `นี่คือรูปบัตรประชาชนไทย (หรือสำเนา) กรุณาอ่านข้อมูลทั้งหมดและตอบเป็น JSON เท่านั้น:
{
  "id_number": "เลขบัตรประชาชน 13 หลัก (ตัวเลขเท่านั้น ไม่มีขีด)",
  "title": "คำนำหน้า เช่น นาย นาง นางสาว",
  "first_name_th": "ชื่อภาษาไทย",
  "last_name_th": "นามสกุลภาษาไทย",
  "first_name_en": "ชื่อภาษาอังกฤษ หรือ null",
  "last_name_en": "นามสกุลภาษาอังกฤษ หรือ null",
  "date_of_birth": "วันเกิด รูปแบบ YYYY-MM-DD หรือ null",
  "address": "ที่อยู่เต็ม รวมบ้านเลขที่ ถนน ตำบล อำเภอ จังหวัด รหัสไปรษณีย์",
  "issue_date": "วันออกบัตร YYYY-MM-DD หรือ null",
  "expiry_date": "วันหมดอายุ YYYY-MM-DD หรือ null",
  "confidence": "high/medium/low",
  "uncertain_fields": ["ชื่อ field ที่อ่านไม่ชัดเจน"]
}

หมายเหตุ:
- หากเป็นบัตรด้านหน้า จะมีชื่อ-ที่อยู่
- หากเป็นบัตรด้านหลัง (มีบาร์โค้ด) ให้อ่านเลขบัตรจากบาร์โค้ดด้วย
- หากอ่านข้อมูลใดไม่ได้ให้ใส่ null
- ตอบ JSON เท่านั้น ห้ามมีคำอธิบายเพิ่มเติม`);
    fs.unlinkSync(req.file.path);
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return res.status(422).json({ error: 'ไม่สามารถอ่านบัตรได้', raw: text });
    const data = JSON.parse(match[0]);
    // สร้าง full_name รวม
    const fullName = [data.title, data.first_name_th, data.last_name_th].filter(Boolean).join(' ');
    res.json({ extracted: { ...data, full_name: fullName || null } });
  } catch (err: any) {
    if (req.file) try { fs.unlinkSync(req.file.path); } catch {}
    res.status(500).json({ error: err.message || 'เกิดข้อผิดพลาด' });
  }
});

/* ── OCR ใบส่งสินค้าออกโรงงาน ── */
router.post('/read-shipment', upload.array('images', 15), async (req, res) => {
  const files = (req.files as any[]) || (req.file ? [req.file] : []);
  const cleanup = () => files.forEach(f => { try { fs.unlinkSync(f.path); } catch {} });
  if (files.length === 0) return res.status(400).json({ error: 'กรุณาแนบไฟล์ (รูปภาพ หรือ PDF)' });
  if (!process.env.ANTHROPIC_API_KEY) { cleanup(); return res.status(503).json({ error: 'ยังไม่ได้ตั้งค่า ANTHROPIC_API_KEY' }); }
  try {
    // รายชื่อสินค้าในระบบ พร้อมโครงการ (ให้ AI จับคู่โครงการ→ชื่อ)
    const prods = prepare(`SELECT name, project FROM products WHERE active = 1 ORDER BY project, name`).all() as any[];
    const productList = prods.map((p: any) => `- [โครงการ: ${p.project || '-'}] ${p.name}`).join('\n');

    const text = await callClaudeMulti(files.map(f => ({ path: f.path, mime: f.mimetype })), `คุณคือผู้ช่วยอ่านเอกสาร "ใบส่งสินค้า / Delivery Note" (ภาษาไทย+อังกฤษ+จีน) ที่ใช้ส่ง-รับสินค้ากับโรงงาน
เอกสารที่แนบมาอาจมี ${files.length} หน้า/รูป — อ่านทุกหน้าและ "รวมรายการสินค้าทั้งหมด" ไว้ใน items เดียวกัน (ถ้ามีสินค้ารุ่นเดียวกันหลายหน้า ให้บวกจำนวนรวมกัน)

โครงสร้างเอกสารเป็นตาราง คอลัมน์หลักคือ:
- ลำดับ (序号)
- เลขคำสั่งซื้อ / PO (订单号)
- รหัสชิ้นส่วนของโรงงาน เช่น CSR049-11 (安费诺凤凰料号 / Amphenol part)
- ชื่อสินค้า/รุ่น เช่น MA020-676_A (品名/描述)
- จำนวนการจัดส่ง (送货数量) ← อ่านคอลัมน์นี้เป็น "quantity"
- หน่วย (单位) เช่น EA
- วันที่จัดส่ง (送货日期)

อ่านอย่างละเอียดทีละแถว (อ่านตัวเลขทีละหลักอย่างระมัดระวัง) แล้วตอบเป็น JSON เท่านั้น:
{
  "shipped_at": "วันที่จัดส่ง YYYY-MM-DD",
  "po_number": "หมายเลขชิ้นส่วน Amphenol / PO เช่น CSR049-11 (หรือ null)",
  "items": [
    { "part_no": "หมายเลขชิ้นส่วน Amphenol ของแถวนี้ (= โครงการ)", "name": "ชื่อรุ่นสินค้า", "quantity": จำนวน(ตัวเลขล้วน), "unit": "หน่วย" }
  ],
  "confidence": "high/medium/low",
  "uncertain_fields": ["field ที่ไม่ชัด"]
}

กฎการอ่านวันที่ (สำคัญมาก):
- รูปแบบ "d/m/yyyy" เช่น 4/05/2026 = วัน/เดือน/ปี ค.ศ. → 2026-05-04
- รูปแบบ "yyyy.m.d" เช่น 2026.5.4 → 2026-05-04
- ถ้ามีหลายช่องวันที่ ให้ใช้ช่อง "送货日期 / วันที่จัดส่ง" ที่อยู่ด้านล่างเอกสารเป็นหลัก
- ปีเป็น ค.ศ. (เช่น 2026) ไม่ต้องแปลงเป็น พ.ศ.

กฎการอ่านหมายเลขชิ้นส่วน Amphenol (po_number):
- มักเป็น "ค่าเดียวที่รวมหลายแถว" (merged cell) เช่น CSR049-11 — อ่านให้ครบทุกตัวอักษร/เลข ระวังสับสน 0↔O, 1↔I, 5↔S

ลำดับการจับคู่สินค้า (สำคัญมาก — เพราะมีสินค้าชื่อซ้ำกันแต่คนละโครงการ):
1) อ่าน "หมายเลขชิ้นส่วน Amphenol" ของแต่ละแถวก่อน → ใส่ใน part_no (นี่คือ "โครงการ")
2) แล้วจึงเทียบ "ชื่อรุ่นสินค้า" กับรายชื่อในระบบ "เฉพาะภายในโครงการเดียวกัน" (ดู [โครงการ: ...] ในรายชื่อด้านล่าง)
3) ถ้าโครงการ+ชื่อ ตรงกับระบบ ให้ใช้ชื่อจากระบบเป๊ะ

กฎการอ่านจำนวน (สำคัญมาก — อ่านผิดคอลัมน์บ่อย):
- "quantity" ให้อ่านจากคอลัมน์ "送货数量 / จำนวนการจัดส่ง / Delivery Quantity" เท่านั้น — ตัวเลขที่อยู่ในช่องคอลัมน์นี้ของแต่ละแถวเท่านั้น
- ห้ามนำตัวเลขจากคอลัมน์อื่นมาใช้เด็ดขาด เช่น "收料数量 / จำนวนรับ", "不良/NG/งานเสีย", "单价/ราคา", "金额/มูลค่า", ยอดรวม (合计/Total), ยอดสะสม/คงเหลือ — ให้มองข้ามทั้งหมด
- ถ้าช่อง "จำนวนการจัดส่ง" ของแถวนั้นว่าง ให้ quantity = null (อย่าไปหยิบเลขจากคอลัมน์อื่นมาแทน)
- จำนวนเป็นตัวเลขล้วน ตัดคอมมา (2,000 → 2000)
- ข้ามแถวว่าง (ไม่มีชื่อสินค้าหรือไม่มีจำนวนในช่องจำนวนการจัดส่ง)
- ระวังอ่านเลขสับสน 6↔8, 0↔O, 3↔8

- ตอบ JSON เท่านั้น ห้ามมีคำอธิบายอื่น

รายชื่อสินค้าในระบบ (ใช้จับคู่ชื่อให้ตรง):
${productList || '(ไม่มี)'}`, 4096);
    cleanup();
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return res.status(422).json({ error: 'ไม่สามารถอ่านใบส่งสินค้าได้', raw: text });
    res.json({ extracted: JSON.parse(match[0]) });
  } catch (err: any) {
    cleanup();
    res.status(500).json({ error: err.message || 'เกิดข้อผิดพลาด' });
  }
});

export default router;
