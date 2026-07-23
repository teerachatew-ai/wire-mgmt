# -*- coding: utf-8 -*-
# รายงานเบิกงาน/ส่งงานรายบุคคล ประจำรอบจ่ายค่าแรง — 1 คน = 1 ชีต, รวมทุกคนในไฟล์เดียว
# แปลงเป็น PDF แล้วแต่ละชีตจะกลายเป็นหน้าเรียงต่อกันตามลำดับโดยอัตโนมัติ
# Usage: python payroll_detail_export.py <data.json> <out.xlsx>
import sys, json, re, warnings
warnings.simplefilter("ignore")
from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
from openpyxl.utils import get_column_letter

dataf, out = sys.argv[1], sys.argv[2]
d = json.load(open(dataf, encoding="utf-8-sig"))

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

FONT = "Tahoma"
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

def base_label(name):
    lbl = short_label(name)
    code = code_num(name)
    return f"{lbl} {code}".strip() if code else lbl

label_freq = {}
for name in product_order:
    lbl = base_label(name)
    label_freq[lbl] = label_freq.get(lbl, 0) + 1
product_label = {}
for name in product_order:
    lbl = base_label(name)
    if label_freq[lbl] > 1:
        prefix = name.split(" (")[0].strip()
        lbl = f"{lbl} ({prefix})"
    product_label[name] = lbl

n_prod = len(product_order)

# ── ตารางแบบ pivot (ชีตรายบุคคล): วันที่เบิก + คอลัมน์แต่ละชนิดสายไฟ (จำนวน) + ค่าแรงรวมของวันนั้น ──
def write_pivot_table(ws, row, rows_list):
    headers = ["วันที่เบิก"] + [product_label[n] for n in product_order] + ["ค่าแรง (บาท)"]
    widths = [13] + [11] * n_prod + [15]
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
        cell(ws, f"{col}{row}", h, font=Font(name=FONT, size=9.5, bold=True, color=txt), fill=fill, align=C, border=box)
    ws.row_dimensions[row].height = 22
    row += 1

    date_agg = {}
    col_totals = {n: 0 for n in product_order}
    wage_total = 0.0
    for r in rows_list:
        dt = r["issued_at"]
        e = date_agg.setdefault(dt, {"qty": {}, "wage": 0.0})
        e["qty"][r["product_name"]] = e["qty"].get(r["product_name"], 0) + r["good_qty"]
        e["wage"] += r["wage"]
        col_totals[r["product_name"]] = col_totals.get(r["product_name"], 0) + r["good_qty"]
        wage_total += r["wage"]

    for dt in sorted(date_agg.keys()):
        e = date_agg[dt]
        vals = [date_th(dt)] + [e["qty"].get(n, 0) for n in product_order] + [e["wage"]]
        for ci, v in enumerate(vals, start=1):
            col = get_column_letter(ci)
            is_prod_col = 2 <= ci <= 1 + n_prod
            is_wage_col = ci == 2 + n_prod
            fmt = NUM_Z if is_prod_col else (MONEY if is_wage_col else None)
            cell(ws, f"{col}{row}", v, font=Font(name=FONT, size=9.5, color="111827"),
                 align=(R if (is_prod_col or is_wage_col) else L), border=box, fmt=fmt)
        ws.row_dimensions[row].height = 16
        row += 1

    # ── บรรทัดรวม (subtotal) ต่อคอลัมน์ — จำนวนที่ตัดรวมของสายไฟแต่ละเส้น + ค่าแรงรวม ──
    cell(ws, f"A{row}", "รวม", font=Font(name=FONT, size=9.5, bold=True), align=R, border=box)
    for ci, n in enumerate(product_order, start=2):
        col = get_column_letter(ci)
        cell(ws, f"{col}{row}", col_totals.get(n, 0), font=Font(name=FONT, size=9.5, bold=True), align=R, border=box, fmt=NUM_Z)
    cell(ws, f"{LAST_P_LETTER}{row}", wage_total, font=Font(name=FONT, size=9.5, bold=True), align=R, border=box, fmt=MONEY)
    ws.row_dimensions[row].height = 18
    row += 1
    return row, col_totals, wage_total

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
cell(ws0, "A1", d.get("org_name", ""), font=Font(name=FONT, size=13, bold=True, color=NAVY), align=CW)
ws0.merge_cells(f"A2:{last_col_letter}2")
cell(ws0, "A2", f"สรุปรายงานเบิกงาน/ส่งงาน — รอบจ่ายค่าแรงเดือน {month_th(d['month'])}", font=Font(name=FONT, size=11, color=GREY), align=CW)
ws0.merge_cells(f"A3:{last_col_letter}3")
cell(ws0, "A3", f"เส้นตัดยอด (cut-off): {date_th(d['cutoff'])}  ·  งานที่คืนหลังจากนี้ยกไปจ่ายรอบเดือน {month_th(d['next_month'])}", font=Font(name=FONT, size=9.5, italic=True, color=GREY), align=CW)
ws0.row_dimensions[1].height = 30
ws0.row_dimensions[2].height = 26
ws0.row_dimensions[3].height = 24

hdr_row = 5
headers0 = ["รหัส", "ชื่อ-สกุล", "ชื่อเล่น"] + [product_label[n] for n in product_order] + ["ค่าแรงสุทธิรอบนี้ (บาท)"]
widths0 = [9, 26, 15] + [13] * n_prod + [18]
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
    cell(ws0, f"{col}{hdr_row}", h, font=Font(name=FONT, size=9, bold=True, color=txt), fill=fill, align=C, border=box)
ws0.row_dimensions[hdr_row].height = 24

row = hdr_row + 1
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
        cell(ws0, f"{col}{row}", v, font=Font(name=FONT, size=9.5, color="111827"),
             align=(R if (is_prod_col or is_total_col) else L), border=box, fmt=fmt)
    for n in product_order:
        grand_qty[n] += pw_map.get(n, {}).get("qty", 0)
    ws0.row_dimensions[row].height = 17
    row += 1

# ── บรรทัดรวม (subtotal) ต่อคอลัมน์ — จำนวนที่ตัดรวมของสายไฟแต่ละเส้นทั้งเดือน + ค่าแรงรวมทั้งหมด ──
ws0.merge_cells(f"A{row}:C{row}")
cell(ws0, f"A{row}", "รวมทั้งหมด", font=Font(name=FONT, size=10, bold=True, color="FFFFFF"), fill=GREEN, align=R, border=box)
for ci, n in enumerate(product_order, start=FIXED_COLS0 + 1):
    col = get_column_letter(ci)
    cell(ws0, f"{col}{row}", grand_qty.get(n, 0), font=Font(name=FONT, size=10, bold=True, color="FFFFFF"), fill=GREEN, align=R, fmt=NUM_Z, border=box)
cell(ws0, f"{last_col_letter}{row}", d["total_wage"], font=Font(name=FONT, size=10, bold=True, color="FFFFFF"), fill=GREEN, align=R, fmt=MONEY, border=box)
ws0.row_dimensions[row].height = 20

ws0.print_area = f"A1:{last_col_letter}{row}"
ws0.page_setup.orientation = "landscape"
ws0.page_setup.fitToWidth = 1
ws0.page_setup.fitToHeight = 0
ws0.sheet_properties.pageSetUpPr.fitToPage = True
ws0.page_margins.left = ws0.page_margins.right = 0.35

# ── ชีตรายบุคคล — พยายามอัดให้พอดี 1 หน้ากระดาษ/คน ──
for m in d["members"]:
    sheet_label = f'{m["member_code"]} {m["member_name"]}'
    ws = wb.create_sheet(safe_sheet_name(sheet_label, used_names))
    ws.sheet_view.showGridLines = False

    ws.merge_cells(f"A1:{LAST_P_LETTER}1")
    cell(ws, "A1", d.get("org_name", ""), font=Font(name=FONT, size=13, bold=True, color=NAVY), align=CW)
    ws.merge_cells(f"A2:{LAST_P_LETTER}2")
    cell(ws, "A2", f"รายงานเบิกงาน/ส่งงานรายบุคคล — รอบจ่ายค่าแรงเดือน {month_th(d['month'])}", font=Font(name=FONT, size=11, color=GREY), align=CW)
    ws.row_dimensions[1].height = 30
    ws.row_dimensions[2].height = 26

    ws.merge_cells(f"A4:{LAST_P_LETTER}4")
    cell(ws, "A4", f'{m["member_code"]}   {m["member_name"]}' + (f'  ({m["member_nickname"]})' if m.get("member_nickname") else ''),
         font=Font(name=FONT, size=11, bold=True, color="111827"), align=LW)
    ws.row_dimensions[4].height = 20
    ws.merge_cells(f"A5:{LAST_P_LETTER}5")
    cell(ws, "A5", f'ธนาคาร: {m.get("bank_name") or "-"}   เลขบัญชี: {m.get("bank_account") or "-"}',
         font=Font(name=FONT, size=9.5, color=GREY), align=L)

    row = 7
    row, _col_totals, _wage_total = write_pivot_table(ws, row, m["rows"])

    if m.get("ng_deduction"):
        ws.merge_cells(f"A{row}:{LABEL_END_LETTER}{row}")
        cell(ws, f"A{row}", f'หัก NG เกินเกณฑ์ ({m["ng_excess_qty"]:g} เส้น × {d.get("ng_penalty_rate", 20):g} บาท)',
             font=Font(name=FONT, size=10, color=RED), align=R, border=box)
        cell(ws, f"{LAST_P_LETTER}{row}", -m["ng_deduction"], font=Font(name=FONT, size=10, color=RED), align=R, fmt=MONEY, border=box)
        row += 1

    ws.merge_cells(f"A{row}:{LABEL_END_LETTER}{row}")
    cell(ws, f"A{row}", "ค่าแรงสุทธิรอบนี้", font=Font(name=FONT, size=11, bold=True, color="FFFFFF"), fill=GREEN, align=R, border=box)
    cell(ws, f"{LAST_P_LETTER}{row}", m["total_wage"], font=Font(name=FONT, size=11, bold=True, color="FFFFFF"), fill=GREEN, align=R, fmt=MONEY, border=box)
    ws.row_dimensions[row].height = 20
    row += 2

    if m.get("carry_rows"):
        ws.merge_cells(f"A{row}:{LAST_P_LETTER}{row}")
        cell(ws, f"A{row}", f'งานที่คืนหลังเส้นตัดยอด ({date_th(d["cutoff"])}) — ยกยอดไปจ่ายรอบเดือน {month_th(d["next_month"])}',
             font=Font(name=FONT, size=10, bold=True, color="FFFFFF"), fill=AMBER, align=LW)
        ws.row_dimensions[row].height = 28
        row += 1
        row, _carry_col_totals, _carry_wage_total = write_pivot_table(ws, row, m["carry_rows"])

    # ── ช่องเซ็นรับเงิน ──
    row += 2
    cell(ws, f"A{row}", "ลงชื่อ .......................................................... ผู้รับเงิน",
         font=Font(name=FONT, size=10.5), align=L)
    row += 2
    cell(ws, f"A{row}", "วันที่ ............ / ............ / ............",
         font=Font(name=FONT, size=10.5), align=L)
    row += 1

    ws.print_area = f"A1:{LAST_P_LETTER}{row}"
    ws.page_setup.orientation = "portrait" if n_prod <= 4 else "landscape"
    ws.page_setup.fitToWidth = 1
    ws.page_setup.fitToHeight = 1
    ws.sheet_properties.pageSetUpPr.fitToPage = True
    ws.page_margins.left = ws.page_margins.right = 0.5
    ws.page_margins.top = ws.page_margins.bottom = 0.4

wb.save(out)
print(out)
