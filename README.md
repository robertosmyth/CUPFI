# CUPFI · Red de Vinculación Empresarial FI-UNLZ

Plataforma web para conectar graduados y empresas vinculadas a la Facultad de
Ingeniería de la Universidad Nacional de Lomas de Zamora: directorio de
organizaciones, directorio de graduados, detección automática de
oportunidades de vinculación (necesidades ↔ ofertas) y mapa.

Es un sitio 100% estático (HTML + CSS + JS sin build) que usa
[Supabase](https://supabase.com) como backend (autenticación, base de datos y
almacenamiento de archivos).

## Estructura del proyecto

```
CUPFI/
├── index.html                # Punto de entrada de la app
├── assets/
│   ├── css/style.css          # Estilos
│   └── js/
│       ├── supabaseClient.js  # Cliente de Supabase (URL + publishable key)
│       ├── auth.js            # Registro / login / logout / perfil
│       ├── empresas.js        # CRUD de empresas + subida de logos
│       ├── matching.js        # Motor de "vinculación" (necesidades ↔ ofertas)
│       ├── utils.js           # Helpers (escape HTML, validaciones, etc.)
│       └── main.js            # UI: navegación, renderizado, listeners
├── sql/
│   ├── 001_schema.sql                     # Esquema completo (documentación / proyecto nuevo)
│   ├── 002_migration_v2.sql               # Migración a correr en un proyecto ya existente
│   ├── 003_lockdown_role_and_uid.sql      # Bloquea auto-escalación de rol / robo de empresa
│   ├── 004_admin_role_management.sql      # Permite que un admin cambie el rol de otros usuarios
│   └── 005_seed_demo_empresas.sql         # (Opcional) 17 empresas de ejemplo para poblar el directorio
└── README.md
```

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
  especiales antes de insertarse en la página, para evitar XSS.
- Los logos se validan en tamaño (máx. 800 KB) y tipo de archivo (imágenes
  únicamente) antes de subirse.
- Nadie puede auto-promoverse a admin ni "transferir" una empresa: dos
  triggers en la base de datos (`sql/003_lockdown_role_and_uid.sql`, refinado
  por `sql/004_admin_role_management.sql`) ignoran cualquier intento de
  cambiar `profiles.role` o `empresas.uid` desde el cliente, salvo un caso: un
  usuario que ya es admin sí puede cambiar el rol de **otro** usuario, desde
  el panel Admin de la app (buscar usuario → "Hacer admin" / "Quitar admin").
  Un usuario común nunca puede tocar su propio rol ni el de nadie más.

## Configuración inicial en Supabase (una sola vez)

Tu proyecto de Supabase ya tiene el esquema original (`profiles`, `empresas`,
políticas RLS y el trigger de alta de usuario). Para que la app funcione
completa falta correr una migración chica:

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
5. Registrate normalmente desde la app (pestaña "Registrarse"). La
   **primera** cuenta de un proyecto nuevo no es admin automáticamente:
   hay que asignarle el rol manualmente (paso siguiente). A partir de ahí,
   ese primer admin puede promover a cualquier otro usuario desde la propia
   app, sin volver a tocar la base de datos.
6. Para convertirte en administrador la primera vez, en el **Table Editor**
   de Supabase abrí la tabla `profiles` y cambiá tu fila: `role = admin`. O
   corré en el SQL Editor:
   ```sql
   update public.profiles set role = 'admin' where email = 'tu-email@ejemplo.com';
   ```
7. (Opcional) Si querés que el directorio no arranque vacío, pegá y ejecutá
   [`sql/005_seed_demo_empresas.sql`](sql/005_seed_demo_empresas.sql): carga
   17 organizaciones de ejemplo (las mismas del prototipo original) sin
   asociarlas a ningún usuario real. Un admin puede editarlas o borrarlas
   luego desde el panel Admin.

Si en algún momento armás un proyecto de Supabase nuevo desde cero, usá
[`sql/001_schema.sql`](sql/001_schema.sql), que contiene el esquema completo
y ya incluye lo anterior.

### Confirmación de email

Por defecto Supabase Auth pide confirmar el email antes de poder iniciar
sesión. Podés dejarlo así (más seguro) o desactivarlo en
**Authentication → Providers → Email → Confirm email** si preferís que el
alta sea inmediata. La app ya contempla ambos casos.

El correo de confirmación lo envía el propio Supabase (no hace falta, ni
conviene, armar un servidor de mails aparte solo para esto). Lo que sí hay
que configurar es a dónde te lleva el link una vez confirmado:
**Authentication → URL Configuration**:
- **Site URL**: `https://<tu-usuario>.github.io/<tu-repo>/` (por ejemplo
  `https://robertosmyth.github.io/CUPFI/`). Si queda con el valor por
  defecto (`http://