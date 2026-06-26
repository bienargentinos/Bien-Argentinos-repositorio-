"""
Bien Argentinos - Backend de Facturación Electrónica ARCA
Flask + pyafipws
"""

from flask import Flask, request, jsonify, send_file
from flask_cors import CORS
import os
import json
from datetime import datetime
from facturacion import emitir_factura
from pdf_generator import generar_pdf
from sheets_logger import registrar_en_sheets

app = Flask(__name__)
CORS(app)

# ── Rutas ──────────────────────────────────────────────────────────────────────

@app.route("/ping", methods=["GET"])
def ping():
    return jsonify({"status": "ok", "timestamp": datetime.now().isoformat()})


@app.route("/factura", methods=["POST"])
def crear_factura():
    datos = request.get_json()
    if not datos:
        return jsonify({"error": "JSON requerido"}), 400

    # Validaciones básicas
    campos = ["cliente_nombre", "cliente_cuit", "items", "condicion_iva"]
    faltantes = [c for c in campos if c not in datos]
    if faltantes:
        return jsonify({"error": f"Campos faltantes: {faltantes}"}), 400

    try:
        # 1. Emitir en ARCA y obtener CAE
        resultado = emitir_factura(datos)

        # 2. Generar PDF con diseño Bien Argentinos
        pdf_path = generar_pdf(datos, resultado)

        # 3. Registrar en Google Sheets
        registrar_en_sheets(datos, resultado)

        return jsonify({
            "ok": True,
            "numero": resultado["numero"],
            "cae": resultado["cae"],
            "vencimiento_cae": resultado["vencimiento_cae"],
            "pdf_url": f"/pdf/{resultado['numero']}",
            "total": resultado["total"]
        })

    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/pdf/<numero>", methods=["GET"])
def descargar_pdf(numero):
    pdf_path = f"pdfs/factura_{numero}.pdf"
    if not os.path.exists(pdf_path):
        return jsonify({"error": "PDF no encontrado"}), 404
    return send_file(pdf_path, as_attachment=True,
                     download_name=f"factura_{numero}.pdf",
                     mimetype="application/pdf")


@app.route("/ultimo-numero", methods=["GET"])
def ultimo_numero():
    """Devuelve el último número de comprobante emitido."""
    from facturacion import obtener_ultimo_numero
    try:
        n = obtener_ultimo_numero()
        return jsonify({"ultimo": n})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


if __name__ == "__main__":
    os.makedirs("pdfs", exist_ok=True)
    app.run(host="0.0.0.0", port=5000, debug=False)
