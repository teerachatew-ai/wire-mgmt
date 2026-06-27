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

กฎการอ่านจำนวน:
- อ่าน "จำนวน" จากคอลัมน์ "送货数量 / จำนวนการจัดส่ง" เท่านั้น (ไม่ใช่คอลัมน์ "收料数量 / จำนวนรับ" ที่มักว่าง)
- จำนวนเป็นตัวเลขล้วน ตัดคอมมา (2,000 → 2000)
- ข้ามแถวว่าง (ไม่มีชื่อสินค้าหรือจำนวน)
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
