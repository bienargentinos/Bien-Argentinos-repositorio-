# Antes de tocar una línea de este repo

Esto es para **cualquier** agente que llegue a este proyecto: Claude, Antigravity, Gemini, ChatGPT,
Copilot, el que sea. Son pocas reglas y todas nacieron de algo que ya salió mal.

Si venís de otra conversación —de Edifica, del portero, de lo que sea— y te pidieron un cambio acá,
**estas reglas te aplican igual**. Quien te lo pidió probablemente no sabía que existían.

---

## 1. GitHub es la única fuente de verdad

El VPS se actualiza **solo** con `git pull` + `pm2 restart marcos-ai`. Un archivo editado a mano en
el servidor desaparece en el próximo despliegue y nadie se entera de por qué.

Un cambio que está solo en el disco de una PC **no existe**: no llega al servidor, no lo ve el otro
agente, y se pierde si esa máquina se rompe.

## 2. Traer lo último ANTES de editar

```bash
git pull origin claude/marcos-ia-whatsapp-template-vpg8gw
```

Trabajar sobre una copia vieja y empujarla **pisa** lo que otro hizo mientras tanto. Ya pasó: una
edición hecha sobre una copia de ayer habría deshecho un merge del día, sin que ninguna prueba lo
notara, porque el archivo era válido — solo estaba atrasado.

Si no sabés si tu copia está al día:

```bash
git log --oneline -1
```

## 3. Antes de subir, esto tiene que dar verde

```bash
node verificar-antes-de-subir.js
```

Corre **sin credenciales**: no necesita `.env`, ni Google, ni PostgreSQL. Si sale rojo, no subas —
el mensaje dice qué prueba falló y por qué. Cada prueba existe porque ese error ya ocurrió en
producción, con una persona real del otro lado.

## 4. Cada archivo tiene dueño

| Archivo | De quién |
|---|---|
| `dashboard.js` (el panel) | Antigravity |
| `index.js`, `datos*.js`, `sheets.js`, `agentes/`, portería, portal del vecino | Claude |

**Si necesitás un cambio del lado del otro, se pide, no se hace.** Dos agentes editando el mismo
archivo el mismo día es como se pierde trabajo. Se pide en `docs/de-antigravity.md` (lo escribe
Antigravity) o en `docs/para-antigravity.md` (lo escribe Claude).

## 5. Llamar a lo que existe, no reimplementarlo

Es el error más caro de este proyecto. `buscarPerfilEdificio` quedó escrita dos veces —en
`sheets.js` y en `datos-pg.js`— y arreglar una copia **no cambió nada en producción**, porque el
motor leía la otra.

Lo mismo con las listas de datos. Si vas a mostrar rubros de proveedor, salen de `rubros.js`
(`RUBROS_CATALOGO`); no se escriben a mano. Había dos listas y el panel ofrecía nueve rubros donde
el motor distinguía catorce: cargar un trabajo de CCTV obligaba a elegir "Otro", y ahí se pierde
justo lo que el rubro existe para dar.

## 6. Ninguna credencial en un archivo, en un comando ni en un mensaje

Un comando con la contraseña adentro queda en el historial de la terminal **y en el log del agente
que lo corrió**. Así se filtró la de root. Borrarla del archivo no la borra del historial de git ni
de los logs: lo único que invalida una credencial expuesta es cambiarla.

La clave SSH se pasa por **ruta**, nunca por contenido, y lo que se comparte es la pública (`.pub`).

## 7. Si algo se hace, verificar que haya quedado hecho

El patrón que más veces mordió acá: hacer algo, no mirar el resultado, y seguir como si hubiera
salido bien.

- `addRow` **descarta en silencio** lo que no entra en las columnas de la hoja.
- Meta contesta 200 al **recibir** el pedido, no al entregar el mensaje.
- `const { x } = require('./y')` con `y` que no exporta `x` deja `x` en `undefined` y revienta
  recién al llamarlo, casi siempre adentro de un `try` que se come el error.
- Un contador que cuenta antes de filtrar informa trabajo que no existe.

Y el corolario: **si algo falla, que lo diga.** Una salida muda es peor que un error ruidoso —
manda a buscar el problema al lugar equivocado, o hace creer que no hay ninguno.

---

Lo largo está en `CLAUDE.md`, con el caso real que originó cada regla. Vale la pena leerlo antes de
un cambio grande.
