# -*- coding: utf-8 -*-
# ใบคุมการเบิก–คืนงาน (สำหรับพิมพ์ไปใช้หน้างาน) — 1 วันที่เบิก = 1 ชีต → PDF A4 แนวตั้ง (วันละหน้า/หลายหน้า)
# แถว = สมาชิก (3 แถวย่อย เบิก / คืน 1 / คืน 2) · คอลัมน์ = ชนิดงานเรียงไปทางขวา · ขวาสุด = วันที่คืน
#   - คืนแล้วในระบบ → พิมพ์จำนวน/วันที่ให้เลย (คืนเกิน 2 ครั้ง: คืน 2 = รวมครั้งที่เหลือ)
#   - ยังไม่คืน / คืนไม่ครบ → เว้นช่องว่างให้เขียนเองหน้างาน
# Usage: python issue_daily_print.py <data.json> <out.xlsx>
import sys, json, re, warnings
from datetime import datetime
warnings.simplefilter("ignore")
from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
from openpyxl.worksheet.pagebreak import Break

dataf, out = sys.argv[1], sys.argv[2]
d = json.load(open(dataf, encoding="utf-8-sig"))

TH_M = ["", "ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."]
TH_ML = ["", "มกราคม", "กุมภาพันธ์", "มีนาคม", "เมษายน", "พฤษภาคม", "มิถุนายน",
         "กรกฎาคม", "สิงหาคม", "กันยายน", "ตุลาคม", "พฤศจิกายน", "ธันวาคม"]
TH_D = ["จันทร์", "อังคาร", "พุธ", "พฤหัสบดี", "ศุกร์", "เสาร์", "อาทิตย์"]

def ymd(iso):
    y, m, dd = map(int, str(iso)[:10].split("-"))
    return y, m, dd

def date_long(iso):
    y, m, dd = ymd(iso)
    return f"{dd} {TH_ML[m]} {y + 543} (วัน{TH_D[datetime(y, m, dd).weekday()]})"

def date_short(iso):
    y, m, dd = ymd(iso)
    return f"{dd} {TH_M[m]} {str(y + 543)[2:]}"

def hexcolor(c):
    c = str(c or "").lstrip("#").strip()
    if len(c) == 3:
        c = "".join(ch * 2 for ch in c)
    return c.upper() if len(c) == 6 and all(ch in "0123456789abcdefABCDEF" for ch in c) else None

def color_priority(hexc):
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

def label(name):
    mm = re.search(r"\(([^)]+)\)", name or "")
    lbl = mm.group(1) if mm else (name or "-")
    num = re.search(r"-(\d+)", (name or "").split("(")[0])
    return f"{lbl} {num.group(1)}" if num else lbl

def prod_key(name, color):
    hexc = hexcolor(color)
    num = re.search(r"-(\d+)", (name or "").split("(")[0])
    return (color_priority(hexc), hexc or "ZZZZZZ", num.group(1) if num else "", name)

FONT = "TH SarabunPSK"   # ติดตั้งบนเซิร์ฟเวอร์จาก fonts/ (Dockerfile) · ตัวเล็กกว่า Tahoma จึงขยายขนาดในฟังก์ชัน font()
FS = 1.6
INK = "111827"; GREY = "6B7280"; LIGHT = "9CA3AF"; NAVY = "1E3A5F"; BLUE = "1D4ED8"; GREEN = "047857"; AMBER = "B45309"
HEAD_FILL = "1E3A5F"; RET_HEAD = "0F766E"; ZEBRA = "F5F7FA"; DONE_FILL = "ECFDF5"
NG_HEAD = "B91C1C"; NG_FILL = "FEF2F2"; RED = "B91C1C"
thin = Side(style="thin", color="C7CED9")
med = Side(style="medium", color="1E3A5F")
ret_edge = Side(style="medium", color="0F766E")
NUM = '#,##0'

def font(size=10, bold=False, color=INK, italic=False):
    return Font(name=FONT, size=round(size * FS, 1), bold=bold, color=color, italic=italic)

# ข้อความหลายสไตล์ในช่องเดียว — openpyxl เก่า (เช่น python3-openpyxl 3.0 บน Debian/Render) ไม่มี rich text → ใช้ข้อความธรรมดาแทน
try:
    from openpyxl.cell.rich_text import CellRichText, TextBlock
    from openpyxl.cell.text import InlineFont
except ImportError:
    CellRichText = None

def rich(parts):
    """parts = [(size, bold, color, text), ...]"""
    if CellRichText is None:
        return "".join(t for *_, t in parts if t)
    return CellRichText([TextBlock(InlineFont(rFont=FONT, sz=round(sz * FS, 1), b=b, color=col), t) for sz, b, col, t in parts if t])

def put(ws, r, c, v=None, *, f=None, fill=None, al=None, fmt=None, border=None):
    cell = ws.cell(row=r, column=c)
    if v is not None:
        cell.value = v
    if f: cell.font = f
    if fill: cell.fill = PatternFill("solid", fgColor=fill)
    if al: cell.alignment = al
    if fmt: cell.number_format = fmt
    if border: cell.border = border
    return cell

C = Alignment(horizontal="center", vertical="center", wrap_text=True)
L = Alignment(horizontal="left", vertical="center", wrap_text=True, indent=1)
R = Alignment(horizontal="right", vertical="center", indent=1)

# ── รูปแบบ matrix: แถว = สมาชิก · คอลัมน์ = ชนิดงานเรียงไปทางขวา (ดูปราดเดียวรู้ว่าใครเบิกอะไรเท่าไหร่) ──
# สมาชิก 1 คน = 5 แถวย่อย:  เบิก (ตัวหนา) / คืน 1 / คืน 2 / NG โรงงาน / NG สมาชิก
#   แถวคืนเว้นว่างไว้เขียนจำนวนที่คืนของแต่ละชนิดเอง · คอลัมน์ขวาสุด "วันที่คืน" ของแถวคืน 1/คืน 2
#   แถว NG = จำนวนงานเสียแต่ละชนิดงาน (NG สมาชิก = ตัดโดนสายไฟ + ดึงเชือก) · คืนแล้วในระบบ = พิมพ์ให้ (ตัวเอียง)
# คืน 1 = วันที่คืนครั้งแรก · คืน 2 = ทุกครั้งที่เหลือรวมกัน (ส่วนมากแบ่งคืนไม่เกิน 2 ครั้ง)
all_products = d.get("products") or {}
org = d.get("org_name", "")

def text_on(hexc):
    """สีตัวอักษรที่อ่านออกบนพื้นสี hexc"""
    if not hexc:
        return INK
    r, g, b = int(hexc[0:2], 16), int(hexc[2:4], 16), int(hexc[4:6], 16)
    return INK if (0.299 * r + 0.587 * g + 0.114 * b) > 125 else "FFFFFF"   # เขียว/ชมพู = ตัวเข้ม · น้ำเงิน = ตัวขาว

wb = Workbook()
wb.remove(wb.active)
used = set()

from openpyxl.utils import get_column_letter as COL

for day in d["days"]:
    lines = day.get("lines") or []
    if not lines:
        continue
    sheet = day["date"][:10]
    while sheet in used:
        sheet += "-"
    used.add(sheet)
    ws = wb.create_sheet(sheet)
    ws.sheet_view.showGridLines = False

    # คอลัมน์สินค้า = สินค้าที่เปิดใช้งานทั้งหมด (ทุกวันหน้าตาเหมือนกัน) + ที่มีในวันนั้น เรียงตามสีป้าย
    pcolor = {n: (all_products.get(n) or {}).get("color") for n in all_products}
    for l in lines:
        pcolor.setdefault(l["product_name"], l.get("color"))
    prods = sorted(pcolor, key=lambda n: prod_key(n, pcolor[n]))
    NP = len(prods)
    cN, cM, cT = 1, 2, 3                 # # | สมาชิก | ป้ายแถว (เบิก/คืน/NG)
    cP0 = 4                              # สินค้าคอลัมน์แรก
    cSum = cP0 + NP                      # รวม
    cDate = cSum + 1                     # วันที่คืน (ขวาสุด)
    NCOL = cDate
    # ความกว้างรวม ~98 ตัวอักษร — LibreOffice บนเซิร์ฟเวอร์ย่อให้พอดีความกว้าง A4 ราว 80%
    widths = {cN: 3, cM: 16, cT: 7, cSum: 6.8, cDate: 9.5}
    for c in range(1, NCOL + 1):
        ws.column_dimensions[COL(c)].width = widths.get(c, 6.2)

    # ── หัวกระดาษ ──
    ws.merge_cells(start_row=1, start_column=1, end_row=1, end_column=NCOL)
    put(ws, 1, 1, org, f=font(9.5, color=GREY), al=Alignment(horizontal="left", vertical="center"))
    ws.merge_cells(start_row=2, start_column=1, end_row=2, end_column=cP0 + 2)
    put(ws, 2, 1, "ใบคุมการเบิก–คืนงาน", f=font(16, True, NAVY), al=Alignment(horizontal="left", vertical="center"))
    ws.merge_cells(start_row=2, start_column=cP0 + 3, end_row=2, end_column=NCOL)
    put(ws, 2, cP0 + 3, "วันที่เบิก  " + date_long(day["date"]), f=font(11, True), al=Alignment(horizontal="right", vertical="center"))
    members = sorted({l["member_code"] for l in lines})
    ws.merge_cells(start_row=3, start_column=1, end_row=3, end_column=NCOL)
    put(ws, 3, 1, f"สมาชิก {len(members)} คน", f=font(9, color=GREY), al=Alignment(horizontal="left", vertical="center"))
    for r, h in ((1, 15), (2, 26), (3, 15), (4, 5)):
        ws.row_dimensions[r].height = h

    # ── หัวตาราง ── (เขียนซ้ำเองทุกครั้งที่ตัดหน้า — LibreOffice บนเซิร์ฟเวอร์ไม่พิมพ์ "แถวหัวซ้ำทุกหน้า" ให้)
    # หัวคอลัมน์ชนิดงาน = พื้นสีของป้ายงานนั้น (ขาว / ชมพู / เขียว / น้ำเงิน)
    hb = Border(left=thin, right=thin, top=thin, bottom=thin)
    def table_header(H):
        put(ws, H, cN, "#", f=font(9, True, "FFFFFF"), fill=HEAD_FILL, al=C, border=hb)
        ws.merge_cells(start_row=H, start_column=cM, end_row=H, end_column=cT)
        put(ws, H, cM, "สมาชิก", f=font(9.5, True, "FFFFFF"), fill=HEAD_FILL, al=C, border=hb)
        put(ws, H, cT, fill=HEAD_FILL, border=hb)
        for i, pn in enumerate(prods):
            hexc = hexcolor(pcolor[pn]) or "FFFFFF"
            fg = text_on(hexc)
            parts = label(pn).rsplit(" ", 1)
            c = put(ws, H, cP0 + i, None, fill=hexc, al=C, border=Border(left=thin, right=thin, top=thin, bottom=Side(style="medium", color=HEAD_FILL)),
                    f=font(8.5, True, fg))
            c.value = rich([(8.5, True, fg, parts[0]), (8, False, fg, ("\n" + parts[1]) if len(parts) > 1 else "")])
        put(ws, H, cSum, "รวม", f=font(9.5, True, "FFFFFF"), fill=HEAD_FILL, al=C, border=hb)
        put(ws, H, cDate, "วันที่คืน", f=font(9.5, True, "FFFFFF"), fill=RET_HEAD, al=C, border=hb)
        ws.row_dimensions[H].height = 40
    H = 5
    table_header(H)

    # ── สมาชิก ──
    by_member = {}
    for l in lines:
        by_member.setdefault(l["member_code"], []).append(l)
    row = H + 1
    tot_issue = {p: 0.0 for p in prods}
    tot_ret = {p: 0.0 for p in prods}
    tot_ngf = {p: 0.0 for p in prods}
    tot_ngm = {p: 0.0 for p in prods}
    sep = Side(style="medium", color="64748B")
    # ตัดหน้าเองก่อนกลุ่มสมาชิกที่จะล้นหน้า — 5 แถวของคนเดียวกันต้องอยู่หน้าเดียวกันเสมอ
    # หน้า A4 ≈ 777pt ÷ อัตราย่อบนเซิร์ฟเวอร์ ~0.8 ≈ 970pt (เผื่อไว้ 950) · สมาชิก 1 คน = 22+24+24+20+20 = 110pt
    ROW_H = (22, 24, 24, 20, 20)
    PAGE_H, BLOCK_H, used_h = 1060, sum(ROW_H), 15 + 26 + 15 + 5 + 40
    for gi, code in enumerate(sorted(by_member)):
        group = by_member[code]
        issued, rets, ngf, ngm = {}, {}, {}, {}    # rets: date -> {product: qty} · ngf/ngm: product -> NG รวมทุกงวด
        for l in group:
            p = l["product_name"]
            issued[p] = issued.get(p, 0.0) + float(l["quantity"] or 0)
            for r in l.get("returns") or []:
                rets.setdefault(r["date"], {})
                rets[r["date"]][p] = rets[r["date"]].get(p, 0.0) + float(r["qty"] or 0)
                ngf[p] = ngf.get(p, 0.0) + float(r.get("ng_factory") or 0)
                ngm[p] = ngm.get(p, 0.0) + float(r.get("ng_group") or 0)
        dates = sorted(rets)
        inst = []
        if dates:
            inst.append((date_short(dates[0]), rets[dates[0]]))
        if len(dates) > 1:
            merged = {}
            for dt in dates[1:]:
                for p, q in rets[dt].items():
                    merged[p] = merged.get(p, 0.0) + q
            lbl2 = date_short(dates[-1]) if len(dates) == 2 else f"{date_short(dates[1])} +{len(dates) - 2}"
            inst.append((lbl2, merged))
        iss_total = sum(issued.values())
        ret_total = sum(sum(m.values()) for _, m in inst)
        done = dates and ret_total >= iss_total - 1e-9
        for p, q in issued.items():
            tot_issue[p] = tot_issue.get(p, 0) + q
        for _, m in inst:
            for p, q in m.items():
                tot_ret[p] = tot_ret.get(p, 0) + q
        for p, q in ngf.items():
            tot_ngf[p] = tot_ngf.get(p, 0) + q
        for p, q in ngm.items():
            tot_ngm[p] = tot_ngm.get(p, 0) + q

        nick = (group[0].get("member_nickname") or "").strip()
        full = (group[0].get("member_name") or "").strip()
        who = rich([(9.5, True, INK, f"{code}  {nick or full}"),
                    (7.5, False, GREY, f"\n{full}" if nick and full and nick != full else "")])
        r0 = row
        if used_h + BLOCK_H > PAGE_H:
            ws.row_breaks.append(Break(id=r0 - 1))
            table_header(r0)          # หน้าใหม่เริ่มด้วยหัวตาราง
            r0 = row = r0 + 1
            used_h = 40
        used_h += BLOCK_H
        bg_issue = DONE_FILL if done else ("F1F5F9" if gi % 2 else "FFFFFF")
        bg_ret = DONE_FILL if done else None
        b = Border(left=thin, right=thin, top=thin, bottom=thin)
        shade = "E5E7EB"

        # แถว "เบิก"
        put(ws, r0, cT, "เบิก", f=font(8.5, True, NAVY), fill=bg_issue, al=C, border=b)
        for i, p in enumerate(prods):
            q = issued.get(p)
            put(ws, r0, cP0 + i, q if q else None, f=font(10.5, True), fill=bg_issue, al=C, fmt=NUM, border=b)
        put(ws, r0, cSum, iss_total, f=font(10.5, True, NAVY), fill=bg_issue, al=C, fmt=NUM, border=b)
        status = "✓ คืนครบ" if done else (f"ค้าง {iss_total - ret_total:,.0f}" if dates else None)
        put(ws, r0, cDate, status, f=font(8.5, True, GREEN if done else AMBER), fill=bg_issue, al=C, border=b)

        # แถว "คืน 1" / "คืน 2" — เว้นว่างให้เขียน (ช่องสินค้าที่ไม่ได้เบิกแรเงาไว้ ไม่ต้องเขียน)
        for k in range(2):
            rr = r0 + 1 + k
            dt_txt, m = inst[k] if k < len(inst) else (None, {})
            put(ws, rr, cT, f"คืน {k + 1}", f=font(8.5, color=RET_HEAD), fill=bg_ret, al=C, border=b)
            for i, p in enumerate(prods):
                q = m.get(p)
                put(ws, rr, cP0 + i, q if q else None, f=font(10, True, BLUE, italic=True),
                    fill=(bg_ret if issued.get(p) else shade), al=C, fmt=NUM, border=b)
            s = sum(m.values()) if m else None
            put(ws, rr, cSum, s, f=font(10, True, BLUE, italic=True), fill=bg_ret, al=C, fmt=NUM, border=b)
            put(ws, rr, cDate, dt_txt, f=font(9.5, False, BLUE, italic=True), fill=bg_ret, al=C, border=b)

        # แถว NG แยกชนิดงาน — NG โรงงาน / NG สมาชิก (ตัดโดนสายไฟ + ดึงเชือก)
        for k, (lbl, vals) in enumerate((("NG โรงงาน", ngf), ("NG สมาชิก", ngm))):
            rr = r0 + 3 + k
            put(ws, rr, cT, lbl, f=font(8, True, RED), fill=NG_FILL, al=C, border=b)
            for i, p in enumerate(prods):
                q = vals.get(p)
                put(ws, rr, cP0 + i, q if q else None, f=font(10, True, RED, italic=True),
                    fill=(NG_FILL if issued.get(p) else shade), al=C, fmt=NUM, border=b)
            s = sum(vals.values())
            put(ws, rr, cSum, s or None, f=font(10, True, RED, italic=True), fill=NG_FILL, al=C, fmt=NUM, border=b)
            put(ws, rr, cDate, fill=shade, border=b)

        for k, h in enumerate(ROW_H):
            ws.row_dimensions[r0 + k].height = h
        last = r0 + len(ROW_H) - 1
        ws.merge_cells(start_row=r0, start_column=cN, end_row=last, end_column=cN)
        ws.merge_cells(start_row=r0, start_column=cM, end_row=last, end_column=cM)
        put(ws, r0, cN, gi + 1, f=font(9, color=GREY), al=C, fill=bg_issue)
        put(ws, r0, cM, who, f=font(9.5, True), al=L, fill=bg_issue)
        for c in (cN, cM):
            for rr in range(r0, last + 1):
                ws.cell(row=rr, column=c).border = Border(left=thin, right=thin)
        # เส้นหนาคั่นระหว่างสมาชิก
        for c in range(1, NCOL + 1):
            cell = ws.cell(row=last, column=c)
            bb = cell.border
            cell.border = Border(left=bb.left, right=bb.right, top=bb.top, bottom=sep)
        row = last + 1

    # ── รวมท้ายตาราง ──
    if used_h + 170 > PAGE_H:   # รวมท้ายตาราง + ลายเซ็น ไม่ให้แยกไปอยู่หน้าใหม่ครึ่งๆ
        ws.row_breaks.append(Break(id=row - 1))
    for label_txt, vals, fill_c, txt_c in (("รวมเบิก", tot_issue, HEAD_FILL, "FFFFFF"),
                                           ("คืนแล้ว", tot_ret, "D1FAE5", GREEN),
                                           ("ค้างคืน", {p: tot_issue.get(p, 0) - tot_ret.get(p, 0) for p in prods}, "FEF3C7", AMBER),
                                           ("NG โรงงาน", tot_ngf, NG_FILL, RED),
                                           ("NG สมาชิก", tot_ngm, NG_FILL, RED)):
        tb = Border(left=thin, right=thin, top=thin, bottom=thin)
        ws.merge_cells(start_row=row, start_column=cN, end_row=row, end_column=cT)
        put(ws, row, cN, label_txt, f=font(9.5, True, txt_c), fill=fill_c, al=Alignment(horizontal="right", vertical="center", indent=1), border=tb)
        for c in (cM, cT):
            put(ws, row, c, fill=fill_c, border=Border(top=thin, bottom=thin))
        for i, p in enumerate(prods):
            v = vals.get(p, 0)
            put(ws, row, cP0 + i, v if v else None, f=font(10, True, txt_c), fill=fill_c, al=C, fmt=NUM, border=tb)
        put(ws, row, cSum, sum(vals.values()) or None, f=font(10, True, txt_c), fill=fill_c, al=C, fmt=NUM, border=tb)
        put(ws, row, cDate, fill=fill_c, border=tb)
        ws.row_dimensions[row].height = 19
        row += 1

    # ── ลงชื่อ + วิธีใช้ ──
    row += 2
    half = NCOL // 2
    ws.merge_cells(start_row=row, start_column=1, end_row=row, end_column=half)
    put(ws, row, 1, "ผู้จ่ายงาน ........................................", f=font(10), al=Alignment(horizontal="left", vertical="bottom", indent=1))
    ws.merge_cells(start_row=row, start_column=half + 1, end_row=row, end_column=NCOL)
    put(ws, row, half + 1, "ผู้ตรวจรับคืน ........................................", f=font(10), al=Alignment(horizontal="right", vertical="bottom"))
    ws.row_dimensions[row].height = 26
    row += 1
    ws.merge_cells(start_row=row, start_column=1, end_row=row, end_column=NCOL)
    put(ws, row, 1, "วิธีกรอก: สมาชิกมาคืนครั้งแรก เขียนจำนวนที่คืนของแต่ละชนิดในแถว \"คืน 1\" และวันที่ในช่องขวาสุด · มาคืนส่วนที่เหลือ เขียนในแถว \"คืน 2\" · "
                    "งานเสีย เขียนจำนวนในแถว \"NG โรงงาน\" / \"NG สมาชิก\" ใต้ชนิดงานนั้น · ตัวเอียง = บันทึกในระบบแล้ว · ช่องเทา = ไม่ได้เบิกชนิดนั้น · แถวสีเขียว = คืนครบแล้ว",
        f=font(8, color=LIGHT), al=Alignment(horizontal="left", vertical="top", wrap_text=True))
    ws.row_dimensions[row].height = 26

    ws.print_area = f"A1:{COL(NCOL)}{row}"
    ws.page_setup.paperSize = ws.PAPERSIZE_A4
    ws.page_setup.orientation = "portrait"
    ws.page_setup.fitToWidth = 1
    ws.page_setup.fitToHeight = 0
    ws.sheet_properties.pageSetUpPr.fitToPage = True
    ws.print_options.horizontalCentered = True
    ws.page_margins.left = ws.page_margins.right = 0.3
    ws.page_margins.top = 0.4
    ws.page_margins.bottom = 0.5
    ws.page_margins.footer = 0.2
    ws.oddFooter.left.text = f"ใบคุมการเบิก–คืนงาน · วันที่เบิก {date_short(day['date'])}"
    ws.oddFooter.left.size = 11
    ws.oddFooter.left.font = FONT
    ws.oddFooter.right.text = "หน้า &P"
    ws.oddFooter.right.size = 11
    ws.oddFooter.right.font = FONT
    ws.page_setup.firstPageNumber = 1          # เลขหน้าเริ่ม 1 ใหม่ทุกวัน
    ws.page_setup.useFirstPageNumber = True


if not wb.sheetnames:
    ws = wb.create_sheet("ว่าง")
    ws["A1"] = "ไม่มีใบเบิกในช่วงที่เลือก"
wb.save(out)
print(out)
