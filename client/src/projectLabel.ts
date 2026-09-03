// ชื่อกลุ่มงานที่คนใช้งานคุ้นเคย (ชื่อรหัสโครงการจริง COT0xx ใช้เฉพาะในระบบหลังบ้าน)
// ใช้ร่วมกันทั้งหน้าสมาชิก (MemberPortal) และหน้าเบิกงานของเจ้าหน้าที่ (Issues)
export const PROJECT_LABEL: Record<string, string> = {
  COT091: 'งานป้ายขาว',
  COT092: 'งานป้ายชมพู',
  COT102: 'งาน 3 สาย',
};

export const projectLabel = (key: string) => PROJECT_LABEL[key] || key;

// แยกชื่อสินค้า "MA020-633_A (ป้ายขาวสั้น)" -> เลขรุ่น "633" + ชื่อเรียก "ป้ายขาวสั้น"
export function parseProductLabel(name: string) {
  const num = name.match(/-(\d+)/)?.[1] || '';
  const label = name.match(/\(([^)]+)\)/)?.[1] || name;
  return { num, label };
}
