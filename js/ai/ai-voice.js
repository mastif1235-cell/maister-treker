/* AI: голосовий введення (Web Speech API). Окремий модуль — не змішаний
   з UI. Голос НІКОЛИ не єдиний спосіб: текстовий чат працює завжди.
   Розпізнаний текст потрапляє в поле вводу (можна відредагувати перед
   надсиланням) — автоматичної відправки немає. */
(function(){
'use strict';
const MTAI = (typeof globalThis !== 'undefined' ? globalThis : window).MTAI;
MTAI.createVoiceInput = function(deps){
  const RecognitionCtor = deps.recognitionCtor
    || (typeof window !== 'undefined' ? (window.SpeechRecognition || window.webkitSpeechRecognition) : null);
  const onStatus = deps.onStatus || function(){};
  const onResult = deps.onResult || function(){};
  const onError = deps.onError || function(){};
  let recognition = null;
  let active = false;

  function supported(){ return !!RecognitionCtor; }

  function start(){
    if(!supported()){ onError({ kind:'unsupported', message:'Голосове введення не підтримується цим браузером.' }); return false; }
    if(active) return true;
    try{
      recognition = new RecognitionCtor();
      recognition.lang = 'uk-UA';
      recognition.interimResults = false;
      recognition.maxAlternatives = 1;
      recognition.onstart = function(){ active = true; onStatus('listening', 'Слухаю…'); };
      recognition.onaudiostart = function(){ onStatus('listening', 'Слухаю…'); };
      recognition.onerror = function(event){
        active = false;
        const map = {
          'not-allowed':{ kind:'permission', message:'Немає доступу до мікрофона. Дозвольте його в налаштуваннях браузера.' },
          'service-not-allowed':{ kind:'permission', message:'Сервіс розпізнавання заблокований браузером.' },
          'no-speech':{ kind:'no_speech', message:'Мова не розпізнана. Спробуйте ще раз.' },
          'network':{ kind:'network', message:'Розпізнавання недоступне без мережі.' }
        };
        onError(map[event.error] || { kind:'unknown', message:'Помилка розпізнавання (' + event.error + ').' });
      };
      recognition.onend = function(){
        if(active){ active = false; onStatus('processing', 'Розпізнаю…'); }
        active = false;
        setTimeout(function(){ onStatus('idle', 'Готово'); }, 600);
      };
      recognition.onresult = function(event){
        const text = event.results && event.results[0] && event.results[0][0] ? event.results[0][0].transcript : '';
        if(text) onResult(text.trim());
      };
      recognition.start();
      return true;
    }catch(err){
      active = false;
      onError({ kind:'unknown', message:'Не вдалося стартувати мікрофон.' });
      return false;
    }
  }
  function stop(){ if(recognition && active){ try{ recognition.stop(); }catch(_e){} } }
  function isActive(){ return active; }
  return { supported: supported, start: start, stop: stop, isActive: isActive };
};
})();
