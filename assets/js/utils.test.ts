import { describe, expect, it } from 'vitest';
import { esc, friendlyError, isValidCuit, isValidEmail, isValidUrl, normalizeTagKey } from './utils.ts';

describe('esc', () => {
  it('escapa caracteres peligrosos para HTML', () => {
    expect(esc('<script>alert(1)</script>')).toBe('&lt;script&gt;alert(1)&lt;/script&gt;');
  });

  it('escapa comillas simples y dobles', () => {
    expect(esc(`it's "quoted"`)).toBe('it&#39;s &quot;quoted&quot;');
  });

  it('trata null/undefined como string vacío', () => {
    expect(esc(null)).toBe('');
    expect(esc(undefined)).toBe('');
  });
});

describe('isValidCuit', () => {
  it('acepta 11 dígitos con guiones', () => {
    expect(isValidCuit('30-71234567-9')).toBe(true);
  });

  it('rechaza menos de 11 dígitos', () => {
    expect(isValidCuit('30-712345-9')).toBe(false);
  });

  it('rechaza vacío', () => {
    expect(isValidCuit('')).toBe(false);
  });
});

describe('isValidEmail', () => {
  it('acepta un email con formato válido', () => {
    expect(isValidEmail('persona@dominio.com')).toBe(true);
  });

  it('rechaza sin arroba', () => {
    expect(isValidEmail('persona.dominio.com')).toBe(false);
  });

  it('rechaza sin dominio', () => {
    expect(isValidEmail('persona@dominio')).toBe(false);
  });
});

describe('isValidUrl', () => {
  it('acepta http:// y https://', () => {
    expect(isValidUrl('http://empresa.com')).toBe(true);
    expect(isValidUrl('https://empresa.com')).toBe(true);
  });

  it('rechaza esquemas peligrosos como javascript:', () => {
    expect(isValidUrl('javascript:alert(1)')).toBe(false);
  });

  it('acepta vacío (campo opcional)', () => {
    expect(isValidUrl('')).toBe(true);
  });
});

describe('normalizeTagKey', () => {
  it('normaliza mayúsculas, acentos y espacios repetidos', () => {
    expect(normalizeTagKey('  Mecanizado   de Piezas  ')).toBe('mecanizado de piezas');
    expect(normalizeTagKey('Diseño Eléctrico')).toBe('dise o electrico');
  });

  it('hace que dos variantes del mismo tag compartan clave', () => {
    expect(normalizeTagKey('Soldadura')).toBe(normalizeTagKey('  soldadura  '));
  });
});

describe('friendlyError', () => {
  it('traduce el mensaje de credenciales inválidas', () => {
    expect(friendlyError({ message: 'Invalid login credentials' })).toBe('Email o contraseña incorrectos.');
  });

  it('traduce "misma contraseña" y "sesión faltante" de Supabase Auth', () => {
    expect(friendlyError({ message: 'New password should be different from the old password.', code: 'same_password' }))
      .toBe('La contraseña nueva tiene que ser distinta de la anterior.');
    expect(friendlyError({ message: 'Auth session missing!' })).toMatch(/La sesión venció/);
  });

  it('traduce duplicidad de CUIT por código postgres', () => {
    expect(friendlyError({ code: '23505', message: 'duplicate key value violates unique constraint "empresas_cuit_key"' }))
      .toBe('Ya existe una empresa registrada con ese CUIT.');
  });

  it('devuelve un mensaje genérico si no hay error', () => {
    expect(friendlyError(null)).toBe('Ocurrió un error inesperado.');
  });

  it('traduce el cooldown de pedidos repetidos', () => {
    expect(friendlyError({ message: 'For security purposes, you can only request this after 46 seconds.' }))
      .toBe('Por seguridad, esperá unos segundos antes de volver a pedirlo.');
  });

  it('traduce el límite de envío de emails', () => {
    expect(friendlyError({ message: 'Email rate limit exceeded' }))
      .toBe('Se alcanzó el límite de envío de emails. Probá de nuevo en unos minutos.');
  });

  it('pide 8 caracteres de contraseña, no 6', () => {
    expect(friendlyError({ message: 'Password should be at least 6 characters' }))
      .toBe('La contraseña debe tener al menos 8 caracteres.');
  });

  it('traduce los códigos de las funciones de sql/012', () => {
    expect(friendlyError({ code: 'P0001', message: 'SIN_PERMISO_EMPRESA' })).toBe('No tenés permiso para actuar en nombre de esa empresa.');
    expect(friendlyError({ code: 'P0001', message: 'CHAT_SIN_MATCH' })).toBe('El chat se habilita cuando las dos empresas aceptan la conexión.');
    expect(friendlyError({ code: 'P0001', message: 'OTROS_REQUIERE_DETALLE' })).toContain('Otros');
  });

  it('no confunde SOLO_WEBMASTER con WEBMASTER_SOLO_WEBMASTER', () => {
    expect(friendlyError({ message: 'WEBMASTER_SOLO_WEBMASTER' })).toBe('Solo un webmaster puede dar o quitar el permiso de webmaster.');
    expect(friendlyError({ message: 'SOLO_WEBMASTER' })).toBe('Esta sección es solo para webmasters.');
  });

  it('avisa si falta correr la migración sql/012', () => {
    expect(friendlyError({ code: 'PGRST205', message: "Could not find the table 'public.empresa_items' in the schema cache" }))
      .toContain('sql/012_etapa1_conexiones.sql');
  });

  it('explica por qué no se puede borrar una categoría en uso', () => {
    expect(friendlyError({ code: '23503', message: 'update or delete on table "categorias" violates foreign key constraint "empresa_items_categoria_id_fkey"' }))
      .toBe('No se puede borrar la categoría: hay empresas o conexiones que la usan.');
  });
});
