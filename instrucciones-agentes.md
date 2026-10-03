# INSTRUCCIONES PARA AGENTES DE IA (AI INSTRUCTIONS)

Este archivo contiene reglas y directrices obligatorias para cualquier agente de IA o desarrollador que trabaje en este repositorio. Su objetivo es mantener la estabilidad del sistema y asegurar que no se deshagan mejoras previas.

---

## 📌 Regla de Oro: Historial de Cambios y Documentación
* **Ubicación:** Todos los cambios realizados en el código deben documentarse en la carpeta `documentacion/`.
* **Acción:** Si realizás modificaciones, creá un archivo de bitácora `.md` o añadilo al existente (ej. `documentacion/historial-cambios-email.md`) explicando qué cambiaste, por qué lo cambiaste y cómo probarlo.
* **PROHIBIDO:** No elimines ni sobrescribas los registros de cambios anteriores de otros desarrolladores/agentes.

---

## 🚨 Configuración Crítica del Sistema de Emails (Nodemailer)
El sistema de notificaciones por email está configurado de forma robusta en `agentes/marcos-admin.js`.
* **Bypass de SSL/TLS:** Se utiliza la propiedad `tls: { rejectUnauthorized: false }` debido a que el servidor SMTP de Ferozo utiliza certificados autofirmados. **NO remuevas este parámetro** bajo ninguna circunstancia, ya que romperá el envío de correos en producción.
* **Host y Credenciales:** El host configurado es `mail.bienargentinos.com` en el puerto `465`. Las credenciales deben administrarse únicamente a través del archivo `.env`.

---

## 📊 Configuración Crítica de Google Sheets (`sheets.js`)
* **Búsqueda con Fallback de Edificios:** La pestaña `EDIFICIOS` del Google Sheets no cuenta con datos en la columna `nombre` (están vacíos), por lo que las búsquedas se realizan comparando de forma inteligente sobre las columnas `nombre`, `direccion` y `aliases`.
* **Estabilidad de Funciones:** Cualquier modificación en las funciones de búsqueda de edificios (`buscarPerfilEdificio` o `listarEdificiosConocidos`) debe respetar este flujo de fallback para evitar que el bot de WhatsApp y llamadas devuelva perfiles nulos.

---

## 📦 Gestión de Dependencias y Paquetes
* Cada vez que se requiera instalar un paquete de Node.js (ej. `npm install`), debe realizarse guardando la dependencia en el archivo de manifiesto del proyecto:
  ```bash
  npm install <nombre-paquete> --save
  ```
* Esto asegura que al sincronizar los archivos con el servidor VPS, las dependencias estén reflejadas en `package.json` y se instalen al ejecutar `npm install` en el servidor.

---

## ☁️ REGLA INREFUTABLE — FLUJO DE TRABAJO CON GIT & DESPLIEGUE

1. **Directorio Único de Trabajo:**
   * A partir de ahora se trabaja **únicamente** en `C:\Users\Daniel\Downloads\Consorcio-AI-Assistant\repo-sync` (repositorio Git conectado a `bienargentinos/bien-argentinos-repositorio-`, rama `claude/marcos-ia-whatsapp-template-vpg8gw`).
   * La carpeta vieja (`Consorcio-AI-Assistant` raíz) queda solo de referencia — **PROHIBIDO** volver a editarla o usarla para desplegar.

2. **Antes de tocar cualquier archivo (OBLIGATORIO):**
   ```bash
   git pull --rebase origin claude/marcos-ia-whatsapp-template-vpg8gw
   ```
   * Si esto falla o marca conflictos: **PARAR Y AVISAR AL USUARIO**. Nunca resolver un conflicto borrando o forzando cambios sin mostrarlo primero.

3. **Ciclo de Cambios (Orden Estricto):**
   ```bash
   git add -A
   git commit -m "descripción clara del cambio"
   git pull --rebase origin claude/marcos-ia-whatsapp-template-vpg8gw
   git push origin claude/marcos-ia-whatsapp-template-vpg8gw
   ```

4. **Despliegue al VPS:**
   * Recién **después** de un `git push` exitoso (confirmado, sin errores) se despliega al VPS.
   * **PROHIBIDO TERMINANTEMENTE:** Usar `upload.js`, `scp`, `FTP` o cualquier método que copie archivos al VPS sin que ese mismo cambio ya esté pusheado a la rama de Git. Si el archivo no está en el `git log` de la rama, **NO SE SUBE AL VPS**.
   * **PROHIBIDO `git push --force`** sobre la rama compartida bajo cualquier circunstancia.

5. **Fallos de Git:**
   * Si en algún momento Git falla (PATH, autenticación, etc.), se **AVISA INMEDIATAMENTE** en vez de buscar atajos. Se resuelve el problema de Git, nunca se lo esquiva.

---

## 🗄️ BASE DE DATOS LOCAL SQLITE EN VPS & REGLAS PARA AGENTES

1. **PROHIBIDO PISAR `index.js`, `sheets.js` o `agentes/*.js` EN EL VPS**:
   * Todos los agentes (Antigravity, Claude, Dash Chat) tienen prohibido subir archivos del motor directamente por copia local en el VPS.
   * El despliegue de estos archivos se hace **únicamente vía Git (`git pull origin <rama>`)** en `/root/marcos/Consorcio-AI-Assistant`.
   * Si se requiere subir una modificación puntual de frontend/panel, solo se actualizará `dashboard.js`.

2. **Base de Datos: PostgreSQL (`db-pg.js`) — SQLite quedó obsoleto**:
   * La base oficial es **PostgreSQL** (`marcos_db`) a través de `db-pg.js`. Incluye `pgvector` para memoria semántica.
   * `db.js` (SQLite) y `migrate-sheets-to-sql.js` **ya no se usan**. Ningún archivo del sistema vivo debe requerir `./db`. Si encontrás un `require('./db')`, es un error: va a leer una base vacía y devolver resultados en blanco sin dar ningún error visible.
   * `importar-sheets-a-pg.js` importa la planilla a PostgreSQL. Es idempotente: se puede correr las veces que haga falta. `migrate-sheets-to-sql-pg.js` quedó obsoleto (adivinaba nombres de pestañas y por eso importaba mal).
   * `diagnostico-sheets.js` y `reparar-datos-pg.js` son de apoyo, ambos con modo `--simular`.

3. **Retardo de Acumulación (25 Segundos)**:
   * Marcos IA debe respetar obligatoriamente la ventana de acumulación de **25 segundos** (`25000 ms`) para ráfagas de mensajes de WhatsApp.


---

## 🤝 REPARTO DE TERRITORIO ENTRE AGENTES (CONTRATO DE TRABAJO EN EQUIPO)

En este proyecto trabajan tres agentes en paralelo sobre la misma rama. **Cada archivo tiene un
solo dueño.** Si necesitás un cambio en un archivo que no es tuyo, **pedíselo a Daniel** para que
lo derive — no lo edites por tu cuenta.

| Archivo / recurso | Dueño | Los demás |
|---|---|---|
| `index.js`, `agentes/*.js`, `sheets.js`, `datos.js`, `db-pg.js` | **Claude** (motor) | solo lectura |
| `dashboard.js`, `design/` | **Antigravity / Dash** (panel) | solo lectura |
| Google Sheets "Base Maestra Bien Argentinos" (contenido) | **Gemini** (datos) | solo lectura |
| `instrucciones-agentes.md`, `REGLAS_INMUTABLES_MARCOS.md`, `CLAUDE.md` | compartido | avisar antes de cambiar |

### Excepción explícita dentro de `dashboard.js`
Los endpoints `/api/mensajes` y `/api/busqueda-global` deben requerir **`./db-pg`** (PostgreSQL) y
usar `await`. **No los cambies a `./db`**: el motor no escribe en SQLite, así que el visor de chat
quedaría vacío para siempre sin dar ningún error.

### Reglas para quien toca la planilla de Google Sheets
* El código busca las columnas **por el nombre exacto del encabezado**. **PROHIBIDO** renombrar,
  traducir, cambiar mayúsculas/acentos o reordenar columnas existentes. Agregar columnas nuevas al
  final es seguro.
* **PROHIBIDO** repetir un nombre de encabezado dentro de una misma pestaña: la librería se niega a
  leer la pestaña entera y el dato desaparece del sistema sin aviso.
* **PROHIBIDO** "corregir" nombres de edificios, alias, direcciones o nombres de personas, aunque
  parezcan mal escritos. Esos datos los carga el administrador de consorcio, y el sistema los usa
  como clave para decidir a qué edificio pertenece un mensaje: un alias "arreglado" deja de
  coincidir con lo que el vecino escribe y Marcos pierde el edificio. Si algo parece un error de
  tipeo, avisale a Daniel en vez de cambiarlo.
* Los nombres de las pestañas también son parte del contrato: `VECINOS`, `EVENTOS`, `EDIFICIOS`,
  `CLIENTES`, `proveedores`, `proveedor_asignaciones`, `memoria`, `facturas`, `tecnicos`,
  `personal`, `consejo`, `solicitudes`, `suscripciones_planes`.

### Etapa actual de la migración a PostgreSQL
1. ✅ Esquema alineado con la planilla real e import idempotente.
2. ✅ **Escritura duplicada** (`datos.js`): la escritura va a Sheets y una copia a PostgreSQL.
3. ✅ **Lecturas desde PostgreSQL**, con Sheets como respaldo automático.
4. ⏳ **Pendiente**: apagar Sheets, cuando `verificar-migracion.js` no reporte diferencias.

**Cómo leer y escribir datos desde ahora:** siempre a través de `datos.js`. Nunca importes
`sheets.js` ni `datos-pg.js` directamente desde el motor. `datos.js` decide de dónde leer y se
encarga de que la escritura llegue a las dos bases.

**Si agregás una función que ESCRIBE**, tiene que quedar envuelta en `datos.js` para que también
copie a PostgreSQL. Una escritura que solo va a Sheets se pierde cuando apaguemos Sheets, y el
síntoma va a ser "el dato estaba y desapareció".

**Palanca de emergencia:** `LECTURA_PG=off` en el `.env` hace que todo vuelva a salir de Sheets,
sin tocar código ni desplegar nada.

> Hasta terminar el punto 4, **Google Sheets sigue siendo la fuente de verdad**. No borres datos de
> la planilla ni la des por reemplazada.
