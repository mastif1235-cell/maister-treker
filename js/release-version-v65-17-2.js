/* Майстер-Трекер — єдина публічна мітка поточного релізу.
   Внутрішні security-модулі мають власні історичні version constants,
   але екран Налаштувань завжди повинен показувати саме CURRENT_APP_RELEASE.
*/

const CURRENT_APP_RELEASE = 'v65.0-security.17.2 · 2026-08-18';

function applyCurrentAppReleaseLabel(){
  const label = document.getElementById('appVersionLabel');
  if(label) label.textContent = `Версія застосунку: ${CURRENT_APP_RELEASE}`;
}

if(typeof renderSettingsScreen === 'function'){
  const releaseVersionPreviousRenderSettingsScreen = renderSettingsScreen;
  renderSettingsScreen = function(){
    const result = releaseVersionPreviousRenderSettingsScreen.apply(this, arguments);
    applyCurrentAppReleaseLabel();
    return result;
  };
}

if(document.readyState === 'loading'){
  document.addEventListener('DOMContentLoaded', applyCurrentAppReleaseLabel, {once:true});
}else{
  applyCurrentAppReleaseLabel();
}
