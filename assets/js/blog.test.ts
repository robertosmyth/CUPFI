import { describe, expect, it } from 'vitest';
import { armarHilos, extension, textoHtml, tiempoRelativo, urlEmbed, validarArchivo, videoExterno, videoUrlValida } from './blog.ts';
import type { BlogComentarioRow } from './types.ts';

describe('links de video', () => {
  it('acepta YouTube (watch, youtu.be, shorts) y Vimeo', () => {
    expect(videoUrlValida('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toBe(true);
    expect(videoUrlValida('https://youtu.be/dQw4w9WgXcQ?t=10')).toBe(true);
    expect(videoUrlValida('https://youtube.com/shorts/dQw4w9WgXcQ')).toBe(true);
    expect(videoUrlValida('https://vimeo.com/76979871')).toBe(true);
  });
  it('rechaza otros sitios, http, ids cortos e inyecciones', () => {
    expect(videoUrlValida('https://evil.example/watch?v=dQw4w9WgXcQ')).toBe(false);
    expect(videoUrlValida('http://youtu.be/dQw4w9WgXcQ')).toBe(false);
    expect(videoUrlValida('https://www.youtube.com/watch?v=abc')).toBe(false);
    expect(videoUrlValida('javascript:alert(1)')).toBe(false);
    expect(videoUrlValida('https://youtu.be/dQw4w9WgXcQ"><script>')).toBe(false);
  });
  it('extrae el id y arma el reproductor', () => {
    expect(videoExterno('https://youtu.be/dQw4w9WgXcQ')).toEqual({ tipo: 'youtube', id: 'dQw4w9WgXcQ' });
    expect(videoExterno('https://vimeo.com/76979871')).toEqual({ tipo: 'vimeo', id: '76979871' });
    expect(videoExterno('https://evil.example')).toBeNull();
    expect(urlEmbed({ tipo: 'youtube', id: 'dQw4w9WgXcQ' })).toContain('youtube-nocookie.com/embed/dQw4w9WgXcQ');
    expect(urlEmbed({ tipo: 'vimeo', id: '76979871' })).toContain('player.vimeo.com/video/76979871');
  });
});

describe('validarArchivo', () => {
  it('imágenes: tipo y 5 MB', () => {
    expect(validarArchivo({ type: 'image/png', size: 1000 }, 'imagen')).toBeNull();
    expect(validarArchivo({ type: 'image/bmp', size: 1000 }, 'imagen')).toMatch(/JPG/);
    expect(validarArchivo({ type: 'image/jpeg', size: 5 * 1024 * 1024 + 1 }, 'imagen')).toMatch(/5 MB/);
  });
  it('video: tipo y 50 MB', () => {
    expect(validarArchivo({ type: 'video/mp4', size: 49 * 1024 * 1024 }, 'video')).toBeNull();
    expect(validarArchivo({ type: 'video/quicktime', size: 1000 }, 'video')).toMatch(/MP4/);
    expect(validarArchivo({ type: 'video/webm', size: 51 * 1024 * 1024 }, 'video')).toMatch(/50 MB/);
  });
  it('extensión según el tipo', () => {
    expect(extension({ name: 'foto.JPEG', type: 'image/jpeg' })).toBe('jpg');
    expect(extension({ name: 'clip', type: 'video/webm' })).toBe('webm');
  });
});

describe('textoHtml', () => {
  it('escapa HTML, respeta saltos de línea y hace clickeables los links', () => {
    const h = textoHtml('<b>hola</b>\nmirá https://cupfi.test/a?x=1&y=2.');
    expect(h).toContain('&lt;b&gt;hola&lt;/b&gt;<br>');
    expect(h).toContain('<a href="https://cupfi.test/a?x=1&amp;y=2" target="_blank" rel="noopener noreferrer nofollow ugc">');
    expect(h.endsWith('</a>.')).toBe(true);
  });
  it('no convierte javascript: en link', () => {
    expect(textoHtml('javascript:alert(1)')).not.toContain('<a');
  });
});

describe('tiempoRelativo', () => {
  const ahora = new Date('2026-11-11T12:00:00Z').getTime();
  it('formatos', () => {
    expect(tiempoRelativo('2026-11-11T11:59:40Z', ahora)).toBe('recién');
    expect(tiempoRelativo('2026-11-11T11:30:00Z', ahora)).toBe('hace 30 min');
    expect(tiempoRelativo('2026-11-11T09:00:00Z', ahora)).toBe('hace 3 h');
    expect(tiempoRelativo('2026-11-09T12:00:00Z', ahora)).toBe('hace 2 d');
    expect(tiempoRelativo('2026-10-01T12:00:00Z', ahora)).toMatch(/2026/);
  });
});

describe('armarHilos', () => {
  const c = (id: number, parent: number | null, t: string): BlogComentarioRow => ({
    id, post_id: 1, parent_id: parent, autor_id: 'u', texto: 'x', oculto: false, oculto_por: null, oculto_at: null,
    oculto_motivo: null, created_at: t, editado_at: null,
  });
  it('agrupa respuestas bajo su comentario, en orden', () => {
    const h = armarHilos([c(3, 1, '2026-01-01T03:00Z'), c(1, null, '2026-01-01T01:00Z'), c(2, null, '2026-01-01T02:00Z'), c(4, 1, '2026-01-01T04:00Z')]);
    expect(h.map(x => x.c.id)).toEqual([1, 2]);
    expect(h[0].respuestas.map(r => r.id)).toEqual([3, 4]);
    expect(h[1].respuestas).toEqual([]);
  });
});
