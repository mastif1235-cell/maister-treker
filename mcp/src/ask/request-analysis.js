/* Internal execution state, owned by ONE handle(). Never tool arguments or
   serialized context. Pin the first successful query read: KV JSON parsing
   otherwise creates new row identities on every tool call. Rows/searchIndex
   are immutable for this request; date/filter membership stays per query. */
export function createRequestAnalysis(){
  let reads=new WeakMap(), rows=new WeakMap(), disposed=false;
  const state=Object.create(null);
  Object.defineProperties(state,{
    load:{value:async function(loader){
      if(disposed)return loader();
      let pending=reads.get(loader);
      if(!pending){
        pending=Promise.resolve().then(loader);
        reads.set(loader,pending);
      }
      try{
        const result=await pending;
        if(!result?.ok && reads.get(loader)===pending)reads.delete(loader);
        return result;
      }catch(error){
        if(reads.get(loader)===pending)reads.delete(loader);
        throw error;
      }
    }},
    analyze:{value:function(ticket,searchIndex,profile,compute){
      if(disposed)return compute();
      let sources=rows.get(ticket);
      if(!sources){sources=new WeakMap();rows.set(ticket,sources);}
      let variants=sources.get(searchIndex);
      if(!variants){variants=new Map();sources.set(searchIndex,variants);}
      // workEvents reads ONLY profile from options. Missing profile means the
      // unreconciled legacy analysis; work_v2 must remain a separate variant.
      const key=profile || '';
      if(variants.has(key))return variants.get(key);
      const analysis=compute(); // exceptions deliberately never inserted
      variants.set(key,analysis);
      return analysis;
    }},
    dispose:{value:function(){disposed=true;reads=new WeakMap();rows=new WeakMap();}}
  });
  return Object.freeze(state);
}
