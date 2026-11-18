import { describe, expect, it } from 'vitest';
import { fuerzaClave, requisitosClave, urlSegura, validarClave } from './seguridad.ts';

describe('validarClave (8+ con mayúscula, minúscula, número y símbolo)', () => {
  it('acepta las claves temporales del formato pedido', () => {
    for (const c of ['OLedezma123!', 'SDagostin123!', 'WDibenedetto123!', 'CGalli123!', 'LSmyth123!']) {
      expect(validarClave(c)).toBeNull();
    }
  });
  it('acepta acentos y ñ como letras', () => {
    expect(validarClave('Ñandú2024?')).toBeNull();
  });
  it('rechaza lo que no cumple y dice qué falta', () => {
    expect(validarClave('')).toMatch(/Ingresá/);
    expect(validarClave('Ab1!')).toMatch(/8 caracteres/);
    expect(validarClave('abcdefg1!')).toMatch(/mayúscula/);
    expect(validarClave('ABCDEFG1!')).toMatch(/minúscula/);
    expect(validarClave('Abcdefgh!')).toMatch(/número/);
    expect(validarClave('Abcdefgh1')).toMatch(/símbolo/);
    expect(validarClave('clave1234')).toMatch(/mayúscula.*símbolo/);
  });
  it('no cuenta el espacio como símbolo ni deja espacios en los bordes', () => {
    expect(validarClave('Abcdefg 1')).toMatch(/símbolo/);
    expect(validarClave(' Abcdef1!')).toMatch(/espacios/);
  });
  it('máximo 72 bytes (límite de bcrypt)', () => {
    expect(validarClave('Aa1!' + 'x'.repeat(68))).toBeNull();
    expect(validarClave('Aa1!' + 'x'.repeat(69))).toMatch(/72/);
  });
});

describe('requisitos y fuerza', () => {
  it('lista de requisitos', () => {
    expect(requisitosClave('Ab1!').map(r => r.ok)).toEqual([false, true, true, true, true]);
  });
  it('fuerza sube con el largo y baja con patrones comunes', () => {
    expect(fuerzaClave('').nivel).toBe(0);
    expect(fuerzaClave('abc').nivel).toBe(1);
    expect(fuerzaClave('Xk9!mPq2').nivel).toBe(2);
    expect(fuerzaClave('Xk9!mPq2Lw7#').nivel).toBe(3);
    expect(fuerzaClave('Xk9!mPq2Lw7#Zr4$').nivel).toBe(4);
    expect(fuerzaClave('Password1234!').nivel).toBeLessThan(3);
  });
});

describe('urlSegura', () => {
  it('solo http/https', () => {
    expect(urlSegura('https://empresa.com/x?a=1')).toBe('https://empresa.com/x?a=1');
    expect(urlSegura(' http://empresa.com ')).toBe('http://empresa.com');
    expect(urlSegura('javascript:alert(1)')).toBeNull();
    expect(urlSegura('JaVaScRiPt:alert(1)')).toBeNull();
    expect(urlSegura('data:text/html,x')).toBeNull();
    expect(urlSegura('https://x.com/"onmouseover=x')).toBeNull();
    expect(urlSegura(null)).toBeNull();
  });
});
