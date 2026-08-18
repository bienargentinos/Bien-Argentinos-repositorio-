-- ============================================================================
-- Bien Argentinos / Marcos IA — Sección "Facturas y Fotos"
-- Migración PostgreSQL (marcos_db) sobre la tabla EXISTENTE `facturas`.
-- ============================================================================

BEGIN;

-- 1. COLUMNAS NUEVAS EN `facturas`
ALTER TABLE facturas ADD COLUMN IF NOT EXISTS clase             text;  -- 'Proveedor' | 'Gasto fijo'
ALTER TABLE facturas ADD COLUMN IF NOT EXISTS categoria         text;  -- ver catálogo, bloque 2
ALTER TABLE facturas ADD COLUMN IF NOT EXISTS tipo              text;  -- 'Factura PDF' | 'Foto' | 'Recibo' | 'Presupuesto' | 'Otro'
ALTER TABLE facturas ADD COLUMN IF NOT EXISTS origen            text;  -- 'Encargado' | 'Consejo' | 'Administrador'
ALTER TABLE facturas ADD COLUMN IF NOT EXISTS origen_nombre     text;  -- nombre de la persona (no hay ids)
ALTER TABLE facturas ADD COLUMN IF NOT EXISTS requiere_revision text;  -- 'si' | 'no'  (convención de la planilla)
ALTER TABLE facturas ADD COLUMN IF NOT EXISTS fecha_pago        text;  -- 'DD/MM/AAAA' o vacío
ALTER TABLE facturas ADD COLUMN IF NOT EXISTS codigo_caso       text;  -- opcional: 'CASO-1001' (en Sheets EVENTOS es id_evento)

-- SOLO PostgreSQL (no van a Sheets):
ALTER TABLE facturas ADD COLUMN IF NOT EXISTS fecha_iso    timestamptz;    -- derivada de `fecha`, para ordenar
ALTER TABLE facturas ADD COLUMN IF NOT EXISTS monto_num    numeric(14,2);  -- derivada de `monto`, NULL si no hay importe
ALTER TABLE facturas ADD COLUMN IF NOT EXISTS factura_key  text;           -- identificador estable para la API
ALTER TABLE facturas ADD COLUMN IF NOT EXISTS sheets_fila  int;            -- fila en la pestaña, para poder actualizarla
ALTER TABLE facturas ADD COLUMN IF NOT EXISTS sheets_sync_at timestamptz;
ALTER TABLE facturas ADD COLUMN IF NOT EXISTS updated_at   timestamptz NOT NULL DEFAULT now();
ALTER TABLE facturas ADD COLUMN IF NOT EXISTS eliminada    text;           -- 'si' | vacío  (soft delete; también en Sheets)

-- 2. CATÁLOGO DE CATEGORÍAS
CREATE TABLE IF NOT EXISTS categorias_gasto (
  categoria text NOT NULL,
  clase     text NOT NULL,   -- 'Proveedor' | 'Gasto fijo'
  icono     text,            -- icono Phosphor, ej 'ph-lightning'
  orden     int  NOT NULL DEFAULT 100,
  activo    text NOT NULL DEFAULT 'si',
  PRIMARY KEY (categoria, clase)
);

INSERT INTO categorias_gasto (categoria, clase, icono, orden) VALUES
  ('Electricidad',        'Gasto fijo', 'ph-lightning',    10),
  ('Gas',                 'Gasto fijo', 'ph-flame',        20),
  ('Agua y saneamiento',  'Gasto fijo', 'ph-drop',         30),
  ('Seguro',              'Gasto fijo', 'ph-shield-check', 40),
  ('Impuestos / ABL',     'Gasto fijo', 'ph-receipt',      50),
  ('Internet / Teléfono', 'Gasto fijo', 'ph-wifi-high',    60),
  ('Otros fijos',         'Gasto fijo', 'ph-dots-three',   99),
  ('Electricidad',        'Proveedor',  'ph-lightning',    10),
  ('Plomería',            'Proveedor',  'ph-wrench',       20),
  ('Ascensores',          'Proveedor',  'ph-elevator',     30),
  ('Albañilería',         'Proveedor',  'ph-bricks',       40),
  ('Limpieza',            'Proveedor',  'ph-broom',        50),
  ('Bombas / Tanques',    'Proveedor',  'ph-gauge',        60),
  ('Cerrajería',          'Proveedor',  'ph-key',          70),
  ('Otros trabajos',      'Proveedor',  'ph-dots-three',   99)
ON CONFLICT (categoria, clase) DO NOTHING;

-- 3. AUDITORÍA
CREATE TABLE IF NOT EXISTS facturas_auditoria (
  id             bigserial PRIMARY KEY,
  factura_key    text NOT NULL,
  usuario        text,              -- clientes.usuario
  accion         text NOT NULL,     -- 'crear' | 'editar' | 'reclasificar' | 'estado' | 'eliminar' | 'enviar_consejo'
  campo          text,
  valor_anterior text,
  valor_nuevo    text,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS facturas_auditoria_key_idx
  ON facturas_auditoria (factura_key, created_at DESC);

-- 4. FUNCIONES AUXILIARES
CREATE OR REPLACE FUNCTION marcos_parse_fecha(txt text)
RETURNS timestamptz AS $$
DECLARE limpio text; BEGIN
  IF txt IS NULL OR btrim(txt) = '' THEN RETURN NULL; END IF;
  limpio := btrim(replace(txt, ',', ''));
  BEGIN
    IF limpio ~ '^\d{1,2}/\d{1,2}/\d{4}\s+\d{1,2}:\d{2}:\d{2}$' THEN
      RETURN to_timestamp(limpio, 'DD/MM/YYYY HH24:MI:SS');
    ELSIF limpio ~ '^\d{1,2}/\d{1,2}/\d{4}\s+\d{1,2}:\d{2}$' THEN
      RETURN to_timestamp(limpio, 'DD/MM/YYYY HH24:MI');
    ELSIF limpio ~ '^\d{1,2}/\d{1,2}/\d{4}$' THEN
      RETURN to_timestamp(limpio, 'DD/MM/YYYY');
    END IF;
    RETURN NULL;
  EXCEPTION WHEN others THEN RETURN NULL; END;
END $$ LANGUAGE plpgsql IMMUTABLE;

CREATE OR REPLACE FUNCTION marcos_parse_monto(txt text)
RETURNS numeric AS $$
DECLARE limpio text; BEGIN
  IF txt IS NULL OR btrim(txt) = '' THEN RETURN NULL; END IF;
  limpio := regexp_replace(txt, '[^0-9,\.\-]', '', 'g');
  IF limpio = '' OR limpio = '-' THEN RETURN NULL; END IF;
  limpio := replace(limpio, '.', '');
  limpio := replace(limpio, ',', '.');
  BEGIN RETURN limpio::numeric; EXCEPTION WHEN others THEN RETURN NULL; END;
END $$ LANGUAGE plpgsql IMMUTABLE;

CREATE OR REPLACE FUNCTION marcos_norm(txt text)
RETURNS text AS $$
  SELECT lower(btrim(translate(coalesce(txt,''),
    'ÁÉÍÓÚÜÑáéíóúüñ', 'AEIOUUNaeiouun')));
$$ LANGUAGE sql IMMUTABLE;

CREATE OR REPLACE FUNCTION marcos_factura_key(p_edificio text, p_numero text, p_fecha text)
RETURNS text AS $$
  SELECT marcos_norm(p_edificio) || '|' ||
         marcos_norm(coalesce(nullif(btrim(p_numero), ''), 'sin-numero')) || '|' ||
         coalesce(to_char(marcos_parse_fecha(p_fecha), 'YYYYMMDDHH24MISS'), md5(coalesce(p_fecha,'')));
$$ LANGUAGE sql IMMUTABLE;

-- 5. BACKFILL
UPDATE facturas SET estado = 'Pagada'
 WHERE marcos_norm(estado) IN ('pagada','pagado','paga','pago','pagados','pagadas');
UPDATE facturas SET estado = 'Pendiente'
 WHERE estado IS NULL OR btrim(estado) = ''
    OR marcos_norm(estado) IN ('pendiente','pendientes','impaga','impago','a pagar');

UPDATE facturas SET tipo = CASE
    WHEN url_archivo ~* '\.pdf($|\?)'                    THEN 'Factura PDF'
    WHEN url_archivo ~* '\.(jpe?g|png|heic|webp)($|\?)'  THEN 'Foto'
    ELSE 'Otro'
  END
 WHERE tipo IS NULL OR btrim(tipo) = '';

UPDATE facturas SET clase = 'Gasto fijo', requiere_revision = 'si'
 WHERE (clase IS NULL OR btrim(clase) = '')
   AND marcos_norm(coalesce(concepto,'') || ' ' || coalesce(proveedor,'')) ~
       '(edenor|edesur|metrogas|naturgy|camuzzi|aysa|agua|abl|rentas|arba|agip|seguro|telecom|fibertel|telecentro|internet|expensa de servicio)';

UPDATE facturas SET clase = 'Proveedor', requiere_revision = 'si'
 WHERE clase IS NULL OR btrim(clase) = '';

UPDATE facturas SET categoria = CASE
    WHEN marcos_norm(concepto || ' ' || coalesce(proveedor,'')) ~ '(edenor|edesur|electric|luz|panel|tablero|contactora)'
      THEN CASE WHEN clase = 'Gasto fijo' THEN 'Electricidad' ELSE 'Electricidad' END
    WHEN marcos_norm(concepto || ' ' || coalesce(proveedor,'')) ~ '(metrogas|naturgy|camuzzi|gas|caldera)'
      THEN CASE WHEN clase = 'Gasto fijo' THEN 'Gas' ELSE 'Otros trabajos' END
    WHEN marcos_norm(concepto || ' ' || coalesce(proveedor,'')) ~ '(aysa|agua|cloaca|saneamiento)'
      THEN CASE WHEN clase = 'Gasto fijo' THEN 'Agua y saneamiento' ELSE 'Plomería' END
    WHEN marcos_norm(concepto) ~ '(ascensor|montacarga)'      THEN 'Ascensores'
    WHEN marcos_norm(concepto) ~ '(plomer|filtracion|caneria|bomba|tanque)' THEN 'Plomería'
    WHEN marcos_norm(concepto) ~ '(seguro|poliza)'            THEN 'Seguro'
    WHEN marcos_norm(concepto) ~ '(abl|rentas|impuesto)'      THEN 'Impuestos / ABL'
    WHEN marcos_norm(concepto) ~ '(limpieza|desinfec|fumig)'  THEN 'Limpieza'
    WHEN marcos_norm(concepto) ~ '(cerrad|llave|cerrajer)'    THEN 'Cerrajería'
    ELSE NULL
  END
 WHERE categoria IS NULL OR btrim(categoria) = '';

UPDATE facturas SET origen = 'Administrador', requiere_revision = 'si'
 WHERE origen IS NULL OR btrim(origen) = '';

UPDATE facturas f SET origen_nombre = e.admin_nombre
  FROM edificios e
 WHERE (f.origen_nombre IS NULL OR btrim(f.origen_nombre) = '')
   AND marcos_norm(f.edificio) = marcos_norm(e.edificio);

UPDATE facturas SET requiere_revision = 'no'
 WHERE requiere_revision IS NULL OR btrim(requiere_revision) = '';
UPDATE facturas SET eliminada = '' WHERE eliminada IS NULL;

UPDATE facturas SET fecha_iso = marcos_parse_fecha(fecha) WHERE fecha_iso IS NULL;
UPDATE facturas SET monto_num = marcos_parse_monto(monto) WHERE monto_num IS NULL;
UPDATE facturas SET factura_key = marcos_factura_key(edificio, numero_factura, fecha)
 WHERE factura_key IS NULL OR btrim(factura_key) = '';

COMMIT;

-- 6. TRIGGER
BEGIN;

CREATE OR REPLACE FUNCTION facturas_derivadas() RETURNS trigger AS $$
BEGIN
  NEW.fecha_iso   := marcos_parse_fecha(NEW.fecha);
  NEW.monto_num   := marcos_parse_monto(NEW.monto);
  NEW.factura_key := marcos_factura_key(NEW.edificio, NEW.numero_factura, NEW.fecha);
  NEW.updated_at  := now();
  IF NEW.estado IS NULL OR btrim(NEW.estado) = '' THEN NEW.estado := 'Pendiente'; END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS facturas_derivadas_trg ON facturas;
CREATE TRIGGER facturas_derivadas_trg BEFORE INSERT OR UPDATE ON facturas
  FOR EACH ROW EXECUTE FUNCTION facturas_derivadas();

-- 7. RESTRICCIONES E ÍNDICES
DO $$ BEGIN
  ALTER TABLE facturas ADD CONSTRAINT facturas_clase_chk
    CHECK (clase IN ('Proveedor','Gasto fijo'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE facturas ADD CONSTRAINT facturas_estado_chk
    CHECK (estado IN ('Pendiente','Pagada'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE facturas ADD CONSTRAINT facturas_origen_chk
    CHECK (origen IN ('Encargado','Consejo','Administrador'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE facturas ADD CONSTRAINT facturas_tipo_chk
    CHECK (tipo IN ('Factura PDF','Foto','Recibo','Presupuesto','Otro'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS facturas_listado_idx
  ON facturas (marcos_norm(edificio), clase, fecha_iso DESC);
CREATE INDEX IF NOT EXISTS facturas_origen_idx  ON facturas (marcos_norm(edificio), origen);
CREATE INDEX IF NOT EXISTS facturas_estado_idx  ON facturas (marcos_norm(edificio), estado);
CREATE INDEX IF NOT EXISTS facturas_key_idx     ON facturas (factura_key);
CREATE INDEX IF NOT EXISTS facturas_numero_idx  ON facturas (numero_factura);

CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX IF NOT EXISTS facturas_busqueda_trgm_idx
  ON facturas USING gin (
    marcos_norm(coalesce(concepto,'') || ' ' || coalesce(proveedor,'') || ' ' ||
                coalesce(numero_factura,'') || ' ' || coalesce(edificio,'')) gin_trgm_ops
  );

COMMIT;
