# Cómo retomar el Panel (Antigravity) en un chat nuevo

> **Para qué es este archivo:** Cuando una conversación se vuelve extensa, abrir un chat nuevo ahorra contexto y mantiene la agilidad. Este archivo resume con precisión milimétrica el estado actual del panel, el despliegue en VPS, las credenciales/accesos y los compromisos asumidos, para que una nueva sesión de Antigravity pueda continuar inmediatamente sin perder nada de información.
>
> **No es un buzón:** Los pedidos entre agentes se comunican a través de `docs/para-antigravity.md` y `docs/para-el-portal.md`.

---

## 1. La frase para iniciar el chat nuevo

Copiá y pegá esto en el primer mensaje del chat nuevo con Antigravity:

```
Sos el agente Antigravity para Marcos IA y el Panel Dash. Leé docs/retomar-antigravity.md, docs/para-antigravity.md y docs/para-el-portal.md, y continuá la labor desde ahí.
```

---

## 2. Reglas y Directivas que no se negocian

| Regla | Detalle |
|---|---|
| **Cero cambios manuales en el VPS** | GitHub es la única fuente de verdad. El VPS se actualiza exclusivamente mediante `git pull origin claude/marcos-ia-whatsapp-template-vpg8gw` y `pm2 restart marcos-ai`. Nunca editar archivos a mano en producción. |
| **Suite de pruebas obligatoria** | Antes de commitear y antes/después de desplegar, correr siempre `node verificar-antes-de-subir.js` (79 pruebas). Debe estar 100% en verde. |
| **Propiedad del código** | Antigravity es dueño de `dashboard.js`, vistas `/admin/...`, endpoints de administración y la carpeta `docs/comercial/`. El motor de Marcos (`index.js`, WhatsApp, agentes) y el portal del vecino (`portal-vecino.js`, `porteria.js`) son territorio de Claude. |
| **Documentación Comercial Obligatoria** | Directiva de Daniel: cada mejora, módulo o arreglo debe registrarse en `docs/comercial/` con 4 secciones obligatorias: 1. ¿Qué problema resuelve?, 2. ¿Cómo funciona en la práctica?, 3. Argumentos comerciales, 4. Guion para video/reel, más la sección de honestidad técnica: **"Lo que todavía no hace"**. |
| **Seguridad de credenciales** | Nunca exponer tokens, secretos ni la clave privada SSH en logs, archivos ni mensajes. |

---

## 3. Estado actual del proyecto y producción (28/09)

- **Commit activo en producción y ramas:** `66567af`
- **Rama de trabajo local:** `antigravity/panel-fase-1`
- **Rama remota desplegada en VPS:** `claude/marcos-ia-whatsapp-template-vpg8gw`
- **VPS SSH Access:**
  - Host: `200.58.102.182`
  - Puerto: `5436`
  - Usuario: `root`
  - Llave SSH: `$env:USERPROFILE\.ssh\marcos_vps`
  - Directorio en VPS: `/root/marcos/Consorcio-AI-Assistant`
- **Estado de PM2:**
  - Servicio `marcos-ai`: online (PID 826735), uptime estable, 0 errores en logs.
- **Suite de pruebas:**
  - `node verificar-antes-de-subir.js`: **79 de 79 pruebas en verde**.

---

## 4. Últimos hitos completados y verificados

1. **Aislamiento del esquema PostgreSQL (`correrSentencias`):**
   - Claude corrigió `initPgSchema` en `db-pg.js` para ejecutar sentencias de a una evitando rollbacks silenciosos de node-postgres.
   - En el VPS se corrió `pm2 logs marcos-ai --lines 120 --nostream | grep -E "ESQUEMA A MEDIAS|❌ \[esquema"` y arrojó **0 errores**. El esquema arrancó con pgvector 100% inicializado.
2. **Pases QR y pantalla de visitas:**
   - La tabla `pases_qr` existe en producción con 19 columnas.
   - El endpoint `GET /vecino/api/pases-qr` responde `200 OK` con `{"ok":true,"pases":[]}` (ya no da 500 ni se congela en "Cargando pases...").
   - Se aplicó el tope máximo de seguridad de hasta 365 días en `crearPaseQR` para pases recurrentes.
3. **Persistencia de idioma:**
   - Arreglado en `portal-vecino.js` guardando en `req.session.idioma` para soportar sesiones demo y producción.
4. **Sesiones de Postgres aisladas (`sesiones_panel` y `sesiones_portal`):**
   - Ambas tablas existen y operan en la base real.
   - `dashboard.js` tiene `createTableIfMissing: false` y llama a `asegurarTablasDeSesion().catch(() => {})`.
   - `pruebas-sesiones-pg.js` ejecutado en VPS arrojó `✅ Todo bien`.
5. **Pop-up por edificio:**
   - Conmutador implementado en `dashboard.js` (`POST /admin/api/edificio-popup`) para activar/desactivar el pop-up de inicio por edificio en `/admin/mi-edificio`.
6. **Buzón sincronizado:**
   - Informe técnico completo respondido a Claude en `docs/para-el-portal.md`.
   - Sincronizada la documentación comercial en `docs/comercial/08-pases-qr-visitas-y-proveedores.md`.

---

## 5. Próximos pasos y pendientes

- **Del lado de Claude (Portal):**
  - Migración del renderizado de QR al navegador del cliente (reemplazando la llamada a `api.qrserver.com` con `qrcodejs` para que el token de apertura de puerta no viaje a un servicio externo).
  - Interfaz visual en el portal para que el vecino elija la fecha de expiración del pase (respetando el tope de 365 días del backend).
- **Del lado de Antigravity (Panel):**
  - Monitorear pedidos de Daniel sobre vistas o mejoras en el panel de administración.
  - Asistir y desplegar cualquier nueva actualización de Claude cuando esté lista y testeada.
