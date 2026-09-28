# Pases QR para visitas, delivery y proveedores

## 1. ¿Qué problema resuelve?

La puerta de un edificio se abre, hoy, de tres maneras y las tres son malas:

- **El vecino baja.** Cada visita, cada delivery, cada vez.
- **Alguien le da la llave o el código.** Y el código no vuelve: queda en el celular de la persona
  de limpieza que dejó de venir hace ocho meses, y en el del novio de la hija.
- **El encargado abre.** Cuando está. Después de las seis de la tarde, un sábado o en enero, no
  está.

Lo que falta no es una cerradura mejor: es **saber quién entró, cuándo, y quién lo dejó entrar**.
Cuando pasa algo en un edificio —y pasa— esa es la primera pregunta, y nadie la puede contestar.

Con el portal, **el vecino le hace un pase a su visita desde el celular**, con la hora que él
elige. La visita llega, muestra el código, y entra. Queda registrado quién lo autorizó.

## 2. ¿Cómo funciona en la práctica?

**El vecino** (desde su teléfono, antes de que llegue la visita):

1. Entra a **Portería** y toca crear un pase.
2. Pone el nombre de quien viene y el motivo: una visita, un delivery, un flete, el gasista.
3. Elige **hasta cuándo vale**: un rato, el día, o —para quien viene siempre, como la persona de
   limpieza— **días fijos de la semana en una franja horaria** (con un tope estricto de seguridad de
   hasta 365 días; ningún pase puede ser eterno ni indefinido).
4. Le manda el código a la persona por WhatsApp.

**La visita**: llega, muestra el código en la entrada y entra. No hay que llamar a nadie.

**El vecino, después**: ve sus pases emitidos y puede **revocar** cualquiera **en el momento**. El
código deja de funcionar ahí mismo, sin cambiar cerraduras ni avisarle a nadie.

**Un detalle que parece técnico y es del edificio:** un pase solo se puede emitir **para un
edificio que existe y para la unidad del vecino que lo emite**. Un pase escrito con el nombre del
edificio mal no abre nada — y lo que el vecino ve entonces es "el QR no anda", sin entender por
qué. Por eso se verifica al emitirlo y no en la puerta, con la persona parada afuera.

### El código se genera en nuestro servidor, no en el de un tercero

Hasta septiembre de 2026 la imagen del código QR se le pedía a un servicio gratuito de internet, y
el código de ingreso viajaba dentro de esa dirección web. Dicho sin vueltas: **el código que abre la
puerta del edificio pasaba por el registro de accesos de otra empresa**, sobre la que nosotros no
tenemos ningún control ni visibilidad.

Hoy el código se dibuja dentro del mismo servidor que lo emitió. No sale ningún pedido a internet
para mostrarlo. Dos consecuencias concretas para el consorcio:

1. **El código de ingreso no se comparte con nadie más.** Ni con nosotros mismos más de lo
   necesario: en el portal del vecino la imagen se pide por el número interno del pase, así que el
   código de ingreso no aparece en ninguna dirección web.
2. **El pase se ve aunque internet ande mal.** Antes, si ese servicio de afuera estaba caído o
   bloqueado, el vecino abría su pase y veía un cuadro roto — el pase era válido y no había forma
   de mostrarlo.

### Cada ingreso queda con el nombre de quien lo autorizó

Es la primera pregunta cuando algo pasa en un edificio: *¿quién lo dejó entrar?* Con llaves
repartidas y códigos que se pasan de boca en boca, esa pregunta no tiene respuesta.

Acá cada pase queda firmado con el nombre y la unidad del vecino que lo emitió, y cuando el visitante
llega y usa el código, **esa firma se copia al registro de ingresos junto con la fecha, la hora y la
foto de seguridad**. El registro guarda también los intentos **rechazados**: un código revocado que
alguien sigue intentando usar queda anotado, con el nombre de quien lo había emitido.

Dos detalles que hacen la diferencia cuando el dato tiene que servir para algo serio:

- **La firma se copia, no se consulta después.** Si más adelante el pase se elimina o el vecino
  cambia de nombre, el registro del ingreso sigue diciendo lo que decía el día que pasó.
- **Cuando no se sabe, lo dice.** Un ingreso del que no consta quién lo autorizó aparece justamente
  así, en lugar de mostrar un nombre aproximado. El administrador necesita saber que de ese ingreso
  no hay a quién reclamarle.

**Y el vecino lo ve en su propio pase.** No está escondido: cuando abre el código para compartirlo,
lee que queda autorizado a su nombre. Eso, por sí solo, cambia con qué ligereza se reparte un acceso.

## 3. Argumentos comerciales

- **El vecino deja de bajar.** Es el beneficio que se entiende sin explicación, y es el que hace
  que lo usen. Todo lo demás viene después.
- **El acceso se apaga.** Un código que se le dio a alguien que ya no viene se revoca de un toque.
  Con una llave o una clave fija, eso es un cerrajero o un cambio de código para todo el edificio.
- **Queda escrito quién autorizó cada ingreso.** Para el administrador esto es lo más importante
  de todo: cuando el consorcio pregunta, hay una respuesta.
- **El horario del encargado deja de ser el horario del edificio.** Un flete un sábado a la mañana
  no depende de que alguien esté.
- **Sirve igual para el proveedor.** El técnico que viene a arreglar la bomba entra con su pase,
  en la franja en que lo esperan, sin que el encargado tenga que quedarse.
- **No hay que instalar nada en el celular de la visita.** Se le manda un código y listo.

**El dato de ingreso no se le presta a nadie.** El código que abre la puerta se genera y se muestra
desde el mismo servidor del sistema. Es una pregunta que un administrador con edificios de categoría
hace temprano, y la respuesta corta es que no viaja a ningún proveedor externo para dibujarse.

**Responsabilidad con nombre y apellido.** Cada ingreso queda asociado al vecino que lo autorizó, con
fecha y hora. Es lo que un consorcio no puede reconstruir hoy con llaves y códigos compartidos, y es
la diferencia entre "entró alguien" y "lo autorizó tal unidad, tal día, a tal hora".

## 4. Guion base para video / reel / publicidad

> **Título en pantalla:** Dejá de bajar a abrir.
>
> *(0-5s — alguien en pijama bajando una escalera, de noche)*
> **Voz:** Llega el delivery. Bajás. Llega la visita. Bajás.
>
> *(5-10s — un llavero viejo, una mano anotando un código en un papel)*
> **Voz:** ¿La alternativa? Darle la llave o el código. Y el código no vuelve más.
>
> *(10-17s — el celular: nombre, motivo, hasta cuándo vale, el código armándose)*
> **Voz:** Con Bien Argentinos le hacés un pase desde el teléfono. Quién viene, para qué, y hasta
> qué hora vale.
>
> *(17-23s — la visita mostrando el código en la entrada y entrando)*
> **Voz:** Llega, muestra el código y entra.
>
> *(23-28s — la lista de pases, el dedo revocando uno)*
> **Voz:** Y cuando ya no querés que entre más, lo revocás. En el momento.
>
> *(28-32s — logo)*
> **Cierre:** Bien Argentinos. Queda escrito quién entró y quién lo dejó entrar.

**Copy corto, para pie de imagen:**

> Le hacés un pase a tu visita desde el celular, con la hora que vos elijas. Llega, muestra el
> código y entra. ¿Ya no querés que entre más? Lo revocás de un toque. Y queda registrado quién
> autorizó cada ingreso — que es la primera pregunta cuando pasa algo.

## Lo que todavía no hace

- **No reemplaza la cerradura del edificio.** Es un permiso de ingreso registrado, y funciona con
  el equipamiento de entrada que el consorcio tenga instalado.
- **El registro de ingresos todavía no tiene una pantalla de consulta para el administrador.** Se
  guarda; falta la vista para mirarlo cómodo. **No prometer "el informe de accesos" todavía.**
- **La seguridad de la identidad del vecino está a medias, y hay que saberlo.** Hoy el pase se
  emite desde la sesión del portal. La autenticación fuerte de cada vecino —con contraseña propia
  y activación por correo— es la tarea que está en curso. Hasta que esté, esto se ofrece como
  comodidad y trazabilidad, **no como control de seguridad de un edificio con riesgo**.
- **Con la base de datos caída, un ingreso se valida por el código firmado pero no queda registrado.**
  Es el caso de un corte, y está identificado. Mientras no se resuelva, **no decir que queda registro
  de absolutamente todos los ingresos**.
- **El prototipo del timbre es un laboratorio abierto.** No es parte de lo que se vende todavía.
