# Resumen de Transferencia del Proyecto (Consorcio-AI-Assistant)

Este documento ha sido generado para que el próximo asistente de **Antigravity** comprenda exactamente el estado actual del proyecto, las credenciales disponibles en esta carpeta y todo el trabajo realizado hasta el momento.

---

## 🔑 Credenciales y Conexiones Guardadas en esta Carpeta

Para que no tengas que pedirle contraseñas o accesos al usuario, los datos de conexión ya están almacenados localmente en los siguientes archivos:

1.  **Servidor VPS (Bot de WhatsApp - Marcos AI)**:
    *   IP: `200.58.102.182`
    *   Puerto SSH: `5436`
    *   Usuario: `root`
    *   Contraseña: Ver en [update-host-vps.js](file:///c:/Users/Daniel/Downloads/Consorcio-AI-Assistant/update-host-vps.js#L5-L10) (Líneas 5-10).
2.  **WordPress (Sitio Web - bienargentinos.com)**:
    *   Usuario Admin: `antigravity`
    *   Contraseña: Ver en [session_manager.js](file:///c:/Users/Daniel/Downloads/Consorcio-AI-Assistant/session_manager.js#L9-L10) (Líneas 9-10).
    *   Las cookies de sesión activa están guardadas en [session_cookies.json](file:///c:/Users/Daniel/Downloads/Consorcio-AI-Assistant/session_cookies.json).
3.  **Variables de Entorno del Bot (Meta API, Gemini, SMTP, etc.)**:
    *   Están guardadas en el archivo [.env](file:///c:/Users/Daniel/Downloads/Consorcio-AI-Assistant/.env) en la raíz de esta carpeta.

---

## 🛠️ Modificaciones Realizadas y Estado Actual

Hemos resuelto todos los detalles estéticos y de funcionalidad acordados:

### 1. Cabecera y Spacing de la Web
*   **Alineación del Logo y Redes**: Inyectamos padding responsivo en la cabecera del tema Astra (`#masthead .site-primary-header-wrap`): `40px` a los lados en escritorio y `20px` en dispositivos móviles. Evita que los logos queden pegados a los bordes de la pantalla.
*   **Badge de Experiencia**: Reubicamos el badge `★ +8 años de experiencia` del héroe del Home para que no se superponga con el menú superior azul oscuro, forzándole un margen superior de `45px`.

### 2. Página de Automatizaciones (`/automatizacion-clientes/`)
*   **Márgenes y Estructura**: Quitamos la limitación de ancho máximo del contenedor principal y le pusimos un padding lateral de `24px` a izquierda y derecha, igualándolo al resto de las páginas del sitio (como `/electricistas/`).
*   **Activador de Simulador de WhatsApp**: WordPress filtraba los scripts de la página, por lo que el simulador interactivo no hacía nada. Añadimos un hook de `wp_footer` en `functions.php` que inyecta la función `runSim` nativamente solo en esta página (Post 2033). Ahora los escenarios ("Asistente de Consorcios", "Reporte de Reclamos", "Confirmación y Aviso") funcionan en tiempo real en la pantalla del mockup de celular.

### 3. Pie de Página (Footer)
*   **Enlace de Automatización**: Agregamos el enlace a `🤖 Automatización` dentro de la lista de servicios del footer directamente modificando el widget de la base de datos de WordPress.

### 4. Protección del Home contra Elementor
*   **Problema**: Al presionar por error "Editar con Elementor" en la página de inicio, el sitio web reemplazaba la página HTML/Gutenberg limpia que programamos por una versión desactualizada en blanco y negro.
*   **Solución**: Añadimos un filtro de protección en la base de datos (`get_post_metadata` en `functions.php`) para el post ID 883.
*   **Resultado**: Elementor tiene bloqueado el control visual del Home. Aunque se presione el botón de Elementor, la web pública se mantiene siempre protegida en su versión de código HTML personalizada.

### 5. Legibilidad del Mapa de Cobertura (Contraste)
*   **Problema**: El título `📍 Zona de cobertura` (en azul) y el texto inferior (en gris oscuro) eran invisibles sobre el fondo de mapa azul marino.
*   **Solución**: Forzamos mediante estilos en `wp_head` que el título sea blanco puro (`#ffffff`) y el subtexto sea un celeste claro (`#E2E8F0`). Ahora el contraste es 100% legible y moderno.

---

## 📈 Próximos Pasos Recomendados para el Nuevo Chat

Cuando el usuario te pida continuar, solo necesitás leer este archivo y estarás listo para cualquier nueva tarea de programación en el VPS o en WordPress.
Puedes revisar el historial completo de cambios visuales detallados en [walkthrough_mejoras_visuales.md](file:///c:/Users/Daniel/Downloads/Consorcio-AI-Assistant/walkthrough_mejoras_visuales.md).
