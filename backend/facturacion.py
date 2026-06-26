"""
Módulo de comunicación con ARCA (AFIP) via pyafipws.
Soporta Factura A, B y C. Homologación y Producción.
"""

import os
from pyafipws.wsfev1 import WSFEv1
from pyafipws.wsaa import WSAA

# ── Configuración ──────────────────────────────────────────────────────────────
CERT    = os.getenv("AFIP_CERT",    "certs/cert.crt")
CLAVE   = os.getenv("AFIP_KEY",     "certs/private.key")
CUIT    = os.getenv("AFIP_CUIT",    "20000000000")      # reemplazar con CUIT real
AMBIENTE = os.getenv("AFIP_AMBIENTE", "homologacion")   # "homologacion" o "produccion"

HOMO = (AMBIENTE == "homologacion")

# Punto de venta configurado en ARCA
PUNTO_VENTA = int(os.getenv("AFIP_PV", "1"))

# Códigos de tipo de comprobante ARCA
TIPO_CBTE = {
    "A": 1,
    "B": 6,
    "C": 11,
}

# Condición IVA del emisor (Bien Argentinos)
CONDICION_EMISOR = os.getenv("AFIP_CONDICION", "RI")  # RI = Responsable Inscripto


def _conectar():
    """Autentica con WSAA y conecta a WSFEv1."""
    wsaa = WSAA()
    wsfev1 = WSFEv1()

    if HOMO:
        wsaa_url = "https://wsaahomo.afip.gov.ar/ws/services/LoginCms?wsdl"
        wsfev1_url = "https://wswhomo.afip.gov.ar/wsfev1/service.asmx?WSDL"
    else:
        wsaa_url = "https://wsaa.afip.gov.ar/ws/services/LoginCms?wsdl"
        wsfev1_url = "https://servicios1.afip.gov.ar/wsfev1/service.asmx?WSDL"

    # Obtener Ticket de Acceso (TA) — se cachea en disco automáticamente
    ta = wsaa.Autenticar("wsfe", CERT, CLAVE, wsaa_url, cache="cache/")
    if not ta:
        raise RuntimeError(f"Error autenticando con WSAA: {wsaa.Excepcion}")

    wsfev1.Cuit = CUIT
    wsfev1.SetTicketAcceso(ta)
    wsfev1.Conectar("", wsfev1_url)

    return wsfev1


def obtener_ultimo_numero():
    wsfev1 = _conectar()
    # Usamos tipo B por defecto para consulta rápida
    wsfev1.CompUltimoAutorizado(TIPO_CBTE["B"], PUNTO_VENTA)
    return int(wsfev1.CbteNro)


def _calcular_totales(items, alicuota_iva=21):
    """Calcula neto, IVA y total a partir de la lista de ítems (precios con IVA)."""
    total_con_iva = sum(float(i["precio"]) * float(i["cantidad"]) for i in items)
    if alicuota_iva == 0:
        neto = total_con_iva
        iva = 0.0
    else:
        divisor = 1 + alicuota_iva / 100
        neto = round(total_con_iva / divisor, 2)
        iva  = round(total_con_iva - neto, 2)
    return round(neto, 2), round(iva, 2), round(total_con_iva, 2)


def emitir_factura(datos: dict) -> dict:
    """
    Emite una factura electrónica en ARCA.

    datos: {
        cliente_nombre, cliente_cuit, cliente_domicilio,
        condicion_iva: "CF" | "RI" | "EX" | "MO",
        tipo_factura: "A" | "B" | "C"  (default B),
        alicuota_iva: 21 | 10.5 | 0    (default 21),
        items: [{"descripcion", "cantidad", "precio"}],
        concepto: 1|2|3  (1=Productos, 2=Servicios, 3=P+S)
    }
    """
    wsfev1 = _conectar()

    tipo_str    = datos.get("tipo_factura", "B")
    tipo_cbte   = TIPO_CBTE.get(tipo_str, TIPO_CBTE["B"])
    alicuota    = float(datos.get("alicuota_iva", 21))
    concepto    = int(datos.get("concepto", 2))          # 2 = Servicios
    items       = datos["items"]

    neto, iva, total = _calcular_totales(items, alicuota)

    # Próximo número de comprobante
    wsfev1.CompUltimoAutorizado(tipo_cbte, PUNTO_VENTA)
    cbte_nro = int(wsfev1.CbteNro) + 1

    fecha = datos.get("fecha") or __import__("datetime").date.today().strftime("%Y%m%d")

    # ── Armar comprobante ──────────────────────────────────────────────────────
    wsfev1.CrearFactura(
        concepto      = concepto,
        tipo_doc      = 80,                  # 80 = CUIT
        nro_doc       = datos["cliente_cuit"].replace("-", ""),
        tipo_cbte     = tipo_cbte,
        punto_vta     = PUNTO_VENTA,
        cbte_nro      = cbte_nro,
        imp_total     = total,
        imp_tot_conc  = 0,                   # no gravado
        imp_neto      = neto,
        imp_iva       = iva,
        imp_trib      = 0,
        imp_op_ex     = 0,
        fecha_cbte    = fecha,
        fecha_venc_pago = fecha,
        fecha_serv_desde = fecha if concepto in (2, 3) else None,
        fecha_serv_hasta = fecha if concepto in (2, 3) else None,
        moneda_id     = "PES",
        moneda_ctz    = 1,
        cond_iva_id   = datos.get("condicion_iva_id", 5),  # 5 = Consumidor Final
    )

    # IVA
    if alicuota > 0:
        cod_iva = {21: 5, 10.5: 4, 27: 6}.get(alicuota, 5)
        wsfev1.AgregarIva(cod_iva, neto, iva)

    # Enviar a ARCA
    wsfev1.CAESolicitar()

    if wsfev1.Resultado != "A":
        raise RuntimeError(f"ARCA rechazó la factura: {wsfev1.ErrMsg or wsfev1.Obs}")

    return {
        "numero":          cbte_nro,
        "tipo":            tipo_str,
        "punto_venta":     PUNTO_VENTA,
        "cae":             wsfev1.CAE,
        "vencimiento_cae": wsfev1.Vencimiento,
        "total":           total,
        "neto":            neto,
        "iva":             iva,
        "fecha":           fecha,
    }
