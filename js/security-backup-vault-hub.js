/* Keep backup password controls inside Settings → Data and backups. */
try{
  const dataSection = SETTINGS_HUB_SECTIONS.find(x=>x.key==='data');
  if(dataSection && !dataSection.match.includes('Пароль резервних копій')) dataSection.match.push('Пароль резервних копій');
  if(Array.isArray(SETTINGS_HUB_ITEM_ICONS) && !SETTINGS_HUB_ITEM_ICONS.some(x=>x[0]==='Пароль резервних копій')){
    SETTINGS_HUB_ITEM_ICONS.push(['Пароль резервних копій','🛟']);
  }
}catch(e){}
