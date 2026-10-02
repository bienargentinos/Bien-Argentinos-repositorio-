# Autenticación de Vecinos y Recuperación de Contraseña por Email

---

## 1. ¿Qué problema resuelve?

En los portales de autogestión de consorcios, dos problemas críticos suelen amenazar la viabilidad operativa y económica:

1. **Costos inesperados por mensajes de autenticación (WhatsApp/SMS):** Plataformas como Meta (WhatsApp Cloud API) cobran tarifas elevadas por conversaciones iniciadas por la empresa bajo la categoría de autenticación (códigos OTP / PIN). En una comunidad de cientos de vecinos donde la gente inicia sesión frecuentemente, los envíos automáticos de códigos por WhatsApp se convierten en una factura recurrente imposible de absorber bajo un esquema de costos predecible.
2. **Saturación del administrador por pérdidas de contraseña:** Cuando los vecinos no recuerdan su clave, la alternativa manual es llamar o escribir al administrador para que les genere un acceso temporal o les cambie la contraseña a mano. Esto suele ocurrir en horarios inhábiles (noches, fines de semana) cuando el vecino intenta pagar o ver una expensa.

**Con este módulo:** La autenticación se realiza de manera 100% autónoma por **correo electrónico y contraseña con hash criptográfico**, y la recuperación de clave funciona mediante un **enlace seguro enviado por email (SMTP)**, garantizando **\$0 costo por mensaje de Meta** y liberando por completo a la administración.

---

## 2. ¿Cómo funciona en la práctica?

### Inicio de Sesión
1. El vecino ingresa a `/vecino/login`.
2. Introduce su **email registrado** y su **contraseña**.
3. El sistema valida las credenciales y le da acceso a su unidad, expensas, avisos y reservas.

### Recuperación de Contraseña Autónoma
1. Si el vecino no recuerda su clave, toca en el enlace **"¿Olvidaste tu contraseña?"**.
2. Ingresa su email registrado y presiona **"Enviar enlace de recuperación"**.
3. **Respuesta neutra y segura (OWASP):** El sistema confirma inmediatamente: *"Si el correo está registrado, te enviamos las instrucciones para restablecer tu contraseña"*. Esto evita que atacantes puedan averiguar si un vecino vive o no en el consorcio (prevención de enumeración de usuarios).
4. El sistema genera un **token criptográfico de un solo uso** con validez de **60 minutos** y envía un email al vecino con su enlace único (`/vecino/recuperar-password?token=...`).
5. El vecino abre el enlace desde su teléfono o computadora, escribe su **nueva contraseña** (mínimo 6 caracteres), confirma y listo.
6. La contraseña se guarda con hash seguro (bcrypt), el token se consume para que nadie pueda reutilizarlo y el vecino ya puede ingresar normalmente.

---

## 3. Argumentos comerciales (Puntos de venta)

- **\$0 Costo en la factura de Meta (WhatsApp):** Al no utilizar plantillas salientes de OTP por WhatsApp ni pasarelas de SMS pagas, la administración y la plataforma operan con costo marginal cero en autenticación y soporte de accesos.
- **Autonomía 24/7 para el propietario e inquilino:** El vecino recupera el control de su cuenta en 30 segundos, sin tener que esperar a que la oficina de la administración abra el lunes a la mañana.
- **Seguridad y privacidad de estándar bancario:**
  - Tokens temporales de 1 hora.
  - Vencimiento automático y consumo inmediato tras el cambio.
  - Almacenamiento seguro en PostgreSQL mediante hashing unidireccional (las contraseñas nunca se guardan en texto plano).
  - Protección activa contra enumeración de cuentas.
- **Mantenimiento cero para la administración:** No hay que generar contraseñas provisorias, no hay que mandar credenciales por chats inseguros ni anotar claves en planillas.

---

## 4. Guion base para video / reel / publicidad

**[Visual]:** Un vecino frente a su celular a las 23:30 queriendo ver su expensa pero olvidó su contraseña.  
**[Locución / Copy]:**  
*"Domingo a las once de la noche. Un vecino necesita ver su liquidación de expensas pero no se acuerda su clave.*  
*¿La opción tradicional? Mandarle un WhatsApp al administrador y esperar al lunes.*  
*¿La opción con Marcos IA? Toca '¿Olvidaste tu contraseña?', le llega un correo seguro al instante, define su nueva clave y entra en menos de un minuto.*  
*Sin mensajes pagos de WhatsApp. Sin llamadas fuera de hora. Seguridad total para el vecino y tranquilidad absoluta para la administración.*  
*Tu consorcio, automatizado con Marcos IA."*

---

## 5. Lo que todavía no hace (y cómo se maneja hoy)

- **Configuración de SMTP:** Requiere que el servidor tenga configuradas las credenciales de correo saliente (`SMTP_HOST`, `SMTP_USER`, `SMTP_PASS`). En entornos locales de prueba sin SMTP activo, el sistema simula el envío y deja registrado el enlace en el registro de depuración para desarrollo.
- **Doble factor de autenticación (2FA / TOTP):** El acceso actual es por email y contraseña única. No requiere apps adicionales tipo Google Authenticator, priorizando la facilidad de adopción para vecinos de todas las edades.
- **Restablecimiento por SMS:** No se envían mensajes SMS a teléfonos celulares para no generar costos de telefonía móvil. Todo el flujo corre sobre correo electrónico e interfaz web responsiva.
