# 📋 Registro de Tareas Pendientes y Mejoras Futuras — Marcos IA

Este archivo sirve como registro central de ideas, mejoras aprobadas para etapas posteriores y funciones a futuro del sistema **Marcos IA / Bien Argentinos**.

---

## 📌 Tareas Pendientes / Futuras Funcionalidades

### 2. 🎠 Carrusel Embebido de Servicios en el Login
- **Descripción**: Transformar el recuadro "Ecosistema Bien Argentinos" del panel lateral de login en un carrusel dinámico e interactivo de servicios.
- **Origen de datos**: Se consumirá mediante `iframe` o script liviano directo desde el sitio web principal **BienArgentinos.com** (o un feed JSON embebido) para no alojar ni cargar archivos multimedia pesados en el VPS del panel.
- **Objetivo**: Mostrar publicidad y servicios adicionales (administración, mantenimiento, tecnología) a los clientes cuando ingresan, manteniendo la ligereza del servidor.

### 3. 🌐 Alias y Redirecciones de Dominio
- **cPanel WNPower**: Redirección 301 de `bienargentinos.com/ia` o `bienargentinos.com/panel` hacia `https://ia.bienargentinos.com` para simplificar la difusión por WhatsApp.

---

## ✅ Tareas Recientemente Completadas

- [x] **Solución al error de guardar planes**: Implementación de `normalizeKey` para evitar errores 500 al crear/editar planes en `💳 Planes y Pagos`.
- [x] **Catálogo de Planes en Modo AC**: Muestra del plan actual del edificio y modal interactivo para solicitar cambio por edificio individual o por **Paquete Corporativo (Todos los edificios)**.
- [x] **Aprobación en Lote**: Actualización masiva de planes en `suscripciones` al aprobar un paquete corporativo.
- [x] **URL Directa en Raíz (`/`)**: Redirección automática de la raíz a `/admin` para ingreso directo al Login/Dashboard.
- [x] **Diseño Responsivo en Zoom 190%**: Ajuste elástico del layout del Login para evitar solapamientos visuales a cualquier nivel de zoom.
- [x] **Adaptabilidad Móvil**: Implementación de barra de navegación inferior (Mobile Bottom Nav) y rejillas de 1 columna para celulares.
- [x] **Frases Rotativas Diarias en el Login**: 14 frases motivacionales que rotan por día del año + saludos automáticos para 12 fechas patrias y efemérides argentinas (25 de Mayo, 9 de Julio, Día de la Bandera, San Martín, Navidad, etc.).
- [x] **Discriminación de Planes Corporativos/Individuales**: Selector de Modalidad (Individual vs. Paquete Corporativo) en la creación/edición de planes; botones del catálogo de planes adaptados por tipo de plan; asignación de edificios por checkboxes al solicitar paquete corporativo; aprobación en lote de todos los edificios seleccionados.
- [x] **Efecto de Fondo de Oficina en Audios de WhatsApp**: Mezcla automática de ambiente de oficina (`mixkit-office-ambience-447.wav`) en notas de voz de ElevenLabs (`tts.js`) procesado en servidor con FFmpeg al 10% de volumen para máximo realismo y fallback seguro.
