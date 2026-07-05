// ══════════════════════════════════════════════
// Motor de "vinculación": cruza necesidades sin cubrir de una
// organización con ofertas/servicios de otra.
//
// Dos niveles de coincidencia:
//  - "strong": la necesidad y la oferta son el mismo texto normalizado
//    (típicamente porque ambos usuarios eligieron la misma categoría
//    sugerida al cargar la empresa). Es una coincidencia confiable.
//  - "weak": superposición de palabras largas entre los dos textos.
//    Es una aproximación y puede traer falsos positivos, así que solo
//    se muestra para una necesidad puntual cuando no hay ninguna
//    coincidencia "strong" para esa misma necesidad.
//
// Además, nunca se cruzan dos empresas del mismo dueño entre sí: un
// graduado con varias empresas no necesita que el sistema le sugiera
// vincular sus propias empresas entre ellas.
// ══════════════════════════════════════════════
import { overlap, normalizeTagKey } from './utils.js';

// Considera "mismo dueño" si comparten al menos un usuario asociado
// (dueño principal o alguno de los usuarios adicionales agregados por
// un admin, ver sql/009_empresa_usuarios.sql). Si a.usuarios/b.usuarios
// no están presentes (por compatibilidad), cae al chequeo simple por uid.
function isSameOwner(a, b) {
  const au = a.usuarios || (a.uid ? [a.uid] : []);
  const bu = b.usuarios || (b.uid ? [b.uid] : []);
  if (!au.length || !bu.length) return false;
  return au.some(id => bu.includes(id));
}

function isStrongMatch(need, offer) {
  const nk = normalizeTagKey(need);
  const ok = normalizeTagKey(offer);
  return !!nk && nk === ok;
}

export function allMatches(orgs) {
  const strong = [];
  const weak = [];

  for (const s of orgs) {
    for (const n of (s.needsUncovered || [])) {
      let foundStrongForThisNeed = false;
      const weakCandidates = [];

      for (const p of orgs) {
        if (p.id === s.id) continue;
        if (isSameOwner(s, p)) continue;

        for (const of2 of (p.ofertas || [])) {
          if (isStrongMatch(n, of2)) {
            strong.push({ seeker: s, need: n, provider: p, offer: of2, strength: 'strong' });
            foundStrongForThisNeed = true;
          } else if (overlap(n, of2)) {
            weakCandidates.push({ seeker: s, need: n, provider: p, offer: of2, strength: 'weak' });
          }
        }
      }

      if (!foundStrongForThisNeed) weak.push(...weakCandidates);
    }
  }

  return [...strong, ...weak];
}

export function findMatchesFor(orgs, org) {
  return allMatches(orgs)
    .filter(m => m.seeker.id === org.id)
    .map(m => ({ org: m.provider, need: m.need, offer: m.offer, strength: m.strength }));
}

export function countMatches(orgs) {
  const seen = new Set();
  return allMatches(orgs).filter(m => {
    const k = `${m.seeker.id}-${m.provider.id}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  }).length;
}

// Agrupa las coincidencias por par de empresas (seeker -> provider), para
// que la pantalla de Vinculación muestre una sola tarjeta por par con
// todas las necesidades/ofertas que calzan, en vez de repetir el par
// una vez por cada coincidencia individual.
export function groupMatchesByPair(matches) {
  const map = new Map();
  for (const m of matches) {
    const key = `${m.seeker.id}-${m.provider.id}`;
    if (!map.has(key)) {
      map.set(key, { seeker: m.seeker, provider: m.provider, items: [] });
    }
    map.get(key).items.push({ need: m.need, offer: m.offer, strength: m.strength });
  }
  return [...map.values()];
}
