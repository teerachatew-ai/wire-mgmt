# -*- coding: utf-8 -*-
# งบการเงิน (แบบจับคู่ต้นทุน-รายรับ) รายเดือน — แยกต่างหากจาก pl_export.py เดิมโดยสิ้นเชิง
# Usage: python matched_pl_export.py <data.json> <out.xlsx>
import sys, json, warnings
warnings.simplefilter("ignore")
from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side

dataf, out = sys.argv[1], sys.argv[2]
d = json.load(open(dataf, encoding="utf-8-sig"))

TH = ["", "มกราคม", "กุมภาพันธ์", "มีนาคม", "เมษายน", "พฤษภาคม", "มิถุนายน",
      "กรกฎาคม", "สิงหาคม", "กันยายน", "ตุลาคม", "พฤศจิกายน", "ธันวาคม"]
def fmt_month_th(ym):
    yy, mm = ym.split("-")
    return f"{TH[int(mm)]} {int(yy) + 543}"

y, m = d["month"].split("-")
month_th = fmt_month_th(d["month"])

FONT = "Tahoma"
NAVY = "1E3A5F"; GREEN = "0B7A3B"; RED = "B42318"; GREY = "6B7280"; AMBER = "B45309"
MONEY = '#,##0.00;[Red](#,##0.00)'
thin = Side(style="thin", color="D8DEE9")
box = Border(left=thin, right=thin, top=thin, bottom=thin)

wb = Workbook()
ws = wb.active
ws.title = "งบการเงิน"
ws.sheet_view.showGridLines = False
ws.column_dimensions["A"].width = 3
ws.column_dimensions["B"].width = 58
ws.column_dimensions["C"].width = 18
ws.column_dimensions["D"].width = 18
ws.column_dimensions["E"].width = 3

def cell(coord, val, *, font=None, fill=None, align=None, fmt=None, border=None):
    c = ws[coord]; c.value = val
    if font: c.font = font
    if fill: c.fill = PatternFill("solid", fgColor=fill)
    if align: c.alignment = align
    if fmt: c.number_format = fmt
    if border: c.border = border
    return c

R = Alignment(horizontal="right", vertical="center")
L = Alignment(horizontal="left", vertical="center", wrap_text=True)
C = Alignment(horizontal="center", vertical="center")

# ── หัวรายงาน ──
ws.merge_cells("B2:D2")
cell("B2", d.get("org_name", ""), font=Font(name=FONT, size=13, bold=True, color=NAVY), align=C)
ws.merge_cells("B3:D3")
cell("B3", f"งบการเงิน  ประจำเดือน {month_th}", font=Font(name=FONT, size=11, color=GREY), align=C)
ws.merge_cells("B4:D4")
cell("B4", "ค่าแรง = ที่จ่ายจริงของรอบจ่ายเดือนนี้ แบ่งเป็น (1) ตามงานที่ส่งออกโรงงาน และ (2) ส่วนเกินที่สำรองจ่ายสมาชิก",
     font=Font(name=FONT, size=9, italic=True, color=GREY), align=C)
ws.row_dimensions[2].height = 22

row = 6
def section(title):
    global row
    ws.merge_cells(f"B{row}:D{row}")
    cell(f"B{row}", title, font=Font(name=FONT, size=10.5, bold=True, color="FFFFFF"), fill=NAVY, align=Alignment(horizontal="left", vertical="center"))
    ws.row_dimensions[row].height = 20
    row += 1

def line(label, amount, *, bold=False, color=None, sign="", formula=None):
    global row
    cell(f"B{row}", label, font=Font(name=FONT, size=10.5, bold=bold, color=color or "111827"), align=Alignment(horizontal="left", vertical="center"), border=box)
    cell(f"C{row}", None, border=box)
    disp = formula if formula is not None else (amount if sign != "-" else -abs(amount))
    cell(f"D{row}", disp, font=Font(name=FONT, size=10.5, bold=bold, color=color or "111827"),
         align=R, fmt=MONEY, border=box)
    ref = f"D{row}"
    ws.row_dimensions[row].height = 18
    row += 1
    return ref

def detail(label, amount):
    global row
    cell(f"B{row}", "      • " + (label or "(ไม่ระบุ)"), font=Font(name=FONT, size=9.5, color=GREY), align=Alignment(horizontal="left", vertical="center"), border=box)
    cell(f"C{row}", amount, font=Font(name=FONT, size=9.5, color=GREY), align=R, fmt=MONEY, border=box)
    cell(f"D{row}", None, border=box)
    ws.row_dimensions[row].height = 16
    row += 1

def note(text, *, color=GREY):
    global row
    ws.merge_cells(f"B{row}:D{row}")
    cell(f"B{row}", text, font=Font(name=FONT, size=9, italic=True, color=color), align=L)
    ws.row_dimensions[row].height = 26
    row += 1

# ── รายรับ ──
section("รายรับ")
ref_revenue = line("รายรับจากโรงงาน (Amphenol) — ตามยอดส่งออก/วางบิลจริงเดือนนี้", d["revenue"], bold=True, color=GREEN)

TH_S = ["", "ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."]
def thd(iso):
    yy, mm, dd = [int(x) for x in str(iso).split("-")]
    return f"{dd} {TH_S[mm]} {str(yy + 543)[-2:]}"
def cyc(ym):
    yy, mm = [int(x) for x in ym.split("-")]
    return f"{TH_S[mm]} {str(yy + 543)[-2:]}"
o = d["wages_owed"]

# ── ค่าแรงที่จ่ายจริง (2 ชั้น) ──
section(f"หัก ค่าแรงสมาชิกที่จ่ายจริง (รอบ {cyc(d['month'])} · กำหนดจ่าย {thd(o['cycle_pay_date'])})")
# คำนวณค่าแรงสุทธิ: ค่าแรงตัดก่อนหักค่าปรับ − ค่าปรับ NG (+ ปัดเศษขึ้นเต็มบาทต่อคน) = ค่าแรงสุทธิ (รวมที่จ่ายจริง)
wb_ = d.get("wage_breakdown") or {"gross": d["wage_paid"], "penalty": 0, "round": 0}
w_first = row
detail("ค่าแรงตัด (ก่อนหักค่าปรับ)", wb_["gross"])
detail("หัก ค่าปรับ NG", -wb_["penalty"])
detail("ปัดเศษขึ้นเป็นบาทเต็มต่อคน", wb_["round"])
ref_wage = line("ค่าแรงสุทธิที่จ่ายจริง", d["wage_paid"], color=RED, sign="-", bold=True, formula=f"=-SUM(C{w_first}:C{w_first + 2})")
# แยกตามที่มา (ไม่รวมในสูตรข้างบน — เป็นอีกมุมมองของยอดเดียวกัน)
detail("แยกตามที่มา: ① ค่าแรงตามปริมาณงานที่ส่งออกโรงงาน", d["wage_matched"])
ref_matched = f"C{row - 1}"
detail("แยกตามที่มา: ② ส่วนเกินที่สำรองจ่ายสมาชิก (งานยังไม่ได้ส่งออก)" if d["wage_excess"] >= 0
       else "แยกตามที่มา: ② ส่งออกงานที่สำรองจ่ายไว้รอบก่อน", d["wage_excess"])
ref_excess = f"C{row - 1}"
row += 1
cell(f"B{row}", "กำไรขั้นต้น (Gross Profit)", font=Font(name=FONT, size=11, bold=True, color=NAVY), align=Alignment(horizontal="left", vertical="center"))
cell(f"D{row}", f"={ref_revenue}+{ref_wage}", font=Font(name=FONT, size=11, bold=True, color=NAVY), align=R, fmt=MONEY)
ref_gross = f"D{row}"
ws.row_dimensions[row].height = 20
row += 2

# ── ค่าใช้จ่ายดำเนินงาน ──
section("หัก ค่าใช้จ่ายดำเนินงาน")
ref_tax = line(f"ภาษี ณ ที่จ่าย {d.get('tax_pct', 3)}%", d["tax"], color=RED, sign="-")

mgr_detail_first = row
for mg in d.get("manager_lines", []):
    if mg["computed"]:
        detail(f'{mg["name"]}{(" · " + mg["role"]) if mg.get("role") else ""}', mg["computed"])
for e in d.get("comp_exp_lines", []):
    who = e.get("paid_to_name") or ("ผู้บริหาร" if e.get("paid_to_type") == "manager" else "สมาชิก")
    detail(f'{e.get("description") or "จ่ายพิเศษ"} → {who}', e["amount"])
mgr_detail_last = row - 1
mgr_formula = f"=-SUM(C{mgr_detail_first}:C{mgr_detail_last})" if mgr_detail_last >= mgr_detail_first else None
ref_mgr_comp = line("รวมค่าตอบแทนผู้บริหาร", d["manager_comp"], color=RED, sign="-", bold=True, formula=mgr_formula)

gen_detail_first = row
for e in d.get("general_exp_lines", []):
    detail(e.get("description"), e["amount"])
gen_detail_last = row - 1
gen_formula = f"=-SUM(C{gen_detail_first}:C{gen_detail_last})" if gen_detail_last >= gen_detail_first else None
ref_gen_exp = line("รวมค่าใช้จ่ายบริหารจัดการ", d["general_exp_total"], color=RED, sign="-", bold=True, formula=gen_formula)

# ── กำไรสุทธิ ──
row += 1
pos = d["net_paid"] >= 0
cell(f"B{row}", "กำไรสุทธิ", font=Font(name=FONT, size=12, bold=True, color="FFFFFF"),
     fill=(GREEN if pos else RED), align=Alignment(horizontal="left", vertical="center"))
cell(f"C{row}", None, fill=(GREEN if pos else RED))
cell(f"D{row}", f"={ref_gross}+{ref_tax}+{ref_mgr_comp}+{ref_gen_exp}", font=Font(name=FONT, size=12, bold=True, color="FFFFFF"),
     fill=(GREEN if pos else RED), align=R, fmt=MONEY)
ref_net = f"D{row}"
ws.row_dimensions[row].height = 26
margin = (d["net_paid"] / d["revenue"] * 100) if d["revenue"] else 0
row += 1
ws.merge_cells(f"B{row}:D{row}")
cell(f"B{row}", f"อัตรากำไรสุทธิ {margin:.1f}%", font=Font(name=FONT, size=9.5, italic=True, color=GREY), align=R)
row += 1
line("ถ้าไม่นับส่วน ② (คิดค่าแรงเฉพาะงานที่ส่งออก) กำไรสุทธิจะเป็น", d["net_matched"], color=GREY, formula=f"={ref_net}+{ref_excess}")
note("ส่วนสำรองจ่ายไม่ได้หายไป แต่จะกลับมาเป็นรายรับเมื่อส่งงานนั้นออกโรงงานรอบถัดไป")
row += 1

# ── ที่มาของส่วน ② ──
section("ค่าแรงที่จ่ายจริง แยกตามชนิดงาน  (① ตามงานส่งออก · ② สำรองจ่าย)")
cell(f"B{row}", "ชนิดงาน (ส่งออก)", font=Font(name=FONT, size=9.5, bold=True, color=GREY), align=Alignment(horizontal="left", vertical="center"), border=box)
cell(f"C{row}", "① ตามงานส่งออก", font=Font(name=FONT, size=9.5, bold=True, color=GREY), align=R, border=box)
cell(f"D{row}", "② สำรองจ่าย", font=Font(name=FONT, size=9.5, bold=True, color=GREY), align=R, border=box)
row += 1
for p in d.get("layer_products", []):
    cell(f"B{row}", f"      • {p['name']} ({p['ship_qty']:,.0f})", font=Font(name=FONT, size=9.5, color="374151"), align=Alignment(horizontal="left", vertical="center"), border=box)
    cell(f"C{row}", p["matched"], font=Font(name=FONT, size=9.5, color="374151"), align=R, fmt=MONEY, border=box)
    cell(f"D{row}", p["excess"], font=Font(name=FONT, size=9.5, color=(AMBER if p["excess"] > 0.005 else "374151")), align=R, fmt=MONEY, border=box)
    ws.row_dimensions[row].height = 16
    row += 1
ex = d["excess_parts"]
cell(f"B{row}", "      • หักค่าปรับ NG และปัดเศษขึ้นเต็มบาทต่อคน", font=Font(name=FONT, size=9.5, color=GREY), align=Alignment(horizontal="left", vertical="center"), border=box)
cell(f"C{row}", None, border=box)
cell(f"D{row}", ex["adjust"], font=Font(name=FONT, size=9.5, color=GREY), align=R, fmt=MONEY, border=box)
row += 1
note(f"ที่มาของส่วนสำรองจ่าย {d['wage_excess']:,.2f} บาท:  งานคืนแล้วยังไม่ส่งออก {ex['dFG']:,.2f}  ·  เหลื่อมวันตัดยอด {ex['timing']:,.2f}  ·  "
     f"NG โรงงาน/หาย/NG สมาชิก − งานแก้ {ex['extra']:,.2f}  ·  ค่าปรับ/ปัดเศษ {ex['adjust']:,.2f}")
row += 1

# ── เงินทดรองจ่ายจากกองทุนวิสาหกิจ ── (= ส่วน ② สะสม)
section("เงินทดรองจ่ายจากกองทุนวิสาหกิจ")
advance = d.get("advance_needed", 0)
if advance > 0.005:
    line("ต้องยืมกองทุนเพิ่มเดือนนี้ (= ส่วน ②)", advance, color=RED, bold=True, formula=f"={ref_excess}")
elif advance < -0.005:
    line("มีกำไรส่วนเกิน คืนกองทุนได้เดือนนี้", -advance, color=GREEN, bold=True, formula=f"=-{ref_excess}")
else:
    line("ส่วนต่างเดือนนี้ — พอดี ไม่ต้องยืม/คืน", 0, color=GREY, formula=f"={ref_excess}")
ref_loan_open = line("ยอดหนี้กองทุน ยกมา", d.get("fund_loan_open", 0), color=GREY)
ref_loan_close = line("ยอดหนี้กองทุน ยกไป (ยังติดค้างกองทุนอยู่สิ้นเดือนนี้)", d.get("fund_loan_close", 0), color=NAVY, bold=True,
                       formula=f"=MAX(0,{ref_loan_open}+{ref_excess})")
earliest = d.get("fund_loan_earliest_month")
note(f"หมายเหตุ: เป็นยอดประมาณการสะสมจากข้อมูลในระบบตั้งแต่เดือน {fmt_month_th(earliest) if earliest else '-'} "
     "ถ้ายอดยืม/คืนจริงในอดีตไม่ตรงตามสูตรนี้ ควรตรวจสอบยอดกับบัญชีจริงของกลุ่มอีกครั้ง", color=AMBER)
row += 1

# ── สินทรัพย์/หนี้สินที่เกี่ยวข้อง ณ สิ้นเดือน ──
section("สินทรัพย์-หนี้สินที่เกี่ยวข้องกับงานตัดสายไฟ ณ สิ้นเดือน")
line("สินค้าคงเหลือ (งานตัดเสร็จ รอส่งออก) ยกมา", d["inventory_open"], color=GREY)
line("สินค้าคงเหลือ (งานตัดเสร็จ รอส่งออก) ยกไป", d["inventory_close"], color=NAVY, bold=True)
accr_row = row
line("ค่าแรงค้างจ่ายสมาชิก (ดูหมายเหตุ)", d["accrued_wages_payable"], color=RED, bold=True)
line("เงินยืมกองทุนวิสาหกิจคงค้าง", d.get("fund_loan_close", 0), color=RED, bold=True, formula=f"={ref_loan_close}")
row += 1

# ── หมายเหตุ: ค่าแรงที่ยังค้างจ่ายสมาชิก ──
section(f"หมายเหตุ: ค่าแรงที่ยังค้างจ่ายสมาชิก ณ {thd(o['as_of'])}")
oa = line(f"(ก) ค่าแรงรอบ {cyc(o['cycle'])} (คืนงาน {thd(o['cycle_start'])} – {thd(o['cycle_end'])}) จ่าย {thd(o['cycle_pay_date'])}", o["cycle_total"])
after_rng = f"{thd(o['after_from'])} – {thd(o['as_of'])}" if o["after_from"] <= o["as_of"] else "(ไม่มีช่วงนี้)"
ob = line(f"(ข) คืนหลังวันตัดยอด {after_rng} (รอบ {cyc(o['after_cycle'])}) จ่าย {thd(o['after_pay_date'])}", o["after_total"])
for p in o.get("after_products", []):
    detail(f"{p['name']}  {p['qty']:,.0f} {p.get('unit') or ''} × {p['wage']:,.2f}", p["amount"])
ot = line("รวมค่าแรงค้างจ่ายสมาชิก", o["total"], color=RED, bold=True, formula=f"={oa}+{ob}")
ws[f"D{accr_row}"] = f"={ot}"
note("งานที่สมาชิกคืนแล้ว (ได้ค่าแรงแล้ว) แต่ยังไม่ถึงวันจ่าย — ค่าแรงรอบก่อนหน้าจ่ายไปแล้ววันที่ 25 ของเดือนนี้ จึงไม่ค้าง · "
     "(ก) สุทธิหลังหักค่าปรับ ปัดขึ้นเต็มบาทต่อคน · (ข) หักค่าปรับ NG ของรายการนั้นแล้ว · รายสมาชิกดูหน้าถัดไป")

# ── ชีตที่ 2: ค่าแรงค้างจ่าย รายสมาชิก ──
ws2 = wb.create_sheet("ค่าแรงค้างจ่าย รายสมาชิก")
ws2.sheet_view.showGridLines = False
for col, w in zip("ABCDEF", [3, 40, 17, 17, 17, 3]):
    ws2.column_dimensions[col].width = w
ws2.merge_cells("B2:E2")
c = ws2["B2"]; c.value = f"ค่าแรงที่ยังค้างจ่ายสมาชิก ณ {thd(o['as_of'])}  (ประกอบงบการเงินเดือน {month_th})"
c.font = Font(name=FONT, size=12, bold=True, color=NAVY); c.alignment = C
hdr = ["สมาชิก", f"(ก) รอบ {cyc(o['cycle'])}", "(ข) หลังวันตัดยอด", "รวมค้างจ่าย"]
for i, h in enumerate(hdr):
    c = ws2.cell(row=4, column=2 + i, value=h)
    c.font = Font(name=FONT, size=10, bold=True, color="FFFFFF"); c.fill = PatternFill("solid", fgColor=NAVY)
    c.alignment = C if i else Alignment(horizontal="left", vertical="center"); c.border = box
r2 = 5
for mm in o.get("members", []):
    nm = f"{mm['code']}  {mm['name']}" + (f" ({mm['nickname']})" if mm.get("nickname") else "")
    vals = [nm, mm["cycle"] or None, mm["after"] or None, f"=SUM(C{r2}:D{r2})"]
    for i, v in enumerate(vals):
        c = ws2.cell(row=r2, column=2 + i, value=v)
        c.font = Font(name=FONT, size=10, bold=(i == 3), color=(RED if i == 3 else "111827")); c.border = box
        c.alignment = R if i else Alignment(horizontal="left", vertical="center")
        if i: c.number_format = MONEY
    r2 += 1
for i, v in enumerate(["รวม", f"=SUM(C5:C{r2 - 1})", f"=SUM(D5:D{r2 - 1})", f"=SUM(E5:E{r2 - 1})"]):
    c = ws2.cell(row=r2, column=2 + i, value=v)
    c.font = Font(name=FONT, size=10.5, bold=True, color=(RED if i == 3 else NAVY)); c.border = box
    c.alignment = R if i else Alignment(horizontal="left", vertical="center")
    if i: c.number_format = MONEY
ws2.print_area = f"A1:F{r2 + 1}"
ws2.print_title_rows = "4:4"
ws2.page_setup.orientation = "portrait"
ws2.page_setup.fitToWidth = 1
ws2.page_setup.fitToHeight = 0
ws2.sheet_properties.pageSetUpPr.fitToPage = True
ws2.page_margins.left = ws2.page_margins.right = 0.4

# print setup
ws.print_area = f"A1:E{row+1}"
ws.page_setup.orientation = "portrait"
ws.page_setup.fitToWidth = 1
ws.page_setup.fitToHeight = 1
ws.sheet_properties.pageSetUpPr.fitToPage = True
ws.page_margins.left = ws.page_margins.right = 0.4

wb.save(out)
print(out)
