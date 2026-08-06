# 📚 BASE DE CONOCIMIENTO: PANEL CONSORCIO (Dashboard de Marcos IA)

## ℹ️ INFORMACIÓN GENERAL DEL PANEL
- **Nombre:** Panel Consorcio (dashboard de administración de Marcos IA), en `/admin`.
- **Propósito:** Que el administrador de consorcio (cliente) gestione sus edificios, vea los reclamos/eventos que Marcos IA atendió por WhatsApp o llamada, cargue proveedores, facturas y expensas, y pida cambios sobre los datos del edificio.
- **Dos roles distintos:**
  - **Dueño** (Daniel, Bien Argentinos): ve y administra TODOS los clientes y edificios.
  - **Cliente / Administrador de consorcio** (la mayoría de quienes usan este asistente): ve solo su propio edificio o edificios asignados.
- **Canales de atención directa:** WhatsApp de Marcos IA (el mismo asistente que atiende a los vecinos) y este panel web.

---

## 🧭 MENÚ PRINCIPAL (lo que ve un cliente/administrador de consorcio)

### 1. Resumen
- Pantalla de inicio. Muestra novedades desde la última conexión, edificios activos, urgencias abiertas del día, y una tarjeta por cada edificio del cliente con su plan y consumo de mensajes/llamadas.
- Si el cliente tiene más de un edificio asignado, arriba en el header hay un selector desplegable para elegir cuál está viendo (afecta Resumen, Eventos y Facturas).

### 2. Mi Edificio
- Acá el cliente ve y edita los datos de SU edificio.
- **Se edita y se guarda directo, sin aprobación** (botón "Guardar cambios del edificio"): dirección, zona, alias/doble dirección, CUIT, unidades funcionales, horario del SUM, cocheras, teléfono de seguridad de la entrada, datos del encargado (nombre, teléfono, estado: activo/licencia/vacaciones, horario), y del suplente.
- **Requiere aprobación del dueño** (botón "Solicitar cambio", queda pendiente hasta que Bien Argentinos lo apruebe): el nombre del consorcio y el nombre/teléfono del administrador — son datos de identidad que no se cambian a ciegas.
- **➕ Agregar edificio: SÍ ESTÁ DISPONIBLE.** Desde "Mi Edificio" hay un botón "+ Agregar edificio" para que el propio cliente cargue un edificio nuevo a su cuenta (completa un formulario con los datos del edificio). No hace falta pedirlo por mail ni esperar a que lo cargue Bien Argentinos: el cliente lo puede dar de alta él mismo en cualquier momento.
- Si el cliente tiene varios edificios, cada uno se administra por separado eligiéndolo en el selector de arriba.

### 3. Eventos
- Historial de todos los reclamos/casos que Marcos IA atendió en el edificio (por WhatsApp con vecinos o llamada telefónica).
- Cada evento se puede abrir (clic en la fila) para ver el detalle en un panel lateral: canal, edificio, cuándo pasó, teléfono, técnico asignado, el resumen del pedido y qué hizo Marcos IA. Ahí también se puede marcar "Confirmar Resuelto".
- Se puede filtrar por urgencia/estado y descargar los audios de las notas de voz que mandó el vecino mientras estén disponibles (se borran automáticamente pasado un tiempo, el panel muestra cuántos días quedan).

### 4. Proveedores
- Flujo en dos pasos, pensado para no tener que cargar el mismo técnico una y otra vez:
  1. El cliente carga **su lista maestra de proveedores** una sola vez (electricista, plomero, gasista, cerrajero, etc., con nombre y teléfono).
  2. Después, en cada edificio, **asigna** un proveedor de esa lista con una prioridad (primera opción / segunda opción / urgencias). Así, si el cliente administra varios edificios, no tiene que recargar el mismo proveedor 27 veces.
- Marcos IA usa esta asignación para saber a quién llamar/avisar según el edificio y el tipo de problema.

### 5. Facturas / Fotos
- Repositorio de facturas y fotos que se suben asociadas a un evento o al edificio en general (por ejemplo, comprobante de un arreglo).

### 6. Expensas
- El cliente puede registrar la expensa mensual (nombre del archivo o un link) para que Marcos IA la comparta con los vecinos que la pidan por WhatsApp.
- **Estado actual:** todavía no se sube el PDF en sí dentro del panel (solo se registra el nombre/link) — está en desarrollo la carga directa del archivo.

### 7. Sugerencias
- El cliente puede mandar sugerencias o pedidos generales sobre el servicio o el panel, que le llegan a Bien Argentinos.

---

## 🔑 REGLA GENERAL: qué se puede hacer solo y qué requiere pedirlo
- **Directo (sin esperar aprobación):** casi todos los datos operativos del edificio (dirección, encargado, horarios, cocheras, unidades, etc.), agregar un edificio nuevo, cargar/asignar proveedores, registrar expensas, enviar sugerencias.
- **Con aprobación del dueño (vía "Solicitar cambio"):** nombre del consorcio y datos del administrador (nombre/teléfono) — porque son datos de identidad.
- El cliente **nunca** necesita escribir un mail para pedir estas cosas: todo se hace desde el panel. La única vía de "contacto por mail" real es para reclamos que excedan lo que el panel permite hacer directamente (ej. cambiar el nombre del consorcio), y en ese caso el camino correcto es igual "Solicitar cambio" dentro del panel, no un mail aparte.

---

## 🚧 COSAS QUE TODAVÍA NO ESTÁN DISPONIBLES (¡ojo, decir esto solo si aplica de verdad!)
Si el cliente pregunta específicamente por algo de esta lista, explicar con cortesía que está en desarrollo:
- Subir el PDF/imagen de la expensa directamente en el panel (hoy solo se registra el nombre/link).
- Ver el detalle de consumo/excedente facturable por uso (todavía no hay datos de consumo reales).
- "Ver como cliente" (impersonación) — es una función pensada para el dueño, no para el cliente.
- Recuperar contraseña por email / activación por token (el login todavía es usuario y contraseña simples).
- Un contador real de notificaciones nuevas en la campana.

**Para todo lo demás que esté descrito arriba (agregar edificio, proveedores, editar datos del edificio, ver eventos, etc.) la respuesta correcta es explicar CÓMO hacerlo desde el panel — nunca decir que "no está habilitado" o que hay que escribir un mail, salvo que sea explícitamente uno de los puntos de esta lista.**

---

## 📖 GLOSARIO DE ESTADOS DE EVENTOS/RECLAMOS
- **Pendiente / Abierto:** el caso fue recibido y todavía no se resolvió.
- **En Proceso:** hay un técnico coordinando o yendo al edificio.
- **Resuelto:** el trabajo se completó y quedó archivado.

---

## ❓ PREGUNTAS FRECUENTES (FAQs)

### ¿Cómo agrego un edificio nuevo a mi cuenta?
Desde la sección "Mi Edificio", tocá el botón "+ Agregar edificio" y completá el formulario con los datos del edificio nuevo. Queda asociado a tu cuenta al instante, no hace falta pedirlo por mail.

### Tengo más de un edificio, ¿cómo cambio de cuál estoy viendo?
Arriba, al lado del logo, hay un selector desplegable con la lista de tus edificios. Elegís uno y el Resumen, Eventos y Facturas se filtran a ese edificio hasta que vuelvas a cambiarlo.

### ¿Cómo cambio el nombre del consorcio o el administrador?
Esos dos datos requieren aprobación: desde "Mi Edificio" usá el botón "Solicitar cambio" en ese campo. El resto de los datos del edificio (dirección, encargado, horarios, etc.) se guardan directo, sin aprobación.

### ¿Cómo cargo un técnico/proveedor?
Primero lo cargás una vez en tu lista de proveedores (sección Proveedores), y después lo asignás al edificio correspondiente con una prioridad. No hace falta cargarlo de nuevo por cada edificio.

### ¿Cómo notifico una urgencia fuera de horario?
Los casos de urgencia alta se derivan automáticamente por WhatsApp a la guardia/encargado activo del edificio en cuanto Marcos IA detecta la urgencia al hablar con el vecino.

### ¿Dónde veo la conversación que tuvo Marcos con un vecino?
Entrando al detalle de un evento (clic en la fila, en la sección Eventos) vas a ver el resumen del pedido y qué hizo Marcos. La transcripción completa mensaje por mensaje todavía no se guarda para todos los casos — es una mejora en desarrollo.
