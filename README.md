# CUPFI · Red de Vinculación Empresarial FI-UNLZ

Plataforma web para conectar graduados y empresas vinculadas a la Facultad de
Ingeniería de la Universidad Nacional de Lomas de Zamora: cada graduado puede
cargar una o varias empresas propias, con sus servicios/productos y sus
necesidades, y el sistema detecta automáticamente qué empresas de otros
graduados pueden cubrir esas necesidades (y viceversa).

Es un sitio estático (HTML + CSS + TypeScript, sin backend propio) que usa
[Vite](https://vitejs.dev) como build tool y
[Supabase](https://supabase.com) como backend (autenticación, base de datos y
almacenamiento de archivos). El resultado del build sigue siendo HTML/CSS/JS
plano — Vite solo empaqueta, tipa y optimiza durante el desarrollo, no agrega
ningún servidor propio.

## Estructura del proyecto

```
CUPFI/
├── index.html                 # Punto de entrada de la app (lo usa Vite)
├── package.json                # Dependencias y scripts (dev/build/test)
├── vite.config.ts              # Configuración de Vite + Vitest
├── tsconfig.json                # Configuración de TypeScript (strict)
├── .github/workflows/deploy.yml # Build + deploy automático a GitHub Pages
├── assets/
│   ├── css/style.css          # Estilos (incluye responsive)
│   └── js/
│       ├── types.ts           # Tipos de la base (Database) + tipos de dominio de la app
│       ├── supabaseClient.ts  # Cliente de Supabase (URL + publishable key)
│       ├── auth.ts            # Registro / login / logout / perfil / recuperar contraseña
│       ├── empresas.ts        # CRUD de empresas + subida de logos
│       ├── matching.ts        # Motor de "vinculación" (necesidades ↔ ofertas)
│       ├── utils.ts           # Helpers (escape HTML, validaciones, etc.)
│       ├── main.ts            # UI: navegación, renderizado, listeners
│       └── *.test.ts          # Tests (Vitest) de matching.ts y utils.ts
├── sql/
│   ├── 001_schema.sql                     # Esquema completo y consolidado (correr en un proyecto nuevo)
│   ├── 005_seed_demo_empresas.sql         # (Opcional) 17 empresas de ejemplo para poblar el directorio
│   ├── 011_empresa_uid_on_delete_set_null.sql # Migración para el proyecto ya existente (ver más abajo)
│   └── historial/                         # Migraciones ya aplicadas al proyecto actual (solo referencia,
│                                           # no hace falta correrlas en un proyecto nuevo: 001 ya las incluye)
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
- El motor de vinculación (`assets/js/matching.ts`) nunca cruza dos
  empresas del mismo graduado entre sí.
- Una empresa puede tener, además de su administrador principal, **otros
  usuarios asociados** (por ejemplo varios socios con cuentas
  separadas): un admin los agrega o quita desde "Gestión de empresas"
  → ícono de personas. Cualquiera de esos usuarios puede editar la
  empresa, y el motor de vinculación tampoco cruza entre sí empresas
  que comparten algún usuario asociado.

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
  triggers en la base de datos (`prevent_role_change` y
  `prevent_empresa_uid_change`, definidos en
  [`sql/001_schema.sql`](sql/001_schema.sql); su historia de refinamiento
  está en [`sql/historial/`](sql/historial/)) ignoran cualquier intento de
  cambiar `profiles.role` o `empresas.uid` desde el cliente, salvo un caso: un
  usuario que ya es admin sí puede cambiar el rol de **otro** usuario, desde
  el panel Admin de la app (buscar usuario → "Hacer admin" / "Quitar admin").
  Un usuario común nunca puede tocar su propio rol ni el de nadie más.

## Cuenta de usuario

- Cada graduado puede **editar su propio perfil** (nombre, apellido,
  teléfono, email) desde el botón de lápiz junto a su nombre en la barra
  superior. Si cambia el email, Supabase le manda un correo de
  confirmación a la dirección nueva; hasta que lo confirma, el login
  sigue siendo con el email anterior (esto depende de la opción
  "Confirm email change" en Authentication → Providers → Email; si está
  activada, según la versión del proyecto puede pedir confirmar también
  desde la casilla anterior).
- Desde el mismo modal de perfil hay un botón **"Cambiar contraseña por
  email"**: manda un correo con un link para definir una contraseña
  nueva, igual que la recuperación de contraseña del login.
- Hay **recuperación de contraseña** ("¿Olvidaste tu contraseña?" en la
  pantalla de login): envía un email con un link que trae de vuelta a la
  app para definir una contraseña nueva. Usa el mismo mecanismo nativo de
  Supabase Auth que la confirmación de cuenta, así que respeta el Site URL
  configurado (ver más abajo).

## Configuración inicial en Supabase (una sola vez)

`sql/001_schema.sql` es el esquema **completo y consolidado**: define
`profiles`, `empresas`, `empresa_usuarios`, `roles`, todas las políticas RLS,
triggers, el bucket de Storage `logos` y las funciones de validación. Es
idempotente (usa `if not exists` / `or replace` / `drop ... if exists` en
todos lados), así que es seguro correrlo más de una vez.

1. Entrá al [dashboard de Supabase](https://supabase.com/dashboard) → tu
   proyecto → **SQL Editor**.
2. Pegá y ejecutá el contenido completo de
   [`sql/001_schema.sql`](sql/001_schema.sql).
3. (Opcional) Pegá y ejecutá
   [`sql/005_seed_demo_empresas.sql`](sql/005_seed_demo_empresas.sql) si
   querés que el directorio no arranque vacío: carga 17 organizaciones de
   ejemplo sin asociarlas a ningún usuario real.
4. Registrate normalmente desde la app (pestaña "Registrarse"). La
   **primera** cuenta de un proyecto nuevo no es admin automáticamente: hay
   que asignarle el rol manualmente (paso siguiente). A partir de ahí, ese
   primer admin puede promover a cualquier otro usuario desde la propia app,
   sin volver a tocar la base de datos.
5. Para convertirte en administrador la primera vez, en el **Table Editor**
   de Supabase abrí la tabla `profiles` y cambiá tu fila: `role = admin`. O
   corré en el SQL Editor:
   ```sql
   update public.profiles set role = 'admin' where email = 'tu-email@ejemplo.com';
   ```

### Migración pendiente en el proyecto ya existente

`sql/001_schema.sql` es seguro de re-correr, pero **no** actualiza
restricciones de columnas que ya existen (`create table if not exists` no
toca una tabla que ya está creada). Por eso, si tu proyecto de Supabase ya
tiene el esquema viejo aplicado, corré una sola vez además
[`sql/011_empresa_uid_on_delete_set_null.sql`](sql/011_empresa_uid_on_delete_set_null.sql):
corrige que borrar la cuenta del administrador principal de una empresa
borrara la empresa entera en cascada (ahora la deja "sin administrador
principal asignado" en vez de desaparecer). No borra ni modifica datos
existentes.

Este proyecto (CUPFI) ya tiene el esquema aplicado en producción: las
migraciones que lo fueron construyendo paso a paso quedaron archivadas en
[`sql/historial/`](sql/historial/) como referencia histórica — no hace falta
volver a correrlas, `001_schema.sql` ya representa el resultado final de
todas ellas combinadas. Si en algún momento hay dudas de si la base en vivo
quedó desalineada con `001_schema.sql`, correrlo de nuevo en el SQL Editor
es seguro (no destruye datos) y sirve como chequeo: si no tira errores, el
esquema está al día.

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
Settings** con un proveedor externo (Resend, Postmark, SendGrid, etc.). No
afecta la seguridad ni requiere tocar código.

### SMTP propio (recomendado antes de tener usuarios reales)

El servicio de email que trae Supabase por defecto es solo para pruebas:
tiene un límite muy bajo de correos por hora (confirmación de cuenta, "olvidé
mi contraseña", cambio de email). Antes de que la app tenga usuarios de
verdad conviene conectar un proveedor SMTP propio — no cambia nada del
código, solo la configuración del proyecto de Supabase:

1. Crear cuenta gratis en [Resend](https://resend.com) (3000 emails/mes
   gratis; permite mandar a cualquier destinatario real desde su dominio de
   pruebas `onboarding@resend.dev`, sin necesitar dominio propio todavía).
2. En Resend → **API Keys** → crear una y copiarla.
3. En Supabase → **Authentication → Settings → SMTP Settings** → activar
   "Enable Custom SMTP" y cargar:
   - Host: `smtp.resend.com`
   - Puerto: `465` (SSL) o `587` (TLS)
   - Usuario: `resend`
   - Contraseña: la API key del paso 2
   - Sender email: `onboarding@resend.dev` (hasta tener dominio propio)
   - Sender name: por ejemplo `CUPFI`
4. Probar desde la app con "¿Olvidaste tu contraseña?".

Cuando el proyecto tenga un dominio propio: en Resend → **Domains**, agregar
el dominio y cargar los registros DNS (SPF/DKIM) que da Resend en el
proveedor donde está registrado el dominio; una vez verificado, cambiar el
"Sender email" en Supabase a una dirección de ese dominio (por ejemplo
`no-reply@turedcupfi.com`). No hace falta cambiar nada más.

## Publicar el sitio (GitHub Pages)

El repo incluye [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml):
cada push a `main` corre los tests, tipa y compila el proyecto (`npm run
build`) y publica automáticamente la carpeta `dist/` resultante a GitHub
Pages. No hace falta compilar a mano ni commitear el build.

Paso único y manual (una sola vez por repositorio):

1. En GitHub: **Settings → Pages → Build and deployment → Source**: elegir
   **"GitHub Actions"** (no "Deploy from a branch" — ese modo viejo no sirve
   más porque ahora hay un paso de build antes de publicar).
2. Hacer push a `main`. A los pocos minutos el sitio queda publicado en
   `https://<usuario>.github.io/<repo>/` (podés ver el progreso en la pestaña
   **Actions** del repositorio).

No hace falta ninguna variable de entorno secreta en el workflow: la única
clave usada en el cliente es la publishable key de Supabase, que ya está en
el código fuente porque es segura de publicar (ver "Cómo funciona la
seguridad" más arriba).

## Desarrollo local

Requiere [Node.js](https://nodejs.org) 20.19+ o 22.12+ (lo que pide Vite 8).

```bash
npm install       # una sola vez
npm run dev       # levanta un servidor de desarrollo con recarga instantánea
```

Otros comandos útiles:

```bash
npm run build     # tipa con TypeScript y genera el sitio final en dist/
npm run preview   # sirve el contenido de dist/ para probarlo antes de publicar
npm test          # corre los tests (Vitest)
```

### Regenerar los tipos de la base de datos

`assets/js/types.ts` fue escrito a mano a partir de `sql/001_schema.sql`
porque este entorno no tenía credenciales de Supabase para generarlos
automáticamente. Si en algún momento se prefiere mantenerlos sincronizados
con el CLI oficial:

```bash
npx supabase login
npx supabase gen types typescript --project-id qxsqjufhkdmhowshspgb --schema public
```

Y pegar el resultado en `assets/js/types.ts` respetando la forma
`Database.public.Tables.<tabla>.Row/Insert/Update/Relationships` (ver el
comentario al principio de ese archivo — hay un detalle no obvio ahí sobre
por qué esos tipos tienen que ser `type` y no `interface`).
