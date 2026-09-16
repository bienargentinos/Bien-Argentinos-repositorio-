/**
 * Presupuestador Electricista — backend en Google Sheets
 * Bien Argentinos · bienargentinos.com/pe/
 *
 * Reemplaza el Código.gs del proyecto publicado en:
 *   https://script.google.com/macros/s/AKfycbwsjXY6ahavwhyXafI9P8e4ZjPXWMhNV76MNgRiigRHPzgw4Ld1VybAhhBWkMFGZNk/exec
 *
 * Mantiene el diseño original: una pestaña por tipo (Electricista, Remito, ...).
 *
 * Qué cambia respecto de la versión anterior:
 *  1. Guardar dos veces el mismo N° ya no crea una fila duplicada: si el N° existe
 *     se actualiza esa fila. Antes se agregaba otra, y al abrirlo desde la lista
 *     la app cargaba siempre la MÁS VIEJA (parecía que la edición se perdía).
 *  2. Si la pestaña del tipo no existe, se crea con su encabezado. Antes tiraba
 *     error y el presupuesto se perdía sin aviso.
 *  3. Acepta validez/moneda con los dos nombres posibles: por eso esas dos
 *     columnas venían siempre vacías.
 *  4. LockService: dos guardados al mismo tiempo no se pisan.
 *  5. Los errores vuelven como JSON ({success:false, error:...}) en vez de una
 *     página HTML de error que la app no sabe leer.
 */

var SHEET_ID = '1k50q4RSGOQoBOJnGubLhjApT5dM-A_CuGjDyht_LE_Y';

var COLUMNAS = ['Timestamp', 'Num', 'Tipo', 'Fecha', 'Cliente', 'Direccion', 'Contacto',
                'Fiscal', 'Notas', 'Descuento', 'Total', 'Validez', 'Moneda', 'Items'];

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

/** Pestaña de ese tipo. Si no existe, la crea con el encabezado. */
function hoja_(tipo) {
  if (!tipo) throw new Error('Falta el tipo (ej: Electricista).');
  var ss = SpreadsheetApp.openById(SHEET_ID);
  var sh = ss.getSheetByName(tipo);
  if (!sh) {
    sh = ss.insertSheet(tipo);
    sh.appendRow(COLUMNAS);
    sh.setFrozenRows(1);
  } else if (sh.getLastRow() === 0) {
    sh.appendRow(COLUMNAS);
    sh.setFrozenRows(1);
  }
  return sh;
}

/** GET ?tipo=Electricista -> { success:true, data:[encabezado, ...filas] } */
function doGet(e) {
  try {
    var tipo = (e && e.parameter && e.parameter.tipo) ? String(e.parameter.tipo).trim() : '';
    if (!tipo) throw new Error('Falta el parámetro tipo. Ejemplo: ?tipo=Electricista');
    var sh = hoja_(tipo);
    return json_({ success: true, data: sh.getDataRange().getValues() });
  } catch (err) {
    return json_({ success: false, error: String(err && err.message ? err.message : err) });
  }
}

/** POST con el presupuesto en JSON. N° nuevo -> se agrega. N° existente -> se actualiza. */
function doPost(e) {
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(30000);
  } catch (err) {
    return json_({ success: false, error: 'La planilla estaba ocupada. Probá de nuevo.' });
  }

  try {
    if (!e || !e.postData || !e.postData.contents) throw new Error('Llegó un pedido vacío.');
    var d = JSON.parse(e.postData.contents);

    var num = String(d.num == null ? '' : d.num).trim();
    if (!num) throw new Error('Falta el N° de presupuesto.');
    var tipo = String(d.tipo || 'Electricista').trim();

    var sh = hoja_(tipo);
    var fila = [
      new Date().toLocaleString('es-AR'),
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
      d.validez || d.validity || '',
      d.moneda || d.currency || '',
      JSON.stringify(d.items || [])
    ];

    // ¿Ya existe ese N° en esta pestaña? (columna B = Num)
    var destino = 0;
    var ultima = sh.getLastRow();
    if (ultima > 1) {
      var nums = sh.getRange(2, 2, ultima - 1, 1).getValues();
      for (var i = 0; i < nums.length; i++) {
        if (String(nums[i][0]).trim() === num) { destino = i + 2; break; }
      }
    }

    var accion;
    if (destino) {
      sh.getRange(destino, 1, 1, fila.length).setValues([fila]);
      accion = 'actualizado';
    } else {
      sh.appendRow(fila);
      destino = sh.getLastRow();
      accion = 'agregado';
    }

    SpreadsheetApp.flush();
    return json_({
      success: true,
      id: num,
      num: num,
      accion: accion,
      fila: destino,
      total_registros: sh.getLastRow() - 1
    });
  } catch (err) {
    return json_({ success: false, error: String(err && err.message ? err.message : err) });
  } finally {
    lock.releaseLock();
  }
}

/**
 * Corré esta función desde el editor (▶ Ejecutar) antes de publicar.
 * El resultado sale abajo, en "Registro de ejecución".
 */
function probar() {
  var ss = SpreadsheetApp.openById(SHEET_ID);
  Logger.log('Planilla: %s', ss.getName());
  var hojas = ss.getSheets();
  for (var i = 0; i < hojas.length; i++) {
    var sh = hojas[i];
    var n = Math.max(0, sh.getLastRow() - 1);
    Logger.log('  Pestaña "%s": %s registros', sh.getName(), n);
    if (n > 0) {
      var nums = sh.getRange(2, 2, n, 1).getValues().map(function (r) { return String(r[0]).trim(); });
      Logger.log('    N°: %s', nums.join(', '));
      var vistos = {}, repetidos = [];
      nums.forEach(function (x) { if (vistos[x]) { repetidos.push(x); } vistos[x] = true; });
      Logger.log('    N° repetidos: %s', repetidos.length ? repetidos.join(', ') : 'ninguno');
    }
  }
}
