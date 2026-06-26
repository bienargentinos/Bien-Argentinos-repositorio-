"""
Generador de PDF con diseño Bien Argentinos usando ReportLab.
"""

import os
from datetime import datetime
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.lib import colors
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, HRFlowable
)
from reportlab.lib.enums import TA_CENTER, TA_RIGHT, TA_LEFT

# ── Paleta Bien Argentinos ─────────────────────────────────────────────────────
AZUL       = colors.HexColor("#1A3A5C")
CELESTE    = colors.HexColor("#2980B9")
GRIS_CLARO = colors.HexColor("#F5F7FA")
GRIS_BORDE = colors.HexColor("#D0D7E0")
BLANCO     = colors.white
NEGRO      = colors.HexColor("#1A1A2E")

EMPRESA = {
    "nombre":    "BIEN ARGENTINOS S.A.",
    "domicilio": "Av. Corrientes 1234, CABA",
    "tel":       "+54 11 4000-0000",
    "email":     "admin@bienargentinos.com.ar",
    "cuit":      "30-71234567-8",
    "iva":       "Responsable Inscripto",
    "iibb":      "901-234567-8",
}

OUT_DIR = "pdfs"
os.makedirs(OUT_DIR, exist_ok=True)


def _estilos():
    s = getSampleStyleSheet()
    return {
        "titulo":    ParagraphStyle("titulo",    fontSize=22, textColor=BLANCO,    alignment=TA_LEFT, fontName="Helvetica-Bold"),
        "subtitulo": ParagraphStyle("subtitulo", fontSize=10, textColor=CELESTE,   alignment=TA_LEFT, fontName="Helvetica-Bold"),
        "normal":    ParagraphStyle("normal",    fontSize=9,  textColor=NEGRO,     alignment=TA_LEFT, fontName="Helvetica"),
        "negrita":   ParagraphStyle("negrita",   fontSize=9,  textColor=NEGRO,     alignment=TA_LEFT, fontName="Helvetica-Bold"),
        "small":     ParagraphStyle("small",     fontSize=7.5,textColor=colors.grey,alignment=TA_LEFT,fontName="Helvetica"),
        "right":     ParagraphStyle("right",     fontSize=9,  textColor=NEGRO,     alignment=TA_RIGHT,fontName="Helvetica"),
        "right_b":   ParagraphStyle("right_b",   fontSize=10, textColor=AZUL,      alignment=TA_RIGHT,fontName="Helvetica-Bold"),
        "center":    ParagraphStyle("center",    fontSize=9,  textColor=NEGRO,     alignment=TA_CENTER,fontName="Helvetica"),
        "cae":       ParagraphStyle("cae",       fontSize=8,  textColor=colors.grey,alignment=TA_CENTER,fontName="Helvetica"),
    }


def _fmt_moneda(valor):
    return f"$ {float(valor):,.2f}".replace(",", "X").replace(".", ",").replace("X", ".")


def generar_pdf(datos: dict, resultado: dict) -> str:
    e  = ESTILOS = _estilos()
    numero  = resultado["numero"]
    pv      = resultado["punto_venta"]
    tipo    = resultado["tipo"]
    fecha   = datetime.strptime(resultado["fecha"], "%Y%m%d").strftime("%d/%m/%Y")
    cae     = resultado["cae"]
    vcto    = resultado["vencimiento_cae"]
    total   = resultado["total"]
    neto    = resultado["neto"]
    iva_amt = resultado["iva"]

    filename = f"{OUT_DIR}/factura_{numero:08d}.pdf"
    doc = SimpleDocTemplate(
        filename,
        pagesize=A4,
        rightMargin=15*mm, leftMargin=15*mm,
        topMargin=10*mm,   bottomMargin=15*mm,
    )

    story = []

    # ── Encabezado azul ────────────────────────────────────────────────────────
    header_data = [[
        Paragraph(EMPRESA["nombre"], e["titulo"]),
        Paragraph(
            f"FACTURA <b>{tipo}</b><br/>"
            f"<font size=9>N° {pv:04d}-{numero:08d}</font>",
            ParagraphStyle("ftype", fontSize=16, textColor=BLANCO,
                           alignment=TA_RIGHT, fontName="Helvetica-Bold")
        ),
    ]]
    header = Table(header_data, colWidths=[110*mm, 65*mm])
    header.setStyle(TableStyle([
        ("BACKGROUND",  (0,0), (-1,-1), AZUL),
        ("TOPPADDING",  (0,0), (-1,-1), 8),
        ("BOTTOMPADDING",(0,0),(-1,-1), 8),
        ("LEFTPADDING", (0,0), (-1,-1), 6),
        ("RIGHTPADDING",(0,0), (-1,-1), 6),
        ("VALIGN",      (0,0), (-1,-1), "MIDDLE"),
    ]))
    story.append(header)
    story.append(Spacer(1, 4*mm))

    # ── Datos empresa + cliente ────────────────────────────────────────────────
    emp_lines = [
        Paragraph("<b>Datos del Emisor</b>", e["subtitulo"]),
        Paragraph(EMPRESA["nombre"],    e["negrita"]),
        Paragraph(EMPRESA["domicilio"], e["normal"]),
        Paragraph(f"CUIT: {EMPRESA['cuit']}", e["normal"]),
        Paragraph(f"IVA: {EMPRESA['iva']}", e["normal"]),
        Paragraph(f"IIBB: {EMPRESA['iibb']}", e["normal"]),
    ]
    cli_lines = [
        Paragraph("<b>Datos del Cliente</b>", e["subtitulo"]),
        Paragraph(datos.get("cliente_nombre", ""), e["negrita"]),
        Paragraph(datos.get("cliente_domicilio", ""), e["normal"]),
        Paragraph(f"CUIT: {datos.get('cliente_cuit','')}", e["normal"]),
        Paragraph(f"Cond. IVA: {datos.get('condicion_iva','')}", e["normal"]),
        Paragraph(f"Fecha: {fecha}", e["normal"]),
    ]
    bi_data = [[emp_lines, cli_lines]]
    bi = Table(bi_data, colWidths=[87*mm, 88*mm])
    bi.setStyle(TableStyle([
        ("VALIGN",      (0,0), (-1,-1), "TOP"),
        ("LEFTPADDING", (0,0), (-1,-1), 4),
        ("RIGHTPADDING",(0,0), (-1,-1), 4),
        ("TOPPADDING",  (0,0), (-1,-1), 2),
        ("BACKGROUND",  (0,0), (0,-1), GRIS_CLARO),
        ("BACKGROUND",  (1,0), (1,-1), BLANCO),
        ("BOX",         (0,0), (0,-1), 0.5, GRIS_BORDE),
        ("BOX",         (1,0), (1,-1), 0.5, GRIS_BORDE),
    ]))
    story.append(bi)
    story.append(Spacer(1, 5*mm))

    # ── Tabla de ítems ─────────────────────────────────────────────────────────
    cols = ["#", "Descripción", "Cantidad", "Precio Unit.", "Subtotal"]
    widths = [8*mm, 95*mm, 17*mm, 22*mm, 23*mm]
    item_data = [[Paragraph(f"<b>{c}</b>", e["center"]) for c in cols]]

    for idx, item in enumerate(datos["items"], start=1):
        qty   = float(item["cantidad"])
        price = float(item["precio"])
        sub   = qty * price
        item_data.append([
            Paragraph(str(idx),                    e["center"]),
            Paragraph(item["descripcion"],          e["normal"]),
            Paragraph(f"{qty:g}",                  e["center"]),
            Paragraph(_fmt_moneda(price),           e["right"]),
            Paragraph(_fmt_moneda(sub),             e["right"]),
        ])

    item_table = Table(item_data, colWidths=widths, repeatRows=1)
    item_table.setStyle(TableStyle([
        ("BACKGROUND",    (0,0), (-1,0), AZUL),
        ("TEXTCOLOR",     (0,0), (-1,0), BLANCO),
        ("FONTNAME",      (0,0), (-1,0), "Helvetica-Bold"),
        ("ROWBACKGROUNDS",(0,1), (-1,-1), [BLANCO, GRIS_CLARO]),
        ("GRID",          (0,0), (-1,-1), 0.4, GRIS_BORDE),
        ("TOPPADDING",    (0,0), (-1,-1), 4),
        ("BOTTOMPADDING", (0,0), (-1,-1), 4),
        ("LEFTPADDING",   (0,0), (-1,-1), 4),
        ("RIGHTPADDING",  (0,0), (-1,-1), 4),
        ("VALIGN",        (0,0), (-1,-1), "MIDDLE"),
    ]))
    story.append(item_table)
    story.append(Spacer(1, 5*mm))

    # ── Totales ────────────────────────────────────────────────────────────────
    alicuota = datos.get("alicuota_iva", 21)
    tot_data = [
        ["Subtotal neto:",      _fmt_moneda(neto)],
        [f"IVA ({alicuota}%):", _fmt_moneda(iva_amt)],
        ["TOTAL:",              _fmt_moneda(total)],
    ]
    tot_table = Table(tot_data, colWidths=[130*mm, 45*mm])
    tot_table.setStyle(TableStyle([
        ("ALIGN",       (0,0), (-1,-1), "RIGHT"),
        ("FONTNAME",    (0,0), (-1,1),  "Helvetica"),
        ("FONTNAME",    (0,2), (-1,2),  "Helvetica-Bold"),
        ("FONTSIZE",    (0,2), (-1,2),  11),
        ("TEXTCOLOR",   (0,2), (-1,2),  AZUL),
        ("TOPPADDING",  (0,0), (-1,-1), 3),
        ("BOTTOMPADDING",(0,0),(-1,-1), 3),
        ("LINEABOVE",   (0,2), (-1,2),  1, AZUL),
    ]))
    story.append(tot_table)
    story.append(Spacer(1, 8*mm))
    story.append(HRFlowable(width="100%", thickness=0.5, color=GRIS_BORDE))
    story.append(Spacer(1, 4*mm))

    # ── CAE y pie ─────────────────────────────────────────────────────────────
    cae_data = [[
        Paragraph(f"CAE N°: <b>{cae}</b><br/>Vencimiento CAE: {vcto}", e["cae"]),
        Paragraph(
            "Documento emitido conforme a la Res. Gral. AFIP N° 1415/03 y modificatorias.<br/>"
            f"{EMPRESA['email']} | {EMPRESA['tel']}",
            e["cae"]
        ),
    ]]
    cae_table = Table(cae_data, colWidths=[90*mm, 85*mm])
    cae_table.setStyle(TableStyle([
        ("BACKGROUND",   (0,0), (0,-1), GRIS_CLARO),
        ("BOX",          (0,0), (0,-1), 0.5, GRIS_BORDE),
        ("LEFTPADDING",  (0,0), (-1,-1), 6),
        ("RIGHTPADDING", (0,0), (-1,-1), 6),
        ("TOPPADDING",   (0,0), (-1,-1), 5),
        ("BOTTOMPADDING",(0,0), (-1,-1), 5),
        ("VALIGN",       (0,0), (-1,-1), "MIDDLE"),
    ]))
    story.append(cae_table)

    doc.build(story)
    return filename
