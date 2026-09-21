/* AI voice (v91.60): reading answers aloud with the BROWSER speechSynthesis
   only (no cloud/paid TTS, nothing leaves the device).

   - MTAI.createVoiceTts() → {supported, speak, stop, isSpeaking, onChange}
   - MTAI.voiceTts.textForSpeech(text) strips what must never be read:
     markdown decoration, URLs, UUID/technical ids, «№754b…» references,
     and the READ-ONLY/provider/model metadata never reaches it because the
     caller passes ONLY the answer's user text (out.text) — never buttons,
     cards, JSON, presentation or UI messages.
   - a new speak() always stops the previous utterance; stop() is explicit.
   - without speechSynthesis every call is a harmless no-op and supported()
     is false, so the UI hides/disables the control and the chat works. */
(function(){
'use strict';
const MTAI = (typeof globalThis !== 'undefined' ? globalThis : window).MTAI;
if(!MTAI) return;

const MAX_CHARS = 1500;

function textForSpeech(text){
  let t = String(text == null ? '' : text);
  t = t.replace(/https?:\/\/\S+/gi, ' ');                                   /* links */
  t = t.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, ' '); /* UUID */
  t = t.replace(/\[(?:id|ticket_id|city_id|street_id)\s*:[^\]]*\]/gi, ' ');   /* [id:…] leftovers */
  t = t.replace(/(?:№|#)\s?[0-9a-z]{4,}(?:[-_.:][0-9a-z]+)*\b/gi, ' ');      /* «№754b…» refs */
  t = t.replace(/[*_`#>|]+/g, ' ');                                          /* markdown */
  t = t.replace(/^\s*[-•·]\s+/gm, '');                                       /* bullets */
  t = t.replace(/^\s*\d{1,2}[.)]\s+/gm, function(m){ return m.trim().replace(/[.)]$/, '') + '. '; });
  t = t.replace(/[ \t]+/g, ' ').replace(/\s*\n\s*/g, '. ').replace(/\.\s*\./g, '.').trim();
  return t.slice(0, MAX_CHARS);
}

function pickLang(text){
  if(typeof MTAI.detectVoiceLang === 'function') return MTAI.detectVoiceLang(text);
  return 'uk-UA';
}

MTAI.voiceTts = { textForSpeech: textForSpeech };

/* deps (optional, for tests): {synth, Utterance} */
MTAI.createVoiceTts = function(deps){
  deps = deps || {};
  const g = (typeof globalThis !== 'undefined' ? globalThis : window);
  const synth = deps.synth !== undefined ? deps.synth : (g.speechSynthesis || null);
  const Utterance = deps.Utterance !== undefined ? deps.Utterance : (g.SpeechSynthesisUtterance || null);
  const listeners = [];
  let current = null;

  function supported(){
    return !!(synth && Utterance && typeof synth.speak === 'function' && typeof synth.cancel === 'function');
  }
  function notify(){ listeners.slice().forEach(function(fn){ try{ fn(isSpeaking()); }catch(_e){} }); }
  function isSpeaking(){ return current !== null; }

  function stop(){
    if(!supported()) return;
    current = null;
    try{ synth.cancel(); }catch(_e){}
    notify();
  }

  /* Reads ONE text; returns true when an utterance was queued. */
  function speak(text){
    if(!supported()) return false;
    const phrase = textForSpeech(text);
    if(!phrase) return false;
    stop();
    let u;
    try{ u = new Utterance(phrase); }catch(_e){ return false; }
    try{ u.lang = pickLang(phrase); }catch(_e){}
    const done = function(){ if(current === u){ current = null; notify(); } };
    u.onend = done; u.onerror = done;
    current = u;
    try{ synth.speak(u); }catch(_e){ current = null; return false; }
    notify();
    return true;
  }

  return {
    supported: supported,
    speak: speak,
    stop: stop,
    isSpeaking: isSpeaking,
    onChange: function(fn){ if(typeof fn === 'function') listeners.push(fn); }
  };
};
})();
