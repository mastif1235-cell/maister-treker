/* Pure application formatting/parsing helpers. No DOM, storage or network. */
const UA_MONTHS = ['січня','лютого','березня','квітня','травня','червня','липня','серпня','вересня','жовтня','листопада','грудня'];
function formatUaDate(d){ return `${d.getDate()} ${UA_MONTHS[d.getMonth()]} ${d.getFullYear()} р.`; }

/* Позначка «пароль є, але він лише на пристрої майстра» для стовпця нотаток.
   Підрядково сумісна: старі рядки з відкритим паролем досі парсяться, а
   маркер перетворюється на порожній пароль + ознаку passwordLocalOnly. */
const MT_PASSWORD_LOCAL_MARKER = '@local-only';
function parseBackupNote(note){
  const result={geoLink:'',masterNote:'',login:'',password:'',fullData:null};
  if(!note)return result;
  const lines=String(note).replace(/\r\n?/g,'\n').split('\n');
  const serviceSection=/^(?:Геолокація|Логін|Пароль|ПовніДаніJSON):/;
  for(let index=0;index<lines.length;index++){
    const line=lines[index];
    const master=line.match(/^Приватна примітка майстра:\s*(.*)$/);
    if(master){
      const value=[master[1]];
      while(index+1<lines.length&&!serviceSection.test(lines[index+1])) value.push(lines[++index]);
      result.masterNote=value.join('\n').trim();
      continue;
    }
    const fields=[['geoLink',/^Геолокація:\s*(.+)$/],['login',/^Логін:\s*(.+)$/],['password',/^Пароль:\s*(.+)$/]];
    let matched=false;
    for(const [key,re] of fields){const match=line.match(re);if(match){result[key]=match[1].trim();matched=true;break;}}
    if(matched)continue;
    const full=line.match(/^ПовніДаніJSON:\s*(.+)$/);if(full){try{result.fullData=JSON.parse(full[1].trim());}catch(_e){}}
  }
  // Маркер «пароль лише на пристрої» — не є паролем: поле лишаємо порожнім,
  // щоб жоден шлях злиття не записав '@local-only' у реальний пароль заявки.
  if(result.password===MT_PASSWORD_LOCAL_MARKER){ result.password=''; result.passwordLocalOnly=true; }
  return result;
}
