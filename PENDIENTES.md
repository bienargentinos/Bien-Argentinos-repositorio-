# Pendientes de Marcos IA

Última actualización: 11/08/2026

> Este archivo existe para que lo pendiente no dependa de que alguien se acuerde. Si retomás el
> trabajo después de unos días, empezá por acá.

---

## 🔜 Lo próximo (con la base ya construida)

### 1. Cadena de escalación cuando no hay quién abra la puerta

Marcos hoy despacha al técnico apenas identifica el problema, sin verificar que alguien le vaya a
abrir. Un técnico que va y no entra es una visita perdida que igual se cobra.

La cadena acordada:

```
¿El proveedor tiene acceso propio? (QR, llave, llavero magnético)
   SÍ  → despachar. No necesita a nadie.
   NO  → ¿hay alguien que reciba? (el vecino, el contacto que dejó, encargado, seguridad)
           SÍ → despachar, aunque falte el apellido o el departamento
           NO → esperar 15 min a que el vecino complete los datos
                  sigue sin nadie → avisar al CONSEJO (presidente)
                    nadie responde → alertar al ADMINISTRADOR, que se hace cargo
```

El caso que más importa: **el que reporta puede ser el encargado que se quedó sin batería**. Marcos
sabe que hay un problema real pero perdió al único que iba a abrir.

**Falta antes de empezar:**
- Columna `acceso` al final de la pestaña `proveedores` (la carga el AC: `qr`, `llave`,
  `llavero magnetico`, `propio`, o vacío).
- Definir si el presidente del consejo se identifica por `cargo = presidente`, y si Marcos prueba
  con los otros miembros antes de ir al administrador.

**Ya construido y reutilizable:** `seguimiento.js` (controles a prueba de reinicios), la pestaña
`consejo` con sus datos, y `buscarAccesosEdificio()`.

---

### 2. Aprobación de gastos: el técnico necesita luz verde para terminar

Si el técnico dice *"la bomba se quemó, hay que comprar una nueva"*, hoy Marcos lo procesa como un
mensaje más: lo resume y sigue. No distingue "terminé" de "necesito plata para terminar", y el caso
queda en proceso con el técnico esperando una respuesta que no llega.

**Marcos no debe negociar plata.** No conoce los fondos del consorcio ni si hace falta asamblea. Un
bot que dice "dale, comprá" es un problema legal para el administrador.

Lo que sí tiene que hacer:

1. **Detectar** que el mensaje es un pedido de aprobación, no un cierre.
2. **Capturar** qué se reparó, qué falta, qué hay que comprar y el monto si lo menciona.
3. **Poner el caso en "esperando aprobación"** y **frenar los seguimientos** — nada de seguir
   preguntando "¿pudiste pasar?" a alguien que está esperando una respuesta nuestra.
4. **Alertar al AC** por mail y en el panel, con el teléfono del proveedor.
5. **Hacerse a un lado**: al técnico, *"lo elevé a la administración, se comunican con vos"*; al
   vecino, *"la reparación quedó parcial, la administración está definiendo cómo seguir"*.

Queda registrado como un tipo de evento aparte, para que el dashboard muestre cuántos casos están
frenados esperando una decisión — información que hoy no existe en ningún lado.

---

## 🧹 Deuda técnica menor

- **Los audios se sirven desde `temp/`.** Si esa carpeta se limpia, los reproductores de casos
  viejos quedan rotos. Los que pasan por `guardarArchivoEstructurado()` van a `almacenamiento/` y
  son permanentes. Hoy conviven los dos caminos; conviene unificar en el permanente.
- **Apagar Google Sheets.** `verificar-migracion.js` da 34/34 sin diferencias. Falta dejar correr
  unos días de uso real y volver a verificar antes de sacarle el respaldo.
- **Migrar las lecturas que quedan**: `buscarFacturasProveedor`, `obtenerCasosAbiertosEdificio`,
  `obtenerEventosPendientesAdmin` y los pocos lugares de `index.js` que hablan con la planilla
  directamente sin pasar por ninguna función.
- **`tecnicos` y `personal` están vacías** en la planilla. Marcos se arregla porque encuentra al
  técnico en `proveedor_asignaciones`, pero **no tiene suplente** al que recurrir si el titular no
  contesta.
- **ElevenLabs con el pago pendiente.** Mientras siga así, Marcos responde en texto en vez de nota
  de voz. No es código.

---

## ✅ Terminado el 11/08/2026

**Bugs del flujo de atención:**
- La foto se perdía en cualquier vuelta donde Marcos pedía un dato (edificio, apellido, depto).
- El enojo del vecino llegaba textual al técnico, por cuatro caminos distintos.
- El departamento del vecino se usaba para ubicar fallas de áreas comunes.
- La confirmación del técnico no se registraba: Marcos decía "estoy consultando" teniendo la
  respuesta, y le seguía mandando recordatorios al técnico después de que confirmara.
- Con contacto de acceso cargado, igual se ofrecía el teléfono del vecino que no iba a estar.
- `guardarLlamada` estaba definida pero nunca exportada: toda llamada de Vapi moría sin guardarse.
- La nota de voz pronunciaba números de teléfono y sonaba a persona masticando.
- El panel no podía reproducir los audios: se guardaba un id en vez de una ruta.
- Las escalaciones vivían en RAM y cada `pm2 restart` las borraba en silencio.

**Funcionalidad nueva:**
- Pestaña `accesos`: dónde está cada instalación y quién tiene la llave. Marcos lo **aprende solo**
  escuchando la conversación, con constancia de quién aportó cada dato.
- Sección "Instalaciones y Accesos" en el panel, con carga por relato (Antigravity).
- Seguimiento de casos a prueba de reinicios: después de que el técnico confirma, se controla que
  la visita haya ocurrido de verdad.

**Migración a PostgreSQL:**
- Esquema alineado con la planilla real (faltaban 4 tablas y 15 columnas).
- Import idempotente que reemplaza al que adivinaba nombres de pestañas.
- Escritura duplicada y lecturas desde PostgreSQL, con Sheets como respaldo automático.
- `verificar-migracion.js`: 34 de 34 comprobaciones sin diferencias.
