'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const root=path.join(__dirname,'..');
const sources=['index.html','js/backup-system.js','js/reports-domain.js','js/report-utils.js'].map(file=>[file,fs.readFileSync(path.join(root,file),'utf8')]);
for(const [file,source] of sources)assert.doesNotMatch(source,/Сохранить|сохранён|Скачать|Изменить|Забыть|Комментарий|бэкапов/,'visible system text is Ukrainian: '+file);
const html=sources[0][1],backup=sources[1][1],reports=sources[2][1],reportUtils=sources[3][1];
assert.match(html,/Пароль для резервних копій ще не збережено/);assert.match(html,/Завантажити резервну копію зараз/);assert.match(backup,/Зберегти щоденну резервну копію/);assert.match(reports,/Коментар до звіту/);assert.match(reportUtils,/Коментар:/);
console.log('PASS audited backup and report system strings are Ukrainian');
