# 🗄️ Guía de Arquitectura de Base de Datos PostgreSQL + pgvector + NocoDB

Este documento es la referencia oficial para la arquitectura de almacenamiento de datos de **Marcos IA**, integrando **PostgreSQL**, **pgvector** para búsquedas vectoriales por IA, y **NocoDB** como la interfaz de usuario estilo planilla de cálculo (Airtable / Excel) en el VPS.

---

## 1. 🌐 PostgreSQL + NocoDB + pgvector (Sistemas Habilitados)

### Componentes de la Arquitectura:

1. **PostgreSQL 15+ (`db-pg.js`)**:
   - Base de datos relacional de alto rendimiento corriendo localmente en el VPS.
   - Conector Node.js: `pg` y `pgvector`.
2. **`pgvector` (Vectores para Marcos IA)**:
   - Extensión que permite guardar embeddings vectoriales en las tablas `reportes`, `mensajes` y `memoria`.
   - Permite a Marcos IA buscar eventos pasados por similitud de significado (RAG / Memoria Semántica).
3. **NocoDB (Panel de Planilla Visual)**:
   - Interfaz web auto-hospedada en `http://200.58.102.182:8080` (o `db.bienargentinos.com`).
   - Muestra todas las tablas de PostgreSQL como si fuera **Google Sheets / Airtable**, permitiendo a Daniel y los administradores editar filas, agregar columnas y filtrar datos visualmente sin tocar código.

---

## 2. 🚀 Instalación y Despliegue en VPS

Para activar PostgreSQL + pgvector + NocoDB en el VPS, se ejecuta el script automatizado:
```bash
bash setup-nocodb-postgres.sh
```

---

## 3. 🗂️ Esquema de Tablas en PostgreSQL

- **`vecinos`**: Teléfonos, nombres, edificios, autorizaciones de contacto.
- **`edificios`**: Consorcios, unidades, horarios del encargado, aliases, planes.
- **`reportes`**: Reclamos `[CASO-XXXX]` con columna `embedding vector(768)` para memoria semántica.
- **`mensajes`**: **Visor de Chat en Vivo mensaje por mensaje** con emisor, tipo de canal y adjuntos.
- **`clientes`**, **`proveedores`**, **`proveedor_asignaciones`**, **`llamadas`**, **`memoria`**, **`facturas`**, **`expensas`**, **`sugerencias`**, **`solicitudes`**.

---

## 4. ⚠️ Directiva de Despliegue Git (Recordatorio para Agentes)

> [!CAUTION]
> **GitHub es la única fuente de verdad**.
> **Prohibido subir `index.js`, `sheets.js` o `agentes/*.js` por copia local al VPS.**
> Todo despliegue del backend se realiza vía `git pull` en el VPS.
