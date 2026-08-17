# 📄 HISTORIAL Y BITÁCORA DE CAMBIOS: MARCOS IA (PRODUCCIÓN)

## 📌 Registro de Cambios y Soluciones Estructurales (Agosto 2026)

---

### 1. 🔐 Seguridad y Rotación de Credenciales VPS
* **Detalle:** Se retiraron del repositorio público los scripts temporales que contenían la contraseña root hardcodeada (`check_vps_logs.js`, `check_vps_pm2.js`, `deploy_full_bot.js`).
* **Acción:** Se rotó la contraseña del servidor VPS (el valor no se registra acá) y se sincronizaron los scripts locales de automatización.
* **Archivos afectados:** `update-password-vps.js`, `check_vps.js`, `deploy-vps.js`.

---

### 2. 📱 Normalización Absoluta de Teléfonos & Acumulación (15s)
* **Problema previo:** Los números de teléfono ingresaban con formatos heterogéneos (ej: `54111550542005` vs `5491150542005`), lo que fragmentaba las claves en los Maps de RAM (`global.marcosSesiones`, `global.colasMensajes`, `global.timersFotoVecino`). Esto ocasionaba que el bot "olvidara" conversaciones o perdiera el hilo de la solicitud de fotos.
* **Solución:** Se forzó el paso de `normalizarTelefonoWhatsApp(from)` en el punto exacto de entrada del webhook de WhatsApp (`index.js`).
* **Efecto:** Todas las identidades del mismo número colapsan exactamente a la misma clave, garantizando la ráfaga de 15 segundos y la continuidad de sesión.

---

### 3. 👷 Aislamiento de Atención a Proveedores / Técnicos
* **Problema previo:** Cuando un técnico respondía a un botón de la plantilla (ej: *"Recibido / En camino"*), Marcos caía al evaluador de vecinos y le preguntaba al técnico su *"nombre y departamento"*.
* **Solución:** Se implementó una rama dedicada en `index.js` para `datosEmisor.rol === 'proveedor'`.
* **Efecto:** Marcos saluda al proveedor de forma colegiada y profesional (ej: *"Excelente Julio, ya registré que estás en camino..."*) sin pedirle datos de residente.

---

### 4. 🖼️ Reenvío Automático de Fotos/Videos al Técnico
* **Problema previo:** Al recibir la foto de la falla del vecino, el sistema no la adjuntaba al técnico y volvía a disparar la plantilla de servicio de Meta en bucle.
* **Solución:** Se conectó la promesa `esperandoDatosVecinoParaProveedor`. Apenas el vecino sube la foto o video, Marcos la retransmite inmediatamente al WhatsApp del técnico vía `enviarImagenWhatsApp` / `enviarVideoWhatsApp`.

---

### 5. 🔑 Gestión Inteligente de Accesos y Apertura
* **Problema previo:** Las plantillas mostraban un texto fijo *"Coordinar ingreso con consorcio"*.
* **Solución:** Si no hay un encargado de turno activo en la planilla `EDIFICIOS`, Marcos consulta proactivamente al vecino: *"¿Usted o alguien de su departamento estará disponible para recibir al técnico y facilitarle el acceso?"*.
* **Efecto:** La plantilla enviada al técnico indica dinámicamente: *"Coordinar ingreso directamente con el solicitante [Nombre (Depto)]"*.

---

### 🛡️ Regla de Oro Git Flow
* **Norma:** Jamás se debe desplegar en el servidor VPS sin antes hacer `git commit` y `git push` a la rama oficial de GitHub (`claude/marcos-ia-whatsapp-template-vpg8gw`). Todos los asistentes (Antigravity, Claude, etc.) deben compartir esta rama como única fuente de verdad.
