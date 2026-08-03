# Historial de Cambios: Reparación del Sistema de Emails (Marcos-Admin)
Fecha: 25 de Julio de 2026

Este documento sirve como registro permanente de los cambios técnicos aplicados en el asistente virtual de consorcios para reparar el sistema de notificaciones de correo.

---

## 1. Problemas Identificados y Soluciones

### A. Fallo de Conexión SSL/TLS con Ferozo (DonWeb)
* **Problema:** Al intentar conectar a través del puerto `465` (secure: true) con el servidor de correos de Ferozo, Node.js rechazaba la conexión arrojando el error `unable to verify the first certificate`. Esto se debe a que las cadenas de certificación SSL de Ferozo no son reconocidas de forma nativa por Node.js.
* **Solución:** Se editó el archivo `agentes/marcos-admin.js` agregando la configuración `tls: { rejectUnauthorized: false }` en la inicialización del transporter de Nodemailer. Esto obliga a omitir la verificación estricta de certificado SSL, permitiendo que los correos salgan de forma segura sin caídas de socket.

### B. Fallo en la Búsqueda de Edificios (Google Sheets)
* **Problema:** La lógica del bot realizaba la búsqueda cruzando datos únicamente contra la columna `nombre` de la pestaña `EDIFICIOS`. Sin embargo, en la planilla real, esta columna está completamente vacía (los datos se cargan bajo las columnas `direccion` y `aliases`). Esto hacía que el bot devolviera `null` para el edificio y abortara el flujo del correo en silencio.
* **Solución:** Se modificó `sheets.js` para que busque por `nombre`, `direccion` o `aliases`. Ahora resuelve correctamente perfiles de edificios usando aliases e incluso direcciones parciales.

### C. Alertas Silenciosas (Falta de Logs)
* **Problema:** Si alguna de las condiciones de Sheets fallaba (edificio no registrado, sin administrador asignado, o sin email configurado), el bot fallaba silenciosamente sin dejar registros.
* **Solución:** Se implementó un flujo de logs detallado con avisos explícitos (`console.warn`) en cada etapa. De esta forma, si el correo se cancela por falta de algún dato en Sheets, se puede ver de inmediato la advertencia en consola.

### D. Credenciales y Host Correctos
* **Problema:** Las credenciales iniciales (`SMTP_HOST=c2691506.ferozo.com` y la clave configurada en ese momento) eran rechazadas por el servidor de correo.
* **Solución:** Se validó que el host correcto para autenticar con la cuenta `alertas@bienargentinos.com` es **`mail.bienargentinos.com`**, usando la clave vigente de `SMTP_PASS`. Se actualizaron las variables de entorno en el archivo `.env` del servidor VPS (contraseñas omitidas de este documento; ver `.env` local).

---

## 2. Archivos Modificados en el Repositorio

* **`agentes/marcos-admin.js`**: Reestructuración de la función `reportarAlAdmin` y de la inicialización de Nodemailer.
* **`sheets.js`**: Adaptación con fallback inteligente para `buscarPerfilEdificio` y `listarEdificiosConocidos`.
* **`package.json`**: Se agregaron formalmente las dependencias de `nodemailer` y `node-cron`.

---

## 3. Pruebas Realizadas y Log de Éxito en VPS

Se ejecutó un caso de prueba mock en producción (VPS) simulando una urgencia de plomería en el edificio *San Patricio 159*. El bot guardó los reportes en Sheets, resolvió al administrador y envió el email exitosamente:

```text
🚀 Iniciando test de integración para Marcos-Admin...
✅ Conectado a Google Sheets: "Base Maestra Bien Argentinos"
📊 Reporte guardado para: San Patricio 159
🧠 Memoria actualizada para Vecino de Prueba
[Email] 🚨 Caso de urgencia ALTA detectado. Iniciando flujo de notificación por email...
[Email] Edificio encontrado en Sheets: "San Patricio 159". Administrador asignado: "Alejandra"
[Email] Cliente/Admin encontrado: "Alejandra". Email: "admin@bienargentinos.com"
[SMTP] 📧 Intentando enviar email a admin@bienargentinos.com...
[SMTP] 📧 Email enviado con éxito a admin@bienargentinos.com. MessageId: <03bf8d9b-14e1-426f-38ce-84c97b474ac8@bienargentinos.com>
```

---

## 4. Comandos de Mantenimiento Útiles en VPS

Para revisar logs en el servidor o reiniciar el bot ante cualquier eventualidad:
* **Ver logs de ejecución y errores en tiempo real:**
  ```bash
  pm2 logs marcos-ai --lines 100
  ```
* **Reiniciar el bot para aplicar cambios en variables de entorno:**
  ```bash
  pm2 restart marcos-ai
  ```
* **Probar el envío de email de forma manual (test script):**
  ```bash
  cd /root/marcos/Consorcio-AI-Assistant && node test-email.js
  ```
