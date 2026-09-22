# Para Antigravity — lo que escribe Claude

**Este archivo lo escribe Claude. Antigravity lo lee y no lo edita.**
Para contestar está `docs/de-antigravity.md`, que es al revés.

Así ninguno de los dos pisa lo del otro y no hay conflictos de git nunca: cada uno es dueño de su
archivo. Se lee con `git pull` y se escribe con un commit normal.

> Nadie se entera solo de que hay algo nuevo. Cuando uno escribe acá, Daniel le avisa al otro
> —"pulleá y leé"— o lo ve en el próximo `git pull`. No es un chat: es un pizarrón compartido.

---

## Arranque — para trabajar sin esperar a nadie

**1. Traer lo último.** Siempre antes de empezar, y de nuevo antes de cada push: Claude está
trabajando en la misma rama.

```bash
git pull origin claude/marcos-ia-whatsapp-template-vpg8gw
```

**2. Trabajar solo en `dashboard.js`.** El reparto está más abajo. Si hace falta tocar otra cosa,
se pide en `docs/de-antigravity.md` en vez de hacerlo.

**3. Antes de cada push, esto tiene que dar verde.** Son 56 pruebas y no necesita base de datos:

```bash
node verificar-antes-de-subir.js
```

Si sale rojo, **no subir**. El mensaje dice qué prueba falló y por qué.

**4. Commitear y empujar a la misma rama.**

```bash
git push -u origin claude/marcos-ia-whatsapp-template-vpg8gw
```

**5. Dejar escrito qué se hizo** en `docs/de-antigravity.md`, con fecha. Eso es lo que lee Claude.

### Desplegar y verificar (en el VPS, no en la PC)

`revisar-sobrantes.js` y `revisar-edificios.js` necesitan el `.env` y las credenciales de Google,
que **viven en el VPS y no en la PC**. Así que la verificación de datos se hace ahí:

```bash
ssh -i ~/.ssh/marcos_vps -p5436 root@200.58.102.182
```

> Desde Windows la ruta de la clave cambia según la terminal: `$env:USERPROFILE\.ssh\marcos_vps` en
> PowerShell, `%USERPROFILE%\.ssh\marcos_vps` en CMD. Conectándose por código se pasa la **ruta**
> del archivo, nunca su contenido. **Ninguna credencial va escrita en un comando ni en un mensaje**:
> queda en el historial de la terminal y en el log del agente que lo corrió — así se filtró una vez.

Ya adentro:

```bash
cd /root/marcos/Consorcio-AI-Assistant && git pull origin claude/marcos-ia-whatsapp-template-vpg8gw
```

```bash
cd /root/marcos/Consorcio-AI-Assistant && node verificar-antes-de-subir.js
```

```bash
pm2 restart marcos-ai
```

```bash
cd /root/marcos/Consorcio-AI-Assistant && node revisar-sobrantes.js
```

```bash
cd /root/marcos/Consorcio-AI-Assistant && node revisar-edificios.js
```

Los dos últimos **solo leen**. Tienen que decir lo mismo o mejor que antes del cambio. Si aparecen
filas de más, algo se escribió en una sola de las dos bases — que es exactamente el bug que la fase
1 viene a cerrar.

**Nunca editar archivos a mano en el VPS.** Se actualiza solo con `git pull`. Un parche escrito
directo en el servidor desaparece en el próximo despliegue y nadie se entera de por qué.

---

## Estado al 22/09/2026

El panel (`dashboard.js`) queda a cargo de Antigravity. El motor (`index.js`, `datos*.js`, agentes,
portería, portal del vecino) queda a cargo de Claude. **No nos cruzamos de archivo**: si hace falta
un cambio del otro lado, se pide acá y lo hace el que corresponde.

Rama de trabajo: `claude/marcos-ia-whatsapp-template-vpg8gw`. `git pull` antes de empezar y empujar
seguido — los dos trabajamos sobre la misma rama.

---

## Pauta del panel — fase 1

El panel escribe en Google Sheets y el motor de Marcos lee PostgreSQL. Por eso hoy **una edición en
el panel es invisible para Marcos**. La fase 1 es que cuatro endpoints escriban en las dos bases,
llamando a módulos que ya existen. Nada más que eso.

### La regla que más importa

> **Llamar a lo que existe, no reimplementarlo.**

`buscarPerfilEdificio` quedó escrita dos veces —en `sheets.js` y en `datos-pg.js`— y arreglar una
copia **no cambió nada en producción**, porque el motor leía la otra. Es el error más caro del
proyecto y no se puede repetir.

### Los cuatro endpoints

| Endpoint | Qué hacer |
|---|---|
| `/api/proveedor-editar` | si cambió el nombre, llamar a `renombrarProveedor()` de `renombrar-proveedor.js` |
| `/api/edificio` | si cambió el nombre, llamar a `renombrarEdificio()` de `renombrar-edificio.js`, y devolver `r.cambios` y `r.fallidos` en la respuesta |
| `/api/aprobar-solicitud` | reemplazar su bloque de propagación inline por esa misma llamada, para que no queden dos criterios de qué se renombra |
| `/api/proveedor-asignar` | escribir la asignación también en PostgreSQL |

Un renombrado a medias parece hecho y no lo está: por eso `/api/edificio` tiene que devolver qué
cambió y qué no.

**No empezar por migrar lecturas ni por rediseñar pantallas.** Eso es fase 2 y se hace sección por
sección, verificando cada una.

### Cambio de producto: el rubro va en la asignación

Un proveedor hace **varios rubros**, y cada rubro lleva **su propia prioridad**. Daniel es
electricista `primera + urgencias` y CCTV `primera + urgencias` en el mismo edificio; hay colegas
que son gasistas y electricistas a la vez. Lo decide el administrador al asignar, no la ficha.

La tabla ya tiene esa forma: `proveedor_asignaciones` es `cliente + edificio + proveedor + rubro +
prioridad`, una fila por rubro. **No hay nada que migrar.** Falta el panel:

- El rubro se elige **al asignar**. Hoy se copia de la ficha (`rubro: m.rubro || 'Otro'`).
- El control de duplicado compara `edificio + proveedor` e **ignora el rubro**, así que la segunda
  asignación pisa la primera en vez de agregar otra fila. Tiene que incluir el rubro.
- La ficha del proveedor pasa a listar los rubros que la persona hace, separados por coma, para
  llenar el desplegable. Del lado del motor eso ya funciona: `atiendeRubro` compara por contenido.

### Lo que rompe y no se ve

Ninguna da error. Todas se ven desde afuera como que "Marcos no sabe" algo.

- **Comparar edificios: normalizado pero exacto.** Nunca `compararEdificios`, que acepta parciales:
  con eso San Patricio 159 queda asignado al cliente del 270, y un administrador ve reclamos de un
  consorcio ajeno. Van `clienteDelEdificio` y `edificiosDeCliente`.
- **Columnas nuevas en Sheets: siempre `asegurarColumnas`.** Nunca `setHeaderRow` directo. Una hoja
  de Google tiene 26 columnas y `addRow` **descarta en silencio** lo que no entra: así se perdieron
  `tecnico`, `tel_tecnico` y `rubro_tecnico` en los cuatro primeros casos reales.
- **No sacar `requireAuth` de un endpoint para que una app funcione.** Ya pasó con `/api/pases-qr`:
  quedó abierto a internet y con él se podían crear, leer y revocar pases de cualquier edificio.
- **`importar-sheets-a-pg.js`: siempre `--simular` primero.** Sincroniza `edificios` usando el
  nombre como clave. Con el nombre desfasado no actualiza la fila: **crea una segunda**.

### Cómo se sabe que la fase 1 terminó

Después de cada cambio, estos dos tienen que decir lo mismo o mejor que antes. Solo leen:

```bash
node revisar-sobrantes.js
node revisar-edificios.js
```

**Terminó cuando** se edita el nombre de un proveedor o un edificio en el panel, no se corre ningún
script a mano, y `revisar-sobrantes.js` sigue diciendo *"Las dos bases dicen lo mismo"*.

---

## Qué está haciendo Claude en paralelo

Para que no haya sorpresas al hacer `git pull`. Todo esto es del motor, ninguno toca `dashboard.js`:

- **Hecho (22/09)**: el técnico que dice "ya lo resolví" ahora cierra **su** caso — antes el cierre
  buscaba el caso por el edificio del vecino, y un proveedor no tiene ninguna de esas fuentes.
  Módulo nuevo: `caso-del-tecnico.js`.
- **Hecho (20-21/09)**: teléfono de relleno entregado como contacto de ingreso, "necesito que
  alguien esté ahí" leído como "entro solo", la hora prometida que se perdía al preguntar otra cosa,
  y el alias interno del edificio saliendo hacia el técnico.
- **Pendiente**: alertas para enterarse de una falla antes que el cliente.

Todo lo de arriba está explicado en detalle en `CLAUDE.md`, con el caso real que lo originó.
