(function(root){
  'use strict';
  const SECRET_KEYS=/^(authorization|password|token|api[-_]?key|maptiler(?:api)?key|tgbottoken|synchmacsecret|secret)$/i;
  function redactSecrets(value){
    return String(value??'')
      .replace(/(authorization\s*[:=]\s*)(?:bearer|basic)?\s*[^\s,;]+/gi,'$1[REDACTED]')
      .replace(/\b\d{6,12}:[A-Za-z0-9_-]{20,}\b/g,'[REDACTED]')
      .replace(/([?&](?:key|token|api_key)=)[^&\s]+/gi,'$1[REDACTED]')
      .replace(/((?:maptiler|hmac|secret|password|token|api[-_ ]?key|\bkey)["'\s]*[:=]["'\s]*)[^\s,&"'}]+/gi,'$1[REDACTED]');
  }
  function normalizeError(error){
    const name=String(error?.name||'Error'),message=redactSecrets(error?.message||error||'Unknown error'),code=redactSecrets(error?.code||'');
    const cancelled=name==='AbortError'||code==='ABORT_ERR'||/cancel(?:led|ed)|скасован/i.test(message);
    const validation=!cancelled&&(/validation|schema|unsafe|invalid|corrupt|bad_/i.test(`${name} ${code} ${message}`));
    const network=!cancelled&&!validation&&(/network|fetch|timeout|offline|http[_ -]?\d|failed to connect/i.test(`${name} ${code} ${message}`));
    return{name,code,message,category:cancelled?'cancelled':validation?'validation':network?'network':'unexpected',cancelled};
  }
  function safeSerialize(value){
    try{
      const seen=new WeakSet();
      return redactSecrets(JSON.stringify(value,(key,item)=>{
        if(SECRET_KEYS.test(key))return'[REDACTED]';
        if(item&&typeof item==='object'){if(seen.has(item))return'[Circular]';seen.add(item);}
        if(item instanceof Error)return normalizeError(item);
        return item;
      }));
    }catch(_error){return'{"error":"LOGGER_SERIALIZATION_FAILED"}';}
  }
  function userSafeMessage(error,fallback='Сталася помилка. Спробуйте ще раз.'){
    const normalized=error?.category?error:normalizeError(error);
    if(normalized.cancelled)return'';
    if(normalized.category==='network')return'Немає з’єднання або сервіс тимчасово недоступний.';
    if(normalized.category==='validation')return'Дані не пройшли безпечну перевірку.';
    return fallback;
  }
  function reportError(error,context={}){
    const normalized=normalizeError(error),result={...normalized,scope:String(context.scope||'app'),userMessage:userSafeMessage(normalized,context.userMessage)};
    if(normalized.cancelled)return result;
    try{root.console?.error?.(`[MT_ERROR] ${safeSerialize({scope:result.scope,error:normalized,details:context.details||null})}`);}catch(_loggerError){}
    return result;
  }
  root.MTSafeError=Object.freeze({redactSecrets,normalizeError,safeSerialize,userSafeMessage,reportError});
})(typeof window!=='undefined'?window:globalThis);
