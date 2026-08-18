/* =====================================================================
   МАЙСТЕР-ТРЕКЕР — password hardening (v65 security.2)
   PBKDF2-SHA256 + salt, сумісна міграція зі старого SHA-256.
   ===================================================================== */

const SECURITY_LOCK_RELEASE_LABEL = 'v65.0-security.2 · 2026-08-18';
const SECURITY_PBKDF2_ITERATIONS = 210000;
const SECURITY_PBKDF2_MIN_LENGTH = 6;

function securityBytesToBase64(bytes){
  let s = '';
  bytes.forEach(b=>{ s += String.fromCharCode(b); });
  return btoa(s);
}

function securityBase64ToBytes(value){
  return Uint8Array.from(atob(String(value || '')), c=>c.charCodeAt(0));
}

function securityConstantTimeEqual(a, b){
  const x = String(a || '');
  const y = String(b || '');
  let diff = x.length ^ y.length;
  const max = Math.max(x.length, y.length);
  for(let i=0;i<max;i++) diff |= (x.charCodeAt(i % Math.max(x.length,1)) || 0) ^ (y.charCodeAt(i % Math.max(y.length,1)) || 0);
  return diff === 0;
}

async function securityPbkdf2Verifier(password, saltB64, iterations){
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(String(password)),
    {name:'PBKDF2'},
    false,
    ['deriveBits']
  );
  const bits = await crypto.subtle.deriveBits({
    name:'PBKDF2',
    hash:'SHA-256',
    salt:securityBase64ToBytes(saltB64),
    iterations:Number(iterations) || SECURITY_PBKDF2_ITERATIONS
  }, keyMaterial, 256);
  return securityBytesToBase64(new Uint8Array(bits));
}

async function securitySetPbkdf2Password(password){
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const saltB64 = securityBytesToBase64(salt);
  const verifier = await securityPbkdf2Verifier(password, saltB64, SECURITY_PBKDF2_ITERATIONS);
  settings.appLockPasswordKdf = 'pbkdf2-sha256';
  settings.appLockPasswordSalt = saltB64;
  settings.appLockPasswordIterations = SECURITY_PBKDF2_ITERATIONS;
  settings.appLockPasswordVerifier = verifier;
  settings.appLockPasswordHash = ''; // старий SHA-256 більше не потрібен
  settings.appLockEnabled = true;
  saveSettings();
}

async function securityVerifyPassword(password){
  if(settings.appLockPasswordKdf === 'pbkdf2-sha256' && settings.appLockPasswordSalt && settings.appLockPasswordVerifier){
    try{
      const candidate = await securityPbkdf2Verifier(password, settings.appLockPasswordSalt, settings.appLockPasswordIterations);
      return securityConstantTimeEqual(candidate, settings.appLockPasswordVerifier);
    }catch(err){
      console.error('PBKDF2 verification failed:', err);
      return false;
    }
  }

  // Сумісність зі старою v64: один успішний вхід старим паролем одразу
  // перезаписує його у PBKDF2+salt без участі користувача.
  if(settings.appLockPasswordHash){
    const legacy = await sha256Hex(password);
    if(securityConstantTimeEqual(legacy, settings.appLockPasswordHash)){
      await securitySetPbkdf2Password(password);
      showToast('🔐 Захист пароля автоматично посилено');
      return true;
    }
  }
  return false;
}

// Новий пароль: мінімум 6 символів. Не вимагаємо штучних правил типу
// "одна велика + один знак" — довжина важливіша, а PIN із 6+ цифр лишається зручним.
openSetPasswordModal = function(isFirstSetup){
  openModal(isFirstSetup ? '🔒 Встановити пароль' : 'Змінити пароль', `
    <div style="font-size:12px;color:var(--text-dim);margin-bottom:10px;">Мінімум ${SECURITY_PBKDF2_MIN_LENGTH} символів. Пароль зберігається через PBKDF2-SHA256 з випадковою сіллю.</div>
    <div class="field"><label>Новий пароль</label><input type="password" id="newAppLockPw" autocomplete="new-password"></div>
    <div class="field" style="margin-top:10px;"><label>Повторіть пароль</label><input type="password" id="newAppLockPwConfirm" autocomplete="new-password"></div>
    <button type="button" class="btn btn-block btn-accent" id="saveAppLockPwBtn" style="margin-top:14px;">Зберегти</button>
  `, {onOpen: ()=>{
    const pwEl = document.getElementById('newAppLockPw');
    const btn = document.getElementById('saveAppLockPwBtn');
    pwEl.focus();
    btn.addEventListener('click', async ()=>{
      const pw = pwEl.value;
      const pw2 = document.getElementById('newAppLockPwConfirm').value;
      if(!pw || pw.length < SECURITY_PBKDF2_MIN_LENGTH){ showToast(`Пароль має бути не коротшим за ${SECURITY_PBKDF2_MIN_LENGTH} символів`); return; }
      if(pw !== pw2){ showToast('Паролі не збігаються'); return; }
      btn.disabled = true;
      btn.textContent = '⏳ Захищаю пароль…';
      try{
        await securitySetPbkdf2Password(pw);
        closeModal();
        showToast('✅ Пароль захищено PBKDF2');
        renderSettingsScreen();
      }catch(err){
        console.error('PBKDF2 setup failed:', err);
        btn.disabled = false;
        btn.textContent = 'Зберегти';
        showToast('Не вдалося безпечно зберегти пароль');
      }
    });
  }});
};

ensureAppUnlocked = function(){
  return new Promise(resolve=>{
    const hasPassword = !!(settings.appLockPasswordVerifier || settings.appLockPasswordHash);
    if(!settings.appLockEnabled || !hasPassword){ resolve(); return; }
    showLockScreen(resolve);
  });
};

showLockScreen = function(onUnlock){
  const screen = document.getElementById('lockScreen');
  const bioBtn = document.getElementById('lockBiometricBtn');
  const pwInput = document.getElementById('lockPasswordInput');
  const errMsg = document.getElementById('lockErrorMsg');
  const unlockBtn = document.getElementById('lockUnlockBtn');
  screen.classList.remove('hidden');
  errMsg.textContent = '';
  pwInput.value = '';

  let finished = false;
  const finishUnlock = ()=>{
    if(finished) return;
    finished = true;
    screen.classList.add('hidden');
    onUnlock();
  };

  const tryPassword = async ()=>{
    const val = pwInput.value;
    if(!val){ errMsg.textContent = 'Введіть пароль'; return; }
    unlockBtn.disabled = true;
    errMsg.textContent = 'Перевіряю…';
    const ok = await securityVerifyPassword(val);
    unlockBtn.disabled = false;
    if(ok){ finishUnlock(); }
    else{
      errMsg.textContent = '❌ Невірний пароль';
      pwInput.value = '';
      pwInput.focus();
    }
  };
  unlockBtn.onclick = tryPassword;
  pwInput.onkeydown = e=>{ if(e.key==='Enter') tryPassword(); };

  const tryBiometric = async ()=>{
    if(!settings.appLockBiometricEnabled || !settings.appLockCredentialId) return false;
    try{
      const credId = securityBase64ToBytes(settings.appLockCredentialId);
      const cred = await navigator.credentials.get({publicKey:{
        challenge:crypto.getRandomValues(new Uint8Array(32)),
        allowCredentials:[{id:credId,type:'public-key'}],
        userVerification:'required',
        timeout:30000
      }});
      if(cred){ finishUnlock(); return true; }
    }catch(err){ /* скасовано або не підтримується — лишається пароль */ }
    return false;
  };

  if(settings.appLockBiometricEnabled && settings.appLockCredentialId && window.PublicKeyCredential){
    bioBtn.classList.remove('hidden');
    bioBtn.onclick = tryBiometric;
    tryBiometric();
  } else {
    bioBtn.classList.add('hidden');
  }
};

// Коли користувач вимикає lock старим обробником app.js, дочищаємо і нові PBKDF2-поля.
if(typeof bindSettingsScreen === 'function'){
  const securityLockOriginalBindSettings = bindSettingsScreen;
  bindSettingsScreen = function(){
    const result = securityLockOriginalBindSettings.apply(this, arguments);
    const toggle = document.getElementById('appLockToggle');
    if(toggle && toggle.dataset.pbkdf2CleanupBound !== '1'){
      toggle.dataset.pbkdf2CleanupBound = '1';
      toggle.addEventListener('change', ()=>{
        if(settings.appLockEnabled) return;
        settings.appLockPasswordKdf = '';
        settings.appLockPasswordSalt = '';
        settings.appLockPasswordIterations = 0;
        settings.appLockPasswordVerifier = '';
        saveSettings();
      });
    }
    return result;
  };
}

// Розширюємо захист бекапів новими полями PBKDF2.
if(typeof securitySanitizeSettingsForBackup === 'function'){
  const securityLockOriginalSanitize = securitySanitizeSettingsForBackup;
  securitySanitizeSettingsForBackup = function(source){
    const clean = securityLockOriginalSanitize(source);
    clean.appLockPasswordKdf = '';
    clean.appLockPasswordSalt = '';
    clean.appLockPasswordIterations = 0;
    clean.appLockPasswordVerifier = '';
    return clean;
  };
}

if(typeof securityMergeImportedSettings === 'function'){
  const securityLockOriginalMerge = securityMergeImportedSettings;
  securityMergeImportedSettings = function(imported, current){
    const preserved = {
      appLockPasswordKdf:current?.appLockPasswordKdf || '',
      appLockPasswordSalt:current?.appLockPasswordSalt || '',
      appLockPasswordIterations:current?.appLockPasswordIterations || 0,
      appLockPasswordVerifier:current?.appLockPasswordVerifier || ''
    };
    const merged = securityLockOriginalMerge(imported, current);
    Object.assign(merged, preserved);
    return merged;
  };
}

// Остання обгортка версії — security.2 має пріоритет над security.1.
if(typeof renderSettingsScreen === 'function'){
  const securityLockOriginalRenderSettings = renderSettingsScreen;
  renderSettingsScreen = function(){
    const result = securityLockOriginalRenderSettings.apply(this, arguments);
    const label = document.getElementById('appVersionLabel');
    if(label) label.textContent = `Версія застосунку: ${SECURITY_LOCK_RELEASE_LABEL}`;
    return result;
  };
}
