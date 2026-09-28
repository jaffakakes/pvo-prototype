export function channelId() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
}

export function runtimeDocument(channel, nonce) {
  const csp = `default-src 'none'; script-src 'nonce-${nonce}' blob:; worker-src blob:; connect-src 'none'; img-src 'none'; media-src 'none'; font-src 'none'; style-src 'none'; frame-src 'none'; object-src 'none'; form-action 'none'; base-uri 'none'`;
  const script = `
    const channel = ${JSON.stringify(channel)};
    let worker = null;
    let workerUrl = null;
    const send = payload => parent.postMessage({channel, ...payload}, '*');
    function stop() {
      worker?.terminate(); worker = null;
      if (workerUrl) URL.revokeObjectURL(workerUrl);
      workerUrl = null;
    }
    function start(js) {
      stop();
      const source = [
        'const __nativePost = self.postMessage.bind(self);',
        'const __nativeListen = self.addEventListener.bind(self);',
        'let __pvoEventId = null;',
        'let __pvoRequestSerial = 0;',
        'const __pvoRequests = new Map();',
        'const __pvoActions = Object.fromEntries(["pick","goToScene","jumpTo","resume","track","submit"].map(method => [method, (...args) => { if(__pvoEventId != null) __nativePost({kind:"action",eventId:__pvoEventId,method,args}); }]));',
        '__pvoActions.request = config => new Promise((resolve,reject) => { if(__pvoEventId == null) return reject(new Error("Requests require a component interaction.")); const requestId=++__pvoRequestSerial; let complete; const settled=new Promise(done => { complete=done; }); __pvoRequests.set(requestId,{eventId:__pvoEventId,resolve,reject,settled,complete}); __nativePost({kind:"action",eventId:__pvoEventId,method:"request",args:[config],requestId}); });',
        'const pvo = Object.freeze(__pvoActions);',
        '__nativeListen("message", event => { const m=event.data; if(!m || m.kind!=="request-result") return; const entry=__pvoRequests.get(m.requestId); if(!entry || entry.eventId!==m.eventId) return; __pvoRequests.delete(m.requestId); if(m.ok) entry.resolve(m.value); else entry.reject(new Error(String(m.error||"Request failed."))); entry.complete(); });',
        '__nativeListen("message", async event => { const m=event.data; if(!m || m.kind!=="invoke") return; __pvoEventId=m.eventId; try { const fn = m.name.startsWith("pvo.") ? pvo[m.name.slice(4)] : self[m.name]; if(typeof fn!=="function") throw new Error("Unknown component function: "+m.name); const args=m.args.map(x=>x&&x.__pvoFormFields ? m.fields : x); await fn(...args); while(true) { const active=[...__pvoRequests.values()].filter(entry=>entry.eventId===m.eventId); if(!active.length) break; await Promise.all(active.map(entry=>entry.settled)); } __nativePost({kind:"done",eventId:m.eventId}); } catch(error) { __nativePost({kind:"error",eventId:m.eventId,message:String(error?.message||error)}); } finally { __pvoEventId=null; } });',
        js,
        '__nativePost({kind:"ready"});'
      ].join('\\n');
      workerUrl = URL.createObjectURL(new Blob([source], {type:'text/javascript'}));
      try {
        worker = new Worker(workerUrl);
        worker.onmessage = event => {
          const m=event.data;
          if(!m || typeof m!=="object") return;
          if(m.kind==="action" || m.kind==="done" || m.kind==="error" || m.kind==="ready") send(m);
        };
        worker.onerror = event => send({kind:'error',message:event.message || 'Component Functions error'});
      } catch(error) { send({kind:'error',message:String(error?.message||error)}); }
    }
    addEventListener('message', event => {
      const m=event.data;
      if(event.source!==parent || !m || m.channel!==channel) return;
      if(m.kind==='start' && typeof m.js==='string') start(m.js);
      if(m.kind==='invoke' && worker) worker.postMessage(m);
      if(m.kind==='request-result' && worker) worker.postMessage(m);
      if(m.kind==='stop') stop();
    });
    send({kind:'frame-ready'});
  `;
  return `<!doctype html><meta http-equiv="Content-Security-Policy" content="${csp}"><script nonce="${nonce}">${script}</script>`;
}
