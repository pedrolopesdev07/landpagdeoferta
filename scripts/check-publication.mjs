import { readFileSync, readdirSync, lstatSync } from 'node:fs';
import { resolve, relative, basename, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const privateDirectories = new Set(['.git', '.aws', '.ssh', '.codex', '.agents', '.wrangler', '.backups', '.venv', 'node_modules', 'secrets', 'sessions']);
const privateNames = /^(?:integration\.json|secrets\.json|credentials.*\.json|service[-_]account.*\.json|tokens\.json|cookies\.json|\.npmrc|\.pypirc|\.netrc)$/i;
const privateExtensions = /\.(?:sqlite3?|db)(?:-.*)?$|\.(?:pem|key|p12|pfx|dump|zip|7z|tar|gz|bak|log|map)$/i;
const credentials = [
  /gh[pousr]_[A-Za-z0-9]{36,}/,
  /github_pat_[A-Za-z0-9_]{50,}/,
  /AKIA[0-9A-Z]{16}/,
  /-----BEGIN (?:RSA |EC |OPENSSH |DSA |ENCRYPTED )?PRIVATE KEY-----/,
];
const publicExtensions = new Set(['.html', '.css', '.js', '.json', '.png', '.jpg', '.jpeg', '.webp', '.svg', '.ico', '.mp4', '.woff', '.woff2', '.txt', '.webmanifest']);

export function inspectFile(path, bytes, assets = false) {
  const normalized = path.replaceAll('\\', '/');
  const parts = normalized.split('/');
  const name = basename(normalized);
  if (parts.some(part => privateDirectories.has(part)) || parts[0] === 'data' || parts[0] === '.publish' || parts[0] === 'conecta' ||
      (assets && parts.includes('data')) || privateNames.test(name) || privateExtensions.test(name) ||
      (/^\.env(?:\.|$)/i.test(name) && (assets || name !== '.env.example')) || /^\.dev\.vars/i.test(name)) {
    return 'arquivo ou pasta privada';
  }
  if (assets && !['_headers', '_redirects', '.assetsignore'].includes(name) && !publicExtensions.has(extname(name).toLowerCase())) return 'tipo de arquivo não permitido nos assets';
  const text = bytes.toString('utf8');
  return credentials.some(pattern => pattern.test(text)) ? 'possível credencial ou chave privada' : '';
}

export function inspectDirectory(directory) {
  const findings = [];
  let count = 0;
  function walk(folder) {
    for (const entry of readdirSync(folder)) {
      const full = resolve(folder, entry);
      const path = relative(directory, full).replaceAll('\\', '/');
      const info = lstatSync(full);
      if (info.isSymbolicLink()) { findings.push({ path, reason: 'link simbólico nos assets' }); continue; }
      if (info.isDirectory()) { walk(full); continue; }
      if (!info.isFile()) { findings.push({ path, reason: 'arquivo especial' }); continue; }
      count++;
      const reason = inspectFile(path, readFileSync(full), true);
      if (reason) findings.push({ path, reason });
    }
  }
  walk(resolve(directory));
  return { count, findings };
}

function main() {
  const argument = process.argv[2];
  if (!['public', 'dist', '--git'].includes(argument)) throw Error('Use public, dist ou --git.');
  let result;
  if (argument === '--git') {
    const paths = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' }).split('\0').filter(Boolean);
    const findings = [];
    for (const path of paths) {
      const bytes = execFileSync('git', ['show', ':' + path], { maxBuffer: 100 * 1024 * 1024 });
      const reason = inspectFile(path, bytes);
      if (reason) findings.push({ path, reason });
    }
    result = { count: paths.length, findings };
  } else result = inspectDirectory(argument);
  // Print paths and reasons only. Never print matching content or credentials.
  for (const finding of result.findings) console.error(`${finding.path}: ${finding.reason}`);
  console.log(`Publicação: ${result.count} arquivos verificados; ${result.findings.length} bloqueios.`);
  if (result.findings.length) process.exitCode = 1;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
