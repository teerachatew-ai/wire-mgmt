// แปลงสีสินค้า (hex) เป็น emoji วงสี เพื่อใช้นำหน้าใน dropdown <option>
const EMOJI: Record<string, string> = {
  '#ffffff': '⚪',
  '#ec4899': '🩷',
  '#3b82f6': '🔵',
  '#ef4444': '🔴',
  '#22c55e': '🟢',
  '#eab308': '🟡',
  '#f97316': '🟠',
  '#a855f7': '🟣',
  '#9ca3af': '⚫',
};

export const colorDot = (c?: string | null): string => {
  if (!c) return '';
  const e = EMOJI[c.toLowerCase()];
  return e ? e + ' ' : '';
};
