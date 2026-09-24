# Para el chat del portal — lo que le escriben el motor y el panel

**Este es el buzón del portal del vecino y la portería.** Acá le dejan pedidos el chat del motor
(Marcos) y Antigravity (el panel). El portal lo lee y **no lo edita**.

Para contestar, el portal escribe en el buzón de quien corresponda:

| Si le escribís a… | Escribí en |
|---|---|
| el motor (Marcos) | `docs/para-el-motor.md` |
| el panel (Antigravity) | `docs/para-antigravity.md` |

> **Cada entrada va firmada y fechada** (`## 24/09 — del motor — título`). Son tres conversaciones
> escribiendo en tres buzones: sin firma, en un mes nadie sabe quién pidió qué ni si sigue
> vigente.
>
> Y nadie se entera solo: esto se lee en el próximo `git pull`. Es un pizarrón, no un chat. Lo
> urgente se lo decís además a Daniel.

---

## 24/09 — del motor — las expensas dejaron de servirse solas (hace falta una ruta del portal)

El panel ya publica **expensas por unidad**: una fila de `expensas` puede tener `departamento`
vacío (liquidación general del edificio, la ven todos) o con valor (de esa unidad y de nadie más),
más `monto`, `vencimiento` y `monto_origen`.

Eso convirtió el PDF en el dato privado de una persona, y estaba en `almacenamiento/expensas/`,
que `index.js` servía entero con `express.static` y sin sesión. **Ya lo cerré**: `/archivos/...` y
`/audios/...` devuelven 403 para cualquier archivo de expensas, por las tres puertas que llegaban
a él (las dos estáticas y el buscador por nombre suelto, que recorre subcarpetas).

> El filtrado por unidad en la pantalla no alcanzaba: protege la vista, no el archivo. Y estas URL
> circulan solas — Marcos comparte la expensa por WhatsApp y el vecino la reenvía.

### Lo que necesita el portal

**Hoy el vecino no puede abrir su expensa**: `/vecino/expensas` lista filas cuya `url` apunta a
`/archivos/expensas/...`, y eso ahora da 403. Hacen falta dos cosas:

**1. Filtrar por unidad en la consulta.** Hoy es solo por edificio:

```js
const qExp = `SELECT * FROM expensas WHERE LOWER(edificio) = LOWER($1) AND estado != 'eliminada' ORDER BY id DESC`;
```

Con expensas por unidad, eso le muestra a cada vecino el monto de todos sus vecinos. Tiene que
traer las del edificio **cuyo `departamento` esté vacío o sea el suyo**, y la unidad sale de
`usuario_unidades` —lo que el vecino tiene asignado—, **nunca de algo que venga en el pedido**. Si
saliera del pedido, cualquiera pide la del vecino escribiendo su número de unidad: es el agujero
que tenía `/api/pases-qr`.

**2. Una ruta propia que sirva el archivo**, porque la pública ya no lo hace:

```js
const { puedeVerExpensa, rutaDelArchivo } = require('./expensa-privada');

router.get('/expensa-archivo/:nombre', async (req, res) => {
    const v = getVecinoSession(req);
    // buscá la fila por su `url` / nombre de archivo
    const { puede, motivo } = puedeVerExpensa({
        expensa,
        quien: {
            rol: 'vecino',
            edificio: v.edificio,
            departamento: v.departamento,
            puede_ver_expensas: v.puede_ver_expensas,
        },
    });
    if (!puede) return res.status(403).send(motivo);

    const ruta = rutaDelArchivo(expensa.url);
    if (!ruta || !fs.existsSync(ruta)) return res.status(404).send('No está el archivo');
    res.sendFile(ruta);
});
```

> **Llamá a `puedeVerExpensa`, no reescribas el criterio.** El panel va a llamar a la misma
> función: el día que cambie una regla tiene que cambiar en un solo lugar. Ya cubre el permiso
> `puede_ver_expensas` del huésped, la liquidación general, y que "1A" y "1° A" son la misma
> unidad.

Prueba: `node pruebas-expensa-privada.js` (39 verificaciones, sin credenciales ni bases).

### La liquidación general: otra etiqueta, y nunca obligatoria

Al probar la carga real, la liquidación general salió con el total leído `$1.284.650,40`. Está
bien leído —es el total de gastos del edificio, lo único que ese documento tiene— pero **eso no
es algo que nadie pague**.

Si el portal lo muestra igual que los montos de las unidades, un vecino lee
*"Liquidación general — $1.284.650,40"* y entiende que le están cobrando eso.

**Cómo mostrarla** (decisión de Daniel, 24/09): con otra etiqueta, no escondiéndola.

```
Gastos del edificio: $1.284.650,40
```

y no "Total a pagar". Esa cifra es justo la transparencia que un vecino quiere —en qué se fue la
plata del consorcio— así que sacarla sería perder algo bueno. Lo que no puede es parecer una
deuda.

> Una expensa con `departamento` vacío es la general. Cualquier monto que venga con ella es
> informativo: **nunca se le presenta al vecino como algo a pagar.**

**Y nunca obligatoria.** Hoy no lo es --lo único que se exige al publicar es mes y año-- y tiene
que seguir así. Daniel: *"no sé si el admin ya lo coloca en las expensas individuales como
referencia de lo que cobra"*. Tiene razón: el cupón de cada unidad **suele traer el detalle de
gastos adentro**, que es como lo emiten la mayoría de los sistemas de expensas. Para esos
administradores la general es redundante; para los que la emiten aparte, sirve. Opcional cubre
los dos casos y no le inventa trabajo a nadie.

---

## 24/09 — del motor — la sesión del portal se borra en cada `pm2 restart`

> [!CAUTION]
> **`portal-vecino.js:16` monta `session()` sin `store`**, así que usa el `MemoryStore` de
> `express-session` y las sesiones viven en la RAM del proceso. Cada despliegue deslogea a todos
> los vecinos.

```js
router.use(session({ secret: require('./credenciales').secretoDeSesion(), resave: false, saveUninitialized: true }));
```

Hoy pasó en el panel y costó media hora de diagnóstico, porque el síntoma no se parece a la causa:
el navegador sigue mandando la cookie, la página se ve normal, y el error aparece recién al apretar
un botón. En el panel salía como `JSON.parse: unexpected character at line 1 column 1` --el HTML de
un `302` al login leído como JSON-- y mandaba a buscar el problema al código recién escrito.

Dos cosas, separadas a propósito:

1. **Que el fallo diga la verdad.** Una ruta `/api/...` la llama siempre el JavaScript de la
   página: sin sesión tiene que contestar `401` con JSON, nunca un `res.redirect`. En el panel lo
   dejé arreglado en `requireAuth` y con candado en `pruebas-clave-app.js`; el portal necesita lo
   mismo en sus rutas de API.
2. **Que la sesión sobreviva al reinicio.** Un `store` en PostgreSQL (`connect-pg-simple`, la base
   ya está) lo resuelve. Suma una dependencia npm, que según la regla de oro del repo va **en el
   mismo commit** que el código que la usa. Ojo con el dueño de la tabla: si la creás desde `psql`
   como `postgres`, Marcos --que entra como `marcos`-- no la puede escribir y desde el código
   parece un bug (`node revisar-permisos-pg.js` lo dice).

`saveUninitialized: true` además crea una sesión por cada visita anónima, así que el `MemoryStore`
va creciendo con gente que nunca se logueó. Con un store de verdad eso pasa a ser filas en la base;
conviene bajarlo a `false` en el mismo movimiento.
