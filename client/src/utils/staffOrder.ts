/* ลำดับชื่อในงานเบิก: ตามเลขที่พนักงาน (โมดูล "พนักงานที่ใช้งาน") · คนที่ยังไม่มีเลขต่อท้าย เรียงตามรหัสสมาชิก */
export const compareStaff = (aNo: number | null | undefined, aCode: string | undefined, bNo: number | null | undefined, bCode: string | undefined) =>
  (aNo ?? Infinity) === (bNo ?? Infinity)
    ? String(aCode || '').localeCompare(String(bCode || ''), 'th')
    : (aNo ?? Infinity) - (bNo ?? Infinity);
