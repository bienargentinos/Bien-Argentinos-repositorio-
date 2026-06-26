"""
Registro de facturas en Google Sheets via gspread.
Hoja: "Facturación ARCA"  →  columnas A-L
"""

import os
import gspread
from google.oauth2.service_account import Credentials
from datetime import datetime

SCOPES = [
    "https://www.googleapis.com/auth/spreadsheets",
    "https://www.googleapis.com/auth/drive",
]

CREDS_FILE   = os.getenv("GOOGLE_CREDS_JSON", "certs/google_service.json")
SPREADSHEET  = os.getenv("GOOGLE_SHEET_NAME", "Facturación ARCA")
SHEET_TAB    = os.getenv("GOOGLE_SHEET_TAB",  "Facturas")

HEADERS = [
    "Fecha", "Tipo", "Punto Venta", "Número", "CAE", "Vto. CAE",
    "Cliente", "CUIT Cliente", "Cond. IVA", "Neto", "IVA", "Total"
]


def _get_hoja():
    creds = Credentials.from_service_account_file(CREDS_FILE, scopes=SCOPES)
    gc    = gspread.authorize(creds)
    sh    = gc.open(SPREADSHEET)
    try:
        ws = sh.worksheet(SHEET_TAB)
    except gspread.WorksheetNotFound:
        ws = sh.add_worksheet(SHEET_TAB, rows=1000, cols=20)
        ws.append_row(HEADERS)
    return ws


def registrar_en_sheets(datos: dict, resultado: dict):
    fecha_str = datetime.strptime(resultado["fecha"], "%Y%m%d").strftime("%d/%m/%Y")
    fila = [
        fecha_str,
        resultado["tipo"],
        resultado["punto_venta"],
        resultado["numero"],
        resultado["cae"],
        resultado["vencimiento_cae"],
        datos.get("cliente_nombre", ""),
        datos.get("cliente_cuit", ""),
        datos.get("condicion_iva", ""),
        resultado["neto"],
        resultado["iva"],
        resultado["total"],
    ]
    ws = _get_hoja()
    ws.append_row(fila, value_input_option="USER_ENTERED")
