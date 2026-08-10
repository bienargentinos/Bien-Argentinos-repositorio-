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
