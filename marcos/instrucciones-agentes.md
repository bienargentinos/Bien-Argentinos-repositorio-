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

## ☁️ Protocolo de Despliegue en VPS
* **Acceso VPS:** El servidor corre bajo Linux y se gestiona mediante PM2 (nombre del proceso: `marcos-ai`).
* **Verificación Pre-Despliegue:** Antes de reiniciar el servidor en producción, subí y ejecutá el script de validación local (ej. `test-email.js`) en la consola del servidor para comprobar que no existan fallos de sintaxis, dependencias faltantes ni errores en la conexión con Sheets o SMTP.
* **Reinicio de Servicios:** Tras sincronizar los archivos en el servidor, reiniciá el bot usando:
  ```bash
  pm2 restart marcos-ai
  ```
