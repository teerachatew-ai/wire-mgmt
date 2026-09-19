# -*- coding: utf-8 -*-
# รายงานเบิกงาน/ส่งงานรายบุคคล ประจำรอบจ่ายค่าแรง — 1 คน = 1 ชีต, รวมทุกคนในไฟล์เดียว
# แปลงเป็น PDF แล้วแต่ละชีตจะกลายเป็นหน้าเรียงต่อกันตามลำดับโดยอัตโนมัติ
# Usage: python payroll_detail_export.py <data.json> <out.xlsx>
import sys, json, re, math, warnings
warnings.simplefilter("ignore")
from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
from openpyxl.utils import get_column_letter

dataf, out = sys.argv[1], sys.argv[2]
d = json.load(open(dataf, encoding="utf-8-sig"))

# ขนาดกระดาษเลือกได้ A4/A5 — A5 บังคับแนวนอน + เต็มหน้า + กึ่งกลาง (พิมพ์ใบเล็กแล้วยังอ่านง่าย)
PAPER_SIZE_CODE = {"A4": "9", "A5": "11"}
paper_size = d.get("paper_size") if d.get("paper_size") in PAPER_SIZE_CODE else "A4"
duplicate_for_pdf = bool(d.get("duplicate_for_pdf"))
# print เต็มรูปแบบ (ต้นฉบับ+คู่ฉบับ) หรือแค่ตรวจทาน (ต้นฉบับอย่างเดียว) — มีผลเฉพาะตอน duplicate_for_pdf เท่านั้น
include_copy = bool(d.get("include_copy", True))
# ป้าย "REPRINT" มุมซ้ายบน — ใช้ตอนพิมพ์ซ้ำ (เอกสารตัวจริงหายหรือพิมพ์ผิดพลาด) กันสับสนกับใบต้นฉบับจริง
reprint = bool(d.get("reprint"))
# เวอร์ชันขาวดำ — แปลงสีทุกจุด (ตัวหนังสือ+พื้นหลัง) เป็นเฉดเทาตามความสว่างเดิม หลังสร้างชีตเสร็จทั้งไฟล์
# (ไม่ใช่แค่ตั้งค่า "พิมพ์ขาวดำ" ของ Excel เพราะตัวแปลง PDF บน production เป็น LibreOffice ซึ่งอาจไม่รองรับ
# ค่านั้น — แปลงสีจริงในไฟล์แทนจึงได้ผลแน่นอนไม่ว่าจะเปิดดู/พิมพ์/แปลง PDF ด้วยโปรแกรมไหน)
black_and_white = bool(d.get("black_and_white"))

TH = ["", "มกราคม", "กุมภาพันธ์", "มีนาคม", "เมษายน", "พฤษภาคม", "มิถุนายน",
      "กรกฎาคม", "สิงหาคม", "กันยายน", "ตุลาคม", "พฤศจิกายน", "ธันวาคม"]

def month_th(ym):
    y, m = ym.split("-")
    return f"{TH[int(m)]} {int(y) + 543}"

def date_th(iso):
    if not iso:
        return "-"
    s = str(iso)[:10]
    parts = s.split("-")
    if len(parts) != 3:
        return s
    y, m, dd = parts
    return f"{dd}/{m}/{int(y) + 543}"

def date_th_short(iso):
    # วันที่แบบสั้น (พ.ศ. 2 หลัก) สำหรับคอลัมน์ "วันที่เบิก" ในใบเสร็จ — บีบคอลัมน์ให้แคบที่สุด
    # เอาพื้นที่ที่เหลือไปขยายตัวเลขจำนวนให้ใหญ่ขึ้น (เจ้าของขอ — สมาชิกสูงอายุอ่านตัวเลขไม่ชัด)
    s = date_th(iso)
    parts = s.split("/")
    if len(parts) == 3 and len(parts[2]) == 4:
        parts[2] = parts[2][2:]
        return "/".join(parts)
    return s

def hexcolor(c):
    if not c:
        return None
    c = str(c).lstrip("#").strip()
    if len(c) == 3:
        c = "".join(ch * 2 for ch in c)
    if len(c) == 6 and all(ch in "0123456789abcdefABCDEF" for ch in c):
        return c.upper()
    return None

def contrast_text(hexc):
    if not hexc:
        return "111827"
    r, g, b = int(hexc[0:2], 16), int(hexc[2:4], 16), int(hexc[4:6], 16)
    lum = 0.299 * r + 0.587 * g + 0.114 * b
    return "111827" if lum > 160 else "FFFFFF"

def short_label(name):
    mm = re.search(r"\(([^)]+)\)", name or "")
    return mm.group(1) if mm else (name or "-")

FONT = "TH SarabunPSK"
BASE_FONT_SCALE = 1.40  # สเกลของชีตสรุปรวม (หน้าแรก) — ชีตใบเสร็จรายคนคิดสเกลของตัวเองต่างหาก
_scale_state = {"v": BASE_FONT_SCALE}
def FS(size):
    return round(size * _scale_state["v"], 2)
def RH(height):  # ขยายความสูงแถวตามสัดส่วนฟอนต์ ป้องกันตัวหนังสือถูกตัด
    return round(height * _scale_state["v"], 1)

# ── ขนาดฟอนต์ (หน่วยก่อนคูณสเกล) ของใบเสร็จรายคน ──────────────────────────
# ทุกอย่าง "ในตาราง" ใช้ขนาดเดียวกันหมด (F_TABLE) ทั้งหัวคอลัมน์ วันที่เบิก ตัวเลขจำนวน ค่าแรง
# และแถวรวม — สมาชิกสูงอายุอ่านง่ายกว่าตัวใหญ่บ้างเล็กบ้าง ส่วนหัวเรื่อง/ข้อความยืนยันนอกตาราง
# เล็กลงได้ เพราะไม่ใช่ตัวเลขที่ต้องเพ่งอ่านทุกบรรทัด
F_TABLE = 15
# ชื่อสมาชิกใหญ่ที่สุดในใบ — สมาชิกหยิบใบเสร็จมาดูว่าใช่ของตัวเองไหมก่อนเป็นอย่างแรก
F_TITLE, F_REPRINT, F_SUB, F_NAME, F_BANK = 15, 15, 9.5, 16, 8.5
F_HEAD = F_DATE = F_DATA = F_TOTAL = F_WAGEROW = F_TABLE
# ค่าแรงสุทธิรอบนี้ = ส่วนหนึ่งของตาราง จึงใช้ขนาดเดียวกับตัวเลขในตาราง
# ข้อความยืนยันการรับเงินขยายอีก 10% จากเดิม (เจ้าของขอ — เป็นข้อความที่สมาชิกต้องอ่านก่อนเซ็น)
F_NG, F_NET, F_CONFIRM, F_SIGN = 10, F_TABLE, 9.35, 10.5
# ── ความสูงแถว (หน่วยก่อนคูณสเกล) ของใบเสร็จรายคน — ตั้งครบทุกแถว รวมแถวว่าง ──
# (แถวที่ไม่ได้ตั้งความสูงจะคงที่ 15pt ไม่ย่อ/ขยายตามฟอนต์ ทำให้สัดส่วนหน้าเพี้ยน)
# แถวที่มีตัวหนังสือไทย (มีสระบน/ล่าง) ต้องสูงอย่างน้อย ~1.35 เท่าของฟอนต์ ไม่งั้นโดนตัดหัว/หาง
H_TITLE, H_SUB, H_NAME, H_BANK, H_GAP = 20, 14, 22, 13, 6
H_DATA, H_TOTAL, H_WAGEROW, H_NG, H_NET = 17, 21, 21, 15, 21
H_CONFIRM, H_SIGNGAP, H_SIGN, H_SIGSPACE, H_DATEROW = 16, 15, 15, 18, 15
LINE_H = 1.35  # ความสูงต่อบรรทัดของ TH SarabunPSK เทียบกับขนาดฟอนต์

# ── ขนาดตัวหนังสือบนกระดาษ: ปล่อยให้ตัวแปลง PDF เป็นคนย่อให้พอดี 1 หน้า ──────────
# เดิมสคริปต์คำนวณเองว่าต้องย่อเท่าไร โดยเดาความกว้างคอลัมน์เป็นจุด ซึ่งขึ้นกับฟอนต์เริ่มต้นของ
# โปรแกรมที่แปลง — Excel (เครื่อง Windows) กับ LibreOffice (เครื่อง production) คิดไม่เท่ากัน
# ผลคือใบเสร็จจาก production ตัวเล็กกว่าที่ควร เหลือที่ว่างท้ายหน้าเปล่าๆ ตั้งเยอะ
#
# วิธีใหม่: ตั้งฟอนต์ใหญ่คงที่ทุกคน แล้วสั่ง fitToWidth=1 + fitToHeight=1 ให้ตัวแปลงย่อเอง
# ตัวแปลงย่อด้วยอัตรา min(พอดีความกว้าง, พอดีความสูง) ซึ่งคือขนาดใหญ่สุดที่จบใน 1 หน้าพอดี
# คนที่มีหลายวัน ความสูงเป็นตัวกำหนด -> ได้ขนาดเท่ากันทุกโปรแกรมแปลง ไม่ต้องเดาหน่วยความกว้างเลย
# คนที่มีไม่กี่วัน ความกว้างเป็นตัวกำหนด -> ได้ใหญ่สุดเท่าที่ตัวเลขยังไม่ล้นช่อง (ดูเพดานด้านล่าง)
MEMBER_FONT_SCALE = 1.45  # เพดาน — สูงกว่านี้ตัวเลขเริ่มล้นความกว้างคอลัมน์จนขึ้น #### (ทดสอบถึงเลขหลักหมื่น)

NAVY = "1E3A5F"; GREEN = "0B7A3B"; RED = "B42318"; GREY = "6B7280"; AMBER = "B45309"
NUM = '#,##0'
NUM_Z = '#,##0;-#,##0;"-"'
MONEY = '#,##0.00;[Red](#,##0.00)'
MONEY_Z = '#,##0.00;[Red](#,##0.00);"-"'
thin = Side(style="thin", color="D8DEE9")
box = Border(left=thin, right=thin, top=thin, bottom=thin)

wb = Workbook()
wb.remove(wb.active)

def safe_sheet_name(name, used):
    name = re.sub(r'[\\/*?:\[\]]', ' ', name)[:28].strip() or "sheet"
    base, i = name, 2
    while name in used:
        name = f"{base}-{i}"; i += 1
    used.add(name)
    return name

def cell(ws, coord, val, *, font=None, fill=None, align=None, fmt=None, border=None):
    c = ws[coord]; c.value = val
    if font: c.font = font
    if fill: c.fill = PatternFill("solid", fgColor=fill)
    if align: c.alignment = align
    if fmt: c.number_format = fmt
    if border: c.border = border
    return c

R = Alignment(horizontal="right", vertical="center")
L = Alignment(horizontal="left", vertical="center")
C = Alignment(horizontal="center", vertical="center")
CW = Alignment(horizontal="center", vertical="center", wrap_text=True)
LW = Alignment(horizontal="left", vertical="center", wrap_text=True)
RW = Alignment(horizontal="right", vertical="center", wrap_text=True)

used_names = set()

def code_num(name):
    prefix = (name or "").split(" (")[0].strip()
    mm = re.search(r'-(\d+)', prefix)
    if mm:
        return mm.group(1)
    mm = re.search(r'(\d+)', prefix)
    return mm.group(1) if mm else ""

# ── รวบรวมรายชื่อสินค้าทั้งหมด จัดกลุ่มตามสี (สีเดียวกันอยู่ติดกัน) แล้วเรียงตามรหัสในกลุ่มนั้น ──
distinct_products = {}
for m in d["members"]:
    for pw in m.get("product_wages", []):
        distinct_products.setdefault(pw["name"], pw.get("color"))

def color_priority(hexc):
    # ลำดับที่ต้องการ: ขาวก่อน -> ชมพู/แดง -> เขียวไว้ขวาสุด -> สีอื่นๆ
    if not hexc:
        return 9
    r, g, b = int(hexc[0:2], 16), int(hexc[2:4], 16), int(hexc[4:6], 16)
    if r > 200 and g > 200 and b > 200:
        return 0
    if g > r and g > b:
        return 2
    if r >= g and r >= b:
        return 1
    return 3

def color_sort_key(name):
    hexc = hexcolor(distinct_products[name])
    return (color_priority(hexc), hexc or "ZZZZZZ", code_num(name), name)

product_order = sorted(distinct_products.keys(), key=color_sort_key)

# ตัดคำว่า "ป้าย"/"เส้น"/"สาย" ออกจากหัวคอลัมน์ — คำเหล่านี้มีทุกชื่อสินค้าอยู่แล้วไม่ช่วยแยกแยะ
# แต่ทำให้ข้อความยาวจนล้นช่องตาราง (ไม่ลดขนาดฟอนต์ ตัดคำแทน)
# ตัดช่องว่างในชื่อออกด้วย เช่น "สายยาว ชมพูใหม่" -> "ยาวชมพูใหม่" (ชื่อสั้นลง หัวคอลัมน์ไม่ต้องตกบรรทัด)
def strip_noise_words(s):
    return re.sub(r"\s+", "", s.replace("ป้าย", "").replace("เส้น", "").replace("สาย", "")).strip()

def base_label(name):
    lbl = strip_noise_words(short_label(name))
    code = code_num(name)
    return f"{lbl} {code}".strip() if code else lbl

label_freq = {}
for name in product_order:
    lbl = base_label(name)
    label_freq[lbl] = label_freq.get(lbl, 0) + 1
# หัวคอลัมน์แยก 2 บรรทัด: ชื่อ / รหัส — ตัวหนังสือหัวตารางใหญ่เท่าตัวเลขในตาราง (เจ้าของขอ)
# ชื่อกับรหัสจึงไม่พอในบรรทัดเดียว ตัดขึ้นบรรทัดใหม่เองตรงนี้ให้ทุกคอลัมน์หน้าตาเหมือนกัน
# (ถ้าปล่อยให้โปรแกรมตัดเอง แต่ละเครื่อง/แต่ละตัวแปลง PDF ตัดไม่เหมือนกัน ความสูงหัวตารางเดาไม่ได้)
product_label = {}
for name in product_order:
    lbl = strip_noise_words(short_label(name))
    if label_freq[base_label(name)] > 1:
        lbl = f"{lbl} ({strip_noise_words(name.split(' (')[0].strip())})"
    code = code_num(name)
    product_label[name] = lbl + "\n" + code if code else lbl

n_prod = len(product_order)

# ── ความกว้างข้อความโดยประมาณ (หน่วย em) — ใช้ตั้งความกว้างคอลัมน์/ความสูงหัวตาราง ──
# ค่าต่อตัวอักษรวัดจาก PDF ที่ระบบออกจริง (TH SarabunPSK): ไทย 0.38, ตัวเลข 0.376,
# จุด/จุลภาค 0.19, ทับ 0.28, ช่องว่าง/วงเล็บ 0.22 — สระบน/ล่าง/วรรณยุกต์ลอยอยู่บน-ล่าง ไม่กินความกว้าง
def text_em(t):
    w = 0.0
    for ch in t:
        o = ord(ch)
        # สระบน/ล่าง + วรรณยุกต์ (ไม่รวม า/ำ ซึ่งกินความกว้างเต็มตัว)
        if o == 0x0E31 or 0x0E34 <= o <= 0x0E3A or 0x0E47 <= o <= 0x0E4E:
            continue
        if ch.isdigit():
            w += 0.376
        elif ch in ".,":
            w += 0.19
        elif ch == "/":
            w += 0.28
        elif ch in " ()":
            w += 0.22
        else:
            w += 0.38
    return w

def text_pt(t):  # ความกว้างข้อความบนชีตจริง (ฟอนต์ในตารางถูกคูณสเกลไว้แล้ว)
    return text_em(t) * F_TABLE * MEMBER_FONT_SCALE

def col_pt(width_units):  # ความกว้างคอลัมน์ (หน่วย Excel) -> จุด (หักขอบในช่อง 4 จุด)
    return (round(width_units * 7) + 5) * 0.75 - 4

# ความกว้างคอลัมน์คิดจากข้อความที่ยาวที่สุดที่จะไปโผล่ในคอลัมน์นั้นจริงๆ (ไม่ใช่ตั้งค่าคงที่เดา)
# แคบไปแล้ว Excel จะขึ้น ###### แทนตัวเลข กว้างไปก็เปลืองหน้ากระดาษจนตัวหนังสือถูกย่อเล็กลง
def width_for(texts, min_units=9.0, max_units=17.0):
    need = max([text_pt(t) for t in texts] or [0]) * 1.04 + 4
    units = (need / 0.75 - 5) / 7
    units = min(max(units, min_units), max_units)
    return math.ceil(units * 2) / 2  # ปัดขึ้นเป็นครึ่งหน่วย — ปัดลงแล้วเสี่ยงขาดไปนิดเดียวจนขึ้น ######

# รวบรวมข้อความจริงของแต่ละคอลัมน์จากข้อมูลทั้งไฟล์ (ทุกคนใช้ความกว้างชุดเดียวกัน หน้าตาจะได้เหมือนกัน)
_date_texts, _wage_texts = ["วันที่เบิก", "รวม", "ค่าแรง"], ["ค่าแรง", "(บาท)"]
_qty_texts = []
for m in d["members"]:
    per_day = {}
    per_prod_qty, per_prod_wage = {}, {}
    for r in m.get("rows", []):
        _date_texts.append(date_th_short(r["issued_at"]))
        k = r["issued_at"]
        per_day[k] = per_day.get(k, 0) + r["wage"]
        per_prod_qty[r["product_name"]] = per_prod_qty.get(r["product_name"], 0) + r["good_qty"]
        per_prod_wage[r["product_name"]] = per_prod_wage.get(r["product_name"], 0) + r["wage"]
        _qty_texts.append(f'{r["good_qty"]:,.0f}')
    _wage_texts += [f"{v:,.2f}" for v in per_day.values()]
    _wage_texts.append(f'{m.get("total_wage", 0):,.2f}')
    _qty_texts += [f"{v:,.0f}" for v in per_prod_qty.values()]
    _qty_texts += [f"{v:,.2f}" for v in per_prod_wage.values()]  # แถวค่าแรงแยกตามชนิด (มีทศนิยม)

W_DATE = width_for(_date_texts)
# ความกว้างคอลัมน์สินค้าคิดจาก "ตัวเลข" อย่างเดียว — ชื่อสินค้าที่ยาวกว่าช่องปล่อยให้ตกบรรทัดในหัวตาราง
# (ขยายคอลัมน์ตามชื่อจะทำให้ตารางกว้างจนถูกย่อทั้งใบ ตัวเลขเลยเล็กลงทั้งที่ไม่จำเป็น)
# ขั้นต่ำ 13 หน่วย ให้ตารางกว้างเต็มหน้าพอสมควร (ขนาดตัวหนังสือเท่าเดิม เพราะความสูงเป็นตัวกำหนด
# อยู่แล้ว แต่ตารางแคบเกินไปจะเหลือขอบซ้าย-ขวาว่างเยอะโดยเปล่าประโยชน์)
W_PROD = width_for(_qty_texts + [code_num(n) for n in product_order], min_units=13.0)
W_WAGE = width_for(_wage_texts)
# โหมด REPRINT ใช้คอลัมน์แรกวางป้ายตัวแดงตัวใหญ่ จึงกว้างกว่าปกติ
W_DATE_EFF = max(18.0, W_DATE) if reprint else W_DATE

def head_lines(text, width_units):  # จำนวนบรรทัดที่หัวคอลัมน์นี้ต้องใช้จริง (เผื่อคลาดเคลื่อน 3%)
    avail = col_pt(width_units) * 0.97
    n = 0
    for part in str(text).split("\n"):
        n += max(1, -(-round(text_pt(part), 2) // avail))
    return int(n)

# ความสูงหัวตาราง = จำนวนบรรทัดมากสุดในบรรดาหัวคอลัมน์ทั้งหมด (กันตัวหนังสือถูกตัด)
H_HEAD = max(
    head_lines("วันที่เบิก", W_DATE_EFF),
    head_lines("ค่าแรง (บาท)", W_WAGE),
    max([head_lines(product_label[n], W_PROD) for n in product_order] or [2]),
) * LINE_H * F_HEAD + 3

# ── ตารางแบบ pivot (ชีตรายบุคคล): วันที่เบิก + คอลัมน์แต่ละชนิดสายไฟ (จำนวน) + ค่าแรงรวมของวันนั้น ──
# แถวรวมท้ายตารางใช้สูตร =SUM(...) อ้างอิงแถวข้อมูลจริง ไม่ใช่ตัวเลขคงที่ — แก้ตัวเลขในแถวไหนใน Excel
# แล้วยอดรวม/ค่าแรงสุทธิท้ายชีตจะคำนวณตามให้อัตโนมัติ
def write_pivot_table(ws, row, rows_list):
    headers = ["วันที่เบิก"] + [product_label[n] for n in product_order] + ["ค่าแรง (บาท)"]
    widths = [W_DATE_EFF] + [W_PROD] * n_prod + [W_WAGE]
    for ci, (h, w) in enumerate(zip(headers, widths), start=1):
        col = get_column_letter(ci)
        ws.column_dimensions[col].width = w
        is_prod_col = 2 <= ci <= 1 + n_prod
        if is_prod_col:
            pname = product_order[ci - 2]
            hexc = hexcolor(distinct_products[pname]) or "9CA3AF"
            fill, txt = hexc, contrast_text(hexc)
        else:
            fill, txt = NAVY, "FFFFFF"
        # wrap_text กันหัวคอลัมน์ยาวล้นออกไปทับคอลัมน์ข้างๆ ตอนคอลัมน์แคบลง (ตัดขึ้นบรรทัดใหม่แทน)
        # หัวคอลัมน์เล็กกว่าตัวเลขในตาราง — อ่านครั้งเดียวก็รู้ว่าคอลัมน์อะไร แต่ตัวเลขต้องอ่านทุกบรรทัด
        cell(ws, f"{col}{row}", h, font=Font(name=FONT, size=FS(F_HEAD), bold=True, color=txt), fill=fill, align=CW, border=box)
    ws.row_dimensions[row].height = RH(H_HEAD)
    row += 1

    # คอลัมน์ซ่อนไว้ทางขวาของตาราง เก็บค่าแรงแยกตามชนิด x วันที่ — เป็นแหล่งอ้างอิงของสูตร SUM แนวตั้ง
    # ของแถว "ค่าแรงตัด (บาท)" ด้านล่าง (ตัวเลขค่าแรงต่อวันในคอลัมน์ที่มองเห็นเป็นยอดรวมทุกชนิดของวันนั้น
    # จึงต้องมีคอลัมน์แยกตามชนิดไว้ต่างหากเพื่อให้ SUM ตามชนิดได้ถูกต้อง)
    hidden_cols = {n: get_column_letter(LAST_P + 1 + i) for i, n in enumerate(product_order)}
    for col in hidden_cols.values():
        ws.column_dimensions[col].hidden = True

    # อัตราค่าแรง/หน่วยของแต่ละชนิด (คงที่ต่อสินค้า) — ใช้ผูกเป็นสูตร qty*rate ในคอลัมน์ที่ซ่อนไว้
    rates = {}
    date_agg = {}
    for r in rows_list:
        dt = r["issued_at"]
        pname = r["product_name"]
        e = date_agg.setdefault(dt, {"qty": {}, "wage": 0.0, "wage_by_prod": {}})
        e["qty"][pname] = e["qty"].get(pname, 0) + r["good_qty"]
        e["wage"] += r["wage"]
        e["wage_by_prod"][pname] = e["wage_by_prod"].get(pname, 0) + r["wage"]
        if pname not in rates:
            rates[pname] = r.get("wage_per_unit") or 0

    first_data_row = row
    for dt in sorted(date_agg.keys()):
        e = date_agg[dt]
        vals = [date_th_short(dt)] + [e["qty"].get(n, 0) for n in product_order] + [e["wage"]]
        for ci, v in enumerate(vals, start=1):
            col = get_column_letter(ci)
            is_prod_col = 2 <= ci <= 1 + n_prod
            is_wage_col = ci == 2 + n_prod
            fmt = NUM_Z if is_prod_col else (MONEY if is_wage_col else None)
            # ตัวเลขจำนวน/ค่าแรง = ตัวใหญ่สุดในตาราง ส่วนวันที่เล็กกว่า (คอลัมน์แคบ + ไม่ใช่ตัวเลขที่ต้องเพ่ง)
            fsize = FS(F_DATA) if (is_prod_col or is_wage_col) else FS(F_DATE)
            cell(ws, f"{col}{row}", v, font=Font(name=FONT, size=fsize, bold=True, color="111827"),
                 align=(R if (is_prod_col or is_wage_col) else C), border=box, fmt=fmt)
        # สูตร = จำนวน(อ้างอิงช่องที่มองเห็น) x อัตราค่าแรง/หน่วย — แก้จำนวนในตารางแล้วค่าแรงเปลี่ยนตามจริง
        # ส่วนต่างเล็กน้อยจากงานเสีย/หาย (ซึ่งไม่ได้แสดงแยกในตารางนี้) บวกเพิ่มเป็นค่าคงที่ต่อท้าย เพื่อให้ยอดรวมยังตรงเป๊ะ
        for ci, n in enumerate(product_order, start=2):
            qcol = get_column_letter(ci)
            hcol = hidden_cols[n]
            qty = e["qty"].get(n, 0)
            wage = e["wage_by_prod"].get(n, 0)
            rate = rates.get(n, 0)
            adj = wage - qty * rate
            formula = f"={qcol}{row}*{rate:g}" if abs(adj) < 0.005 else f"={qcol}{row}*{rate:g}+{adj:.2f}"
            cell(ws, f"{hcol}{row}", formula, fmt=MONEY)
        ws.row_dimensions[row].height = RH(H_DATA)
        row += 1
    last_data_row = row - 1

    # ── บรรทัดรวม (subtotal) ต่อคอลัมน์ — สูตร SUM อ้างอิงแถวข้อมูลด้านบน ──
    # ช่องค่าแรงรวมท้ายแถวนี้ไม่ต้องใส่ตัวเลขซ้ำ (ปล่อยว่างไว้) เพราะแถว "ค่าแรงตัด" ถัดไปมีสรุปยอดเดียวกันอยู่แล้ว
    col_totals = {n: 0 for n in product_order}
    wage_total = 0.0
    cell(ws, f"A{row}", "รวม", font=Font(name=FONT, size=FS(F_TOTAL), bold=True), align=R, border=box)
    if last_data_row >= first_data_row:
        for ci, n in enumerate(product_order, start=2):
            col = get_column_letter(ci)
            col_totals[n] = sum(date_agg[dt]["qty"].get(n, 0) for dt in date_agg)
            cell(ws, f"{col}{row}", f"=SUM({col}{first_data_row}:{col}{last_data_row})",
                 font=Font(name=FONT, size=FS(F_TOTAL), bold=True), align=R, border=box, fmt=NUM_Z)
        wage_total = sum(e["wage"] for e in date_agg.values())
    cell(ws, f"{LAST_P_LETTER}{row}", None, font=Font(name=FONT, size=FS(F_TOTAL), bold=True), align=R, border=box)
    ws.row_dimensions[row].height = RH(H_TOTAL)
    row += 1

    # ── แถบสีเขียวอ่อน: ค่าแรงตัด (บาท) แยกตามชนิด — เป็นแหล่งอ้างอิงยอดค่าแรงรวมเพียงจุดเดียว (ไม่ซ้ำกับแถว "รวม" ด้านบน) ──
    # แนวตั้ง: แต่ละช่อง = SUM คอลัมน์ที่ซ่อนไว้ของชนิดนั้น (first_data_row:last_data_row)
    # แนวนอน: ช่องรวมท้ายแถว = SUM ของทุกช่องชนิดในแถวนี้เอง
    LIGHT_GREEN = "DCFCE7"
    # ป้ายแถวนี้ต้องสั้นพอใส่คอลัมน์วันที่ที่บีบให้แคบแล้ว (หน่วยเป็นบาทอยู่ในหัวคอลัมน์ขวาสุดแล้ว)
    cell(ws, f"A{row}", "ค่าแรง", font=Font(name=FONT, size=FS(F_WAGEROW), bold=True, color=GREEN), fill=LIGHT_GREEN, align=R, border=box)
    if last_data_row >= first_data_row:
        for ci, n in enumerate(product_order, start=2):
            col = get_column_letter(ci)
            hcol = hidden_cols[n]
            cell(ws, f"{col}{row}", f"=SUM({hcol}{first_data_row}:{hcol}{last_data_row})",
                 font=Font(name=FONT, size=FS(F_WAGEROW), bold=True, color=GREEN), fill=LIGHT_GREEN, align=R, border=box, fmt=MONEY_Z)
        cell(ws, f"{LAST_P_LETTER}{row}", f"=SUM(B{row}:{LABEL_END_LETTER}{row})",
             font=Font(name=FONT, size=FS(F_WAGEROW), bold=True, color=GREEN), fill=LIGHT_GREEN, align=R, border=box, fmt=MONEY)
    else:
        cell(ws, f"{LAST_P_LETTER}{row}", 0, font=Font(name=FONT, size=FS(F_WAGEROW), bold=True, color=GREEN), fill=LIGHT_GREEN, align=R, border=box, fmt=MONEY)
    wage_total_ref = f"{LAST_P_LETTER}{row}"
    ws.row_dimensions[row].height = RH(H_WAGEROW)
    row += 1

    return row, col_totals, wage_total, wage_total_ref

LAST_P = n_prod + 2  # วันที่เบิก + สินค้าแต่ละชนิด + ค่าแรง
LAST_P_LETTER = get_column_letter(LAST_P)
LABEL_END_LETTER = get_column_letter(LAST_P - 1)

# ── ชีตสรุปรวม (หน้าแรก) — รหัส/ชื่อ + แยกยอดค่าแรงตามชนิดสายไฟ + รวมสุทธิ ──
ws0 = wb.create_sheet(safe_sheet_name("สรุปรวม", used_names))
ws0.sheet_view.showGridLines = False
n_prod = len(product_order)
FIXED_COLS0 = 3  # รหัส, ชื่อ-สกุล, ชื่อเล่น
last_col = FIXED_COLS0 + n_prod + 1  # + สินค้าแต่ละชนิด + ค่าแรงสุทธิ
last_col_letter = get_column_letter(last_col)
ws0.merge_cells(f"A1:{last_col_letter}1")
cell(ws0, "A1", d.get("org_name", ""), font=Font(name=FONT, size=FS(13), bold=True, color=NAVY), align=CW)
ws0.merge_cells(f"A2:{last_col_letter}2")
cell(ws0, "A2", f"สรุปรายงานเบิกงาน/ส่งงาน — รอบจ่ายค่าแรงเดือน {month_th(d['month'])}", font=Font(name=FONT, size=FS(11), color=GREY), align=CW)
# ไม่บอกวันตัดยอด/งานที่ยกไปเดือนหน้า — บอกแค่เดือน เหมือนใบเสร็จรายคน (แถว 3 เว้นว่างไว้เป็นช่องไฟ)
ws0.row_dimensions[1].height = RH(30)
ws0.row_dimensions[2].height = RH(26)
ws0.row_dimensions[3].height = RH(10)

hdr_row = 5
headers0 = ["รหัส", "ชื่อ-สกุล", "ชื่อเล่น"] + [product_label[n] for n in product_order] + ["ค่าแรงสุทธิรอบนี้ (บาท)"]
widths0 = [9, 26, 15] + [13] * n_prod + [22]
for ci, (h, w) in enumerate(zip(headers0, widths0), start=1):
    col = get_column_letter(ci)
    ws0.column_dimensions[col].width = w
    is_prod_col = FIXED_COLS0 + 1 <= ci <= FIXED_COLS0 + n_prod
    if is_prod_col:
        pname = product_order[ci - FIXED_COLS0 - 1]
        hexc = hexcolor(distinct_products[pname]) or "9CA3AF"
        fill, txt = hexc, contrast_text(hexc)
    else:
        fill, txt = NAVY, "FFFFFF"
    # wrap_text กันหัวคอลัมน์ยาวล้นออกไปทับคอลัมน์ข้างๆ หรือหลุดขอบหน้ากระดาษ
    cell(ws0, f"{col}{hdr_row}", h, font=Font(name=FONT, size=FS(9), bold=True, color=txt), fill=fill, align=CW, border=box)
ws0.row_dimensions[hdr_row].height = RH(28)

row = hdr_row + 1
first_member_row = row
grand_qty = {n: 0 for n in product_order}
for m in d["members"]:
    pw_map = {pw["name"]: pw for pw in m.get("product_wages", [])}
    vals = [m["member_code"], m["member_name"], m.get("member_nickname") or "-"]
    vals += [pw_map.get(n, {}).get("qty", 0) for n in product_order]
    vals += [m["total_wage"]]
    for ci, v in enumerate(vals, start=1):
        col = get_column_letter(ci)
        is_prod_col = FIXED_COLS0 + 1 <= ci <= FIXED_COLS0 + n_prod
        is_total_col = ci == last_col
        fmt = NUM_Z if is_prod_col else (MONEY_Z if is_total_col else None)
        cell(ws0, f"{col}{row}", v, font=Font(name=FONT, size=FS(9.5), bold=True, color="111827"),
             align=(R if (is_prod_col or is_total_col) else L), border=box, fmt=fmt)
    for n in product_order:
        grand_qty[n] += pw_map.get(n, {}).get("qty", 0)
    ws0.row_dimensions[row].height = RH(17)
    row += 1
last_member_row = row - 1

# ── บรรทัดรวม (subtotal) ต่อคอลัมน์ — สูตร SUM อ้างอิงแถวสมาชิกด้านบน ──
ws0.merge_cells(f"A{row}:C{row}")
cell(ws0, f"A{row}", "รวมทั้งหมด", font=Font(name=FONT, size=FS(10), bold=True, color="FFFFFF"), fill=GREEN, align=R, border=box)
has_members = last_member_row >= first_member_row
for ci, n in enumerate(product_order, start=FIXED_COLS0 + 1):
    col = get_column_letter(ci)
    v = f"=SUM({col}{first_member_row}:{col}{last_member_row})" if has_members else 0
    cell(ws0, f"{col}{row}", v, font=Font(name=FONT, size=FS(10), bold=True, color="FFFFFF"), fill=GREEN, align=R, fmt=NUM_Z, border=box)
wage_v = f"=SUM({last_col_letter}{first_member_row}:{last_col_letter}{last_member_row})" if has_members else 0
cell(ws0, f"{last_col_letter}{row}", wage_v, font=Font(name=FONT, size=FS(10), bold=True, color="FFFFFF"), fill=GREEN, align=R, fmt=MONEY, border=box)
ws0.row_dimensions[row].height = RH(20)

ws0.print_area = f"A1:{last_col_letter}{row}"
ws0.page_setup.paperSize = PAPER_SIZE_CODE[paper_size]
ws0.page_setup.orientation = "landscape"
ws0.page_setup.fitToWidth = 1
ws0.page_setup.fitToHeight = 0
ws0.sheet_properties.pageSetUpPr.fitToPage = True
ws0.print_options.horizontalCentered = True
ws0.page_margins.left = ws0.page_margins.right = 0.35

# ── ชีตรายบุคคล — พยายามอัดให้พอดี 1 หน้ากระดาษ/คน ──
CONFIRM_TEXT = "ข้าพเจ้าขอยืนยันว่ารายการและจำนวนเงินดังกล่าวข้างต้นมีความถูกต้องครบถ้วนทุกประการ และได้รับเงินเรียบร้อยแล้ว"

def write_member_sheet(m, label=None):
    _scale_state["v"] = MEMBER_FONT_SCALE

    sheet_label = f'{m["member_code"]} {m["member_name"]}' + (f' {label}' if label else '')
    ws = wb.create_sheet(safe_sheet_name(sheet_label, used_names))
    ws.sheet_view.showGridLines = False

    # หัวชีต — ถ้ามี label (ต้นฉบับ/คู่ฉบับ) กันคอลัมน์ขวาสุดไว้เป็นป้ายมุมขวาบน ให้เห็นชัดแยกจากหัวเรื่องหลัก
    # รวม cut-off ไว้บรรทัดเดียวกับชื่อเดือน
    # บรรทัดบนสุด = ชื่อเอกสาร "ใบเสร็จรับเงิน" ตัวใหญ่เด่นชัด (เดิมเป็นชื่อกลุ่มวิสาหกิจ)
    if reprint:
        # กันคอลัมน์ A ไว้เป็นป้าย REPRINT แยกจากหัวเรื่องหลัก (merge เริ่มที่ B แทน A)
        # ตัวใหญ่เกือบเท่าหัวเรื่องหลักให้เห็นชัดจริงๆ — ขยายความกว้างคอลัมน์ A ทีหลัง (หลัง write_pivot_table
        # ซึ่งจะตั้งความกว้างคอลัมน์ A ทับเป็น 13 อีกที) ไม่งั้นตัวหนังสือใหญ่จะถูกคอลัมน์แคบบังคับให้แสดงไม่เต็ม
        ws.merge_cells(f"B1:{LAST_P_LETTER}1")
        cell(ws, "A1", "REPRINT", font=Font(name=FONT, size=FS(F_REPRINT), bold=True, color="DC2626"), align=L)
        cell(ws, "B1", "ใบเสร็จรับเงิน", font=Font(name=FONT, size=FS(F_TITLE), bold=True, color="111827"), align=C)
    else:
        ws.merge_cells(f"A1:{LAST_P_LETTER}1")
        cell(ws, "A1", "ใบเสร็จรับเงิน", font=Font(name=FONT, size=FS(F_TITLE), bold=True, color="111827"), align=C)
    # ชื่อกลุ่มวิสาหกิจย้ายลงมาบรรทัดที่ 2 ต่อกับรอบจ่าย — ยังต้องมีอยู่ในเอกสาร
    # เพราะเป็นชื่อผู้ออกใบเสร็จ (ถ้าตัดทิ้งใบเสร็จจะใช้อ้างอิงไม่ได้)
    # บอกแค่เดือน ไม่ต้องบอกช่วงวันตัดยอด (เจ้าของขอ — สมาชิกดูแล้วงง)
    ws.merge_cells(f"A2:{LAST_P_LETTER}2")
    subtitle = f"{d.get('org_name', '')} — รอบจ่ายค่าแรงเดือน {month_th(d['month'])}"
    # ข้อความยาว -> shrink_to_fit แทน wrap_text กันตกบรรทัด/ถูกตัดท้าย
    # (wrap_text + auto-height ไม่เสถียรกับชีตที่สร้างจาก openpyxl ล้วนตอนแปลง PDF ผ่าน Excel COM)
    cell(ws, "A2", subtitle, font=Font(name=FONT, size=FS(F_SUB), color=GREY),
         align=Alignment(horizontal="center", vertical="center", shrink_to_fit=True))
    ws.row_dimensions[1].height = RH(H_TITLE)
    ws.row_dimensions[2].height = RH(H_SUB)

    ws.merge_cells(f"A3:{LAST_P_LETTER}3")
    cell(ws, "A3", f'{m["member_code"]}   {m["member_name"]}' + (f'  ({m["member_nickname"]})' if m.get("member_nickname") else ''),
         font=Font(name=FONT, size=FS(F_NAME), bold=True, color="111827"), align=LW)
    ws.row_dimensions[3].height = RH(H_NAME)

    ws.merge_cells(f"A4:{LAST_P_LETTER}4")
    cell(ws, "A4", f'ธนาคาร: {m.get("bank_name") or "-"}   เลขบัญชี: {m.get("bank_account") or "-"}',
         font=Font(name=FONT, size=FS(F_BANK), color=GREY), align=L)
    ws.row_dimensions[4].height = RH(H_BANK)
    ws.row_dimensions[5].height = RH(H_GAP)  # ช่องไฟก่อนตาราง (ตั้งความสูงไว้ให้โมเดลคำนวณหน้าตรงกับของจริง)

    row = 6
    row, _col_totals, _wage_total, wage_total_ref = write_pivot_table(ws, row, m["rows"])

    net_formula_parts = [wage_total_ref]
    if m.get("ng_deduction"):
        ws.merge_cells(f"A{row}:{LABEL_END_LETTER}{row}")
        cell(ws, f"A{row}", f'หัก NG เกินเกณฑ์ ({m["ng_excess_qty"]:g} เส้น × {d.get("ng_penalty_rate", 20):g} บาท)',
             font=Font(name=FONT, size=FS(F_NG), color=RED), align=R, border=box)
        # แสดงเป็นสูตรคูณตรงๆ (จำนวนเกิน x อัตราค่าปรับ) ให้เห็นที่มาของตัวเลข ไม่ใช่แค่ผลลัพธ์สำเร็จรูป
        ng_ref = f"{LAST_P_LETTER}{row}"
        cell(ws, ng_ref, f'=-({m["ng_excess_qty"]:g}*{d.get("ng_penalty_rate", 20):g})',
             font=Font(name=FONT, size=FS(F_NG), color=RED), align=R, fmt=MONEY, border=box)
        ws.row_dimensions[row].height = RH(H_NG)
        net_formula_parts.append(ng_ref)
        row += 1

    ws.merge_cells(f"A{row}:{LABEL_END_LETTER}{row}")
    cell(ws, f"A{row}", "ค่าแรงสุทธิรอบนี้", font=Font(name=FONT, size=FS(F_NET), bold=True, color="FFFFFF"), fill=GREEN, align=R, border=box)
    # ปัดขึ้นเต็มบาทเหมือนสูตรฝั่งระบบ (Math.ceil) — ใช้ ROUNDUP แทน (ค่าแรงเป็นบวกเสมอ ผลเหมือนกัน)
    net_formula = f"=ROUNDUP({'+'.join(net_formula_parts)},0)"
    cell(ws, f"{LAST_P_LETTER}{row}", net_formula, font=Font(name=FONT, size=FS(F_NET), bold=True, color="FFFFFF"), fill=GREEN, align=R, fmt=MONEY, border=box)
    ws.row_dimensions[row].height = RH(H_NET)
    row += 1

    # ไม่แสดงงานที่คืนหลังวันตัดยอด (ยกไปจ่ายรอบเดือนถัดไป) ในใบเสร็จนี้ — ใบเสร็จแสดงเฉพาะงานของรอบเดือนนั้นๆ
    # งานพวกนั้นจะไปโผล่ในใบเสร็จของเดือนถัดไปเองอยู่แล้ว

    # ── ช่องเซ็นรับเงิน (ระยะห่างกระชับ กันเนื้อหาล้นไปหน้าถัดไปตอนมีหลายแถว) ──
    ws.merge_cells(f"A{row}:{LAST_P_LETTER}{row}")
    cell(ws, f"A{row}", CONFIRM_TEXT, font=Font(name=FONT, size=FS(F_CONFIRM), italic=True, color="111827"), align=RW)
    ws.row_dimensions[row].height = RH(H_CONFIRM)
    row += 1
    ws.row_dimensions[row].height = RH(H_SIGNGAP)  # ที่ว่างไว้เซ็นชื่อจริง
    row += 1
    # เดิม "ลงชื่อ"/"วันที่" ชิดขวาแยกกัน (ตามความยาวข้อความ) ทำให้บรรทัดวันที่ดูเบ้ไปทางขวามากกว่า
    # บรรทัดลงชื่อ — เปลี่ยนมา merge แค่ครึ่งขวาของแถว แล้วจัดกึ่งกลาง "ภายในครึ่งขวา" เดียวกันทั้งสองบรรทัด
    # ผลคือยังอยู่ชิดฝั่งขวาของหน้าเหมือนเดิม แต่สองบรรทัดจะอยู่กึ่งกลางตรงกันพอดี ไม่เบ้
    half_col = get_column_letter(max(2, LAST_P // 2))
    ws.merge_cells(f"{half_col}{row}:{LAST_P_LETTER}{row}")
    cell(ws, f"{half_col}{row}", "ลงชื่อ .......................................................... ผู้รับเงิน",
         font=Font(name=FONT, size=FS(F_SIGN)), align=C)
    ws.row_dimensions[row].height = RH(H_SIGN)
    row += 1
    ws.row_dimensions[row].height = RH(H_SIGSPACE)  # บรรทัดว่างคั่นก่อนถึงวันที่ (นับรวมในโมเดลหน้ากระดาษแล้ว)
    row += 1
    ws.merge_cells(f"{half_col}{row}:{LAST_P_LETTER}{row}")
    cell(ws, f"{half_col}{row}", "วันที่ ............ / ............ / ............",
         font=Font(name=FONT, size=FS(F_SIGN)), align=C)
    ws.row_dimensions[row].height = RH(H_DATEROW)
    row += 1

    ws.print_area = f"A1:{LAST_P_LETTER}{row}"
    ws.page_setup.paperSize = PAPER_SIZE_CODE[paper_size]
    if paper_size == "A5":
        ws.page_setup.orientation = "landscape"
    else:
        ws.page_setup.orientation = "portrait" if n_prod <= 4 else "landscape"
    # fitToHeight=0 (ไม่จำกัดจำนวนหน้าตามความสูง) — บังคับให้ scale คำนวณจาก "ความกว้าง" เพียงอย่างเดียว
    # เสมอ ไม่ว่าคนนั้นจะมีกี่แถว/กี่วัน กันปัญหาคนที่มีข้อมูลน้อย (แถวสั้น) โดน scale ขยายเกินจนล้นขอบขวา
    # (คนที่มีข้อมูลเยอะจะขึ้นหน้าที่ 2 ต่อแทน ด้วยขนาดตัวหนังสือเท่ากันทุกคน ไม่บีบเล็กลงเป็นพิเศษ)
    ws.page_setup.fitToWidth = 1
    # fitToHeight=1 เป็นตัวกันพลาดชั้นสุดท้าย: ขนาดฟอนต์คำนวณมาให้พอดี 1 หน้าอยู่แล้ว (scale_for_member)
    # ถ้าคลาดไปนิดหน่อย Excel จะย่อให้เองแทนที่จะดันบรรทัดลงชื่อ/วันที่หลุดไปหน้า 2
    ws.page_setup.fitToHeight = 1
    ws.sheet_properties.pageSetUpPr.fitToPage = True
    ws.print_options.horizontalCentered = True
    ws.print_options.verticalCentered = False
    ws.page_margins.left = ws.page_margins.right = 0.25
    ws.page_margins.top = ws.page_margins.bottom = 0.4

for m in d["members"]:
    if duplicate_for_pdf:
        write_member_sheet(m, label="ต้นฉบับ")
        if include_copy:
            write_member_sheet(m, label="คู่ฉบับ")
    else:
        write_member_sheet(m)

if black_and_white:
    def to_gray6(argb):
        hexpart = (argb or "000000")[-6:]
        try:
            r, g, b = int(hexpart[0:2], 16), int(hexpart[2:4], 16), int(hexpart[4:6], 16)
        except ValueError:
            return hexpart
        lum = round(0.299 * r + 0.587 * g + 0.114 * b)
        return f"{lum:02X}{lum:02X}{lum:02X}"

    for wsx in wb.worksheets:
        for row_cells in wsx.iter_rows():
            for c in row_cells:
                f = c.font
                if f and f.color is not None and isinstance(getattr(f.color, "rgb", None), str):
                    c.font = Font(name=f.name, size=f.size, bold=f.bold, italic=f.italic,
                                  underline=f.underline, strike=f.strike, color=to_gray6(f.color.rgb))
                fl = c.fill
                if fl and fl.patternType == "solid" and isinstance(getattr(fl.fgColor, "rgb", None), str):
                    c.fill = PatternFill("solid", fgColor=to_gray6(fl.fgColor.rgb))

wb.save(out)
print(out)
