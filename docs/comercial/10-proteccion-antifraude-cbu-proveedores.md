# Protección Antifraude y Auditoría en Datos Bancarios de Proveedores

> **Módulo del Panel y del Motor:** Cómo el sistema valida cuentas bancarias (CBU / Alias) y protege al consorcio contra desvíos de fondos y estafas en cambios de cuenta.

---

## 1. ¿Qué problema resuelve?

En la administración de consorcios, los pagos a proveedores (ascensoristas, plomeros, electricistas, empresas de limpieza) mueven sumas considerables todos los meses. En este circuito ocurren dos problemas graves:

1. **El fraude del cambio de cuenta (Suplantación / BEC):** Alguien escribe por WhatsApp desde el teléfono del técnico o simulando ser el proveedor diciendo: *"Hola, cambié de banco, para el pago de este mes anotá este nuevo CBU"*. Si la administración actualiza el dato sin verificar, la transferencia sale a una cuenta desconocida y la plata se pierde definitivamente.
2. **Errores de tipeo en 22 dígitos:** Un CBU tiene 22 números. Un solo dígito equivocado al pasarlo de un mensaje a la planilla hace que la transferencia rebote en el banco (haciendo perder días) o termine acreditada en la cuenta de otra persona.

**Con este módulo:** La primera carga valida matemáticamente los dígitos verificadores del CBU o la estructura del Alias. Y si un proveedor ya registrado pide cambiar su cuenta bancaria por WhatsApp, **el sistema jamás pisa el dato automáticamente**: resguarda el CBU original, bloquea el cambio automático y enciende una alerta roja en el panel para que el administrador audite y apruebe o rechace la solicitud con un clic.

---

## 2. ¿Cómo funciona en la práctica?

### A. Validación algorítmica al cargar una cuenta (Panel)
- En la sección **Proveedores** del panel, al cargar o editar un CBU, el sistema corre el algoritmo oficial del Banco Central (BCRA) con sus dos dígitos verificadores.
- Si el CBU tiene un error de tipeo, el panel avisa de inmediato: *"Ese CBU no verifica (los dígitos no cierran). Revisalo o cargá el alias"*.
- Lo mismo aplica para el Alias CBU: valida extensión, puntos y caracteres permitidos.

### B. El intento de cambio por WhatsApp (Doble Cerrojo)
1. **Detección:** Si el técnico le envía a Marcos por WhatsApp un nuevo CBU o alias (*"Marcos, te paso mi nuevo CBU para las facturas"*), Marcos lo extrae y lo valida.
2. **Congelamiento de seguridad:** El sistema **no** sobrescribe el CBU vigente. Guarda el dato entrante en una casilla separada de *CBU Pendiente* con fecha y hora.
3. **Alerta en el Panel:** En la ficha del proveedor dentro del panel aparece una tarjeta de advertencia destacada:
   - Muestra el **CBU / Alias actual** vs. el **Nuevo CBU / Alias solicitado**.
   - Muestra la fecha y el teléfono desde el que se solicitó el cambio.
4. **Decisión humana con un clic:**
   - **Aprobar:** Si el administrador habló con el técnico y confirmó el cambio, presiona *"Aprobar cambio"*. El sistema traslada el nuevo CBU a cobro activo y deja registro con auditoría.
   - **Rechazar:** Si fue un intento sospechoso o un malentendido, presiona *"Rechazar"*. El pedido pendiente se descarta y el CBU histórico se mantiene intacto.

---

## 3. Argumentos comerciales (Puntos de venta)

- **Blindaje total contra estafas por WhatsApp:** El administrador duerme tranquilo sabiendo que ninguna orden de pago se redirige a cuentas bancarias no autorizadas por un simple mensaje de chat.
- **Cero transferencias rebotadas por errores de tipeo:** La validación matemática de los 22 dígitos garantiza que cada CBU registrado en el sistema existe y es apto para transferencias.
- **Trazabilidad y respaldo contable:** Queda registrado quién, cuándo y desde qué canal se pidió y aprobó cada modificación de datos de cobro.
- **Defensa del patrimonio del consorcio:** En un entorno donde las estafas virtuales crecen día a día, contar con un sistema con doble confirmación humana obligatoria es un estándar de seguridad profesional.

---

## 4. Guion base para video / reel / publicidad

> **Título en pantalla:** La estafa del CBU que le cuesta millones a los edificios.
>
> *(0-6s — mensaje de WhatsApp en primer plano: "Hola administrador, cambié de cuenta, transferime acá...")*  
> **Voz:** *"Cambié de banco, anotá mi nuevo CBU"*. Es el fraude más común en consorcios: alguien toma la línea de un técnico y se queda con el pago del trabajo.
>
> *(6-14s — pantalla del Panel de Marcos IA con tarjeta de alerta roja)*  
> **Voz:** En Marcos IA ningún cambio de cuenta bancaria se aplica solo. Si un proveedor pide cambiar su CBU por chat, el sistema congela la solicitud y le avisa al administrador en el panel.
>
> *(14-22s — cursor haciendo clic en "Rechazar" o "Aprobar" tras verificar)*  
> **Voz:** Vos comparás el CBU viejo con el nuevo. Si no está confirmado, lo rechazás con un clic y la plata del consorcio queda a salvo. Además, valida los 22 dígitos para evitar errores de tipeo.
>
> *(22-28s — placa final con logo)*  
> **Cierre:** Bien Argentinos. Inteligencia Artificial para gestionar consorcios con seguridad bancaria real.

---

## 5. Lo que todavía no hace

- **No realiza transferencias bancarias directas ni se conecta a homebanking:** El sistema resguarda y audita los datos de cobro para que la administración liquide con certeza; no ejecuta débitos automáticos en cuentas bancarias.
- **Validación de CUIT contra AFIP / BCRA en tiempo real:** Valida matemáticamente la estructura del CBU y del Alias; la verificación del nombre del titular contra el padrón fiscal depende del comprobante que emite el banco al transferir.
- **Proveedores que comparten la misma línea telefónica:** Si dos profesionales distintos atienden desde el mismo teléfono sin aclarar su nombre comercial, el sistema detecta la ambigüedad y no permite modificar los datos bancarios hasta que se identifique con exactitud a cuál de los dos corresponde.
