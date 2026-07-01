// อ่านชื่อผู้ใช้ปัจจุบันจาก header X-User (client ส่งมาแบบ encodeURIComponent)
export function userOf(req: any): string | null {
  const h = req.headers ? req.headers['x-user'] : undefined;
  const v = Array.isArray(h) ? h[0] : h;
  if (!v) return null;
  try { return decodeURIComponent(v); } catch { return String(v); }
}
