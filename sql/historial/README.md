# Historial de migraciones

Estos archivos son las migraciones que se fueron aplicando, en orden, para
llegar al estado actual del proyecto CUPFI en Supabase. Se conservan acá
como referencia histórica (para entender *por qué* quedó cada cosa como
quedó), pero **no hace falta correrlas**: [`sql/001_schema.sql`](../001_schema.sql)
ya es el resultado consolidado de todas ellas.

Si estás levantando un proyecto de Supabase nuevo desde cero, usá
`sql/001_schema.sql` (y opcionalmente `sql/005_seed_demo_empresas.sql`) y
ignorá esta carpeta.
