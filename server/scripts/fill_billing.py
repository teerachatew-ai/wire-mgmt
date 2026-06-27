# -*- coding: utf-8 -*-
# Fills the real billing template (server/templates/billing-template.xlsx) with data.
# Usage: python fill_billing.py <template.xlsx> <data.json> <out.xlsx>
import sys, json, datetime, warnings
from copy import copy
warnings.simplefilter("ignore")
from openpyxl import load_workbook

tpl, dataf, out = sys.argv[1], sys.argv[2], sys.argv[3]
d = json.load(open(dataf, encoding="utf-8-sig"))

wb = load_workbook(tpl)
ws = wb["สำหรับกรอกข้อมูล Form "]

TH = ["มกราคม", "กุมภาพันธ์", "มีนาคม", "เมษายน", "พฤษภาคม", "มิถุนายน",
      "กรกฎาคม", "สิงหาคม", "กันยายน", "ตุลาคม", "พฤศจิกายน", "ธันวาคม"]
EN = ["January", "February", "March", "April", "May", "June",
      "July", "August", "September", "October", "November", "December"]

month = d.get("month", "")  # 'YYYY-MM'
if month:
    y, m = month.split("-")
    ws["F5"] = f"{TH[int(m)-1]} {EN[int(m)-1]}"
    ws["I5"] = int(y)

sup = d.get("supplier", {})
if sup.get("name"):    ws["D8"]  = sup["name"]
if sup.get("code"):
    ws["H8"] = sup["code"]
    _a = ws["H8"].alignment
    from openpyxl.styles import Alignment as _Al
    ws["H8"].alignment = _Al(horizontal="center", vertical=_a.vertical or "center")
if sup.get("address"): ws["D10"] = sup["address"]
if sup.get("contact"): ws["D12"] = sup["contact"]
if sup.get("tel"):     ws["H12"] = sup["tel"]

# วันที่บนใบวางบิล = วันที่ export (วันนี้)
ws["C50"] = datetime.datetime.now().replace(hour=0, minute=0, second=0, microsecond=0)

# ป้าย "ผู้วางบิล"/"ผู้รับวางบิล" ล้นไปชนช่องเซ็นที่ merge -> หดให้พอดีจะได้เห็นครบ
from openpyxl.styles import Alignment
for coord in ("B48", "G48"):
    c = ws[coord]
    a = c.alignment
    c.alignment = Alignment(horizontal=a.horizontal, vertical=a.vertical, shrink_to_fit=True)

lines = d.get("lines", [])
BASE = 17          # first data row
CAP = 26           # template provides rows 17..42
MINROWS = 40       # จำนวนแถวมาตรฐานในฟอร์ม (เผื่อรายการมากขึ้น)
n = len(lines)
target = max(MINROWS, n)   # ถ้ารายการเกิน 40 ก็ขยายตามจริง (ไหลขึ้นหน้าใหม่)

# template "model" row to copy styles from when we need extra rows
def copy_row_style(src, dst):
    for col in range(1, 13):  # A..L (รวมขอบนอกเข้ม: A=ซ้าย, L=ขวา)
        s = ws.cell(row=src, column=col)
        t = ws.cell(row=dst, column=col)
        t._style = copy(s._style)

DATA_H = ws.row_dimensions[17].height or 19.5   # ความสูงแถวข้อมูลมาตรฐาน

if target > CAP:
    extra = target - CAP
    # openpyxl.insert_rows ไม่เลื่อน merged cells / row heights -> จัดการเองทั้งคู่
    from openpyxl.utils import range_boundaries
    foot_merges = [str(m) for m in ws.merged_cells.ranges if m.min_row >= 43]
    foot_heights = {r: ws.row_dimensions[r].height for r in range(43, 70) if ws.row_dimensions[r].height is not None}
    for rng in foot_merges:
        ws.unmerge_cells(rng)
    ws.insert_rows(43, extra)               # push Total row + below down
    for rng in foot_merges:
        c1, r1, c2, r2 = range_boundaries(rng)
        ws.merge_cells(start_row=r1 + extra, end_row=r2 + extra, start_column=c1, end_column=c2)
    # คืนความสูง footer ที่ตำแหน่งใหม่ (เลื่อนลง extra)
    for r, h in foot_heights.items():
        ws.row_dimensions[r + extra].height = h
    for i in range(extra):
        r = 42 + 1 + i                       # newly inserted rows 43..
        copy_row_style(17, r)
        ws.cell(row=r, column=2).value = "=ROW()-15"               # B No.
        ws.cell(row=r, column=9).value  = f'=IF(F{r}*H{r}=0,"",F{r}*H{r})'   # I Amount
        ws.cell(row=r, column=10).value = f'=IF(I{r}="","",I{r}*K{r})'        # J WHT
        ws.cell(row=r, column=11).value = 0.03                                 # K rate

tr = BASE + target            # total row index after insertion
last = tr - 1                 # last data row

# fill / clear data rows
for idx in range(BASE, last + 1):
    li = idx - BASE
    # normalize ทุกแถวให้สไตล์/เส้นขอบ/ฟอร์แมต/ความสูง เหมือนแถวแรก (กันตารางเละ)
    copy_row_style(BASE, idx)
    ws.row_dimensions[idx].height = DATA_H
    ws.cell(row=idx, column=2).value  = "=ROW()-15"                       # B No.
    ws.cell(row=idx, column=9).value  = f'=IF(F{idx}*H{idx}=0,"",F{idx}*H{idx})'  # I Amount
    ws.cell(row=idx, column=10).value = f'=IF(I{idx}="","",I{idx}*K{idx})'        # J WHT
    if li < n:
        l = lines[li]
        ws.cell(row=idx, column=3).value = None                         # C PO No. (ไม่ใส่)
        ws.cell(row=idx, column=4).value = l.get("part_number") or None # D Part Number
        ws.cell(row=idx, column=5).value = l.get("description") or None # E Description
        ws.cell(row=idx, column=6).value = l.get("quantity") or None    # F Qty
        dt = l.get("deliveryDate")
        if dt:
            try:
                ws.cell(row=idx, column=7).value = datetime.datetime.strptime(dt[:10], "%Y-%m-%d")
            except Exception:
                ws.cell(row=idx, column=7).value = dt
        else:
            ws.cell(row=idx, column=7).value = None
        ws.cell(row=idx, column=8).value = l.get("price") or None       # H Value/unit price
        ws.cell(row=idx, column=11).value = d.get("wht_rate", 0.03)     # K rate
    else:
        # แถวว่าง: เคลียร์ C-H และอัตราภาษี K (กัน 3% โผล่มั่ว) เหลือแค่เส้นขอบ + เลขลำดับ
        for col in (3, 4, 5, 6, 7, 8, 11):
            ws.cell(row=idx, column=col).value = None

# fix totals to span the real data range
ws.cell(row=tr, column=6).value  = f'=IF(SUMIF(F{BASE}:F{last},"<>")=0,"",SUMIF(F{BASE}:F{last},"<>"))'
ws.cell(row=tr, column=9).value  = f'=IF(SUM(I{BASE}:I{last})="","",SUM(I{BASE}:I{last}))'
ws.cell(row=tr, column=10).value = f'=IF(SUM(J{BASE}:J{last})="","",SUM(J{BASE}:J{last}))'

# net total row (label ยอดเงินสุทธิ) sits 2 rows below total row in template
nr = tr + 2
# locate it robustly by scanning for the merged net formula cell J around there
ws.cell(row=nr, column=10).value = f'=IF(J{tr}="","",I{tr}-J{tr})'

# Page setup: บีบทั้งฟอร์มให้จบใน 1 หน้าเสมอ (กว้าง 1 หน้า x สูง 1 หน้า)
from openpyxl.worksheet.properties import PageSetupProperties
extra = max(0, target - CAP)
footer_last = 63 + extra          # เดิม print_area = A1:L63 ; เลื่อนลงตามจำนวนแถวที่แทรก
if ws.sheet_properties.pageSetUpPr is None:
    ws.sheet_properties.pageSetUpPr = PageSetupProperties(fitToPage=True)
else:
    ws.sheet_properties.pageSetUpPr.fitToPage = True
ws.page_setup.fitToWidth = 1
ws.page_setup.fitToHeight = 1
ws.page_setup.scale = None
ws.print_area = f"A1:L{footer_last}"
ws.print_title_rows = None

wb.save(out)
print(out)
