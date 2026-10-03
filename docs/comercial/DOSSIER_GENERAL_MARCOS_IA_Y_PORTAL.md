# DOSSIER GENERAL: MARCOS IA, PORTAL DEL VECINO Y PANEL DE GESTIÓN
**Base de Conocimiento Integral para Capacitación, Comercialización y Soporte**
*Fecha de consolidación: Septiembre 2026*

---

# PARTE 1: VISIÓN GENERAL Y PROPUESTA DE VALOR

### ¿Qué es el ecosistema Marcos?
Es una solución integral de inteligencia artificial y gestión diseñada exclusivamente para consorcios, administraciones de edificios y barrios cerrados. Se compone de tres pilares perfectamente conectados:
1. **Marcos IA (Motor Conversacional por WhatsApp):** Un asistente inteligente que interactúa con vecinos, encargados y proveedores de forma 100% natural, resolviendo reclamos, coordinando visitas y gestionando urgencias 24/7 sin descanso.
2. **Portal del Vecino y Portería (Edifica):** Una aplicación web moderna para residentes (propietarios, inquilinos y huéspedes temporales) donde consultan expensas protegidas, gestionan pases QR de ingreso rápido y visualizan comunicados oficiales.
3. **Panel de Control del Administrador (Dashboard):** El centro de mando donde la administración supervisa finanzas, proveedores, reclamos y accesos con auditoría en tiempo real.

### La Regla de Oro del Producto
* **Para el Vecino:** Marcos es una persona del equipo de administración. Nunca se presenta como un bot ni utiliza frases mecánicas. Se comunica con modismos argentinos, empatía y sentido común.
* **Para el Administrador:** Sabe que es una IA de última generación, lo que le garantiza tranquilidad: el sistema atiende a cualquier hora, no pierde mensajes y le filtra los reclamos duplicados.

---

# PARTE 2: MÓDULOS COMERCIALES Y SOLUCIONES OPERATIVAS

## 1. Avisos al Edificio y Comunicados Urgentes
* **Dolor operativo resuelto:** Evita el caos de los grupos tóxicos de WhatsApp y los carteles de papel pegados en el hall que nadie lee.
* **Cómo funciona:**
  - El administrador puede emitir un comunicado desde el panel web (`/admin/avisos`) o mandándole un mensaje directo a Marcos por WhatsApp (*"Marcos, avisá corte de agua hasta las 18 hs"*).
  - Marcos valida la identidad (solo acepta órdenes de administradores, encargados o consejo) y publica el aviso en el portal del edificio.
  - Cuenta con **vencimiento automático**: si el corte termina a las 18:00, a las 18:01 el aviso desaparece solo sin intervención manual.

## 2. Subida Masiva y Auditoría Inteligente de Expensas (OCR)
* **Dolor operativo resuelto:** Termina con la carga manual departamento por departamento y previene errores humanos de asignación o filtración de deudas ajenas.
* **Cómo funciona:**
  - El administrador arrastra hasta 60 comprobantes PDF juntos.
  - Una IA especializada lee cada PDF, extrayendo unidad (ej: 4° B), fecha de vencimiento y monto exacto a pagar.
  - Presenta una **Mesa de Revisión con Semáforo** (Verde = coincide con vecino; Amarillo = unidad válida sin vecino registrado aún; Gris = liquidación general; Rojo = advertencia de duplicado).
  - Al publicar, cada expensa queda blindada con seguridad de sesión: ningún vecino puede ver el cupón o saldo de otra unidad.

## 3. Coordinación de Proveedores y Cierre de Trabajos por WhatsApp
* **Dolor operativo resuelto:** Elimina las llamadas constantes de seguimiento (*"¿fuiste a revisar la pérdida de agua?"*) y la filtración de números privados de vecinos.
* **Cómo funciona:**
  - Ante un reclamo, Marcos contacta automáticamente al técnico del rubro adecuado (plomería, electricidad, gas, etc.).
  - Le remite las fotos/audios que envió el vecino y le da las instrucciones de acceso pactadas (portería o contacto autorizado).
  - Marcos **entiende lenguaje natural de cierre**: cuando el técnico escribe *"listo, ya terminé acá"*, Marcos cierra el reclamo, frena los reenvíos de fotos y registra la resolución en el panel con fecha y hora.
  - Si el técnico atiende varios casos en paralelo, Marcos pregunta en vez de adivinar cuál cerró, y jamás promete horas de llegada inventadas al vecino.

## 4. Comprensión de Contexto para Vecinos con Múltiples Propiedades
* **Dolor operativo resuelto:** Propietarios que viven en un edificio y tienen cochera, oficina o local en otro consorcio de la misma administración.
* **Cómo funciona:**
  - En lugar de exigir códigos de barra o menús numéricos fríos, Marcos analiza el texto y el historial de la conversación.
  - Si el vecino dice *"hay humedad en la oficina de San Patricio"*, Marcos asocia el reclamo a esa propiedad específica.
  - Desestima falsos positivos (entiende que *"piso 4"* es una ubicación interna y no una altura de calle). Si existe una duda genuina, consulta educadamente antes de mandar al técnico.

## 5. Número de Caso Visible y Asignación de Facturas
* **Dolor operativo resuelto:** Facturas de proveedores que llegan por WhatsApp o email sin saber a qué reparación corresponden, generando demoras en la liquidación y pagos duplicados.
* **Cómo funciona:**
  - Cada trabajo asignado por Marcos lleva su identificador único (ej: `[CASO-1005]`) visible en cada foto y mensaje.
  - Cuando el proveedor envía su factura o presupuesto, Marcos o el panel la asocian directamente al caso correspondiente sin necesidad de buscar en chats viejos.
  - Ver detalle completo en [`05-numero-de-caso-y-facturas.md`](05-numero-de-caso-y-facturas.md).

## 6. Protección Antifraude y Datos Bancarios de Proveedores (CBU / Alias)
* **Dolor operativo resuelto:** Estafas por suplantación de cuenta bancaria vía WhatsApp (BEC) y demoras por errores de tipeo en los 22 dígitos del CBU al transferir a técnicos.
* **Cómo funciona:**
  - El sistema valida matemáticamente la coherencia de los 22 dígitos (dígitos verificadores oficiales del BCRA) y la estructura del Alias bancario antes de guardar.
  - Si un técnico pide un cambio de cuenta por WhatsApp, Marcos **no** pisa el CBU actual. Guarda la solicitud como pendiente y levanta una alerta en el panel de control.
  - El administrador audita el cambio (CBU anterior vs. nuevo solicitado) y lo aprueba o rechaza con un solo clic.
  - Ver detalle completo en [`10-proteccion-antifraude-cbu-proveedores.md`](10-proteccion-antifraude-cbu-proveedores.md).

---

# PARTE 3: EL MOTOR DE MARCOS IA (ARQUITECTURA Y ROBUSTEZ)

### Respaldo Dual y Sincronización
* **PostgreSQL + Google Sheets:** Cada evento crítico (reclamos, facturas, asignaciones de proveedores) se sincroniza en ambas bases. Si un servicio externo sufre microcortes, el sistema tiene redundancia total.
* **Ventana de 24 Horas de Meta (WhatsApp Cloud API):**
  - Si un técnico responde después de 24 horas y Meta reabre la ventana de conversación, Marcos despacha automáticamente todas las fotos, videos y contactos de acceso que habían quedado en cola de espera.
  - Conservación física de medios: los archivos se resguardan en almacenamiento seguro en disco para garantizar entregas diferidas.

### Ruteo Inteligente y Memoria
* **Memoria por Vecino:** Recuerda el trato preferido, problemas anteriores y contexto de la unidad para brindar una atención personalizada.
* **Separación Estricta de Roles:** Vecinos, miembros del consejo, encargados de edificio y proveedores tienen árboles de diálogo y permisos completamente aislados.

---

# PARTE 4: EL PORTAL DEL VECINO Y CONTROL DE ACCESO (EDIFICA)

### Funcionalidades Residentes
* **Inicio con Pop-up Dinámico e Interruptor del Consorcio (Módulo 09):** Avisos de emergencia del consorcio o consejos útiles sobre el uso del edificio. Cuenta con doble interruptor: el administrador puede desactivarlo para todo el edificio desde `/admin/mi-edificio`, y cada vecino puede apagarlo individualmente desde su perfil. Ver [`09-avisos-en-el-portal-y-popup.md`](09-avisos-en-el-portal-y-popup.md).
* **Expensas en el Celular (Módulo 06):** Acceso directo a expensas individuales y gastos globales del consorcio con visor seguro, sin compartir enlaces públicos desprotegidos. Ver [`06-expensas-en-el-celular-del-vecino.md`](06-expensas-en-el-celular-del-vecino.md).
* **Multi-idioma Nativo (Módulo 07):** Disponible en 4 idiomas (Español, Inglés, Portugués y Francés) con traducción estructural de términos de consorcio, ideal para residentes internacionales y turistas de alquiler temporal. Ver [`07-portal-en-cuatro-idiomas.md`](07-portal-en-cuatro-idiomas.md).
* **Pases QR de Acceso Seguro (Módulo 08):** Generación de invitaciones temporales con código QR firmado criptográficamente para visitas, deliveries o técnicos, con validación en portería sin depender de internet constante. Ver [`08-pases-qr-visitas-y-proveedores.md`](08-pases-qr-visitas-y-proveedores.md).

