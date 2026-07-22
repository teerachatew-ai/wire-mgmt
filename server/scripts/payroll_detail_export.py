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

FONT = "Tahoma"
NAVY = "1E3A5F"; GREEN = "0B7A3B"; RED = "B42318"; GREY = "6B7280"; AMBER = "B45309"
NUM = '#,##0'
MONEY = '#,##0.00;[Red](#,##0.00)'
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

COLS = ["วันที่คืน", "เลขที่คืน", "อ้างใบเบิก", "วันที่เบิก", "สินค้า", "งานดี", "เสีย-ตัด", "เสีย-โรงงาน", "เศษ", "หาย", "ค่าแรง (บาท)"]
WIDTHS = [12, 10, 10, 12, 26, 10, 10, 10, 8, 8, 14]

def write_table_header(ws, row):
    for ci, (h, w) in enumerate(zip(COLS, WIDTHS), start=1):
        col = get_column_letter(ci)
        ws.column_dimensions[col].width = w
        cell(ws, f"{col}{row}", h, font=Font(name=FONT, size=9.5, bold=True, color="FFFFFF"),
             fill=NAVY, align=C, border=box)
    ws.row_dimensions[row].height = 20
    return row + 1

def write_table_rows(ws, row, rows):
    for r in rows:
        vals = [date_th(r["returned_at"]), r["return_code"], r["issue_code"], date_th(r["issued_at"]),
                r["product_name"],
                r["good_qty"], r["ng_cut"], r["ng_factory"], r["waste_qty"], r["lost_qty"], r["wage"]]
        for ci, v in enumerate(vals, start=1):
            col = get_column_letter(ci)
            is_money = ci == 11
            is_num = ci in (6, 7, 8, 9, 10)
            cell(ws, f"{col}{row}", v, font=Font(name=FONT, size=9.5, color="111827"),
                 align=(R if (is_num or is_money) else L), border=box,
                 fmt=(MONEY if is_money else (NUM if is_num else None)))
        ws.row_dimensions[row].height = 17
        row += 1
    return row

used_names = set()

# ── ชีตสรุปรวม (หน้าแรก) ──
ws0 = wb.create_sheet(safe_sheet_name("สรุปรวม", used_names))
ws0.sheet_view.showGridLines = False
ws0.merge_cells("A1:F1")
cell(ws0, "A1", d.get("org_name", ""), font=Font(name=FONT, size=13, bold=True, color=NAVY), align=C)
ws0.merge_cells("A2:F2")
cell(ws0, "A2", f"สรุปรายงานเบิกงาน/ส่งงาน — รอบจ่ายค่าแรงเดือน {month_th(d['month'])}", font=Font(name=FONT, size=11, color=GREY), align=C)
ws0.merge_cells("A3:F3")
cell(ws0, "A3", f"เส้นตัดยอด (cut-off): {date_th(d['cutoff'])}  ·  งานที่คืนหลังจากนี้ยกไปจ่ายรอบเดือน {month_th(d['next_month'])}", font=Font(name=FONT, size=9.5, italic=True, color=GREY), align=C)
ws0.row_dimensions[1].height = 22

hdr_row = 5
headers0 = ["รหัส", "ชื่อ-สกุล", "ชื่อเล่น", "ธนาคาร", "เลขบัญชี", "ค่าแรงสุทธิรอบนี้ (บาท)"]
widths0 = [10, 26, 14, 16, 16, 20]
for ci, (h, w) in enumerate(zip(headers0, widths0), start=1):
    col = get_column_letter(ci)
    ws0.column_dimensions[col].width = w
    cell(ws0, f"{col}{hdr_row}", h, font=Font(name=FONT, size=9.5, bold=True, color="FFFFFF"), fill=NAVY, align=C, border=box)
ws0.row_dimensions[hdr_row].height = 20

row = hdr_row + 1
for m in d["members"]:
    vals = [m["member_code"], m["member_name"], m.get("member_nickname") or "-", m.get("bank_name") or "-", m.get("bank_account") or "-", m["total_wage"]]
    for ci, v in enumerate(vals, start=1):
        col = get_column_letter(ci)
        cell(ws0, f"{col}{row}", v, font=Font(name=FONT, size=9.5, color="111827"),
             align=(R if ci == 6 else L), border=box, fmt=(MONEY if ci == 6 else None))
    ws0.row_dimensions[row].height = 17
    row += 1

cell(ws0, f"E{row}", "รวมทั้งหมด", font=Font(name=FONT, size=10, bold=True, color="FFFFFF"), fill=GREEN, align=R, border=box)
cell(ws0, f"F{row}", d["total_wage"], font=Font(name=FONT, size=10, bold=True, color="FFFFFF"), fill=GREEN, align=R, fmt=MONEY, border=box)
ws0.row_dimensions[row].height = 20

ws0.print_area = f"A1:F{row}"
ws0.page_setup.orientation = "portrait"
ws0.page_setup.fitToWidth = 1
ws0.page_setup.fitToHeight = 0
ws0.sheet_properties.pageSetUpPr.fitToPage = True
ws0.page_margins.left = ws0.page_margins.right = 0.4

# ── ชีตรายบุคคล ──
for m in d["members"]:
    sheet_label = f'{m["member_code"]} {m["member_name"]}'
    ws = wb.create_sheet(safe_sheet_name(sheet_label, used_names))
    ws.sheet_view.showGridLines = False

    ws.merge_cells("A1:K1")
    cell(ws, "A1", d.get("org_name", ""), font=Font(name=FONT, size=13, bold=True, color=NAVY), align=C)
    ws.merge_cells("A2:K2")
    cell(ws, "A2", f"รายงานเบิกงาน/ส่งงานรายบุคคล — รอบจ่ายค่าแรงเดือน {month_th(d['month'])}", font=Font(name=FONT, size=11, color=GREY), align=C)
    ws.row_dimensions[1].height = 22

    ws.merge_cells("A4:D4")
    cell(ws, "A4", f'{m["member_code"]}   {m["member_name"]}' + (f'  ({m["member_nickname"]})' if m.get("member_nickname") else ''),
         font=Font(name=FONT, size=11, bold=True, color="111827"), align=L)
    ws.merge_cells("E4:K4")
    cell(ws, "E4", f'ธนาคาร: {m.get("bank_name") or "-"}   เลขบัญชี: {m.get("bank_account") or "-"}',
         font=Font(name=FONT, size=9.5, color=GREY), align=L)

    row = 6
    row = write_table_header(ws, row)
    row = write_table_rows(ws, row, m["rows"])

    cell(ws, f"E{row}", "รวมค่าแรง (ก่อนหัก NG เกินเกณฑ์)", font=Font(name=FONT, size=9.5, bold=True), align=R, border=box)
    for c in "FGHIJ":
        cell(ws, f"{c}{row}", None, border=box)
    cell(ws, f"K{row}", m["gross_wage"], font=Font(name=FONT, size=9.5, bold=True), align=R, fmt=MONEY, border=box)
    row += 1

    if m.get("ng_deduction"):
        cell(ws, f"E{row}", f'หัก NG เกินเกณฑ์ ({m["ng_excess_qty"]:g} เส้น × {d.get("ng_penalty_rate", 20):g} บาท)',
             font=Font(name=FONT, size=9.5, color=RED), align=R, border=box)
        for c in "FGHIJ":
            cell(ws, f"{c}{row}", None, border=box)
        cell(ws, f"K{row}", -m["ng_deduction"], font=Font(name=FONT, size=9.5, color=RED), align=R, fmt=MONEY, border=box)
        row += 1

    cell(ws, f"E{row}", "ค่าแรงสุทธิรอบนี้", font=Font(name=FONT, size=10.5, bold=True, color="FFFFFF"), fill=GREEN, align=R, border=box)
    for c in "FGHIJ":
        cell(ws, f"{c}{row}", None, fill=GREEN, border=box)
    cell(ws, f"K{row}", m["total_wage"], font=Font(name=FONT, size=10.5, bold=True, color="FFFFFF"), fill=GREEN, align=R, fmt=MONEY, border=box)
    ws.row_dimensions[row].height = 20
    row += 2

    if m.get("carry_rows"):
        ws.merge_cells(f"A{row}:K{row}")
        cell(ws, f"A{row}", f'งานที่คืนหลังเส้นตัดยอด ({date_th(d["cutoff"])}) — ยกยอดไปจ่ายรอบเดือน {month_th(d["next_month"])}',
             font=Font(name=FONT, size=10, bold=True, color="FFFFFF"), fill=AMBER, align=L)
        ws.row_dimensions[row].height = 20
        row += 1
        row = write_table_header(ws, row)
        row = write_table_rows(ws, row, m["carry_rows"])
        cell(ws, f"E{row}", f'ยอดยกไปจ่ายเดือน {month_th(d["next_month"])}', font=Font(name=FONT, size=9.5, bold=True, color=AMBER), align=R, border=box)
        for c in "FGHIJ":
            cell(ws, f"{c}{row}", None, border=box)
        cell(ws, f"K{row}", m["carry_subtotal"], font=Font(name=FONT, size=9.5, bold=True, color=AMBER), align=R, fmt=MONEY, border=box)
        row += 1

    ws.print_area = f"A1:K{row}"
    ws.page_setup.orientation = "landscape"
    ws.page_setup.fitToWidth = 1
    ws.page_setup.fitToHeight = 0
    ws.sheet_properties.pageSetUpPr.fitToPage = True
    ws.page_margins.left = ws.page_margins.right = 0.4

wb.save(out)
print(out)
