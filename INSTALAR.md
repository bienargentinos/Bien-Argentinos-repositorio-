# Levantar Marcos en un servidor nuevo, desde cero

> **Por qué existe este archivo.** El 30/08/2026 el nodo del proveedor se cayó y el VPS estuvo
> **tres días** inaccesible, sin fecha de resolución y sin poder ni siquiera sacar un backup. No
> había forma de mover Marcos a otro lado en el momento, porque el procedimiento de instalación
> vivía en la cabeza de alguien y no escrito.
>
> **Poder mudarse rápido vale más que elegir el hosting perfecto.** Un segundo servidor prendido es
> caro y prematuro; esto es gratis y convierte "un día de trabajo" en "cuarenta minutos".

## Lo que hace falta tener a mano

| | Dónde está | Si se perdió |
|---|---|---|
| El código | GitHub, rama `claude/marcos-ia-whatsapp-template-vpg8gw` | no se pierde |
| Los datos | Google Sheets | no se pierden |
| **El `.env`** | **solo en el servidor** | hay que regenerar credencial por credencial |
| **El JSON de Google** | **solo en el servidor** | se baja de nuevo desde Google Cloud |

Antes de empezar, verificá que tu copia del `.env` sirva. **No hace falta abrirlo ni mostrarlo:**

```bash
node revisar-env.js "C:\ruta\a\tu\copia\.env"
```

Ese script imprime nombres de variables y si están o no. **Nunca imprime valores.**

## 1. Servidor

Ubuntu 24.04. Mínimo razonable: **2 GB de RAM**. Con 1 GB, Node + PostgreSQL + Nginx entran justos
y el kernel termina matando alguno.

```bash
apt update && apt upgrade -y
apt install -y git curl nginx postgresql certbot python3-certbot-nginx
curl -fsSL https://deb.nodesource.com/setup_22.x | bash - && apt install -y nodejs
npm install -g pm2
```

## 2. Código

```bash
mkdir -p /root/marcos && cd /root/marcos
git clone https://github.com/bienargentinos/Bien-Argentinos-repositorio-.git Consorcio-AI-Assistant
cd Consorcio-AI-Assistant
git checkout claude/marcos-ia-whatsapp-template-vpg8gw
npm install
```

## 3. Credenciales

```bash
cp .env.ejemplo .env
nano .env
```

Y el JSON de Google al lado de `index.js`, con el nombre que diga `GOOGLE_CREDENTIALS_FILE`.

```bash
node revisar-env.js
```

No sigas hasta que diga que están todas las imprescindibles.

## 4. Base de datos

```bash
sudo -u postgres createdb marcos_db
sudo -u postgres psql -c "ALTER USER postgres PASSWORD 'la-que-pusiste-en-DATABASE_URL';"
```

Las tablas se crean solas al arrancar (`db-pg.js`). PostgreSQL guarda las burbujas del chat del
panel: **es reconstruible, no es la fuente de verdad.** La fuente de verdad es Sheets.

## 5. Columnas de la planilla

```bash
node revisar-columnas.js
node crear-columnas.js --aplicar
```

Una hoja de Google trae 26 columnas y `EVENTOS` necesita más de treinta. Si faltan, lo que se
escriba en ellas **se pierde sin avisar** — ver la sección correspondiente en `CLAUDE.md`.

## 6. Arrancar

```bash
pm2 start index.js --name marcos-ai
pm2 save
pm2 startup
```

> El proceso se llama **`marcos-ai`**, no `marcos-ia`.

## 7. Nginx y SSL

```bash
certbot --nginx -d marcos.bienargentinos.com
```

Apuntá el DNS al servidor nuevo **antes** de correr certbot, o va a fallar la validación.

## 8. Volver a apuntar el webhook de Meta

**Este es el paso que se olvida y sin él no entra ni un mensaje.** En el panel de WhatsApp
Business, la URL del webhook tiene que apuntar al servidor nuevo:

```
https://marcos.bienargentinos.com/webhook
```

## 9. Verificar de punta a punta

```bash
pm2 logs marcos-ai --lines 40 --nostream
node revisar-columnas.js
node revisar-casos.js 5
```

Y mandale un WhatsApp de prueba. **Que el proceso esté vivo no quiere decir que Marcos conteste**:
lo único que lo demuestra es un mensaje que entra y una respuesta que sale.

---

## Después de mudarse: que no vuelva a ser una sorpresa

Dos cosas que no requieren código y valen más que cualquier otra:

**Enterarse en 5 minutos, no a los tres días.** UptimeRobot (gratis) pegándole a
`marcos.bienargentinos.com` cada 5 minutos, con aviso al mail y al celular. Con administradores
reales usándolo, la diferencia entre avisar vos a los 5 minutos y que se enteren ellos solos es
toda la credibilidad del servicio.

**Rotar los logs**, que crecen sin límite:

```bash
pm2 install pm2-logrotate
```

Y una cosa que conviene tener presente, porque no tiene solución técnica: **mientras el servidor
está caído, el webhook de Meta no contesta y los mensajes se pierden.** Meta reintenta un rato y
después los descarta. Un vecino que reporta una pérdida de gas con el servidor abajo no reportó
nada. Por eso lo que salva no es la redundancia: es enterarse rápido y avisar por teléfono.
