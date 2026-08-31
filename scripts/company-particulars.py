#!/usr/bin/env python3
"""Company particulars sheet — one page per entity, for sharing with
suppliers, banks, and applications. Official registration data only."""
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.lib import colors
from reportlab.lib.styles import ParagraphStyle
from reportlab.platypus import (SimpleDocTemplate, Paragraph, Spacer, Table,
                                TableStyle, PageBreak, HRFlowable)

INK = colors.HexColor("#1a1a1a")
MUTED = colors.HexColor("#666666")
LINE = colors.HexColor("#cccccc")
ACCENT = colors.HexColor("#7a4a2b")  # coffee brown

st_group = ParagraphStyle("group", fontName="Helvetica", fontSize=9,
                          textColor=MUTED, spaceAfter=2)
st_name = ParagraphStyle("name", fontName="Helvetica-Bold", fontSize=17,
                         textColor=INK, spaceAfter=10, leading=21)
st_label = ParagraphStyle("label", fontName="Helvetica-Bold", fontSize=9.5,
                          textColor=MUTED, leading=13)
st_value = ParagraphStyle("value", fontName="Helvetica", fontSize=10.5,
                          textColor=INK, leading=14)
st_foot = ParagraphStyle("foot", fontName="Helvetica", fontSize=8,
                         textColor=MUTED)

COMPANIES = [
    {
        "group": "CELSIUS COFFEE GROUP",
        "name": "CELSIUS COFFEE SDN. BHD.",
        "rows": [
            ("Company Registration No. (SSM)", "202101024485 (1424785-A)"),
            ("Tax Identification No. (TIN)", "C26773249100"),
            ("SST Registration", "Not registered (N/A)"),
            ("Nature of Business", "Food & beverage — coffee house / café operations (MSIC 56101)"),
            ("Registered Address", "K-3-01, Conezion City, Persiaran IRC 3,<br/>IOI Resort, 62502 Putrajaya, Malaysia"),
            ("Business Address", "58, Jalan Renang 13/26, Tadisma Business Park,<br/>40100 Shah Alam, Selangor, Malaysia"),
            ("Telephone", "+60 11-5459 5369"),
        ],
    },
    {
        "group": "CELSIUS COFFEE GROUP",
        "name": "CELSIUS COFFEE CONEZION SDN. BHD.",
        "rows": [
            ("Company Registration No. (SSM)", "202501044958 (1646366-U)"),
            ("Tax Identification No. (TIN)", "C60421230050"),
            ("SST Registration", "Not registered (N/A)"),
            ("Nature of Business", "Food & beverage — coffee house / café operations (MSIC 56101)"),
            ("Registered Address", "K-3-01, Conezion City, Persiaran IRC 3,<br/>IOI Resort, 62502 Putrajaya, Malaysia"),
            ("Business Address", "M-G-06, Persiaran IRC 3, IOI City Resort,<br/>62502 Putrajaya, Malaysia"),
            ("Telephone", "+60 11-5459 5369"),
        ],
    },
    {
        "group": "CELSIUS COFFEE GROUP",
        "name": "CELSIUS COFFEE TAMARIND SDN. BHD.",
        "rows": [
            ("Company Registration No. (SSM)", "202501036872 (1638282-K)"),
            ("Tax Identification No. (TIN)", "C60337963100"),
            ("SST Registration", "Not registered (N/A)"),
            ("Nature of Business", "Food & beverage — coffee house / café operations (MSIC 56101)"),
            ("Registered Address", "K-3-01, Conezion City, Persiaran IRC 3,<br/>IOI Resort, 62502 Putrajaya, Malaysia"),
            ("Business Address", "K-05, Level 3m, Tamarind Square, Persiaran Multimedia,<br/>63000 Cyberjaya, Selangor, Malaysia"),
            ("Telephone", "+60 11-5459 5369"),
        ],
    },
    {
        "group": "GOSAME GROUP",
        "name": "GOSAME INTERNATIONAL SDN. BHD.",
        "rows": [
            ("Company Registration No. (SSM)", "202601006195 (1668293-M)"),
            ("Date of Incorporation", "11 February 2026"),
            ("Tax Identification No. (TIN)", "C60579873070"),
            ("Employer TIN", "E9628007204"),
            ("Nature of Business", "Food & beverage — restaurants specialising in Korean cuisine (MSIC 56101a)"),
            ("Registered Address", "No. 12-1, Jalan PPS 2, Pusat Perniagaan Selaseh,<br/>68100 Batu Caves, Selangor, Malaysia"),
            ("Business Address", "M-G-06, Conezion City, Persiaran IRC 3,<br/>IOI Resort, 62502 Putrajaya, Malaysia"),
            ("Directors", "Ammar Bin Shahrin · Ammar Bin Roslizar"),
            ("Telephone", "+60 11-5459 5369"),
        ],
    },
    {
        "group": "GOSAME GROUP",
        "name": "GOSAME BUKIT TUNKU SDN. BHD.",
        "rows": [
            ("Company Registration No. (SSM)", "202601006713 (1668811-A)"),
            ("Date of Incorporation", "13 February 2026"),
            ("Tax Identification No. (TIN)", "C60583422090"),
            ("Employer TIN", "E9628082601"),
            ("Nature of Business", "Food & beverage — restaurants specialising in Korean cuisine (MSIC 56101a)"),
            ("Registered Address", "No. 12-1, Jalan PPS 2, Pusat Perniagaan Selaseh,<br/>68100 Batu Caves, Selangor, Malaysia"),
            ("Business Address", "M-G-06, Conezion City, Persiaran IRC 3,<br/>IOI Resort, 62502 Putrajaya, Malaysia"),
            ("Holding Company", "Gosame International Sdn. Bhd. (100%)"),
            ("Directors", "Ammar Bin Shahrin · Ammar Bin Roslizar"),
            ("Telephone", "+60 11-5459 5369"),
        ],
    },
]

out = "company-particulars.pdf"
doc = SimpleDocTemplate(out, pagesize=A4, topMargin=28 * mm,
                        bottomMargin=22 * mm, leftMargin=22 * mm,
                        rightMargin=22 * mm, title="Company Particulars",
                        author="Celsius Coffee / Gosame")
story = []
for i, co in enumerate(COMPANIES):
    story.append(Paragraph(co["group"], st_group))
    story.append(Paragraph(co["name"], st_name))
    story.append(HRFlowable(width="100%", thickness=1.2, color=ACCENT,
                            spaceAfter=12))
    data = [[Paragraph(lbl, st_label), Paragraph(val, st_value)]
            for lbl, val in co["rows"]]
    t = Table(data, colWidths=[58 * mm, 108 * mm])
    t.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("TOPPADDING", (0, 0), (-1, -1), 7),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 7),
        ("LEFTPADDING", (0, 0), (-1, -1), 0),
        ("LINEBELOW", (0, 0), (-1, -2), 0.4, LINE),
    ]))
    story.append(t)
    story.append(Spacer(1, 16))
    story.append(Paragraph(
        "Company particulars for official use — vendor registration, "
        "applications and correspondence. Issued August 2026.", st_foot))
    if i < len(COMPANIES) - 1:
        story.append(PageBreak())

doc.build(story)
print("written:", out)
