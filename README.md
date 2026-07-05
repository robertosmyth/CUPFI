# CUPFI · Red de Vinculación Empresarial FI-UNLZ

Plataforma web para conectar graduados y empresas vinculadas a la Facultad de
Ingeniería de la Universidad Nacional de Lomas de Zamora: cada graduado puede
cargar una o varias empresas propias, con sus servicios/productos y sus
necesidades, y el sistema detecta automáticamente qué empresas de otros
graduados pueden cubrir esas necesidades (y viceversa).

Es un sitio 100% estático (HTML + CSS + JS sin build) que usa
[Supabase](https://supabase.com) como backend (autenticación, base de datos y
almacenamiento de archivos).

## Estructura del proyecto

```
CUPFI/
├── index.html                # Punto de entrada de la app
├── assets/
│   ├── css/style.css          # Estilos (incluye responsive)
│   └── js/
│       ├── supabaseClient.js  # Cliente de Supabase (URL + publishable key)
│       ├── auth.js            # Registro / login / logout / perfil / recuperar contraseña
│       ├── empresas.js        # CRUD de empresas + subida de logos
│       ├── matching.js        # Motor de "vinculación" (necesidades ↔ ofertas)
│       ├── utils.js           # Helpers (escape HTML, validaciones, etc.)
│       └── main.js            # UI: navegación, renderizado, listeners
├── sql/
│   ├── 001_schema.sql                     # Esquema completo (documentación / proyecto nuevo)
│   ├── 002_migration_v2.sql               # Migración a correr en un proyecto ya existente
│   ├── 003_lockdown_role_and_uid.sql      # Bloquea auto-escalación de rol / robo de empresa
│   ├── 004_admin_role_management.sql      # Permite que un admin cambie el rol de otros usuarios
│   ├── 005_seed_demo_empresas.sql         # (Opcional) 17 empresas de ejemplo para poblar el directorio
│   ├── 006_updated_at_trigger.sql         # Actualiza empresas.updated_at automáticamente al editar
│   ├── 007_fix_admin_role_via_dashboard.sql # Permite cambiar el rol desde el Table Editor de Supabase
│   └── 008_roles_reference_table.sql      # Normaliza profiles.role con una tabla roles (FK)
└── README.md
```

## Cómo funciona la vinculación (lo central del programa)

- Un graduado puede registrar **una o varias empresas propias** (pestaña
  "Agregar"). Cada empresa carga, además de sus datos, sus **servicios /
  productos** (lo que ofrece) y sus **necesidades sin cubrir** (lo que le
  falta).
- Al cargar servicios y necesidades, la app sugiere **categorías
  predefinidas** (botones "+ Categoría") además de permitir texto libre.
  Usar la misma categoría que otra empresa (por ejemplo "Mecanizado de
  piezas") es lo que le permite al sistema encontrar una **coincidencia
  exacta**, mucho más confiable que una coincidencia aproximada por
  palabras sueltas.
- La pestaña "Vinculación" agrupa, por cada par de empresas, todas las
  coincidencias entre lo que una necesita y lo que la otra ofrece, marcando
  cada una como "Coincidencia exacta" o "Posible coincidencia". Desde ahí
  (y desde el detalle de cada empresa) hay un botón para **contactar
  directamente** por email o teléfono a la otra empresa.
- El motor de vinculación (`assets/js/matching.js`) nunca cruza dos
  empresas del mismo graduado entre sí.

## Cómo funciona la seguridad

- La base de datos usa **Row Level Security (RLS)**: cada tabla define
  explícitamente quién puede leer, insertar, actualizar o borrar filas. El
  cliente nunca decide esto, lo decide Postgres.
- El modelo actual es **"todo requiere login"**: hace falta una cuenta y
  sesión iniciada para ver el directorio de empresas y de graduados, y para
  cargar organizaciones.
- La clave que usa el navegador (`sb_publishable_...`) es la **publishable
  key** de Supabase: está pensada para exponerse públicamente en el cliente.
  La protección real la da RLS, no el secreto de esa clave.
- **Nunca** se usa ni se debe agregar la `service_role key` en este proyecto:
  esa clave sí es secreta, se salta RLS por completo y solo debería usarse
  desde un backend (por ejemplo una Supabase Edge Function), nunca en código
  que corre en el navegador.
- Por eso, borrar cuentas de usuario (no solo empresas) **no está
  implementado en el navegador**: hacerlo requeriría la `service_role key`
  del lado del cliente, lo cual sería un riesgo de seguridad grave. Para dar
  de baja a un usuario, hacelo desde el dashboard de Supabase
  (Authentication → Users).
- Todo el HTML dinámico pasa por una función `esc()` que escapa caracteres
  especiales antes de insertarse en la página, para evitar XSS. El campo
  "sitio web" de una empresa valida que empiece con `http://` o `https://`
  antes de guardarse, para que no se pueda cargar un esquema de URL
  peligroso (por ejemplo `javascript:`).
- Los logos se validan en tamaño (máx. 800 KB) y tipo de archivo (imágenes
  únicamente) antes de subirse.
- Nadie puede auto-promoverse a admin ni "transferir" una empresa: dos
  triggers en la base de datos (`sql/003_lockdown_role_and_uid.sql`, refinado
  por `sql/004_admin_role_management.sql`) ignoran cualquier intento de
  cambiar `profiles.role` o `empresas.uid` desde el cliente, salvo un caso: un
  usuario que ya es admin sí puede cambiar el rol de **otro** usuario, desde
  el panel Admin de la app (buscar usuario → "Hacer admin" / "Quitar admin").
  Un usuario común nunca puede tocar su propio rol ni el de nadie más.

## Cuenta de usuario

- Cada graduado puede **editar su propio perfil** (nombre, apellido,
  teléfono) desde el botón de lápiz junto a su nombre en la barra superior.
- Hay **recuperación de contraseña** ("¿Olvidaste tu contraseña?" en la
  pantalla de login): envía un email con un link que trae de vuelta a la
  app para definir una contraseña nueva. Usa el mismo mecanismo nativo de
  Supabase Auth que la confirmación de cuenta, así que respeta el Site URL
  configurado (ver más abajo).

## Configuración inicial en Supabase (una sola vez)

Tu proyecto de Supabase ya tiene el esquema original (`profiles`, `empresas`,
políticas RLS y el trigger de alta de usuario). Para que la app funcione
completa falta correr algunas migraciones chicas, en este orden:

1. Entrá al [dashboard de Supabase](https://supabase.com/dashboard) → tu
   proyecto → **SQL Editor**.
2. Pegá y ejecutá el contenido de [`sql/002_migration_v2.sql`](sql/002_migration_v2.sql).
   Esto agrega:
   - la columna `email` en `profiles` (para poder mostrar el email de cada
     graduado en el directorio, ya que `auth.users` no es accesible
     directamente desde el cliente),
   - el bucket público de Storage `logos` con sus políticas de acceso.
3. Pegá y ejecutá también [`sql/003_lockdown_role_and_uid.sql`](sql/003_lockdown_role_and_uid.sql),
   que impide que un usuario se auto-promueva a admin o "robe" una empresa
   cambiando su dueño desde el cliente (ver sección de seguridad arriba).
4. Pegá y ejecutá [`sql/004_admin_role_management.sql`](sql/004_admin_role_management.sql),
   que habilita la funcionalidad de gestión de usuarios del panel Admin
   (buscar un usuario y cambiarle el rol). Sin este paso, el resto de la app
   funciona igual, pero los botones "Hacer admin" / "Quitar admin" van a
   fallar porque la base de datos todavía bloquea cualquier cambio de rol.
5. Pegá y ejecutá [`sql/006_updated_at_trigger.sql`](sql/006_updated_at_trigger.sql),
   para que la fecha de última modificación de cada empresa se actualice
   sola al editarla (antes quedaba siempre con la fecha de creación).
6. Pegá y ejecutá [`sql/007_fix_admin_role_via_dashboard.sql`](sql/007_fix_admin_role_via_dashboard.sql).
   **Importante:** sin este paso, si cambiás el rol de un usuario a mano
   desde el Table Editor o el SQL Editor de Supabase, el valor se revierte
   solo a `user` sin avisar ningún error (el trigger de 003/004 confunde
   una edición directa del dueño del proyecto con un intento de
   auto-escalación). Este paso lo corrige.
7. Pegá y ejecutá [`sql/008_roles_reference_table.sql`](sql/008_roles_reference_table.sql),
   que reemplaza el `check (role in ('user','admin'))` por una tabla real
   `public.roles` con clave foránea — mismo comportamiento, pero mejor
   normalizado (podés ver y documentar los roles válidos con un `select *
   from public.roles`, y agregar roles nuevos en el futuro sin tocar el
   constraint).
8. (Opcional) Pegá y ejecutá [`sql/005_seed_demo_empresas.sql`](sql/005_seed_demo_empresas.sql)
   si querés que el directorio no arranque vacío: carga 17 organizaciones
   de ejemplo sin asociarlas a ningún usuario real.
9. Registrate normalmente desde la app (pestaña "Registrarse"). La
   **primera** cuenta de un proyecto nuevo no es admin automáticamente:
   hay que asignarle el rol manualmente (paso siguiente). A partir de ahí,
   ese primer admin puede promover a cualquier otro usuario desde la propia
   app, sin volver a tocar la base de datos.
10. Para convertirte en administrador la primera vez, en el **Table Editor**
    de Supabase abrí la tabla `profiles` y cambiá tu fila: `role = admin`. O
    corré en el SQL Editor:
    ```sql
    update public.profiles set role = 'admin' where email = 'tu-email@ejemplo.com';
    ```
    (Esto ya funciona bien una vez que corriste el paso 6 de arriba.)

Si en algún momento armás un proyecto de Supabase nuevo desde cero, usá
[`sql/001_schema.sql`](sql/001_schema.sql), que contiene el esquema completo
(incluido el trigger de `updated_at`) y ya incluye todo lo anterior salvo el
paso 6 (opcional) y el registro de tu primer usuario admin.

### Confirmación de email

Por defecto Supabase Auth pide confirmar el email antes de poder iniciar
sesión. Podés dejarlo así (más seguro) o desactivarlo en
**Authentication → Providers → Email → Confirm email** si preferís que el
alta sea inmediata. La app ya contempla ambos casos.

El correo de confirmación (y el de recuperación de contraseña) lo envía el
propio Supabase (no hace falta, ni conviene, armar un servidor de mails
aparte solo para esto). Lo que sí hay que configurar es a dónde te lleva el
link una vez confirmado: **Authentication → URL Configuration**:
- **Site URL**: `https://<tu-usuario>.github.io/<tu-repo>/` (por ejemplo
  `https://robertosmyth.github.io/CUPFI/`). Si queda con el valor por
  defecto (`http://localhost:3000` o similar), el link del mail te va a
  llevar a una página que no existe — el mail y la confirmación en sí
  funcionan igual, solo cambia la redirección final.
- **Redirect URLs**: agregá esa misma URL a la lista permitida.

Si más adelante querés usar tu propio dominio o servicio de email (por
ejemplo para que los mails salgan desde una dirección propia en vez de la
genérica de Supabase), se configura en **Authentication → Settings → SMTP
Settings** con un proveedor externo (Resend, Postmark, SendGrid, etc.). Es
opcional: no afecta la seguridad ni el funcionamiento, solo la marca/remitente
del mail.

## Publicar el sitio (GitHub Pages)

1. Hacer push de este repositorio a la rama `main` de GitHub.
2. En GitHub: **Settings → Pages → Build and deployment → Source**: elegir
   "Deploy from a branch", rama `main`, carpeta `/ (root)`.
3. A los pocos minutos el sitio queda publicado en
   `https://<usuario>.github.io/<repo>/`.

Al ser un sitio estático, no hace falta build, servidor propio, ni variables
de entorno secretas: la única clave usada en el cliente es la publishable
key, que es segura de publicar.

## Desarrollo local

No requiere instalación. Alcanza con abrir `index.html` con un servidor
estático simple, por ejemplo:

```bash
npx serve .
# o
python3 -m http.server 8080
```

(Abrir `index.html` directamente con `file://` también funciona, salvo
restricciones de CORS de algunos navegadores con módulos ES; si eso pasa,
usá alguno de los comandos de arriba.)
