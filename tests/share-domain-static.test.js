'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs');
const source=fs.readFileSync('js/share-domain.js','utf8');
for(const name of ['shareTicket','shareCurrentTicket','sharePickerBuildItems','sharePickerTextOnly','openTicketSharePicker']){
  assert.equal((source.match(new RegExp(`(?:async\\s+)?function\\s+${name}\\s*\\(`,'g'))||[]).length,1,`${name} has one canonical implementation`);
}
assert.match(source,/onClose:\(\)=> shareMultiClose\(items\)/,'picker close revokes URLs and closes modal');
assert.match(source,/files\.length === 1[\s\S]*navigator\.share\(\{title:'Заявка', text, files\}\)/,'single photo keeps text payload');
assert.match(source,/navigator\.clipboard\.writeText\(text\)[\s\S]*navigator\.share\(\{title:'Фото заявки', files\}\)/,'multi-photo flow copies text and shares files once');
console.log('PASS canonical single/multi-photo Web Share behavior');
