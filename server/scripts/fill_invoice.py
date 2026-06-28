# -*- coding: utf-8 -*-
# เติมข้อมูลลง template ใบแจ้งหนี้ (server/templates/invoice-template.xlsx)
# Usage: python fill_invoice.py <template.xlsx> <data.json> <out.xlsx>
import sys, json, datetime, warnings
warnings.simplefilter("ignore")
from openpyxl import load_workbook

tpl, dataf, out = sys.argv[1], sys.argv[2], sys.argv[3]
mode = sys.argv[4] if len(sys.argv) > 4 else ""   # "pdf" = เหลือเฉพาะชีตใบแจ้งหนี้
d = json.load(open(dataf, encoding="utf-8-sig"))

wb = load_workbook(tpl)
ws = wb["ใบแจ้งหนี้"]

# ---- หัวบิล ----
if d.get("invoice_no"):
    try:    ws["J5"] = int(d["invoice_no"])
    except: ws["J5"] = d["invoice_no"]
dt = d.get("date")
if dt:
    try:    ws["J6"] = datetime.datetime.strptime(dt[:10], "%Y-%m-%d")
    except: ws["J6"] = dt

# ป้าย "วันครบกำหนด / Due Date" (I9,I10) ตั้ง wrap ไว้แล้วถูกตัด -> หดให้พอดีช่อง เห็นครบ
from openpyxl.styles import Alignment as _Al
for _c in ("I9", "I10"):
    _a = ws[_c].alignment
    ws[_c].alignment = _Al(horizontal=_a.horizontal, vertical=_a.vertical, wrap_text=False, shrink_to_fit=True)

cust = d.get("customer", {})
if cust.get("name"):    ws["D11"] = cust["name"]
if cust.get("address"): ws["D12"] = cust["address"]
if cust.get("contact"): ws["D13"] = cust["contact"]
if cust.get("taxid"):   ws["E14"] = cust["taxid"]

# ---- รายการสินค้า (แถว 18-29 = 12 บรรทัด) ----
BASE = 18
CAP = 12
lines = d.get("lines", [])[:CAP]
for i in range(CAP):
    r = BASE + i
    if i < len(lines):
        l = lines[i]
        ws.cell(row=r, column=3).value = l.get("project") or None        # C โครงการ
        ws.cell(row=r, column=4).value = l.get("part_number") or None    # D รหัสสินค้า
        ws.cell(row=r, column=5).value = l.get("description") or None    # E รายการ (merged E:G)
        ws.cell(row=r, column=8).value = l.get("quantity") or None       # H จำนวนหน่วย
        ws.cell(row=r, column=9).value = l.get("price") or None          # I ราคาต่อหน่วย
        # B (ลำดับ) และ J (จำนวนเงิน) ปล่อยเป็นสูตรเดิมของ template ให้คำนวณเอง
    else:
        # แถวว่าง: ล้างสูตร lookup เดิมออก ไม่ให้โชว์ค่าค้าง
        for col in (3, 4, 5, 8, 9):
            ws.cell(row=r, column=col).value = None

# โหมด PDF: ลบชีตข้อมูลช่วยออก เหลือเฉพาะใบแจ้งหนี้ + บีบให้พอดี 1 หน้าเสมอ
if mode == "pdf":
    for sn in list(wb.sheetnames):
        if sn != "ใบแจ้งหนี้":
            del wb[sn]
    from openpyxl.worksheet.properties import PageSetupProperties
    if ws.sheet_properties.pageSetUpPr is None:
        ws.sheet_properties.pageSetUpPr = PageSetupProperties(fitToPage=True)
    else:
        ws.sheet_properties.pageSetUpPr.fitToPage = True
    ws.page_setup.fitToWidth = 1
    ws.page_setup.fitToHeight = 1
    ws.page_setup.scale = None

wb.save(out)
print(out)
