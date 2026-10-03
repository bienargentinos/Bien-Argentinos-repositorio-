// GENERA EXPENSAS DE EJEMPLO PARA PROBAR LA CARGA
//
//   node ejemplo-expensas.js                          las 4 del edificio de prueba
//   node ejemplo-expensas.js "Zeballos Cia" 1A 2B 3C  las unidades que le pases
//
// Escribe archivos HTML en `ejemplos-expensas/`. Se abren en el navegador y se imprimen a PDF
// (Ctrl+P → Guardar como PDF), que es exactamente el formato en que llega una liquidación de
// verdad.
//
// ── PARA QUÉ SIRVE ──────────────────────────────────────────────────────────
//
// Antes de pedirle a un administrador real que suba las expensas de su consorcio, conviene ver
// qué lee el sistema de un documento con la forma de una liquidación argentina: el total a pagar
// entre varios importes parecidos, la unidad escrita como la escribe un sistema de expensas, el
// vencimiento, y el punto de los miles.
//
// **Está hecho para que sea difícil, no fácil.** Trae saldo anterior, intereses, subtotales y el
// total del edificio, que son justo los números que se pueden confundir con el total a pagar.
// Un lector que acierta sobre un documento limpio no dice nada; uno que acierta sobre esto sí.
//
// Y una de las cuatro sale **a propósito con la unidad escrita distinto** (`Depto 3`), para ver
// el aviso de "todavía no hay ningún vecino registrado en esa unidad" antes de publicar.

'use strict';

const fs = require('fs');
const path = require('path');

const edificio = process.argv[2] || 'san patricio casa';
const unidades = process.argv.slice(3);

// El edificio de prueba tiene 3 unidades. La cuarta entrada es la liquidación general.
const PREDETERMINADAS = ['1° A', '4° C', 'Depto 3'];

const pesos = (n) => '$ ' + n.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function documento({ unidad, total, saldoAnterior, interes, expensaComun, expensaExtra, totalEdificio }) {
    const esGeneral = !unidad;
    return `<!doctype html>
<html lang="es"><head><meta charset="utf-8">
<title>Expensas ${esGeneral ? 'generales' : unidad} — Agosto 2026</title>
<style>
  @page { size: A4; margin: 14mm; }
  body { font-family: Arial, Helvetica, sans-serif; color: #111; font-size: 12px; line-height: 1.45; }
  h1 { font-size: 17px; margin: 0 0 2px; }
  .sub { color: #555; font-size: 11px; margin-bottom: 14px; }
  .caja { border: 1px solid #999; padding: 10px 12px; margin-bottom: 14px; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 12px; }
  th, td { border-bottom: 1px solid #ddd; padding: 5px 4px; text-align: left; }
  td.n, th.n { text-align: right; white-space: nowrap; }
  tfoot td { border-top: 2px solid #111; border-bottom: none; font-weight: bold; }
  .total { border: 2px solid #111; padding: 10px 12px; margin-top: 10px; display: flex;
           justify-content: space-between; align-items: center; }
  .total .rot { font-size: 13px; font-weight: bold; text-transform: uppercase; }
  .total .val { font-size: 20px; font-weight: bold; }
  .vto { font-size: 12px; margin-top: 8px; }
  .pie { color: #666; font-size: 10px; margin-top: 18px; border-top: 1px solid #ddd; padding-top: 8px; }
</style></head>
<body>

<h1>ADMINISTRACIÓN BIEN ARGENTINOS</h1>
<div class="sub">Liquidación de expensas · Período <strong>Agosto 2026</strong></div>

<div class="caja">
  <div><strong>Consorcio:</strong> ${edificio}</div>
  <div><strong>Dirección:</strong> San Patricio 159 — C.A.B.A.</div>
  ${esGeneral
    ? '<div><strong>Liquidación general del edificio</strong> (todas las unidades)</div>'
    : `<div><strong>Unidad:</strong> ${unidad}</div>`}
</div>

<table>
  <thead><tr><th>Concepto</th><th class="n">Importe</th></tr></thead>
  <tbody>
    <tr><td>Sueldo y cargas sociales encargado</td><td class="n">${pesos(totalEdificio * 0.41)}</td></tr>
    <tr><td>Energía eléctrica áreas comunes</td><td class="n">${pesos(totalEdificio * 0.13)}</td></tr>
    <tr><td>Agua y servicios sanitarios</td><td class="n">${pesos(totalEdificio * 0.09)}</td></tr>
    <tr><td>Limpieza y mantenimiento</td><td class="n">${pesos(totalEdificio * 0.16)}</td></tr>
    <tr><td>Reparación portón de acceso</td><td class="n">${pesos(totalEdificio * 0.11)}</td></tr>
    <tr><td>Honorarios administración</td><td class="n">${pesos(totalEdificio * 0.10)}</td></tr>
  </tbody>
  <tfoot>
    <tr><td>TOTAL GASTOS DEL EDIFICIO</td><td class="n">${pesos(totalEdificio)}</td></tr>
  </tfoot>
</table>

${esGeneral ? `
<div class="pie">
  Esta liquidación corresponde al total del consorcio. El detalle de lo que abona cada unidad
  se emite por separado en el cupón de cada propietario.
</div>
` : `
<table>
  <thead><tr><th>Detalle de la unidad ${unidad}</th><th class="n">Importe</th></tr></thead>
  <tbody>
    <tr><td>Expensas comunes (prorrateo)</td><td class="n">${pesos(expensaComun)}</td></tr>
    <tr><td>Expensas extraordinarias</td><td class="n">${pesos(expensaExtra)}</td></tr>
    <tr><td>Saldo período anterior</td><td class="n">${pesos(saldoAnterior)}</td></tr>
    <tr><td>Intereses por mora</td><td class="n">${pesos(interes)}</td></tr>
  </tbody>
</table>

<div class="total">
  <span class="rot">Total a pagar</span>
  <span class="val">${pesos(total)}</span>
</div>

<div class="vto">
  <strong>1° vencimiento:</strong> 10/09/2026 &nbsp;·&nbsp;
  <strong>2° vencimiento:</strong> 20/09/2026 (con 5% de recargo)
</div>

<div class="pie">
  Documento de PRUEBA generado por <code>ejemplo-expensas.js</code>. Importes ficticios.
</div>
`}

</body></html>`;
}

const carpeta = path.join(__dirname, 'ejemplos-expensas');
fs.mkdirSync(carpeta, { recursive: true });

const totalEdificio = 1284650.4;
const lista = unidades.length ? unidades : PREDETERMINADAS;

const escritos = [];

// La liquidación general: se sube con la unidad VACÍA y la ven todos.
const general = path.join(carpeta, 'expensas-general-agosto-2026.html');
fs.writeFileSync(general, documento({ unidad: '', totalEdificio }));
escritos.push([general, 'liquidación general (subirla con la unidad VACÍA)']);

lista.forEach((unidad, i) => {
    // Números distintos por unidad, y con decimales: el punto de los miles y la coma decimal son
    // justo donde se rompe una lectura descuidada.
    const expensaComun = 78400 + i * 6130.5;
    const expensaExtra = 9200 + i * 480.25;
    const saldoAnterior = i === 1 ? 14820.6 : 0;
    const interes = i === 1 ? 1273.4 : 0;
    const total = expensaComun + expensaExtra + saldoAnterior + interes;

    const archivo = path.join(carpeta,
        `expensas-${String(unidad).replace(/[^\w]+/g, '-').toLowerCase()}-agosto-2026.html`);
    fs.writeFileSync(archivo, documento({
        unidad, total, saldoAnterior, interes, expensaComun, expensaExtra, totalEdificio,
    }));
    escritos.push([archivo, `unidad ${unidad} · total ${pesos(total)}`]);
});

// ── A PDF, SI HAY UN CHROMIUM A MANO ────────────────────────────────────────
//
// > [!CAUTION]
// > **"Guardar como..." NO produce un PDF.** Guarda el HTML con otro nombre.
//
// Pasó en la primera prueba real: las cuatro expensas se subieron, el navegador informó el tipo
// por la extensión --así que pasaron el filtro-- y la IA se plantó con "The document has no
// pages". Desde afuera parecía que el lector no servía.
//
// Imprimir a PDF de verdad son tres pasos que hay que explicar y acordarse. Si hay un Chromium
// instalado, esto lo hace solo y el problema no existe.
const { execFileSync } = require('child_process');

function chromiumDisponible() {
    const candidatos = [
        process.env.CHROME_BIN,
        '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
        '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome',
    ].filter(Boolean);
    for (const c of candidatos) { if (fs.existsSync(c)) return c; }
    // Y los de Playwright, cuya carpeta lleva el número de versión adentro.
    try {
        const base = process.env.PLAYWRIGHT_BROWSERS_PATH || '/opt/pw-browsers';
        for (const d of fs.readdirSync(base)) {
            const c = path.join(base, d, 'chrome-linux', 'chrome');
            if (fs.existsSync(c)) return c;
        }
    } catch (_) {}
    return null;
}

const chrome = chromiumDisponible();
if (chrome) {
    for (const [ruta] of escritos) {
        const destino = ruta.replace(/\.html$/, '.pdf');
        try {
            execFileSync(chrome, [
                '--headless', '--disable-gpu', '--no-sandbox', '--no-pdf-header-footer',
                `--print-to-pdf=${destino}`, `file://${ruta}`,
            ], { stdio: 'ignore' });
        } catch (e) {
            console.warn(`   ⚠️ No se pudo pasar a PDF ${path.basename(ruta)}: ${e.message}`);
        }
    }
}

console.log(`\n💸 ${escritos.length} expensa(s) de ejemplo en ${carpeta}\n`);
for (const [ruta, que] of escritos) console.log(`   · ${path.basename(ruta)}\n     ${que}`);
console.log(chrome ? `
   Ya están en PDF al lado de cada HTML: esos .pdf son los que se suben al panel.` : `
   Abrilas en el navegador e imprimilas a PDF (Ctrl+P → DESTINO: Guardar como PDF).
   OJO: "Guardar como..." del menú NO sirve -- guarda el HTML con otro nombre, el
   panel lo acepta por la extensión y la IA se planta con "no pages".`);

console.log(`

   Qué mirar al cargarlas:
   · Que el total leído sea el de "TOTAL A PAGAR" y NO el del edificio, ni un subtotal,
     ni el saldo anterior. Son los cuatro números que se confunden.
   · Que "4° C" se reconozca como la unidad "4C" del edificio.
   · Que "Depto 3" salga avisada: no hay ningún vecino registrado en esa unidad.
   · Que la general se publique sin unidad y la vean todos.
`);
