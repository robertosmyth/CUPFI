// ══════════════════════════════════════════════
// Tipos de datos: esquema de Supabase (snake_case, ver sql/001_schema.sql)
// + tipos de dominio de la app (camelCase, ver empresas.ts fromDb/toDb).
//
// Escritos a mano a partir del esquema real porque generarlos con
// `supabase gen types typescript` requiere credenciales del proyecto que
// este entorno no tiene. Si en algún momento se quiere mantenerlos
// sincronizados automáticamente con la base, se pueden reemplazar por:
//   npx supabase gen types typescript --project-id qxsqjufhkdmhowshspgb --schema public
// (login previo con `npx supabase login`), respetando esta misma forma
// (Database.public.Tables.<tabla>.Row/Insert/Update).
// ══════════════════════════════════════════════

// ─── Esquema de la base (snake_case) ───────────────────────────────
//
// OJO: estos son `type`, no `interface`, a propósito. TypeScript solo
// trata un tipo como compatible con un índice `Record<string, unknown>`
// (lo que exige el generic de @supabase/supabase-js para cada tabla) si
// está escrito como alias de tipo — a un `interface` NO le aplica esa
// relajación (por la posibilidad de "declaration merging" a futuro), así
// que quedaría "never" en cada .from(...)/.insert(...)/.update(...) de
// forma silenciosa. Costó bastante encontrar esto, documentado para no
// repetir el error si se agrega una tabla nueva.

export type ProfileRow = {
  id: string;
  nombre: string;
  apellido: string;
  email: string | null;
  tel: string | null;
  role: string;
  is_webmaster: boolean;
  guia_vista: boolean;
  created_at: string;
};

export type EmpresaRow = {
  id: number;
  uid: string | null;
  cuit: string;
  tipo: string;
  nombre: string;
  sector: string | null;
  calle: string | null;
  ciudad: string | null;
  provincia: string | null;
  pais: string | null;
  referente: string | null;
  cargo: string | null;
  email_org: string | null;
  tel: string | null;
  web: string | null;
  descripcion: string | null;
  logo: string | null;
  ofertas: string[];
  instalaciones: string[];
  needs_uncovered: string[];
  needs_covered: string[];
  items_migrados: boolean;
  created_at: string;
  updated_at: string;
};

// ─── Etapa 1 (ver sql/012_etapa1_conexiones.sql) ───────────────────
export type CategoriaRow = {
  id: number;
  nombre: string;
  subcategorias: string[];
  orden: number;
  es_otros: boolean;
  created_at: string;
};

export type ItemTipo = 'oferta' | 'necesidad';

export type EmpresaItemRow = {
  id: number;
  empresa_id: number;
  tipo: ItemTipo;
  categoria_id: number;
  subcategoria: string;
  revisar: boolean;
  created_at: string;
};

export type ConexionRow = {
  id: number;
  empresa_necesita_id: number;
  empresa_ofrece_id: number;
  categoria_id: number;
  acepta_necesita_at: string | null;
  acepta_necesita_por: string | null;
  acepta_ofrece_at: string | null;
  acepta_ofrece_por: string | null;
  rechazada_at: string | null;
  rechazada_por: string | null;
  rechazada_empresa_id: number | null;
  match_at: string | null;
  created_at: string;
  updated_at: string;
};

export type MensajeRow = {
  id: number;
  conexion_id: number;
  empresa_id: number;
  autor_id: string | null;
  contenido: string;
  created_at: string;
};

export type BitacoraRow = {
  id: number;
  created_at: string;
  user_id: string | null;
  user_nombre: string | null;
  user_email: string | null;
  accion: string;
  entidad: string | null;
  entidad_id: string | null;
  detalle: Record<string, unknown>;
};

export type ContactoResumenRow = {
  conexion_id: number;
  empresa_id: number;
  cantidad: number;
  primer_mensaje: string;
  ultimo_mensaje: string;
};

export type SolicitudTipo = 'conseguir' | 'ofrecer';
export type SolicitudEstado = 'pendiente' | 'aceptada' | 'rechazada' | 'cancelada';
export type SolicitudAccion = 'aceptar' | 'rechazar' | 'cancelar';

// Ver sql/013_solicitudes.sql. Remitente: una empresa O una persona.
export type SolicitudRow = {
  id: number;
  tipo: SolicitudTipo;
  origen_empresa_id: number | null;
  origen_persona_id: string | null;
  enviada_por: string | null;
  destino_empresa_id: number;
  categoria_id: number;
  subcategoria: string;
  estado: SolicitudEstado;
  respondida_at: string | null;
  respondida_por: string | null;
  created_at: string;
  updated_at: string;
};

export type SolicitudMensajeRow = {
  id: number;
  solicitud_id: number;
  lado: 'origen' | 'destino';
  autor_id: string | null;
  contenido: string;
  created_at: string;
};

export type SolicitudResumenRow = {
  solicitud_id: number;
  lado: 'origen' | 'destino';
  cantidad: number;
  primer_mensaje: string;
  ultimo_mensaje: string;
};

// Resultado de solicitud_enviar: si ya había coincidencia automática con
// esa empresa, la solicitud cuenta como aceptación de la conexión.
export type SolicitudEnvioResultado = {
  resultado: 'solicitud' | 'conexion_aceptada' | 'conexion_match' | 'conexion_ya_aceptada' | 'conexion_en_match';
  solicitud_id: number | null;
  conexion_id: number | null;
  item_agregado: boolean;
};

export type EmpresaUsuarioRow = {
  empresa_id: number;
  user_id: string;
  created_at: string;
};

export type RoleRow = {
  name: string;
  descripcion: string;
};

export interface CheckProfileDuplicatesResult {
  nombre_apellido: boolean;
  email: boolean;
  tel: boolean;
}

// Forma esperada por `createClient<Database>(...)` de @supabase/supabase-js:
// da autocompletado y chequeo de tipos en cada .from(...) / .rpc(...).
export interface Database {
  public: {
    Tables: {
      profiles: {
        Row: ProfileRow;
        Insert: Partial<ProfileRow> & Pick<ProfileRow, 'id' | 'nombre' | 'apellido'>;
        Update: Partial<ProfileRow>;
        Relationships: [];
      };
      empresas: {
        Row: EmpresaRow;
        Insert: Partial<EmpresaRow> & Pick<EmpresaRow, 'cuit' | 'nombre'>;
        Update: Partial<EmpresaRow>;
        Relationships: [];
      };
      empresa_usuarios: {
        Row: EmpresaUsuarioRow;
        Insert: Pick<EmpresaUsuarioRow, 'empresa_id' | 'user_id'>;
        Update: Partial<EmpresaUsuarioRow>;
        Relationships: [];
      };
      roles: {
        Row: RoleRow;
        Insert: RoleRow;
        Update: Partial<RoleRow>;
        Relationships: [];
      };
      categorias: {
        Row: CategoriaRow;
        Insert: Partial<CategoriaRow> & Pick<CategoriaRow, 'nombre'>;
        Update: Partial<CategoriaRow>;
        Relationships: [];
      };
      // Las tres siguientes son de solo lectura desde el navegador: se
      // escriben únicamente a través de las funciones (Functions) de abajo.
      empresa_items: {
        Row: EmpresaItemRow;
        Insert: never;
        Update: never;
        Relationships: [];
      };
      conexiones: {
        Row: ConexionRow;
        Insert: never;
        Update: never;
        Relationships: [];
      };
      mensajes: {
        Row: MensajeRow;
        Insert: never;
        Update: never;
        Relationships: [];
      };
      bitacora: {
        Row: BitacoraRow;
        Insert: never;
        Update: never;
        Relationships: [];
      };
      solicitudes: {
        Row: SolicitudRow;
        Insert: never;
        Update: never;
        Relationships: [];
      };
      solicitud_mensajes: {
        Row: SolicitudMensajeRow;
        Insert: never;
        Update: never;
        Relationships: [];
      };
    };
    // OJO: acá tiene que ir un tipo SIN index signature (no
    // Record<string, never>). Un Record<string, never> sí tiene index
    // signature, y TablesAndViews de supabase-js hace `Schema['Tables'] &
    // Exclude<Schema['Views'], ''>`: al intersecar Tables con un tipo que
    // tiene "cualquier string key es never", cada tabla colapsa a never.
    Views: Record<never, never>;
    Functions: {
      check_profile_duplicates: {
        Args: {
          p_nombre: string | null;
          p_apellido: string | null;
          p_tel?: string | null;
          p_email?: string | null;
          p_exclude_id?: string | null;
        };
        Returns: CheckProfileDuplicatesResult;
      };
      guardar_items_empresa: {
        Args: { p_empresa: number; p_items: Array<{ tipo: ItemTipo; categoria_id: number; subcategoria: string }> };
        Returns: EmpresaItemRow[];
      };
      conexion_responder: {
        Args: { p_necesita: number; p_ofrece: number; p_categoria: number; p_accion: ConexionAccion };
        Returns: ConexionRow;
      };
      enviar_mensaje: {
        Args: { p_conexion: number; p_contenido: string };
        Returns: MensajeRow;
      };
      webmaster_contacto_resumen: {
        Args: Record<never, never>;
        Returns: ContactoResumenRow[];
      };
      registrar_evento: {
        Args: { p_accion: 'sesion_inicio' | 'sesion_cierre' };
        Returns: undefined;
      };
      marcar_guia_vista: {
        Args: Record<never, never>;
        Returns: undefined;
      };
      empresa_item_agregar: {
        Args: { p_empresa: number; p_tipo: ItemTipo; p_categoria: number; p_subcategoria: string };
        Returns: EmpresaItemRow;
      };
      empresa_item_quitar: {
        Args: { p_item: number };
        Returns: undefined;
      };
      solicitud_enviar: {
        Args: {
          p_tipo: SolicitudTipo; p_origen_empresa: number | null; p_destino: number; p_categoria: number;
          p_subcategoria: string; p_mensaje: string | null; p_agregar_item: boolean;
        };
        Returns: SolicitudEnvioResultado;
      };
      solicitud_responder: {
        Args: { p_solicitud: number; p_accion: SolicitudAccion };
        Returns: SolicitudRow;
      };
      solicitud_enviar_mensaje: {
        Args: { p_solicitud: number; p_contenido: string };
        Returns: SolicitudMensajeRow;
      };
      webmaster_solicitudes_resumen: {
        Args: Record<never, never>;
        Returns: SolicitudResumenRow[];
      };
    };
    Enums: Record<never, never>;
    CompositeTypes: Record<never, never>;
  };
}

// ─── Tipos de dominio de la app (camelCase, ver empresas.ts) ───────

export interface Profile {
  id: string;
  nombre: string;
  apellido: string;
  email: string | null;
  tel: string | null;
  role: string;
  // Opcionales por compatibilidad: si sql/012 todavía no se corrió, la
  // columna no existe y se tratan como false.
  is_webmaster?: boolean;
  guia_vista?: boolean;
  created_at?: string;
}

export type ConexionAccion = 'aceptar' | 'rechazar' | 'retirar';

export interface Categoria {
  id: number;
  nombre: string;
  subcategorias: string[];
  orden: number;
  esOtros: boolean;
}

// Una oferta o necesidad de una empresa: categoría + subcategoría.
export interface EmpresaItem {
  id?: number; // id en empresa_items (no lo tienen los ítems nuevos del formulario)
  tipo: ItemTipo;
  categoriaId: number;
  subcategoria: string;
  revisar: boolean;
}

// Campos propios de una empresa tal como los usa la UI (camelCase). No
// incluye `id` ni `usuarios` porque no se mandan en un insert/update.
// Las ofertas y necesidades sin cubrir ya no son texto libre sino ítems
// con categoría + subcategoría (Empresa.items, tabla empresa_items); las
// columnas viejas empresas.ofertas / needs_uncovered quedan solo como
// respaldo en la base y la app no las lee ni las escribe.
export interface EmpresaFields {
  cuit: string;
  tipo: string;
  nombre: string;
  sector: string;
  calle: string;
  ciudad: string;
  provincia: string;
  pais: string;
  referente: string;
  cargo: string;
  emailOrg: string;
  tel: string;
  web: string;
  desc: string;
  logo: string | null;
  instalaciones: string[];
  needsCovered: string[];
}

// Payload parcial que se manda a createEmpresa/updateEmpresa (solo los
// campos presentes se traducen a columnas, ver toDb() en empresas.ts).
export type EmpresaInput = Partial<EmpresaFields>;

export interface Empresa extends EmpresaFields {
  id: number;
  uid: string | null;
  // Todos los usuarios con acceso a esta empresa (administrador principal +
  // asociados), calculado en main.ts (usuariosDeEmpresa). Ausente hasta que
  // se calcula la primera vez.
  usuarios?: string[];
  // Ofertas y necesidades (empresa_items). Se completa en main.ts al cargar.
  items: EmpresaItem[];
}

// ─── Conexiones (ver matching.ts) ──────────────────────────────────
// 'exacta': misma categoría y misma subcategoría. 'categoria': misma
// categoría, distinta subcategoría.
export type NivelCoincidencia = 'exacta' | 'categoria';

export interface ParCoincidencia {
  necesidad: string; // subcategoría pedida ('' = sin especificar)
  oferta: string;    // subcategoría ofrecida
  nivel: NivelCoincidencia;
}

// Una conexión sugerida, calculada a partir de los ítems actuales:
// "necesita" necesita [categoria] ← "ofrece" la ofrece.
export interface Sugerencia {
  key: string;
  necesita: Empresa;
  ofrece: Empresa;
  categoria: Categoria;
  pares: ParCoincidencia[];
  nivel: NivelCoincidencia; // 'exacta' si al menos un par es exacto
}

export type EstadoConexion =
  | 'sugerida'        // nadie aceptó
  | 'esperando_otra'  // mi empresa aceptó, falta la otra
  | 'otra_acepto'     // la otra empresa aceptó, falta la mía
  | 'match'           // ambas aceptaron
  | 'rechazada';

export type LadoConexion = 'necesita' | 'ofrece';
