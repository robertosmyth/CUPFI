// ══════════════════════════════════════════════
// Edge Function: admin-update-user
//
// Deja que un admin cambie el email y/o la contraseña de OTRO usuario,
// sin pasar por el flujo normal de verificación de Supabase Auth (sin
// link de confirmación al email nuevo, sin email de "restablecer
// contraseña"). Se aplica al instante.
//
// TRADE-OFF DE SEGURIDAD A PROPÓSITO: la verificación por correo existe
// para que nadie pueda "robarse" una cuenta ajena cambiándole el email o
// la contraseña sin que su dueño se entere. Esta función se salta esa
// protección deliberadamente (decisión del equipo del proyecto) para que
// un admin pueda resolver casos donde el usuario perdió acceso a su
// email, escribió mal sus datos al registrarse, etc. Cualquier cuenta
// admin puede hacer esto sobre cualquier otra cuenta (mismo nivel de
// confianza que ya existe hoy entre admins para cambiar roles, ver
// toggleUserRole en assets/js/main.ts).
//
// Por qué hace falta una Edge Function y no alcanza con código de
// cliente: cambiar el email/contraseña de OTRO usuario (no el propio)
// requiere la Admin API de Supabase Auth (auth.admin.updateUserById),
// que solo funciona con la service_role key. Esa clave nunca debe
// llegar al navegador (se salta RLS por completo) — por eso este código
// corre en el servidor de Supabase, no en el sitio.
//
// DESPLIEGUE: pegar este archivo tal cual en el dashboard de Supabase →
// Edge Functions → Create a new function → nombre "admin-update-user" →
// Deploy. No hace falta configurar ningún secreto a mano: SUPABASE_URL,
// SUPABASE_ANON_KEY y SUPABASE_SERVICE_ROLE_KEY ya están disponibles
// automáticamente en toda Edge Function del proyecto.
// ══════════════════════════════════════════════
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

// Traduce los errores más comunes de la Admin API a español. El resto se
// devuelve tal cual (el cliente ya sabe mostrar mensajes en inglés como
// último recurso, ver friendlyError en assets/js/utils.ts).
function translateError(msg: string): string {
  if (/already been registered|already exists|duplicate/i.test(msg)) {
    return 'Ya existe otra cuenta con ese email.';
  }
  if (/password.*at least/i.test(msg)) {
    return 'La contraseña debe tener al menos 8 caracteres.';
  }
  return msg;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  if (req.method !== 'POST') {
    return json({ error: 'Método no soportado.' }, 405);
  }

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return json({ error: 'No autorizado.' }, 401);

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;

    // Cliente "de usuario": valida el JWT de quien llama y respeta RLS.
    // Con esto alcanza para confirmar la identidad y el rol de quien
    // pide el cambio — todavía no se toca la service_role key.
    const callerClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: { user: caller }, error: callerError } = await callerClient.auth.getUser();
    if (callerError || !caller) return json({ error: 'Sesión inválida.' }, 401);

    const { data: callerProfile, error: callerProfileError } = await callerClient
      .from('profiles')
      .select('role')
      .eq('id', caller.id)
      .maybeSingle();
    if (callerProfileError || !callerProfile || callerProfile.role !== 'admin') {
      return json({ error: 'Solo un administrador puede hacer esto.' }, 403);
    }

    const body = await req.json().catch(() => ({}));
    const targetUserId: string | undefined = body.userId;
    const email: string | undefined = body.email || undefined;
    const password: string | undefined = body.password || undefined;

    if (!targetUserId) return json({ error: 'Falta el id del usuario a modificar.' }, 400);
    if (!email && !password) return json({ error: 'No hay ningún cambio para aplicar.' }, 400);
    if (password && password.length < 8) {
      return json({ error: 'La contraseña debe tener al menos 8 caracteres.' }, 400);
    }

    // Chequeo de duplicados ANTES de tocar auth.users, reusando la misma
    // función que usa el resto de la app (ver
    // sql/historial/010_unique_profile_constraints.sql). Evita dejar
    // auth.users y profiles desincronizados si el email ya está en uso.
    if (email) {
      const { data: dup, error: dupError } = await callerClient.rpc('check_profile_duplicates', {
        p_nombre: null,
        p_apellido: null,
        p_email: email,
        p_exclude_id: targetUserId,
      });
      if (dupError) return json({ error: translateError(dupError.message) }, 400);
      if (dup?.email) return json({ error: 'Ya existe otra cuenta con ese email.' }, 400);
    }

    // Recién acá se crea el cliente con privilegios totales — nunca sale
    // de este servidor, y solo se llega hasta acá después de confirmar
    // que quien llama ya es admin.
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const adminClient = createClient(supabaseUrl, serviceRoleKey);

    const updatePayload: Record<string, unknown> = {};
    if (email) { updatePayload.email = email; updatePayload.email_confirm = true; }
    if (password) updatePayload.password = password;

    const { error: updateError } = await adminClient.auth.admin.updateUserById(targetUserId, updatePayload);
    if (updateError) return json({ error: translateError(updateError.message) }, 400);

    if (email) {
      const { error: syncError } = await adminClient.from('profiles').update({ email }).eq('id', targetUserId);
      if (syncError) return json({ error: translateError(syncError.message) }, 400);
    }

    return json({ ok: true });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : 'Error inesperado.' }, 500);
  }
});
