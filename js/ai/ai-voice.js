/* AI: голосове введення v2 (Web Speech API, Android/Chrome-first).
   Уроки реальної перевірки: у частині Chromium-браузерів start() МОЖЕ
   мовчки нічого не зробити (ні onstart, ні onerror, ні prompt). Тому:
   1) стан кнопки/статус змінюється СИНХРОННО у кліку, до будь-якого API;
   2) перед start() робимо getUserMedia({audio}) warm-up — стандартний API
     гарантовано показує permission prompt або дає явну помилку;
   3) watchdog: якщо onstart не прийшов за watchdogMs — видима помилка
     (ніколи не silent no-op);
   4) повторний тап = stop; onend/onerror завжди скидають стан;
   5) мова: uk-UA/ru-RU за останнім повідомленням користувача
     (детект кириличних маркерів), дефолт — мова браузера.
   Голос НІКОЛИ не єдиний спосіб: текстовий чат працює завжди.
   Розпізнаний текст потрапляє в поле вводу БЕЗ авт відправки. */
(function(){
'use strict';
const MTAI = (typeof globalThis !== 'undefined' ? globalThis : window).MTAI;

/* uk/ru детект за кириличними маркерами; нейтральний текст -> мова UI. */
MTAI.detectVoiceLang = function(text, uiLang){
  const t = String(text == null ? '' : text).toLowerCase();
  if(/[ыэъ]/.test(t)) return 'ru-RU';
  if(/[іїєґ]|\bцей\b|\bбуло\b|\bякий\b|\bяка\b/.test(t)) return 'uk-UA';
  const nav = String(uiLang || (typeof navigator !== 'undefined' && navigator.language) || 'uk').toLowerCase();
  return nav.indexOf('ru') === 0 ? 'ru-RU' : 'uk-UA';
};

MTAI.createVoiceInput = function(deps){
  const doc = deps.document || (typeof document !== 'undefined' ? document : null);
  const RecognitionCtor = deps.recognitionCtor
    || (typeof window !== 'undefined' ? (window.SpeechRecognition || window.webkitSpeechRecognition) : null);
  const getUserMedia = deps.getUserMedia
    || (typeof navigator !== 'undefined' && navigator && navigator.mediaDevices && typeof navigator.mediaDevices.getUserMedia === 'function'
        ? function(constraints){ return navigator.mediaDevices.getUserMedia(constraints); }
        : null);
  const getLang = deps.getLang || function(){ return 'uk-UA'; };
  const onStatus = deps.onStatus || function(){};
  const onResult = deps.onResult || function(){};
  const onError = deps.onError || function(){};
  const onStateChange = deps.onStateChange || function(){};
  const watchdogMs = typeof deps.watchdogMs === 'number' ? deps.watchdogMs : 4000;

  const MESSAGES = {
    unsupported: 'Голосовий ввід не підтримується цим браузером.',
    permission: 'Дозвольте доступ до мікрофона в налаштуваннях браузера.',
    no_speech: 'Мову не розпізнано. Спробуйте ще раз.',
    network: 'Помилка голосового сервісу. Перевірте інтернет.',
    no_mic: 'Мікрофон не знайдено на цьому пристрої.',
    dead_api: 'Браузер не відповів на запит мікрофона. Спробуйте ще раз або введіть текст.',
    start_failed: 'Не вдалося стартувати мікрофон.'
  };

  let recognition = null;      // единственный экземпляр, пересоздаём только после dead
  let active = false;          // recognition.start() принят, ждём/идёт запись
  let gotStart = false;        // пришёл onstart (реально слушает)
  let stopping = false;        // пользователь нажал stop (onend не считает ошибкой)
  let watchdog = null;

  function supported(){ return !!RecognitionCtor; }

  function resetState(){
    active = false; gotStart = false; stopping = false;
    if(watchdog){ clearTimeout(watchdog); watchdog = null; }
    onStateChange(false);
  }

  function fail(kind){
    resetState();
    onError({ kind: kind, message: MESSAGES[kind] || MESSAGES.start_failed });
  }

  function clearWatchdog(){ if(watchdog){ clearTimeout(watchdog); watchdog = null; } }

  function handleStart(){
    gotStart = true;
    clearWatchdog();
    active = true;
    onStatus('listening', '🎤 Слухаю…');
    onStateChange(true);
  }

  function handleEnd(){
    clearWatchdog();
    const wasActive = active || gotStart;
    resetState();
    if(wasActive && !stopping) onStatus('processing', 'Розпізнаю…');
    setTimeout(function(){ if(!active && !gotStart) onStatus('idle', 'Готово'); }, 600);
  }

  function handleError(event){
    const code = event && event.error;
    clearWatchdog();
    if(code === 'aborted' || code === 'no-speech' && stopping){ resetState(); return; }
    if(code === 'no-speech'){ resetState(); fail('no_speech'); return; }
    if(code === 'not-allowed' || code === 'service-not-allowed'){ fail('permission'); return; }
    if(code === 'network'){ fail('network'); return; }
    if(code === 'audio-capture'){ fail('no_mic'); return; }
    fail('start_failed');
  }

  function handleResult(event){
    const results = event && event.results;
    if(!results || !results.length) return;
    const last = results[results.length - 1];
    const text = last && last[0] ? String(last[0].transcript || '').trim() : '';
    if(text) onResult(text);
  }

  function buildRecognition(){
    const rec = new RecognitionCtor();
    rec.lang = getLang() === 'ru-RU' ? 'ru-RU' : 'uk-UA';
    rec.interimResults = false;
    rec.maxAlternatives = 1;
    rec.continuous = false;
    rec.onstart = handleStart;
    rec.onaudiostart = function(){ if(!gotStart) handleStart(); };
    rec.onresult = handleResult;
    rec.onerror = handleError;
    rec.onend = handleEnd;
    return rec;
  }

  /* Тёплый вызов разрешения: стандартный getUserMedia даёт либо prompt,
     либо явную ошибку — там, где SpeechRecognition молчит. */
  function warmupPermission(){
    if(!getUserMedia) return Promise.resolve();
    return getUserMedia({ audio: true }).then(function(stream){
      try{
        (stream.getTracks && stream.getTracks() || []).forEach(function(t){ t.stop && t.stop(); });
      }catch(_e){}
    });
  }

  function start(){
    if(!supported()){
      resetState();
      onError({ kind:'unsupported', message: MESSAGES.unsupported });
      return false;
    }
    if(active || gotStart) return true;
    /* СИНХРОННАЯ обратная связь ещё до любых вызовов API: пользователь
       сразу видит, что тап сработал. */
    stopping = false;
    onStatus('starting', '🎤 Слухаю…');
    onStateChange(true);
    const begin = warmupPermission().then(function(){
      if(stopping) return; // успели нажать stop во время warm-up
      try{
        if(!recognition) recognition = buildRecognition();
        recognition.lang = getLang() === 'ru-RU' ? 'ru-RU' : 'uk-UA';
        recognition.start();
        if(doc && typeof doc.getElementById === 'function'){
          void doc; // doc зарезервирован для будущих нужд UI-статусов
        }
        watchdog = setTimeout(function(){
          if(!gotStart){ destroy(); fail('dead_api'); }
        }, watchdogMs);
        return true;
      }catch(err){
        destroy();
        fail('start_failed');
        return false;
      }
    })['catch'](function(err){
      const name = err && err.name || '';
      if(name === 'NotAllowedError' || name === 'SecurityError') fail('permission');
      else if(name === 'NotFoundError' || name === 'DevicesNotFoundError') fail('no_mic');
      else fail('start_failed');
      return false;
    });
    return true;
  }

  function destroy(){
    if(recognition){
      try{ recognition.abort && recognition.abort(); }catch(_e){}
      try{ recognition.onend = null; recognition.onresult = null; recognition.onerror = null; recognition.onstart = null; }catch(_e){}
      recognition = null;
    }
  }

  function stop(){
    if(!active && !gotStart){ return; }
    stopping = true;
    resetState();
    onStatus('idle', 'Зупинено');
    if(recognition){
      try{ recognition.stop && recognition.stop(); }catch(_e){}
      try{ recognition.abort && recognition.abort(); }catch(_e){}
    }
  }

  function isActive(){ return active || gotStart; }

  return { supported: supported, start: start, stop: stop, isActive: isActive };
};
})();
