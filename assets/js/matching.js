// ══════════════════════════════════════════════
// Motor de "vinculación": cruza necesidades sin cubrir de una
// organización con ofertas/servicios de otra.
// ══════════════════════════════════════════════
import { overlap } from './utils.js';

export function allMatches(orgs) {
  const m = [];
  for (const s of orgs) {
    for (const n of (s.needsUncovered || [])) {
      for (const p of orgs) {
        if (p.id === s.id) continue;
        for (const of2 of (p.ofertas || [])) {
          if (overlap(n, of2)) m.push({ seeker: s, need: n, provider: p, offer: of2 });
        }
      }
    }
  }
  return m;
}

export function findMatchesFor(orgs, org) {
  return allMatches(orgs)
    .filter(m => m.seeker.id === org.id)
    .map(m => ({ org: m.provider, need: m.need, offer: m.offer }));
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
