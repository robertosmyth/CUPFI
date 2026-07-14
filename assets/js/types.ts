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
  created_at: string;
  updated_at: string;
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
  created_at?: string;
}

// Campos propios de una empresa tal como los usa la UI (camelCase). No
// incluye `id` ni `usuarios` porque no se mandan en un insert/update.
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
  ofertas: string[];
  instalaciones: string[];
  needsUncovered: string[];
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
}

export type MatchStrength = 'strong' | 'weak';

export interface MatchResult {
  seeker: Empresa;
  need: string;
  provider: Empresa;
  offer: string;
  strength: MatchStrength;
}

export interface MatchForOrg {
  org: Empresa;
  need: string;
  offer: string;
  strength: MatchStrength;
}

export interface MatchGroup {
  seeker: Empresa;
  provider: Empresa;
  items: Array<{ need: string; offer: string; strength: MatchStrength }>;
}
