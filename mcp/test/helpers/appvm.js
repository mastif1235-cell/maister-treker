/* Loads REAL app modules (classic scripts) into a vm sandbox so tests can run
   the app's own pure functions for parity checks. */

import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

export function loadAppModule(relPath, extraGlobals){
  const code = readFileSync(path.join(REPO_ROOT, relPath), 'utf8');
  const sandbox = Object.assign({
    console,
    crypto: globalThis.crypto,
    TextEncoder,
    TextDecoder,
    btoa: function(binary){ return Buffer.from(binary, 'binary').toString('base64'); },
    atob: function(b64){ return Buffer.from(b64, 'base64').toString('binary'); }
  }, extraGlobals || {});
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox, {filename: relPath});
  return sandbox;
}
