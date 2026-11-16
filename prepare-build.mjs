// Preserve legacy uploads before Vite replaces the generated directory.
import { copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('.', import.meta.url));
const legacy = resolve(root, 'dist/uploads');
const persistent = resolve(root, 'data/uploads');
if (existsSync(legacy)) {
  if (lstatSync(legacy).isSymbolicLink()) throw Error('Pasta de uploads deve ser local.');
  mkdirSync(persistent, { recursive: true });
  if (lstatSync(persistent).isSymbolicLink()) throw Error('Pasta de dados deve ser local.');
  for (const filename of readdirSync(legacy)) {
    const source = resolve(legacy, filename);
    const target = resolve(persistent, filename);
    if (!lstatSync(source).isFile() || !/^[A-Za-z0-9_-]+\.(png|jpe?g|webp)$/i.test(filename)) {
      throw Error('Arquivo inesperado nos uploads antigos. Preserve-o antes de compilar.');
    }
    if (existsSync(target)) {
      if (!readFileSync(source).equals(readFileSync(target))) throw Error('Conflito na migração das imagens.');
    } else {
      copyFileSync(source, target);
    }
  }
}
