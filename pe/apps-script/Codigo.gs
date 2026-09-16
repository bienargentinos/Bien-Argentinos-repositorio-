/**
 * Presupuestador Electricista — backend en Google Sheets
 * Bien Argentinos · bienargentinos.com/pe/
 *
 * Reemplaza el contenido de Código.gs del proyecto de Apps Script que ya está
 * publicado en:
 *   https://script.google.com/macros/s/AKfycbwsjXY6ahavwhyXafI9P8e4ZjPXWMhNV76MNgRiigRHPzgw4Ld1VybAhhBWkMFGZNk/exec
 *
 * Qué arregla: al guardar un presupuesto NUEVO ahora siempre se agrega una fila
 * al final (appendRow). Antes se pisaba la última fila y por eso la planilla
 * quedaba clavada en la misma cantidad de registros.
 *
 * Un presupuesto se identifica por Num + Tipo:
 *   - si ese Num ya existe  -> se actualiza esa fila (editar un presupuesto)
 *   - si no existe          -> se agrega al final (presupuesto nuevo)
 */

// Dejalo vacío si este script está adentro de la planilla (Extensiones > Apps Script).
// Si es un proyecto suelto, pegá acá el ID de la planilla (lo que va entre /d/ y /edit en la URL).
var SHEET_ID = '';

// Dejalo vacío para que busque sola la hoja de presupuestos. Si querés fijarla, poné el nombre.
var HOJA = '';

var COLUMNAS = ['Timestamp', 'Num', 'Tipo', 'Fecha', 'Cliente', 'Direccion', 'Contacto',
                'Fiscal', 'Notas', 'Descuento', 'Total', 'Validez', 'Moneda', 'Items'];

function planilla_() {
  return SHEET_ID ? SpreadsheetApp.openById(SHEET_ID) : SpreadsheetApp.getActiveSpreadsheet();
}

/** Devuelve la hoja de presupuestos (la que tiene Timestamp + Num en la fila 1). */
function hoja_() {
  var ss = planilla_();
  if (!ss) throw new Error('No encuentro la planilla. Completá SHEET_ID arriba.');

  if (HOJA) {
    var fija = ss.getSheetByName(HOJA);
    if (!fija) throw new Error('No existe la hoja "' + HOJA + '".');
    return conEncabezado_(fija);
  }

  var hojas = ss.getSheets();
  for (var i = 0; i < hojas.length; i++) {
    if (hojas[i].getLastRow() < 1) continue;
    var cab = hojas[i].getRange(1, 1, 1, 2).getValues()[0];
    if (String(cab[0]).trim() === 'Timestamp' && String(cab[1]).trim() === 'Num') return hojas[i];
  }

  // Ninguna hoja tiene el encabezado: usamos la primera y se lo ponemos.
  return conEncabezado_(hojas[0] || ss.insertSheet('Presupuestos'));
}

function conEncabezado_(sh) {
  if (sh.getLastRow() === 0) sh.appendRow(COLUMNAS);
  return sh;
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

/** GET ?tipo=Electricista -> { success:true, data:[encabezado, ...filas] } */
function doGet(e) {
  try {
    var sh = hoja_();
    var data = sh.getDataRange().getValues();
    var tipo = (e && e.parameter && e.parameter.tipo) ? String(e.parameter.tipo) : '';

    if (tipo && data.length > 1) {
      var cab = data[0];
      var filas = data.slice(1).filter(function (r) {
        return String(r[1]) !== '' && String(r[2]).trim() === tipo;
      });
      data = [cab].concat(filas);
    }
    return json_({ success: true, data: data });
  } catch (err) {
    return json_({ success: false, error: String(err) });
  }
}

/** POST con el presupuesto en JSON -> lo agrega al final, o actualiza el que ya existe. */
function doPost(e) {
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(30000);
  } catch (err) {
    return json_({ success: false, error: 'La planilla estaba ocupada, probá de nuevo.' });
  }

  try {
    if (!e || !e.postData || !e.postData.contents) throw new Error('Llegó un pedido vacío.');
    var d = JSON.parse(e.postData.contents);

    var num = String(d.num == null ? '' : d.num).trim();
    if (!num) throw new Error('Falta el N° de presupuesto.');
    var tipo = String(d.tipo || 'Electricista').trim();

    var sh = hoja_();
    var fila = [
      new Date(),
      num,
      tipo,
      d.date || '',
      d.client || '',
      d.addr || '',
      d.contact || '',
      d.fiscal || '',
      d.notes || '',
      d.discount || 0,
      Number(d.total) || 0,
      d.validez || '',
      d.moneda || 'ARS',
      JSON.stringify(d.items || [])
    ];

    // ¿Ya existe ese N° para ese tipo? Miramos las columnas Num y Tipo (B y C).
    var destino = 0;
    var ultima = sh.getLastRow();
    if (ultima > 1) {
      var claves = sh.getRange(2, 2, ultima - 1, 2).getValues();
      for (var i = 0; i < claves.length; i++) {
        if (String(claves[i][0]).trim() === num && String(claves[i][1]).trim() === tipo) {
          destino = i + 2;  // +2 = saltear el encabezado y pasar a base 1
          break;
        }
      }
    }

    var accion;
    if (destino) {
      sh.getRange(destino, 1, 1, fila.length).setValues([fila]);
      accion = 'actualizado';
    } else {
      sh.appendRow(fila);            // siempre al final: nunca pisa una fila anterior
      destino = sh.getLastRow();
      accion = 'agregado';
    }

    SpreadsheetApp.flush();
    return json_({
      success: true,
      num: num,
      accion: accion,
      fila: destino,
      total_registros: sh.getLastRow() - 1
    });
  } catch (err) {
    return json_({ success: false, error: String(err) });
  } finally {
    lock.releaseLock();
  }
}

/**
 * Corré esta función desde el editor (botón "Ejecutar") ANTES de publicar,
 * para confirmar que encuentra la hoja correcta. El resultado sale en "Registro de ejecución".
 */
function probar() {
  var sh = hoja_();
  var n = Math.max(0, sh.getLastRow() - 1);
  Logger.log('Planilla: %s', planilla_().getName());
  Logger.log('Hoja: %s', sh.getName());
  Logger.log('Presupuestos guardados hoy: %s', n);
  if (n > 0) {
    var nums = sh.getRange(2, 2, n, 1).getValues().map(function (r) { return r[0]; });
    Logger.log('N° presentes: %s', nums.join(', '));
  }
}
