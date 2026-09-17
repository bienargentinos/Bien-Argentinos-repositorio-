#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Genera una variante del presupuestador a partir de pe/index.html.

    python3 pe/generar-variante.py pe/variantes/pintura.json

El JSON define título, tipo (= pestaña en la planilla), prefijo de guardado
local, categorías, ítems precargados y notas por defecto. Todo lo demás
(diseño, remito, clientes, historial, impresión) se hereda del original, así
que cualquier arreglo en pe/index.html se propaga regenerando las variantes.
"""
import io, json, os, re, sys

BASE = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'index.html')


def unico(s, viejo, nuevo, etiqueta):
    n = s.count(viejo)
    if n != 1:
        sys.exit('ERROR: el ancla "%s" aparece %d veces (esperaba 1)' % (etiqueta, n))
    return s.replace(viejo, nuevo, 1)


def entre(s, desde, hasta, nuevo, etiqueta):
    i = s.find(desde)
    if i < 0:
        sys.exit('ERROR: no encuentro el inicio de "%s"' % etiqueta)
    j = s.find(hasta, i + len(desde))
    if j < 0:
        sys.exit('ERROR: no encuentro el final de "%s"' % etiqueta)
    return s[:i] + nuevo + s[j + len(hasta):]


def js_str(v):
    return json.dumps(v, ensure_ascii=False)


def generar(cfg):
    s = io.open(BASE, encoding='utf-8').read()
    tipo = cfg['tipo']
    pref = cfg['prefijo']

    # 1. Título de la pestaña del navegador
    s = unico(s, '<title>Presupuestador Electricista</title>',
              '<title>%s</title>' % cfg['titulo'], 'título')

    # 2. Tipo que se manda al guardar (= nombre de la pestaña en la planilla)
    s = unico(s, "tipo:'Electricista'", "tipo:%s" % js_str(tipo), 'tipo en el POST')

    # 3. Tipo que se pide al leer
    n = s.count('?tipo=Electricista')
    if n < 1:
        sys.exit('ERROR: no encuentro los GET por tipo')
    s = s.replace('?tipo=Electricista', '?tipo=' + tipo)
    print('  tipo aplicado en %d lecturas' % n)

    # 4. Claves de guardado local propias de esta variante.
    #    elec-empresa y elec-clientes NO se tocan: son la misma empresa y la
    #    misma base de clientes, y así el logo y los datos ya cargados aparecen
    #    solos en todas las variantes.
    for viejo, nuevo in [('elec-index', pref + '-index'), ('elec-pres:', pref + '-pres:')]:
        c = s.count(viejo)
        if not c:
            sys.exit('ERROR: no encuentro la clave %s' % viejo)
        s = s.replace(viejo, nuevo)
        print('  %s -> %s (%d usos)' % (viejo, nuevo, c))

    # 5. Categorías (colores de las etiquetas)
    cats = ','.join('%s:{label:%s,bg:%s,col:%s}' % (
        k, js_str(v['label']), js_str(v['bg']), js_str(v['col']))
        for k, v in cfg['categorias'].items())
    s = entre(s, 'const CATS={', '};\n', 'const CATS={' + cats + '};\n', 'CATS')

    # 6. Ítems precargados
    defs = ''.join('  {cat:%s,desc:%s,unit:%s,qty:%s,price:0},\n' % (
        js_str(it['cat']), js_str(it['desc']), js_str(it['unit']), it.get('qty', 1))
        for it in cfg['items'])
    s = entre(s, 'const DEFS=[', '\n];\n', 'const DEFS=[\n' + defs + '];\n', 'DEFS')

    # 7. Opciones del desplegable "+ Agregar ítem"
    ops = '\n'.join('      <option value="%s">%s</option>' % (k, v['label'])
                    for k, v in cfg['categorias'].items())
    s = entre(s, '<option value="lum">', '</select>', ops + '\n    </select>', 'add-cat')

    # 8. La tabla viene con las filas del original pegadas en el HTML;
    #    se vacía para que la dibuje renderItems() desde DEFS.
    s = entre(s, '<tbody id="items-body">', '</tbody>',
              '<tbody id="items-body"></tbody>', 'items-body')

    # 9. Notas / condiciones por defecto
    s = entre(s, '- Presupuesto sujeto a revisión en sitio.', '</textarea>',
              cfg['notas'] + '</textarea>', 'notas')

    destino = cfg['salida']
    os.makedirs(os.path.dirname(destino), exist_ok=True)
    io.open(destino, 'w', encoding='utf-8').write(s)
    print('  escrito %s (%d ítems, %d categorías)' % (destino, len(cfg['items']), len(cfg['categorias'])))
    return destino


if __name__ == '__main__':
    if len(sys.argv) < 2:
        sys.exit('uso: generar-variante.py <config.json>')
    for ruta in sys.argv[1:]:
        cfg = json.load(io.open(ruta, encoding='utf-8'))
        print('%s:' % cfg['titulo'])
        generar(cfg)
