-- ═══════════════════════════════════════════════════════════════
-- CUPFI · Corrección de ubicaciones de las 18 organizaciones cargadas
-- (datos de producción; aprobado por el administrador el 27/11/2026).
--
-- Se corre una sola vez DESPUÉS de sql/016. Fuente: API Georef del
-- Estado argentino (apis.datos.gob.ar/georef). "direccion" = punto exacto
-- de la calle; "localidad" = centro de la localidad (la calle no figura en
-- Georef o no está cargada). La calle escrita por cada empresa no se toca.
-- Diagnóstico y Soluciones, Meraki y Damian Testori quedan sin punto hasta
-- que completen su ubicación.
-- ═══════════════════════════════════════════════════════════════
-- De sesión (no solo de la sentencia): así vale igual corrido de a una
-- sentencia o dentro de una transacción. Se apaga al final.
select set_config('cupfi.sin_bitacora', 'on', false);

update public.empresas e set
  provincia_id = v.prov, ciudad = v.loc, localidad_id = v.loc_id,
  departamento = v.dep, departamento_id = v.dep_id,
  lat = v.lat, lng = v.lng, ubicacion_precision = v.prec
from (values
  (1,  '06', 'Lomas de Zamora', '0649001003', 'Lomas de Zamora',    '06490', -34.7596127748886,  -58.3994691356768,  'localidad'),
  (2,  '06', 'Villa Lynch',     '0637101020', 'General San Martín', '06371', -34.58796810222022, -58.52992276176131, 'direccion'),
  (3,  '06', 'La Plata',        '0644103015', 'La Plata',           '06441', -34.89308743983156, -57.98357446187844, 'direccion'),
  (4,  '06', 'Avellaneda',      '0603501002', 'Avellaneda',         '06035', -34.6602473354163,  -58.38505861826625, 'direccion'),
  (5,  '06', 'San Justo',       '0642701010', 'La Matanza',         '06427', -34.67654288949369, -58.535538750451174,'direccion'),
  (6,  '06', 'San Justo',       '0642701010', 'La Matanza',         '06427', -34.6811417496029,  -58.563738604389,   'localidad'),
  (7,  '06', 'Ramos Mejía',     '0642701009', 'La Matanza',         '06427', -34.65553048758393, -58.55630085283755, 'direccion'),
  (8,  '06', 'Temperley',       '0649001004', 'Lomas de Zamora',    '06490', -34.780343026395,   -58.3869842206462,  'direccion'),
  (9,  '06', 'Lanús Este',      '0643401002', 'Lanús',              '06434', -34.69639443810433, -58.37280408492065, 'direccion'),
  (10, '02', 'Puerto Madero',   '0200701003', 'Comuna 1',           '02007', -34.619362013357055,-58.365610688183516,'direccion'),
  (11, '06', 'Mar del Plata',   '0635711003', 'General Pueyrredón', '06357', -38.0064494189987,  -57.5438377776641,  'localidad'),
  (12, '06', 'Llavallol',       '0649001002', 'Lomas de Zamora',    '06490', -34.78377700821809, -58.430201995490165,'direccion'),
  (13, '58', 'Neuquén',         '58035070',   'Confluencia',        '58035', -38.9518288206176,  -68.0591813073308,  'localidad'),
  (14, '02', 'Constitución',    '0200701001', 'Comuna 1',           '02007', -34.62777787183812, -58.381098620315974,'direccion'),
  (16, '82', 'Rosario',         '82084270',   'Rosario',            '82084', -32.9472133838031,  -60.6331755763544,  'localidad')
) as v(id, prov, loc, loc_id, dep, dep_id, lat, lng, prec)
where e.id = v.id;

select set_config('cupfi.sin_bitacora', 'off', false);
