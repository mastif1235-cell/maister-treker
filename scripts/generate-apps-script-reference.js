'use strict';

const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'Code.gs'), 'utf8').replace(/\r\n/g, '\n');
const output = '// Generated from Code.gs by scripts/generate-apps-script-reference.js.\n' +
  'const APPS_SCRIPT_CODE = ' + JSON.stringify(source) + ';\n';

fs.writeFileSync(path.join(root, 'js', 'apps-script-reference.js'), output, 'utf8');
