# Subida Masiva y Auditoría Inteligente de Expensas con OCR

---

## 1. ¿Qué problema resuelve?
Publicar las expensas mes a mes suele ser uno de los procesos más tediosos y riesgosos para una administración:
- Si el edificio tiene 40 departamentos, subir PDF por PDF de forma individual exige 40 repeticiones manuales, consumiendo horas de trabajo administrativo.
- El error humano es constante: asignar la expensa de la unidad 4° B al propietario del 2° A, o tipear mal un total a pagar.
- La privacidad de datos: si una expensa queda en un enlace web público sin autenticación, cualquier vecino o tercero puede espiar las deudas privadas de sus vecinos.

**Con este módulo:** La administración sube los 40 o 60 archivos PDF juntos en un solo paso. Un motor de Inteligencia Artificial lee cada documento, extrae la unidad, el vencimiento y el monto exacto a pagar, y presenta una tabla de auditoría con semáforo para que el administrador valide todo en segundos antes de publicar. Además, cada expensa queda 100% blindada para que sólo la vea el titular de esa unidad.

---

## 2. ¿Cómo funciona en la práctica?

1. **Selección múltiple:** En la sección **Expensas** del panel, el administrador selecciona hasta 60 comprobantes PDF al mismo tiempo y hace clic en **"Procesar tanda"**.
2. **Lectura Inteligente (OCR):** El sistema analiza cada PDF sin trabar la pantalla, extrayendo automáticamente:
   - Departamento o unidad (ej: *1° A, 4° B*).
   - Período y fecha de vencimiento.
   - Monto total a pagar (diferenciando deudas anteriores y subtotales).
3. **Mesa de Revisión con Semáforo:**
   - 🟢 **Verde (OK):** Unidad y monto identificados con total coincidencia con el padrón del edificio.
   - 🟡 **Amarillo (Sin vecino registrado):** La unidad es válida pero aún no hay un usuario registrado con esa unidad (la expensa queda lista para cuando el vecino ingrese).
   - ⚪ **Gris (General):** Es la liquidación general del consorcio (la ven todos los copropietarios).
   - 🔴 **Rojo (Duplicado o Alerta):** Advierte si se seleccionó por error dos veces el mismo PDF.
4. **Edición o Aprobación:** El administrador puede corregir un número en línea si lo desea o descartar un archivo con un clic.
5. **Publicación Protegida:** Al presionar **"Publicar todas"**, los vecinos reciben la notificación y ven su cupón en su portal privado. Si alguien intenta acceder a la URL de otro departamento, el sistema lo bloquea automáticamente.

---

## 3. Argumentos comerciales (Puntos de venta)
- **Ahorro del 90% del tiempo operativo:** Lo que antes llevaba 45 minutos de carga manual por edificio, ahora se resuelve en menos de 2 minutos.
- **Tolerancia cero a errores de asignación:** El sistema audita y avisa si un archivo tiene un número de unidad inconsistente antes de que llegue al vecino.
- **Privacidad y cumplimiento legal:** Acceso protegido bajo sesión. Un copropietario nunca puede ver el saldo o los datos de expensas de otro vecino.
- **Transparencia total:** El vecino ve en grande su cupón individual y a la vez tiene acceso a la liquidación general de gastos del consorcio para su control.

---

## 4. Guion base para video / reel / publicidad

**[Visual]:** Pantalla dividida: a la izquierda alguien cargando PDFs uno por uno con cara de aburrimiento; a la derecha arrastrando 40 archivos de golpe al panel de Marcos IA.  
**[Locución / Copy]:**  
*"¿Seguís perdiendo toda una tarde subiendo las expensas departamento por departamento?*  
*Mirá esto: arrastrás hasta 60 liquidaciones juntas. La Inteligencia Artificial de Marcos lee cada PDF, extrae el departamento, el vencimiento y el monto exacto.*  
*Te muestra un semáforo de control para revisar todo de un vistazo y con un solo clic publicás todo el edificio.*  
*Cada vecino ve únicamente su expensa, con seguridad bancaria y sin errores.*  
*Tu tiempo vale. Automatizá tu administración con Marcos IA."*
