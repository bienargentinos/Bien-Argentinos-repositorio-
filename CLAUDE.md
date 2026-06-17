# Bien Argentinos — Marcos IA

## Accesos VPS (DonWeb)

```
ssh -p5436 root@200.58.102.182
```

- Proyecto en: `/root/marcos/Consorcio-AI-Assistant/`
- Process manager: PM2 → `pm2 list` / `pm2 restart marcos-ia` / `pm2 logs marcos-ia`
- Nginx + SSL en: `marcos.bienargentinos.com`
- Dashboard admin: `https://marcos.bienargentinos.com/admin`
  - Usuario dueño: `admin` / `marcos2024` (o env `DASHBOARD_USER` / `DASHBOARD_PASS`)

## Repositorio GitHub

- Repo: `bienargentinos/bien-argentinos-repositorio-`
- Branch de desarrollo: `claude/ecstatic-hamilton-d1564x`
- Para transferir archivos al VPS:
  ```bash
  curl -o /root/marcos/Consorcio-AI-Assistant/dashboard.js \
    https://raw.githubusercontent.com/bienargentinos/bien-argentinos-repositorio-/main/dashboard.js
  pm2 restart marcos-ia
  ```
  > El repo debe estar público para que curl funcione. Ponerlo privado después.

## Stack técnico

- **Runtime**: Node.js + Express — `index.js` es el servidor principal
- **IA**: Google Gemini 2.5 Flash (multi-agente: marcos-caso, marcos-cara, marcos-ops, marcos-docs, marcos-admin)
- **WhatsApp**: Meta WhatsApp Cloud API → webhook en `/webhook`
- **Llamadas**: Vapi → endpoints `/vapi` y `/vapi/llamada-finalizada`
- **Voz TTS**: ElevenLabs (solo primeros 2 audios por sesión, luego texto)
- **Base de datos**: Google Sheets via `googleapis` + service account
- **Dashboard**: `dashboard.js` montado en `/admin`

## Google Sheets

- Sheet ID: `1jG6-CuNnk5HH2PmdvKdHwOExmxE6RQ-Cb_BdpLQy0vI`
- Credenciales: `gen-lang-client-0735429936-bba6999e5e60.json`
- Tabs usadas:
  - `Eventos`: fecha, vecino, edificio, problema, urgencia, notas_ia
  - `Edificios`: edificio, tipo, notas_especiales, admin_nombre, admin_telefono, aliases
  - `Archivos`: fecha, proveedor, monto, concepto, edificio, url_archivo
  - `Sugerencias`: (se crea sola) fecha, usuario, edificio, texto, estado, respuesta
  - `Solicitudes`: (se crea sola) fecha, usuario, edificio, campo, valor_actual, valor_nuevo, estado, motivo_rechazo

## Roles del dashboard

- **Dueño** (Daniel): ve todo — Resumen, Eventos, Facturas, Edificios, Solicitudes
- **Admin consorcio** (cliente): ve solo su edificio — Resumen, Mi Edificio, Eventos, Facturas, Sugerencias
  - Configurar en `.env`:
    ```
    CONSORCIO_USERS={"usuario1":"contraseña:Nombre Edificio A","usuario2":"contraseña:Edificio B,Edificio C"}
    ```

## Regla de oro

**Los vecinos NO deben saber que Marcos es IA.** Marcos se comporta como humano, usa expresiones argentinas, rechaza preguntas sobre si es robot de forma natural.

## Pendientes

- [ ] Aplicar últimos cambios del dashboard en VPS (curl + pm2 restart)
- [ ] Crear primer usuario cliente en `.env` con `CONSORCIO_USERS`
- [ ] Verificar que los eventos aparecen en el dashboard (fix de columnas)
- [ ] Twilio + chip Movistar: agregar `VAPI_API_KEY`, `TWILIO_*` al `.env`
- [ ] Test end-to-end WhatsApp + llamadas
