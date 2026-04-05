#!/usr/bin/env python3
"""Generate Celsius Coffee Inventory System - User Manual PDF

Converts Peachi OTF (CFF outlines) to TTF (glyf outlines) at runtime
so reportlab can use the font natively for all headings.
"""

from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.colors import HexColor, white, black
from reportlab.lib.units import mm, cm
from reportlab.lib.enums import TA_CENTER, TA_LEFT, TA_JUSTIFY
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, PageBreak, Table, TableStyle,
    KeepTogether, HRFlowable, ListFlowable, ListItem, Image
)
from reportlab.platypus.frames import Frame
from reportlab.platypus.doctemplate import PageTemplate
from reportlab.lib import colors
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from PIL import Image as PILImage, ImageDraw, ImageFont
import datetime, io, os, copy

LOGO_PATH = '/Users/ammarshahrin/celsius-inventory/apps/inventory/public/images/celsius-logo.jpg'

# ── Convert Peachi OTF (CFF) → TTF (glyf) for reportlab ──
def convert_otf_to_ttf(otf_path, ttf_path):
    """Convert CFF-based OTF to TrueType-based TTF using fonttools cu2qu."""
    from fontTools.ttLib import TTFont as FTFont
    from fontTools.pens.cu2quPen import Cu2QuPen
    from fontTools.pens.ttGlyphPen import TTGlyphPen
    from fontTools.ttLib.tables._g_l_y_f import table__g_l_y_f, Glyph
    from fontTools.ttLib.tables._l_o_c_a import table__l_o_c_a

    font = FTFont(otf_path)
    cff = font['CFF ']
    top_dict = cff.cff.topDictIndex[0]
    glyph_order = font.getGlyphOrder()

    out = FTFont()
    out.sfntVersion = '\x00\x01\x00\x00'
    for tag in ['head', 'hhea', 'OS/2', 'name', 'cmap', 'post', 'hmtx']:
        if tag in font:
            out[tag] = copy.deepcopy(font[tag])
    out.setGlyphOrder(glyph_order)

    out['loca'] = table__l_o_c_a()
    glyf = table__g_l_y_f()
    glyf.glyphs = {}
    glyf.glyphOrder = glyph_order
    charstrings = top_dict.CharStrings

    for gname in glyph_order:
        pen = TTGlyphPen(None)
        cu2qu_pen = Cu2QuPen(pen, max_err=1.0, reverse_direction=True)
        try:
            charstrings[gname].draw(cu2qu_pen)
            glyf[gname] = pen.glyph()
        except:
            glyf[gname] = Glyph()
    out['glyf'] = glyf

    maxp = copy.deepcopy(font['maxp'])
    maxp.tableVersion = 0x00010000
    maxp.version = 0x00010000
    maxp.maxZones = 2
    maxp.maxTwilightPoints = maxp.maxStorage = maxp.maxFunctionDefs = 0
    maxp.maxInstructionDefs = maxp.maxStackElements = maxp.maxSizeOfInstructions = 0
    maxp.maxComponentElements = maxp.maxComponentDepth = 0
    maxp.maxPoints = maxp.maxContours = 0
    maxp.maxCompositePoints = maxp.maxCompositeContours = 0
    for gname in glyph_order:
        g = glyf[gname]
        if hasattr(g, 'numberOfContours') and g.numberOfContours > 0:
            maxp.maxContours = max(maxp.maxContours, g.numberOfContours)
            if hasattr(g, 'coordinates'):
                maxp.maxPoints = max(maxp.maxPoints, len(g.coordinates))
    out['maxp'] = maxp
    out['head'].indexToLocFormat = 0
    out.save(ttf_path)

FONT_DIR = '/Users/ammarshahrin/celsius-inventory/apps/inventory/public/fonts'
PEACHI_VARIANTS = {
    'PeachiBold': ('Peachi-Bold.otf', '/tmp/Peachi-Bold.ttf'),
    'PeachiMedium': ('Peachi-Medium.otf', '/tmp/Peachi-Medium.ttf'),
    'PeachiRegular': ('Peachi-Regular.otf', '/tmp/Peachi-Regular.ttf'),
}
for rl_name, (otf_name, ttf_path) in PEACHI_VARIANTS.items():
    if not os.path.exists(ttf_path):
        convert_otf_to_ttf(os.path.join(FONT_DIR, otf_name), ttf_path)
    pdfmetrics.registerFont(TTFont(rl_name, ttf_path))

pdfmetrics.registerFontFamily('Peachi',
    normal='PeachiRegular', bold='PeachiBold')

# Register Space Grotesk font
SG_FONT = '/tmp/SpaceGrotesk-Variable.ttf'
pdfmetrics.registerFont(TTFont('SpaceGrotesk', SG_FONT))
pdfmetrics.registerFontFamily('SpaceGrotesk', normal='SpaceGrotesk', bold='SpaceGrotesk')

# Brand colors
TERRACOTTA = HexColor("#C2452D")
TERRACOTTA_LIGHT = HexColor("#D4654F")
TERRACOTTA_DARK = HexColor("#A33822")
DARK_BG = HexColor("#160800")
LIGHT_BG = HexColor("#F8F6F4")
GRAY_TEXT = HexColor("#6B7280")
DARK_TEXT = HexColor("#1F2937")
GREEN = HexColor("#16A34A")
AMBER = HexColor("#D97706")
RED = HexColor("#DC2626")
BLUE = HexColor("#2563EB")
VIOLET = HexColor("#7C3AED")

WIDTH, HEIGHT = A4

# Pillow-based Peachi rendering (only used for cover page oversized text)
PEACHI_BOLD_OTF = os.path.join(FONT_DIR, 'Peachi-Bold.otf')
PEACHI_MEDIUM_OTF = os.path.join(FONT_DIR, 'Peachi-Medium.otf')

def render_peachi_text(text, font_size=28, color=(194, 69, 45), font_path=PEACHI_BOLD_OTF):
    """Render text using Peachi OTF as a high-res image (cover page only)."""
    pil_font = ImageFont.truetype(font_path, font_size * 3)
    bbox = pil_font.getbbox(text)
    w = bbox[2] - bbox[0] + 20
    h = bbox[3] - bbox[1] + 20
    img = PILImage.new('RGBA', (w, h), (255, 255, 255, 0))
    draw = ImageDraw.Draw(img)
    draw.text((-bbox[0] + 10, -bbox[1] + 5), text, font=pil_font, fill=color + (255,))
    bbox2 = img.getbbox()
    if bbox2:
        img = img.crop(bbox2)
    buf = io.BytesIO()
    img.save(buf, format='PNG')
    buf.seek(0)
    target_h = font_size * 1.3
    target_w = img.width * target_h / img.height
    return Image(buf, width=target_w, height=target_h)

styles = getSampleStyleSheet()

# Custom styles using Space Grotesk for body
styles.add(ParagraphStyle(
    name='CoverTitle', fontName='PeachiBold', fontSize=28,
    textColor=TERRACOTTA, alignment=TA_CENTER, spaceAfter=8
))
styles.add(ParagraphStyle(
    name='CoverSub', fontName='SpaceGrotesk', fontSize=14,
    textColor=GRAY_TEXT, alignment=TA_CENTER, spaceAfter=4
))
styles.add(ParagraphStyle(
    name='ChapterTitle', fontName='PeachiBold', fontSize=22,
    textColor=TERRACOTTA, spaceBefore=20, spaceAfter=10,
    leading=28, borderPadding=(0, 0, 4, 0)
))
styles.add(ParagraphStyle(
    name='SectionTitle', fontName='PeachiMedium', fontSize=14,
    textColor=DARK_TEXT, spaceBefore=16, spaceAfter=8, leading=18
))
styles.add(ParagraphStyle(
    name='SubSection', fontName='PeachiRegular', fontSize=11,
    textColor=HexColor("#374151"), spaceBefore=12, spaceAfter=6, leading=14
))
styles.add(ParagraphStyle(
    name='Body', fontName='SpaceGrotesk', fontSize=9.5,
    textColor=DARK_TEXT, spaceAfter=6, leading=14, alignment=TA_JUSTIFY
))
styles.add(ParagraphStyle(
    name='StepNum', fontName='SpaceGrotesk', fontSize=9.5,
    textColor=TERRACOTTA, spaceAfter=2, leading=14
))
styles.add(ParagraphStyle(
    name='StepText', fontName='SpaceGrotesk', fontSize=9.5,
    textColor=DARK_TEXT, spaceAfter=4, leading=14, leftIndent=20
))
styles.add(ParagraphStyle(
    name='BulletText', fontName='SpaceGrotesk', fontSize=9.5,
    textColor=DARK_TEXT, spaceAfter=3, leading=13, leftIndent=16,
    bulletIndent=6, bulletFontSize=9
))
styles.add(ParagraphStyle(
    name='NoteBox', fontName='SpaceGrotesk', fontSize=8.5,
    textColor=HexColor("#92400E"), spaceAfter=8, leading=12,
    leftIndent=8, borderPadding=6, backColor=HexColor("#FEF3C7"),
    borderColor=HexColor("#F59E0B"), borderWidth=0.5, borderRadius=3
))
styles.add(ParagraphStyle(
    name='TableHeader', fontName='SpaceGrotesk', fontSize=8.5,
    textColor=white, alignment=TA_CENTER
))
styles.add(ParagraphStyle(
    name='TableCell', fontName='SpaceGrotesk', fontSize=8.5,
    textColor=DARK_TEXT
))
styles.add(ParagraphStyle(
    name='TOCEntry', fontName='PeachiMedium', fontSize=11,
    textColor=DARK_TEXT, spaceAfter=5, leftIndent=0, leading=14
))
styles.add(ParagraphStyle(
    name='TOCSubEntry', fontName='SpaceGrotesk', fontSize=9,
    textColor=GRAY_TEXT, spaceAfter=3, leftIndent=16
))
styles.add(ParagraphStyle(
    name='Footer', fontName='SpaceGrotesk', fontSize=7.5,
    textColor=GRAY_TEXT, alignment=TA_CENTER
))


def header_footer(canvas, doc):
    canvas.saveState()
    if doc.page > 1:
        # Header: logo + text + line
        logo_h = 0.8*cm
        logo_w = 0.8*cm
        logo_x = 2*cm
        logo_y = HEIGHT - 1.45*cm
        try:
            canvas.drawImage(LOGO_PATH, logo_x, logo_y, width=logo_w, height=logo_h, preserveAspectRatio=True, mask='auto')
        except:
            pass
        canvas.setStrokeColor(TERRACOTTA)
        canvas.setLineWidth(0.5)
        canvas.line(2*cm, HEIGHT - 1.55*cm, WIDTH - 2*cm, HEIGHT - 1.55*cm)
        canvas.setFont("PeachiMedium", 8)
        canvas.setFillColor(DARK_TEXT)
        canvas.drawString(2*cm + logo_w + 0.2*cm, HEIGHT - 1.35*cm, "Celsius Coffee Inventory System")
        canvas.setFont("SpaceGrotesk", 7.5)
        canvas.setFillColor(GRAY_TEXT)
        canvas.drawRightString(WIDTH - 2*cm, HEIGHT - 1.35*cm, "User Manual & SOP Guide")
        # Footer
        canvas.setStrokeColor(HexColor("#E5E7EB"))
        canvas.line(2*cm, 1.5*cm, WIDTH - 2*cm, 1.5*cm)
        canvas.setFont("SpaceGrotesk", 8)
        canvas.setFillColor(GRAY_TEXT)
        canvas.drawCentredString(WIDTH/2, 1*cm, f"Page {doc.page}")
        canvas.setFont("SpaceGrotesk", 6.5)
        canvas.drawString(2*cm, 1*cm, "Confidential - Internal Use Only")
        canvas.drawRightString(WIDTH - 2*cm, 1*cm, f"Rev 1.0 - {datetime.date.today().strftime('%B %Y')}")
    canvas.restoreState()


def make_step(num, text):
    return Paragraph(f'<b><font color="#{TERRACOTTA.hexval()[2:]}">{num}.</font></b>  {text}', styles['StepText'])

def make_bullet(text):
    return Paragraph(f'<bullet>&bull;</bullet> {text}', styles['BulletText'])

def make_note(text):
    return Paragraph(f'<b>Note:</b> {text}', styles['NoteBox'])

def make_table(headers, rows, col_widths=None):
    data = [headers] + rows
    if not col_widths:
        col_widths = [WIDTH * 0.85 / len(headers)] * len(headers)
    t = Table(data, colWidths=col_widths, repeatRows=1)
    t.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, 0), TERRACOTTA),
        ('TEXTCOLOR', (0, 0), (-1, 0), white),
        ('FONTNAME', (0, 0), (-1, 0), 'SpaceGrotesk'),
        ('FONTSIZE', (0, 0), (-1, 0), 8.5),
        ('FONTNAME', (0, 1), (-1, -1), 'SpaceGrotesk'),
        ('FONTSIZE', (0, 1), (-1, -1), 8.5),
        ('TEXTCOLOR', (0, 1), (-1, -1), DARK_TEXT),
        ('ALIGN', (0, 0), (-1, 0), 'CENTER'),
        ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
        ('ROWBACKGROUNDS', (0, 1), (-1, -1), [white, HexColor("#F9FAFB")]),
        ('GRID', (0, 0), (-1, -1), 0.4, HexColor("#E5E7EB")),
        ('TOPPADDING', (0, 0), (-1, -1), 5),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 5),
        ('LEFTPADDING', (0, 0), (-1, -1), 6),
        ('RIGHTPADDING', (0, 0), (-1, -1), 6),
    ]))
    return t

def hr():
    return HRFlowable(width="100%", thickness=0.5, color=HexColor("#E5E7EB"), spaceAfter=8, spaceBefore=4)


story = []

# ==================== COVER PAGE ====================
story.append(Spacer(1, 3*cm))
# Logo
story.append(Image(LOGO_PATH, width=5*cm, height=5*cm, hAlign='CENTER'))
story.append(Spacer(1, 1*cm))
# Peachi heading rendered as image
story.append(render_peachi_text("CELSIUS COFFEE", font_size=36, color=(194, 69, 45)))
story.append(Spacer(1, 0.3*cm))
story.append(render_peachi_text("Inventory Management System", font_size=20, color=(31, 41, 55), font_path=PEACHI_MEDIUM_OTF))
story.append(Spacer(1, 0.5*cm))
story.append(hr())
story.append(Spacer(1, 0.8*cm))
story.append(Paragraph("User Manual, SOP & Workflow Guide", styles['CoverSub']))
story.append(Spacer(1, 0.3*cm))
story.append(Paragraph(f"Version 1.0  |  {datetime.date.today().strftime('%d %B %Y')}", styles['CoverSub']))
story.append(Spacer(1, 2*cm))

cover_info = [
    ["Prepared For", "Celsius Coffee Sdn Bhd"],
    ["Document Type", "User Manual & Standard Operating Procedures"],
    ["Classification", "Internal - Confidential"],
    ["System URL", "inventory.celsiuscoffee.com"],
]
t = Table(cover_info, colWidths=[5*cm, 9*cm])
t.setStyle(TableStyle([
    ('FONTNAME', (0, 0), (0, -1), 'SpaceGrotesk'),
    ('FONTNAME', (1, 0), (1, -1), 'SpaceGrotesk'),
    ('FONTSIZE', (0, 0), (-1, -1), 9),
    ('TEXTCOLOR', (0, 0), (0, -1), GRAY_TEXT),
    ('TEXTCOLOR', (1, 0), (1, -1), DARK_TEXT),
    ('TOPPADDING', (0, 0), (-1, -1), 4),
    ('BOTTOMPADDING', (0, 0), (-1, -1), 4),
    ('LINEBELOW', (0, 0), (-1, -2), 0.3, HexColor("#E5E7EB")),
]))
story.append(t)
story.append(PageBreak())

# ==================== TABLE OF CONTENTS ====================
story.append(Paragraph("Table of Contents", styles['ChapterTitle']))
story.append(Spacer(1, 2))
story.append(Spacer(1, 0.5*cm))

toc_items = [
    ("1", "System Overview", [
        "1.1 About the System",
        "1.2 User Roles & Permissions",
        "1.3 Logging In",
    ]),
    ("2", "Staff Operations (Mobile App)", [
        "2.1 Home Dashboard",
        "2.2 Daily Stock Check",
        "2.3 Smart Ordering (Mobile)",
        "2.4 Record Wastage",
        "2.5 Stock Transfer",
    ]),
    ("3", "Admin Panel - Master Data", [
        "3.1 Dashboard (Company Overview)",
        "3.2 Products Management",
        "3.3 Categories",
        "3.4 Suppliers & Price Lists",
        "3.5 Menu & BOM (Recipes)",
    ]),
    ("4", "Admin Panel - Ordering Workflow", [
        "4.1 Smart Order Creation",
        "4.2 Purchase Order Management",
        "4.3 Goods Receiving",
        "4.4 Invoice Management",
    ]),
    ("5", "Admin Panel - Operations", [
        "5.1 Branch Management",
        "5.2 Staff & Access Control",
        "5.3 Approval Rules",
        "5.4 Par Level Management",
    ]),
    ("6", "Admin Panel - Analytics & System", [
        "6.1 Reports Hub",
        "6.2 Integrations (StoreHub & Bukku)",
        "6.3 System Activity Log",
    ]),
    ("7", "Standard Operating Procedures (SOPs)", [
        "7.1 SOP: Daily Opening Routine",
        "7.2 SOP: Placing a Purchase Order",
        "7.3 SOP: Receiving Goods Delivery",
        "7.4 SOP: Weekly Stock Audit",
        "7.5 SOP: Recording Wastage",
        "7.6 SOP: New Staff Onboarding",
        "7.7 SOP: Month-End Stock Take",
    ]),
    ("8", "Workflow Diagrams", [
        "8.1 Purchase Order Lifecycle",
        "8.2 Stock Check Flow",
        "8.3 Goods Receiving Flow",
    ]),
]

for num, title, subs in toc_items:
    story.append(Paragraph(f'<b>{num}.</b>  {title}', styles['TOCEntry']))
    for sub in subs:
        story.append(Paragraph(sub, styles['TOCSubEntry']))

story.append(PageBreak())

# ==================== CHAPTER 1: SYSTEM OVERVIEW ====================
story.append(Paragraph("1. System Overview", styles['ChapterTitle']))
story.append(hr())

story.append(Paragraph("1.1 About the System", styles['SectionTitle']))
story.append(Paragraph(
    "The Celsius Coffee Inventory System is a comprehensive multi-branch inventory management platform built for F&B operations. "
    "It manages the complete procurement cycle from stock monitoring to purchase ordering, goods receiving, and invoice tracking. "
    "The system integrates with StoreHub POS for sales data and supports WhatsApp-based supplier communication.",
    styles['Body']
))
story.append(Spacer(1, 4))
story.append(Paragraph("Key Capabilities", styles['SubSection']))
features = [
    "Real-time inventory tracking across multiple branches/outlets",
    "Smart ordering based on stock levels, par points, and daily usage",
    "Purchase order workflow with approval rules and WhatsApp integration",
    "Goods receiving with discrepancy tracking and photo evidence",
    "Daily/weekly/monthly stock checks with variance recording",
    "Wastage tracking with cost monitoring and reason categorization",
    "Inter-branch stock transfers",
    "Menu & BOM (Bill of Materials) for COGS calculation",
    "Role-based access control with module-level permissions",
    "System activity log for full audit trail",
    "StoreHub POS integration for sales data sync",
]
for f in features:
    story.append(make_bullet(f))

story.append(Spacer(1, 8))
story.append(Paragraph("1.2 User Roles & Permissions", styles['SectionTitle']))
story.append(Paragraph(
    "The system supports three user roles. Each role has different access levels to modules and features.",
    styles['Body']
))

roles_table = make_table(
    ["Role", "Access Level", "Typical Users", "Key Capabilities"],
    [
        ["Admin", "Full system access to all modules", "Owner, Operations Manager", "All features, user management, system settings, reports"],
        ["Branch Manager", "Branch-level access + ordering", "Outlet Manager, Supervisor", "Orders, receivings, stock checks, branch reports"],
        ["Staff", "Limited operational access", "Barista, Kitchen Staff", "Stock checks, wastage recording, view-only features"],
    ],
    col_widths=[2.5*cm, 4.5*cm, 3.5*cm, 5*cm]
)
story.append(roles_table)
story.append(Spacer(1, 6))
story.append(Paragraph(
    "Module-level permissions can be customized per user from the Staff page. Admins have all modules enabled by default. "
    "Available modules: Dashboard, Master Data, Ordering, Staff, Approval Rules, Par Levels, Reports, and Integrations.",
    styles['Body']
))

story.append(Spacer(1, 8))
story.append(Paragraph("1.3 Logging In", styles['SectionTitle']))
story.append(Paragraph("The system supports two login methods:", styles['Body']))

story.append(Paragraph("Method A: Username & Password (Admin / Manager)", styles['SubSection']))
for i, s in enumerate([
    'Open the system URL in your browser.',
    'Click "Manager / Admin Login".',
    'Enter your username and password.',
    'Click "Sign In". You will be redirected to the Admin Dashboard.',
], 1):
    story.append(make_step(i, s))

story.append(Paragraph("Method B: 4-Digit PIN (All Staff)", styles['SubSection']))
for i, s in enumerate([
    'Open the system URL on the outlet tablet or phone.',
    'Click "Staff PIN Login".',
    'Enter your 4-digit PIN using the number pad. The system auto-submits on the 4th digit.',
    'You will be redirected to the Staff Home Dashboard.',
], 1):
    story.append(make_step(i, s))

story.append(make_note("PINs are assigned by the Admin from the Staff management page. Contact your manager if you forget your PIN."))
story.append(PageBreak())

# ==================== CHAPTER 2: STAFF OPERATIONS ====================
story.append(Paragraph("2. Staff Operations (Mobile App)", styles['ChapterTitle']))
story.append(hr())
story.append(Paragraph(
    'The mobile-optimized interface is designed for daily outlet operations. Staff access these pages from their phone or tablet after logging in with their PIN.',
    styles['Body']
))

# 2.1 Home Dashboard
story.append(Paragraph("2.1 Home Dashboard", styles['SectionTitle']))
story.append(Paragraph(
    'The Home Dashboard provides a daily operational overview including priority tasks, stock alerts, weekly metrics, and quick action buttons.',
    styles['Body']
))
story.append(Paragraph("What You See", styles['SubSection']))
for b in [
    '<b>Priority Action Cards</b> - "Start Daily Stock Check" (with morning badge 6AM-12PM), deliveries expected today, pending approvals, low stock alerts',
    '<b>Weekly Performance</b> - Total spending, order count, stock alerts and waste count',
    '<b>Stock Levels</b> - Items below par level sorted by urgency with color-coded progress bars (Red = critical, Amber = low, Green = OK)',
    '<b>Recent Orders</b> - Latest purchase orders with status badges',
    '<b>Quick Actions</b> - Bottom buttons for Check, Order, Receive, Wastage',
]:
    story.append(make_bullet(b))

# 2.2 Stock Check
story.append(Paragraph("2.2 Daily Stock Check", styles['SectionTitle']))
story.append(Paragraph(
    "Physical inventory counting to verify system stock levels against actual quantities. This is the most important daily task for inventory accuracy.",
    styles['Body']
))
story.append(Paragraph("SOP: Performing a Stock Check", styles['SubSection']))
for i, s in enumerate([
    'Open the Stock Check page from the Home Dashboard or Quick Actions.',
    'Select frequency: <b>Daily</b> (fast, essential items), <b>Weekly</b> (daily + weekly items), or <b>Monthly</b> (all items).',
    'Items are grouped by storage area (Fridge, Counter, Dry Store). Each area can be collapsed/expanded.',
    'For each item, verify the physical quantity matches the system quantity.',
    'If quantity matches: tap the <font color="#16A34A">green checkmark</font> button to confirm.',
    'If quantity differs: tap the <font color="#DC2626">red X</font> button. An adjustment dialog opens.',
    'In the adjustment dialog: enter the actual quantity counted, select a reason (Wastage/Spillage, Breakage, Expired, Used but not recorded, Theft/Loss, Other), then tap "Save Adjustment".',
    'Monitor the progress bar at the top showing completion percentage.',
    'Use "Confirm All" to quickly mark all remaining items in an area as correct.',
    'When 100% checked, tap <b>"Submit Check"</b> to save the stock check.',
], 1):
    story.append(make_step(i, s))
story.append(make_note(
    "Morning checks (6AM-12PM) are highlighted as priority. Complete daily checks before the lunch rush. "
    "The system tracks who performed each check and the timestamp for accountability."
))

# 2.3 Smart Ordering Mobile
story.append(Paragraph("2.3 Smart Ordering (Mobile)", styles['SectionTitle']))
story.append(Paragraph(
    "Mobile ordering interface for quickly reordering low-stock items. Orders are sent directly to suppliers via WhatsApp.",
    styles['Body']
))
story.append(Paragraph("SOP: Placing a Mobile Order", styles['SubSection']))
for i, s in enumerate([
    'Open Smart Ordering from Home Dashboard or Quick Actions.',
    'The <b>"Needs Ordering"</b> tab shows items below par level with suggested quantities pre-calculated.',
    'Tap "Add" on items you want to order. The system suggests quantities based on par levels.',
    'Use +/- buttons to adjust quantities as needed.',
    'Switch to <b>"Quick Reorder"</b> tab to repeat a previous order (last 5 orders shown per supplier).',
    'The cart bar at the bottom shows item count and total cost.',
    'Tap <b>"Send to Supplier"</b> for each supplier group.',
    'Review the WhatsApp preview message showing order details, delivery date, and items.',
    'Tap <b>"Open WhatsApp"</b> to send the pre-formatted message to the supplier.',
    'The order is automatically created in the system with SENT status.',
], 1):
    story.append(make_step(i, s))

# 2.4 Wastage
story.append(Paragraph("2.4 Record Wastage", styles['SectionTitle']))
story.append(Paragraph("Log product loss and waste for cost tracking and accountability.", styles['Body']))
story.append(Paragraph("SOP: Recording Wastage", styles['SubSection']))
for i, s in enumerate([
    'Open Wastage from the Home Dashboard or Quick Actions.',
    'Tap <b>"Record Wastage"</b> button.',
    'Search and select the product from the autocomplete dropdown.',
    'Enter the quantity wasted (in base UOM).',
    'Optionally enter the cost in RM if known.',
    'Select a reason: Expired, Spillage, Breakage, Quality Issue, or Other.',
    'Add optional notes for context (e.g., "dropped tray of pastries").',
    'Tap <b>"Record Wastage"</b> to save. The record appears in the Recent Wastage list.',
], 1):
    story.append(make_step(i, s))

# 2.5 Transfer
story.append(Paragraph("2.5 Stock Transfer", styles['SectionTitle']))
story.append(Paragraph("Move inventory between branches to balance stock levels.", styles['Body']))
story.append(Paragraph("SOP: Creating a Stock Transfer", styles['SubSection']))
for i, s in enumerate([
    'Open Stock Transfer from Home Dashboard.',
    'Tap <b>"New Transfer"</b> button.',
    'Your branch is auto-filled as the "From Branch" (read-only).',
    'Select the destination branch from the "To Branch" dropdown.',
    'Search products by name or SKU and tap to add them.',
    'Adjust quantities with +/- buttons. Remove items with the X button.',
    'Add optional notes explaining the reason for the transfer.',
    'Tap <b>"Create Transfer"</b> to save. The transfer appears with PENDING status.',
], 1):
    story.append(make_step(i, s))
story.append(PageBreak())

# ==================== CHAPTER 3: ADMIN - MASTER DATA ====================
story.append(Paragraph("3. Admin Panel - Master Data", styles['ChapterTitle']))
story.append(hr())

# 3.1 Dashboard
story.append(Paragraph("3.1 Dashboard (Company Overview)", styles['SectionTitle']))
story.append(Paragraph(
    "The Admin Dashboard provides company-wide financial metrics and order status overview.",
    styles['Body']
))
story.append(Paragraph("Key Metrics Displayed", styles['SubSection']))
metrics_table = make_table(
    ["Card", "Description", "Data Source"],
    [
        ["Inventory Asset Value", "Total RM value of all stock across branches", "Current stock x unit cost"],
        ["COGS This Month", "Cost of goods sold for current month", "Sales data x recipe costs"],
        ["Purchase This Week", "Total PO spend this week", "Sum of order amounts"],
        ["Expected vs Real", "Variance between system and physical count", "Stock check data"],
    ],
    col_widths=[3.5*cm, 6*cm, 5*cm]
)
story.append(metrics_table)

# 3.2 Products
story.append(Paragraph("3.2 Products Management", styles['SectionTitle']))
story.append(Paragraph(
    "Central product catalog managing all inventory items. Each product has a unique SKU, category, base UOM, storage area, shelf life, and check frequency.",
    styles['Body']
))
story.append(Paragraph("Adding a Product", styles['SubSection']))
for i, s in enumerate([
    'Click <b>"Add Product"</b> button.',
    'Enter Product Name (e.g., "Oat Milk 1L").',
    'Enter a unique SKU code (e.g., "OAT-001").',
    'Select Category from dropdown (e.g., "Dairy Alternatives").',
    'Select Base UOM: ml, g, or pcs.',
    'Select Storage Area: Fridge, Freezer, Dry Store, Counter, or Bar.',
    'Enter Shelf Life in days (optional, for expiry tracking).',
    'Select Check Frequency: Daily, Weekly, or Monthly.',
    'Click <b>"Add Product"</b> to save.',
], 1):
    story.append(make_step(i, s))

story.append(Paragraph("Bulk Actions", styles['SubSection']))
story.append(Paragraph(
    "Select multiple products using checkboxes, then use the bulk action bar to change category, storage area, "
    "check frequency, or delete selected items in one operation.",
    styles['Body']
))

# 3.3 Categories
story.append(Paragraph("3.3 Categories", styles['SectionTitle']))
story.append(Paragraph(
    "Organize products into categories for filtering and reporting. Categories are flat (no sub-categories). "
    "Each category shows the count of linked products. Empty categories can be deleted; categories with linked products must have products reassigned first.",
    styles['Body']
))

# 3.4 Suppliers
story.append(Paragraph("3.4 Suppliers & Price Lists", styles['SectionTitle']))
story.append(Paragraph(
    "Manage supplier information and maintain product-level pricing for accurate purchase order costing.",
    styles['Body']
))
story.append(Paragraph("Adding a Supplier", styles['SubSection']))
for i, s in enumerate([
    'Click <b>"Add Supplier"</b>.',
    'Enter Name, Code, Location, WhatsApp Number, Lead Time (days), and Tags.',
    'Click <b>"Add Supplier"</b> to save.',
], 1):
    story.append(make_step(i, s))

story.append(Paragraph("Managing Price Lists", styles['SubSection']))
for i, s in enumerate([
    'Click <b>"View Price List"</b> on a supplier card.',
    'The price list dialog shows all linked products with SKU, package, and price.',
    'To add a product: click <b>"+ Add Product"</b>, search by name/SKU, select from dropdown, enter price, click checkmark.',
    'To edit a price: click the pencil icon, update the value, press Enter.',
    'To remove a product: click the trash icon and confirm.',
], 1):
    story.append(make_step(i, s))

# 3.5 Menu & BOM
story.append(Paragraph("3.5 Menu & BOM (Recipes)", styles['SectionTitle']))
story.append(Paragraph(
    "Define ingredient recipes for menu items to calculate Cost of Goods Sold (COGS). Each menu item shows its selling price, product cost, "
    "and COGS percentage color-coded for quick analysis (Green: <=30%, Amber: 30-40%, Red: >40%).",
    styles['Body']
))
story.append(Paragraph("Editing a Recipe", styles['SubSection']))
for i, s in enumerate([
    'Click the pencil icon on a menu item to enter edit mode.',
    'Existing ingredients appear in an editable table with quantity and UOM.',
    'To add an ingredient: type product name in the search field, select from dropdown, set quantity and UOM.',
    'To remove an ingredient: click the X button next to it.',
    'Click <b>"Save"</b> to persist changes. The COGS recalculates automatically.',
], 1):
    story.append(make_step(i, s))
story.append(make_note("Use the 'Sync from StoreHub' button to import menu items from your POS system. Ingredients must be mapped manually after sync."))
story.append(PageBreak())

# ==================== CHAPTER 4: ORDERING WORKFLOW ====================
story.append(Paragraph("4. Admin Panel - Ordering Workflow", styles['ChapterTitle']))
story.append(hr())

story.append(Paragraph(
    "The ordering workflow covers the complete procurement cycle: creating orders, approvals, sending to suppliers, receiving goods, and invoice reconciliation.",
    styles['Body']
))

# 4.1 Smart Order
story.append(Paragraph("4.1 Smart Order Creation", styles['SectionTitle']))
story.append(Paragraph(
    "The Smart Order page intelligently suggests what to order based on current stock levels, par points, and daily usage rates.",
    styles['Body']
))
story.append(Paragraph("Complete Ordering Workflow", styles['SubSection']))
for i, s in enumerate([
    'Navigate to <b>Purchase Orders > Create Order</b> or click "Create Order" from the orders page.',
    'Select the <b>Branch</b> you are ordering for from the dropdown.',
    'Optionally filter by <b>Supplier</b> to focus on one supplier at a time.',
    'The <b>"Needs Ordering"</b> tab shows items below par level with color-coded urgency (Red = critical, Amber = low).',
    'Click <b>"Add"</b> on suggested items, or search for specific products in the <b>"All Products"</b> tab.',
    'Use the <b>"Quick Reorder"</b> tab to repeat previous orders.',
    'Items are grouped by supplier in the cart sidebar (right side) with running totals.',
    'Adjust quantities using +/- buttons. The delivery date is calculated from supplier lead time.',
    'Add optional notes for the order.',
    'Click <b>"Send to Supplier"</b> to preview the WhatsApp message, then click <b>"Open WhatsApp"</b> to send.',
    'Alternatively, click <b>"Save as Draft"</b> to save without sending (for later review/approval).',
], 1):
    story.append(make_step(i, s))

# 4.2 PO Management
story.append(Paragraph("4.2 Purchase Order Management", styles['SectionTitle']))
story.append(Paragraph("Purchase Order Status Lifecycle", styles['SubSection']))

status_table = make_table(
    ["Status", "Color", "Description", "Available Actions"],
    [
        ["DRAFT", "Gray", "Order created but not submitted", "Edit, Submit for Approval, Delete"],
        ["PENDING APPROVAL", "Amber", "Awaiting manager approval", "Approve, Reject"],
        ["APPROVED", "Blue", "Approved, ready to send", "Send via WhatsApp"],
        ["SENT", "Green", "Sent to supplier", "Record Delivery"],
        ["AWAITING DELIVERY", "Purple", "Waiting for goods", "Record Delivery"],
        ["PARTIALLY RECEIVED", "Amber", "Some items received", "Receive More"],
        ["COMPLETED", "Gray", "All items received", "View Only"],
        ["CANCELLED", "Red", "Order cancelled", "Delete"],
    ],
    col_widths=[3*cm, 1.5*cm, 4.5*cm, 5.5*cm]
)
story.append(status_table)

# 4.3 Goods Receiving
story.append(Paragraph("4.3 Goods Receiving", styles['SectionTitle']))
story.append(Paragraph(
    "Record delivery of goods from purchase orders. The system tracks discrepancies between ordered and received quantities.",
    styles['Body']
))
story.append(Paragraph("SOP: Receiving a Delivery", styles['SubSection']))
for i, s in enumerate([
    'Go to <b>Receivings</b> page. Awaiting deliveries are shown at the top.',
    'Click an awaiting order card, or click <b>"Record Delivery"</b> and select the PO from the dropdown.',
    'The ordered items populate automatically with their ordered quantities.',
    'For each item, enter the <b>Received Qty</b> (actual count of delivered goods).',
    'The system indicates: <font color="#16A34A">Green check</font> = exact match, <font color="#DC2626">Red alert</font> = short, <font color="#2563EB">Blue up</font> = over-delivered.',
    'For any discrepancy, select a reason: Short, Damaged, Wrong Item, or Expired.',
    'Add notes if needed to explain the discrepancy.',
    'Click <b>"Confirm Delivery"</b> to save. Stock balances update automatically.',
    'The PO status updates to PARTIALLY_RECEIVED or COMPLETED based on quantities.',
    'An invoice is auto-created from the receiving for accounts payable tracking.',
], 1):
    story.append(make_step(i, s))

# 4.4 Invoices
story.append(Paragraph("4.4 Invoice Management", styles['SectionTitle']))
story.append(Paragraph(
    "Invoices are auto-created when goods are received. Track payment status from PENDING through PAID.",
    styles['Body']
))
inv_status = make_table(
    ["Status", "Color", "Description"],
    [
        ["DRAFT", "Gray", "Auto-created from receiving, not yet sent for payment"],
        ["PENDING", "Terracotta", "Sent to accounts for payment processing"],
        ["PAID", "Green", "Payment completed"],
        ["OVERDUE", "Red", "Past due date, still awaiting payment"],
    ],
    col_widths=[3*cm, 2.5*cm, 9*cm]
)
story.append(inv_status)
story.append(PageBreak())

# ==================== CHAPTER 5: OPERATIONS ====================
story.append(Paragraph("5. Admin Panel - Operations", styles['ChapterTitle']))
story.append(hr())

# 5.1 Branches
story.append(Paragraph("5.1 Branch Management", styles['SectionTitle']))
story.append(Paragraph(
    "Manage outlet locations and central kitchen facilities. Each branch has its own inventory, staff, and stock levels.",
    styles['Body']
))
branch_table = make_table(
    ["Branch Type", "Purpose", "Examples"],
    [
        ["OUTLET", "Customer-facing retail location with POS", "Pavilion KL, Mid Valley, KLCC"],
        ["CENTRAL_KITCHEN", "Internal production facility", "HQ Kitchen, Commissary"],
    ],
    col_widths=[3*cm, 6*cm, 5.5*cm]
)
story.append(branch_table)
story.append(Spacer(1, 4))
story.append(Paragraph("Actions: Add, Edit, Activate/Deactivate (toggle), Delete (only if no staff assigned).", styles['Body']))

# 5.2 Staff
story.append(Paragraph("5.2 Staff & Access Control", styles['SectionTitle']))
story.append(Paragraph(
    "Create user accounts with role-based permissions and authentication credentials. The staff edit dialog has four tabs:",
    styles['Body']
))
for b in [
    '<b>Details</b> - Name, role, primary branch, phone, email',
    '<b>Outlets</b> - Multi-branch access with checkboxes (primary branch always included)',
    '<b>Modules</b> - Toggle which system modules the user can access (Admin gets all by default)',
    '<b>Security</b> - Username/password (Admin/Manager) or 4-digit PIN (all staff)',
]:
    story.append(make_bullet(b))

# 5.3 Approval Rules
story.append(Paragraph("5.3 Approval Rules", styles['SectionTitle']))
story.append(Paragraph(
    "Configure workflows requiring manager sign-off. Rules can apply to specific branches and designate who can approve.",
    styles['Body']
))
rule_table = make_table(
    ["Rule Type", "Use Case"],
    [
        ["ORDER_APPROVAL", "Purchase orders above a certain RM amount need approval"],
        ["STOCK_ADJUSTMENT", "Stock count adjustments require verification"],
        ["STOCK_TRANSFER", "Inter-branch transfers need sign-off"],
        ["CREDIT_NOTE", "Credit notes and deductions need authorization"],
    ],
    col_widths=[4*cm, 10.5*cm]
)
story.append(rule_table)

# 5.4 Par Levels
story.append(Paragraph("5.4 Par Level Management", styles['SectionTitle']))
story.append(Paragraph(
    "Set target stock levels per product per branch. Par levels drive the Smart Order suggestions.",
    styles['Body']
))
par_table = make_table(
    ["Field", "Definition", "Example"],
    [
        ["Par Level", "Target stock quantity to maintain", "50 pcs"],
        ["Reorder Point", "Quantity that triggers reordering (usually Par / 2)", "25 pcs"],
        ["Avg Daily Usage", "Expected daily consumption", "10 pcs/day"],
        ["Days Left", "Current Stock / Daily Usage", "3.5 days"],
    ],
    col_widths=[3*cm, 7*cm, 4.5*cm]
)
story.append(par_table)
story.append(Spacer(1, 4))

story.append(Paragraph("Status Indicators", styles['SubSection']))
status_ind = make_table(
    ["Status", "Color", "Condition"],
    [
        ["OK", "Green", "Stock >= Par Level"],
        ["Low", "Amber", "Stock < Par but >= Reorder Point"],
        ["Critical", "Red", "Stock <= Reorder Point"],
        ["Not Set", "Gray", "No Par Level configured"],
    ],
    col_widths=[3*cm, 3*cm, 8.5*cm]
)
story.append(status_ind)
story.append(Spacer(1, 4))
story.append(make_note(
    "Use Bulk Set for products without par levels. The system calculates: Par = (Current Stock / 7 days) x Multiplier. "
    "Par levels must be set before Smart Order can suggest quantities."
))
story.append(PageBreak())

# ==================== CHAPTER 6: ANALYTICS & SYSTEM ====================
story.append(Paragraph("6. Admin Panel - Analytics & System", styles['ChapterTitle']))
story.append(hr())

# 6.1 Reports
story.append(Paragraph("6.1 Reports Hub", styles['SectionTitle']))
reports_table = make_table(
    ["Report", "Status", "Description"],
    [
        ["Stock Valuation", "Available", "System vs physical count with RM variance values"],
        ["COGS Report", "Coming Soon", "Actual vs expected ingredient usage"],
        ["Purchase Summary", "Coming Soon", "Spending by supplier, product, category"],
        ["Wastage Report", "Coming Soon", "Waste cost by reason, product, staff"],
        ["Supplier Scorecard", "Coming Soon", "On-time delivery, quality, pricing metrics"],
    ],
    col_widths=[3.5*cm, 2.5*cm, 8.5*cm]
)
story.append(reports_table)

# 6.2 Integrations
story.append(Paragraph("6.2 Integrations", styles['SectionTitle']))
story.append(Paragraph("StoreHub POS Integration", styles['SubSection']))
story.append(Paragraph(
    "StoreHub syncs product catalog, sales transactions, and employee data. Sales data enables COGS calculation through menu recipes. "
    "Each outlet maps to a StoreHub location. Sync can be triggered manually or runs on schedule (Product Catalog: daily, Sales: hourly, Employee: weekly).",
    styles['Body']
))
story.append(Paragraph("Bukku Accounting Integration", styles['SubSection']))
story.append(Paragraph(
    "Bukku integration for purchase order and invoice sync is coming soon. When connected, it will synchronize purchase orders, receivings, payments, and expense data.",
    styles['Body']
))

# 6.3 System Log
story.append(Paragraph("6.3 System Activity Log", styles['SectionTitle']))
story.append(Paragraph(
    "Full audit trail of all system actions. Every create, update, delete, login, and approval action is logged with the user, timestamp, and details.",
    styles['Body']
))
log_table = make_table(
    ["Action", "Color", "Tracked Events"],
    [
        ["Create", "Green", "New orders, products, staff, branches created"],
        ["Update", "Blue", "Status changes, edits, price updates"],
        ["Delete", "Red", "Orders, products removed"],
        ["Login", "Violet", "User authentication events"],
        ["Approve", "Amber", "Order approvals"],
        ["Send", "Teal", "Orders sent to suppliers via WhatsApp"],
        ["Receive", "Indigo", "Goods received from deliveries"],
    ],
    col_widths=[2.5*cm, 2*cm, 10*cm]
)
story.append(log_table)
story.append(Spacer(1, 4))
story.append(Paragraph(
    "Filter logs by module (Orders, Staff, Products, etc.) and search across all fields. Adjustable view limit: 50, 100, 200, or 500 most recent entries.",
    styles['Body']
))
story.append(PageBreak())

# ==================== CHAPTER 7: SOPs ====================
story.append(Paragraph("7. Standard Operating Procedures (SOPs)", styles['ChapterTitle']))
story.append(hr())

# SOP 7.1
story.append(Paragraph("7.1 SOP: Daily Opening Routine", styles['SectionTitle']))
story.append(Paragraph("Purpose: Ensure accurate inventory data at the start of each business day.", styles['Body']))
story.append(Paragraph("Responsible: Opening Staff / Branch Manager", styles['Body']))
story.append(Paragraph("Frequency: Daily, before 9:00 AM", styles['Body']))
story.append(hr())
for i, s in enumerate([
    'Log in using your PIN on the outlet device.',
    'Review the Home Dashboard for any low stock alerts or pending deliveries.',
    'Open <b>Stock Check</b> and select <b>"Daily"</b> frequency.',
    'Walk through each storage area (Fridge, Counter, Dry Store) and verify quantities.',
    'Confirm items that match, adjust items that differ with appropriate reason codes.',
    'Submit the stock check when 100% complete.',
    'If any items are critical (red), inform the Branch Manager to place an order.',
    'Check for expected deliveries and prepare the receiving area.',
], 1):
    story.append(make_step(i, s))
story.append(make_note("The morning badge 'Do First' appears 6AM-12PM to remind staff that stock check is the priority task."))

# SOP 7.2
story.append(Spacer(1, 8))
story.append(Paragraph("7.2 SOP: Placing a Purchase Order", styles['SectionTitle']))
story.append(Paragraph("Purpose: Maintain optimal stock levels by ordering from suppliers before running out.", styles['Body']))
story.append(Paragraph("Responsible: Branch Manager / Admin", styles['Body']))
story.append(Paragraph("Frequency: As needed (typically 2-3 times per week)", styles['Body']))
story.append(hr())
for i, s in enumerate([
    'Navigate to <b>Purchase Orders > Create Order</b>.',
    'Select your branch from the dropdown.',
    'Review the <b>"Needs Ordering"</b> tab for items below par level.',
    'Add suggested items to cart. Adjust quantities based on expected demand (events, promotions, etc.).',
    'Check the <b>"All Products"</b> tab for any items not flagged but needed.',
    'Review cart totals per supplier. Verify delivery dates match your schedule.',
    'Add notes if needed (e.g., "Urgent - event this weekend").',
    'If order requires approval (per Approval Rules): click <b>"Save as Draft"</b>, then <b>"Submit for Approval"</b>.',
    'If no approval needed: click <b>"Send to Supplier"</b>, review WhatsApp preview, then <b>"Open WhatsApp"</b>.',
    'Verify the WhatsApp message was sent successfully. The order status auto-updates to SENT.',
], 1):
    story.append(make_step(i, s))
story.append(make_note("Always check previous orders via Quick Reorder tab before creating a new order to avoid duplicates."))

# SOP 7.3
story.append(Spacer(1, 8))
story.append(Paragraph("7.3 SOP: Receiving Goods Delivery", styles['SectionTitle']))
story.append(Paragraph("Purpose: Accurately record delivered goods and identify discrepancies.", styles['Body']))
story.append(Paragraph("Responsible: Branch Manager / Receiving Staff", styles['Body']))
story.append(Paragraph("Frequency: Upon each delivery", styles['Body']))
story.append(hr())
for i, s in enumerate([
    'When delivery arrives, open the <b>Receivings</b> page.',
    'Click the matching PO card in the "Awaiting Delivery" section.',
    'Physically count each item against the delivery order.',
    'Enter the <b>Received Qty</b> for each item.',
    'For any short, damaged, wrong, or expired items, select the appropriate <b>Discrepancy Reason</b>.',
    'Take photos of discrepancies as evidence (attach via invoice photos).',
    'Add notes explaining any issues (e.g., "2 cartons dented, contents OK").',
    'Click <b>"Confirm Delivery"</b> to finalize.',
    'Verify stock levels updated correctly on the Dashboard.',
    'Inform the Branch Manager of any significant discrepancies for supplier follow-up.',
], 1):
    story.append(make_step(i, s))
story.append(make_note("Never sign the delivery order before completing the system receiving. Discrepancies must be documented before the driver leaves."))

# SOP 7.4
story.append(Spacer(1, 8))
story.append(Paragraph("7.4 SOP: Weekly Stock Audit", styles['SectionTitle']))
story.append(Paragraph("Purpose: Comprehensive stock verification including weekly-frequency items.", styles['Body']))
story.append(Paragraph("Responsible: Branch Manager", styles['Body']))
story.append(Paragraph("Frequency: Every Monday before opening", styles['Body']))
story.append(hr())
for i, s in enumerate([
    'Open Stock Check and select <b>"Weekly"</b> frequency (includes Daily + Weekly items).',
    'Systematically check each storage area, starting from the Fridge.',
    'Count slow-moving items carefully (these are the weekly-only items).',
    'Record any adjusted items with detailed reasons.',
    'Submit the weekly check.',
    'Review the variance report and investigate items with >10% discrepancy.',
    'Update par levels if consumption patterns have changed.',
    'Report findings to the Operations Manager.',
], 1):
    story.append(make_step(i, s))

# SOP 7.5
story.append(Spacer(1, 8))
story.append(Paragraph("7.5 SOP: Recording Wastage", styles['SectionTitle']))
story.append(Paragraph("Purpose: Track and minimize product waste for cost control.", styles['Body']))
story.append(Paragraph("Responsible: All Staff", styles['Body']))
story.append(Paragraph("Frequency: Immediately when wastage occurs", styles['Body']))
story.append(hr())
for i, s in enumerate([
    'Open the <b>Wastage</b> page immediately when waste occurs.',
    'Tap <b>"Record Wastage"</b> and select the product.',
    'Enter the quantity wasted and cost (if known).',
    'Select the reason: Expired, Spillage, Breakage, Quality Issue, or Other.',
    'Add notes describing the incident.',
    'Save the record. The waste cost appears in the dashboard metrics.',
    'For significant waste (>RM50), notify the Branch Manager immediately.',
], 1):
    story.append(make_step(i, s))
story.append(make_note("Record wastage in real-time, not at end of day. Delayed recording leads to inaccurate data and missed cost-saving opportunities."))

# SOP 7.6
story.append(Spacer(1, 8))
story.append(Paragraph("7.6 SOP: New Staff Onboarding", styles['SectionTitle']))
story.append(Paragraph("Purpose: Set up new team members with system access and training.", styles['Body']))
story.append(Paragraph("Responsible: Admin / Branch Manager", styles['Body']))
story.append(hr())
for i, s in enumerate([
    'Go to <b>Staff</b> page and click <b>"Add User"</b>.',
    '<b>Details tab:</b> Enter name, select role (Staff/Manager), set primary branch, enter phone number.',
    '<b>Outlets tab:</b> Assign additional branch access if staff works across locations.',
    '<b>Modules tab:</b> Enable relevant modules based on job scope.',
    '<b>Security tab:</b> Set a 4-digit PIN for staff, or username/password for managers.',
    'Save the user account.',
    'Walk the new staff through: Stock Check, Wastage Recording, and Home Dashboard.',
    'Have them complete a supervised stock check on their first day.',
], 1):
    story.append(make_step(i, s))

# SOP 7.7
story.append(Spacer(1, 8))
story.append(Paragraph("7.7 SOP: Month-End Stock Take", styles['SectionTitle']))
story.append(Paragraph("Purpose: Complete physical inventory count for financial reporting.", styles['Body']))
story.append(Paragraph("Responsible: Branch Manager + Admin", styles['Body']))
story.append(Paragraph("Frequency: Last working day of each month", styles['Body']))
story.append(hr())
for i, s in enumerate([
    'Schedule the stock take after closing time to avoid disruptions.',
    'Open Stock Check and select <b>"Monthly"</b> frequency (all items included).',
    'Two staff members should count: one counts, one enters data.',
    'Check every storage area systematically: Fridge, Freezer, Dry Store, Counter, Bar.',
    'For each item: physically count, then enter actual quantity.',
    'Document all variances with detailed reasons.',
    'Submit the monthly check.',
    'Admin reviews the Stock Valuation report for financial accuracy.',
    'Investigate any items with variance > 5% of par level.',
    'Update par levels and reorder points based on monthly consumption trends.',
], 1):
    story.append(make_step(i, s))
story.append(PageBreak())

# ==================== CHAPTER 8: WORKFLOW DIAGRAMS ====================
story.append(Paragraph("8. Workflow Diagrams", styles['ChapterTitle']))
story.append(hr())

# 8.1 PO Lifecycle
story.append(Paragraph("8.1 Purchase Order Lifecycle", styles['SectionTitle']))
story.append(Spacer(1, 4))

po_flow = [
    ["Stage", "Status", "Who", "Action", "Next Step"],
    ["1. Create", "DRAFT", "Manager", "Build order from Smart Order page", "Submit for Approval"],
    ["2. Submit", "PENDING_APPROVAL", "Manager", "Submit order for review", "Wait for approval"],
    ["3a. Approve", "APPROVED", "Admin", "Review and approve the order", "Send to supplier"],
    ["3b. Reject", "DRAFT", "Admin", "Reject with feedback", "Manager revises"],
    ["4. Send", "SENT", "Manager", "Send via WhatsApp to supplier", "Wait for delivery"],
    ["5. Deliver", "AWAITING_DELIVERY", "System", "Supplier confirms delivery date", "Receive goods"],
    ["6a. Receive (partial)", "PARTIALLY_RECEIVED", "Staff", "Record received items", "Receive remaining"],
    ["6b. Receive (full)", "COMPLETED", "Staff", "All items received and confirmed", "Auto-create invoice"],
    ["X. Cancel", "CANCELLED", "Manager", "Cancel order (from Draft only)", "Delete if needed"],
]
t = Table(po_flow, colWidths=[1.8*cm, 3.5*cm, 2*cm, 4.5*cm, 3.2*cm], repeatRows=1)
t.setStyle(TableStyle([
    ('BACKGROUND', (0, 0), (-1, 0), TERRACOTTA),
    ('TEXTCOLOR', (0, 0), (-1, 0), white),
    ('FONTNAME', (0, 0), (-1, 0), 'SpaceGrotesk'),
    ('FONTSIZE', (0, 0), (-1, -1), 8),
    ('FONTNAME', (0, 1), (-1, -1), 'SpaceGrotesk'),
    ('TEXTCOLOR', (0, 1), (-1, -1), DARK_TEXT),
    ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
    ('ROWBACKGROUNDS', (0, 1), (-1, -1), [white, HexColor("#F9FAFB")]),
    ('GRID', (0, 0), (-1, -1), 0.4, HexColor("#E5E7EB")),
    ('TOPPADDING', (0, 0), (-1, -1), 4),
    ('BOTTOMPADDING', (0, 0), (-1, -1), 4),
    ('LEFTPADDING', (0, 0), (-1, -1), 4),
]))
story.append(t)

# 8.2 Stock Check Flow
story.append(Spacer(1, 12))
story.append(Paragraph("8.2 Stock Check Flow", styles['SectionTitle']))
story.append(Spacer(1, 4))

sc_flow = [
    ["Step", "Action", "Outcome"],
    ["1", "Select frequency (Daily / Weekly / Monthly)", "Items filtered by check frequency"],
    ["2", "Navigate to storage area (Fridge, Counter, etc.)", "Items grouped by location"],
    ["3", "Physically count each item", "Compare against system quantity"],
    ["4a", "Quantity matches -> Confirm (green check)", "Item marked as verified"],
    ["4b", "Quantity differs -> Adjust (red X)", "Enter actual qty + reason"],
    ["5", "All items checked (100%)", "Submit button enabled"],
    ["6", "Submit stock check", "System stock levels updated"],
    ["7", "Review variances", "Investigate discrepancies > 10%"],
]
t2 = Table(sc_flow, colWidths=[1.5*cm, 6.5*cm, 6.5*cm], repeatRows=1)
t2.setStyle(TableStyle([
    ('BACKGROUND', (0, 0), (-1, 0), TERRACOTTA),
    ('TEXTCOLOR', (0, 0), (-1, 0), white),
    ('FONTNAME', (0, 0), (-1, 0), 'SpaceGrotesk'),
    ('FONTSIZE', (0, 0), (-1, -1), 8.5),
    ('FONTNAME', (0, 1), (-1, -1), 'SpaceGrotesk'),
    ('TEXTCOLOR', (0, 1), (-1, -1), DARK_TEXT),
    ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
    ('ROWBACKGROUNDS', (0, 1), (-1, -1), [white, HexColor("#F9FAFB")]),
    ('GRID', (0, 0), (-1, -1), 0.4, HexColor("#E5E7EB")),
    ('TOPPADDING', (0, 0), (-1, -1), 5),
    ('BOTTOMPADDING', (0, 0), (-1, -1), 5),
    ('LEFTPADDING', (0, 0), (-1, -1), 6),
]))
story.append(t2)

# 8.3 Goods Receiving Flow
story.append(Spacer(1, 12))
story.append(Paragraph("8.3 Goods Receiving Flow", styles['SectionTitle']))
story.append(Spacer(1, 4))

gr_flow = [
    ["Step", "Action", "System Effect"],
    ["1", "Delivery arrives at outlet", "N/A"],
    ["2", "Open Receivings > Select awaiting PO", "Ordered items loaded"],
    ["3", "Count each item physically", "N/A"],
    ["4", "Enter received quantities", "Discrepancies auto-detected"],
    ["5", "Tag discrepancy reasons (short/damaged/etc.)", "Logged for supplier tracking"],
    ["6", "Confirm delivery", "Stock balances updated"],
    ["7", "System updates PO status", "PARTIALLY_RECEIVED or COMPLETED"],
    ["8", "Invoice auto-created", "Accounts payable record generated"],
]
t3 = Table(gr_flow, colWidths=[1.5*cm, 5.5*cm, 7.5*cm], repeatRows=1)
t3.setStyle(TableStyle([
    ('BACKGROUND', (0, 0), (-1, 0), TERRACOTTA),
    ('TEXTCOLOR', (0, 0), (-1, 0), white),
    ('FONTNAME', (0, 0), (-1, 0), 'SpaceGrotesk'),
    ('FONTSIZE', (0, 0), (-1, -1), 8.5),
    ('FONTNAME', (0, 1), (-1, -1), 'SpaceGrotesk'),
    ('TEXTCOLOR', (0, 1), (-1, -1), DARK_TEXT),
    ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
    ('ROWBACKGROUNDS', (0, 1), (-1, -1), [white, HexColor("#F9FAFB")]),
    ('GRID', (0, 0), (-1, -1), 0.4, HexColor("#E5E7EB")),
    ('TOPPADDING', (0, 0), (-1, -1), 5),
    ('BOTTOMPADDING', (0, 0), (-1, -1), 5),
    ('LEFTPADDING', (0, 0), (-1, -1), 6),
]))
story.append(t3)

story.append(Spacer(1, 2*cm))
story.append(hr())
story.append(Paragraph(
    "End of User Manual",
    ParagraphStyle('EndNote', parent=styles['Body'], alignment=TA_CENTER, textColor=GRAY_TEXT, fontSize=10, fontName='SpaceGrotesk')
))
story.append(Spacer(1, 4))
story.append(Paragraph(
    f"Celsius Coffee Inventory System v1.0  |  Generated {datetime.date.today().strftime('%d %B %Y')}",
    ParagraphStyle('EndDate', parent=styles['Body'], alignment=TA_CENTER, textColor=GRAY_TEXT, fontSize=8)
))
story.append(Paragraph(
    "For support, contact the Operations Manager or system administrator.",
    ParagraphStyle('EndSupport', parent=styles['Body'], alignment=TA_CENTER, textColor=GRAY_TEXT, fontSize=8)
))

# ==================== BUILD PDF ====================
output_path = "/Users/ammarshahrin/Desktop/Celsius_Inventory_User_Manual.pdf"
doc = SimpleDocTemplate(
    output_path,
    pagesize=A4,
    topMargin=2*cm,
    bottomMargin=2*cm,
    leftMargin=2*cm,
    rightMargin=2*cm,
    title="Celsius Coffee Inventory System - User Manual",
    author="Celsius Coffee Sdn Bhd",
    subject="User Manual, SOP & Workflow Guide",
)

doc.build(story, onFirstPage=header_footer, onLaterPages=header_footer)
print(f"PDF generated: {output_path}")
