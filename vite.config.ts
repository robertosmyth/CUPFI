import { defineConfig } from 'vitest/config';

// base relativo: el sitio funciona igual publicado en la raíz de un dominio
// propio o en un subpath de GitHub Pages (https://usuario.github.io/CUPFI/)
// sin tener que fijar el nombre del repo acá.
export default defineConfig({
  base: './',
  build: {
    outDir: 'dist',
  },
  test: {
    environment: 'node',
  },
});
