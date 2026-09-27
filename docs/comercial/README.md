# Documentación comercial, de soporte y de capacitación

Esta carpeta **no es documentación técnica**. `CLAUDE.md` y los `docs/para-*.md` ya cuentan cómo
está hecho el sistema y qué se rompió. Acá se guarda lo otro: **qué le decimos a un administrador
de consorcio que todavía no nos conoce**, y con qué material lo vamos a capacitar cuando compre.

Son dos usos distintos del mismo archivo:

| Cuándo | Quién lo lee | Para qué |
|---|---|---|
| Antes de vender | Daniel, o quien venda | Explicar el beneficio sin abrir el código |
| Después de vender | El AC y el vecino | Tutorial y soporte de primera línea |

## La regla que hace que esto sirva: no se escribe humo

> [!CAUTION]
> **Solo se documenta lo que el código ya hace hoy.** Un argumento de venta sobre una función que
> todavía no existe se convierte en una promesa que alguien va a reclamar, y la va a reclamar
> delante de un cliente que ya pagó.

Por eso cada documento tiene, al final, una sección **"Lo que todavía no hace"**. No es una
debilidad del material de venta: es lo que permite venderlo tranquilo. Quien vende sabe hasta
dónde puede prometer, y quien da soporte sabe qué no es un error.

Tampoco se inventan números. **Ningún documento dice "ahorrá 10 horas por semana"** ni pone un
porcentaje que nadie midió. Se describe el mecanismo —qué deja de pasar— y el AC saca su propia
cuenta, que además va a ser la de su edificio y no la de un promedio inventado.

## Cuándo se escribe uno

Cada vez que se termina una mejora, un módulo o una corrección, **en el mismo ciclo de trabajo**
que el cambio técnico. Un documento escrito tres semanas después se escribe de memoria, y de
memoria es como se inventa humo.

**Una corrección chica no necesita su propio archivo**: se agrega al documento del módulo que
corrige. Solo se abre archivo nuevo cuando hay algo que un AC podría comprar por separado.

## Estructura obligatoria

Los cuatro títulos van tal cual, en este orden:

```markdown
# <Nombre del módulo, como lo diría un cliente>

## 1. ¿Qué problema resuelve?
Lenguaje simple y comercial. Sin jerga de código: ni nombres de archivo, ni tablas, ni endpoints.
Se escribe apuntando al Administrador de Consorcio o al vecino, según a quién le sirva.

## 2. ¿Cómo funciona en la práctica?
El paso a paso real: qué toca, qué ve, qué le llega. Del panel o del WhatsApp.

## 3. Argumentos comerciales
Qué dolor operativo del edificio soluciona. Uno por viñeta, cada uno atado a algo que el
sistema hace de verdad.

## 4. Guion base para video / reel / publicidad
Listo para grabar o para pegar como copy. Sin datos inventados.

## Lo que todavía no hace
La sección que mantiene honesto a todo lo de arriba.
```

## Índice

| Módulo | Para quién | Archivo |
|---|---|---|
| Expensas en el celular del vecino | AC y vecino | `portal-expensas.md` |
| El portal en cuatro idiomas | AC con huéspedes extranjeros | `portal-idiomas.md` |
| Pases QR para visitas y proveedores | AC, vecino y portería | `portal-pases-qr.md` |
| Avisos del edificio y pop-up de inicio | AC y vecino | `portal-avisos.md` |

> Faltan los módulos del **panel** (Antigravity) y del **motor de WhatsApp** (el chat de Marcos).
> Cada conversación escribe los suyos: quien hizo el módulo es el único que sabe qué hace de
> verdad y qué no. Queda pedido en los dos buzones.

## Glosario, porque acá se cruzan dos vocabularios

Las siglas que usamos entre nosotros **no van en estos documentos** — el cliente no las conoce:

| Sigla | Acá se escribe | Qué es |
|---|---|---|
| AC | "el administrador" | El administrador de consorcio, nuestro cliente |
| AY | (no se nombra) | Antigravity, el asistente que trabaja en el panel |
| CI | (no se nombra) | La revisión automática que corre antes de publicar un cambio |
