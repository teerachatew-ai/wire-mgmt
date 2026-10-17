import { Router } from 'express';
import { prepare } from '../db';
import { getImage } from '../imageStore';
import { restampNgPhoto, assignMemberToUnlinkedPhotos } from '../ngPhotos';
import { userOf } from '../reqUser';

// อัลบั้มรูปงาน NG (รูปมาจากกลุ่มไลน์ — ดู server/lineBot.ts) + จัดการบัญชี LINE ที่ผูกกับสมาชิก
const router = Router();

router.get('/', (req, res) => {
  const where = ['p.deleted_at IS NULL'];
  const params: any[] = [];
  if (req.query.month) { where.push(`substr(p.sent_at, 1, 7) = ?`); params.push(String(req.query.month)); }
  if (req.query.member_id) { where.push(`p.member_id = ?`); params.push(Number(req.query.member_id)); }
  if (req.query.product_id === 'none') where.push(`p.product_id IS NULL`);
  else if (req.query.product_id) { where.push(`p.product_id = ?`); params.push(Number(req.query.product_id)); }
  const rows = prepare(`SELECT p.id, p.image_key, p.member_id, p.sender_name, p.product_id, p.product_source, p.note,
      p.sent_at, p.updated_at, p.line_user_id, m.code AS member_code, m.name AS member_name, pr.name AS product_name
    FROM ng_photos p
    LEFT JOIN members m ON m.id = p.member_id
    LEFT JOIN products pr ON pr.id = p.product_id
    WHERE ${where.join(' AND ')}
    ORDER BY p.sent_at DESC, p.id DESC LIMIT 1000`).all(...params);
  // เดือนที่มีรูป (ให้หน้าเว็บทำตัวเลือกเดือน)
  const months = prepare(`SELECT substr(sent_at, 1, 7) AS month, COUNT(*) AS n FROM ng_photos
    WHERE deleted_at IS NULL GROUP BY month ORDER BY month DESC`).all();
  res.json({ photos: rows, months });
});

// ไฟล์รูป — kind=o ต้นฉบับ, อื่นๆ = รูปที่ประทับข้อความ · key สุ่มเดาไม่ได้ จึงไม่ต้องแนบสิทธิ์เพิ่ม (ใช้ใน <img> ได้ตรงๆ)
router.get('/image/:key', async (req, res) => {
  const key = String(req.params.key).replace(/[^A-Za-z0-9_-]/g, '');
  const img = await getImage((req.query.kind === 'o' ? 'o_' : 's_') + key).catch(() => null);
  if (!img) return res.status(404).end();
  res.setHeader('Content-Type', img.mime);
  // URL มี ?v=updated_at เปลี่ยนทุกครั้งที่ประทับใหม่ → แคชยาวได้
  res.setHeader('Cache-Control', 'private, max-age=31536000, immutable');
  if (req.query.download) res.setHeader('Content-Disposition', `attachment; filename="ng-${key.slice(0, 8)}.jpg"`);
  res.send(img.data);
});

// แก้ข้อมูลรูป (สมาชิก/รุ่น/หมายเหตุ) แล้วประทับข้อความใหม่
router.put('/:id', async (req, res) => {
  const id = Number(req.params.id);
  const cur = prepare(`SELECT * FROM ng_photos WHERE id = ? AND deleted_at IS NULL`).get(id) as any;
  if (!cur) return res.status(404).json({ error: 'ไม่พบรูปนี้' });
  const b = req.body || {};
  const member_id = b.member_id === undefined ? cur.member_id : (b.member_id ? Number(b.member_id) : null);
  const product_id = b.product_id === undefined ? cur.product_id : (b.product_id ? Number(b.product_id) : null);
  const note = b.note === undefined ? cur.note : (String(b.note || '').trim() || null);
  prepare(`UPDATE ng_photos SET member_id = ?, product_id = ?, note = ?,
      product_source = CASE WHEN ? IS NOT product_id THEN 'admin' ELSE product_source END WHERE id = ?`)
    .run(member_id, product_id, note, product_id, id);
  if (member_id !== cur.member_id || product_id !== cur.product_id) {
    try { await restampNgPhoto(id); } catch (e: any) { return res.status(500).json({ error: 'บันทึกแล้ว แต่ประทับข้อความใหม่ไม่สำเร็จ: ' + e?.message }); }
  }
  res.json({ ok: true });
});

// ลบออกจากอัลบั้ม (ซ่อน — ไฟล์รูปยังเก็บไว้ กู้คืนได้จากฐานข้อมูล)
router.delete('/:id', (req, res) => {
  prepare(`UPDATE ng_photos SET deleted_at = datetime('now'), note = COALESCE(note, '') || ? WHERE id = ? AND deleted_at IS NULL`)
    .run(userOf(req) ? ` [ลบโดย ${userOf(req)}]` : '', Number(req.params.id));
  res.json({ ok: true });
});

// ── บัญชี LINE ที่เคยพิมพ์ในกลุ่ม + สมาชิกที่ผูกไว้ ──────────────────
router.get('/line-users', (_req, res) => {
  res.json(prepare(`SELECT lu.user_id, lu.display_name, lu.member_id, lu.linked_at, lu.linked_by, lu.first_seen, lu.last_seen,
      m.code AS member_code, m.name AS member_name,
      (SELECT COUNT(*) FROM ng_photos p WHERE p.line_user_id = lu.user_id AND p.deleted_at IS NULL) AS photo_count
    FROM line_users lu LEFT JOIN members m ON m.id = lu.member_id
    ORDER BY lu.member_id IS NULL DESC, lu.last_seen DESC`).all());
});

router.put('/line-users/:userId', (req, res) => {
  const userId = String(req.params.userId);
  const memberId = req.body?.member_id ? Number(req.body.member_id) : null;
  if (!prepare(`SELECT 1 FROM line_users WHERE user_id = ?`).get(userId)) return res.status(404).json({ error: 'ไม่พบบัญชี LINE นี้' });
  if (memberId) {
    const other = prepare(`SELECT display_name FROM line_users WHERE member_id = ? AND user_id <> ?`).get(memberId, userId) as any;
    if (other) return res.status(409).json({ error: `สมาชิกนี้ผูกกับบัญชี LINE "${other.display_name || '-'}" อยู่แล้ว ปลดผูกบัญชีนั้นก่อน` });
  }
  prepare(`UPDATE line_users SET member_id = ?, linked_at = CASE WHEN ? IS NULL THEN NULL ELSE datetime('now') END, linked_by = ? WHERE user_id = ?`)
    .run(memberId, memberId, memberId ? (userOf(req) || 'admin') : null, userId);
  // รูปที่ส่งก่อนผูกและยังไม่มีชื่อสมาชิก — เติมให้ + ประทับใหม่ (ไม่ทับรูปที่แอดมินแก้ชื่อไว้แล้ว)
  if (memberId) assignMemberToUnlinkedPhotos(userId, memberId);
  res.json({ ok: true });
});

export default router;
