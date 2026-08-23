/* =====================================================================
   МАЙСТЕР-ТРЕКЕР — password hardening (v65 security.2)
   PBKDF2-SHA256 + salt, сумісна міграція зі старого SHA-256.
   ===================================================================== */

const SECURITY_LOCK_RELEASE_LABEL = 'v65.0-security.2 · 2026-08-18';
const SECURITY_PBKDF2_ITERATIONS = 210000;
const SECURITY_PBKDF2_MIN_LENGTH = 6;
const SECURITY_LOCK_THROTTLE_KEY = 'appLockThrottleV1';

function securityBytesToBase64(bytes){
  return MTAppLockCore.bytesToBase64(bytes);
}

function securityBase64ToBytes(value){
  return MTAppLockCore.base64ToBytes(value);
}

function securityConstantTimeEqual(a, b){
  return MTAppLockCore.constantTimeEqual(a,b);
}

async function securityPbkdf2Verifier(password, saltB64, iterations){
  return MTAppLockCore.verifier(password,saltB64,iterations);
}

function securityLoadThrottle(){try{return JSON.parse(localStorage.getItem(SECURITY_LOCK_THROTTLE_KEY))||{};}catch(_e){return{};}}
function securitySaveThrottle(state){localStorage.setItem(SECURITY_LOCK_THROTTLE_KEY,JSON.stringify(state));}
function securityResetThrottle(){localStorage.removeItem(SECURITY_LOCK_THROTTLE_KEY);}

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
    const waitMs=MTAppLockCore.remainingMs(securityLoadThrottle());
    if(waitMs){errMsg.textContent=`Забагато спроб. Зачекайте ${Math.ceil(waitMs/1000)} с`;return;}
    unlockBtn.disabled = true;
    errMsg.textContent = 'Перевіряю…';
    const ok = await securityVerifyPassword(val);
    unlockBtn.disabled = false;
    if(ok){ securityResetThrottle();finishUnlock(); }
    else{
      const state=MTAppLockCore.recordFailure(securityLoadThrottle());securitySaveThrottle(state);
      const delay=MTAppLockCore.remainingMs(state);errMsg.textContent=delay?`❌ Невірний пароль. Пауза ${Math.ceil(delay/1000)} с`:'❌ Невірний пароль';
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

