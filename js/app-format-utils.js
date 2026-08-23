/* Pure application formatting/parsing helpers. No DOM, storage or network. */
const UA_MONTHS = ['січня','лютого','березня','квітня','травня','червня','липня','серпня','вересня','жовтня','листопада','грудня'];
function formatUaDate(d){ return `${d.getDate()} ${UA_MONTHS[d.getMonth()]} ${d.getFullYear()} р.`; }

function parseBackupNote(note){
  const result={geoLink:'',masterNote:'',login:'',password:'',fullData:null};
  if(!note)return result;
  String(note).split('\n').forEach(line=>{
    const fields=[['geoLink',/^Геолокація:\s*(.+)$/],['masterNote',/^Приватна примітка майстра:\s*(.+)$/],['login',/^Логін:\s*(.+)$/],['password',/^Пароль:\s*(.+)$/]];
    for(const [key,re] of fields){const match=line.match(re);if(match){result[key]=match[1].trim();return;}}
    const full=line.match(/^ПовніДаніJSON:\s*(.+)$/);if(full){try{result.fullData=JSON.parse(full[1].trim());}catch(_e){}}
  });
  return result;
}
