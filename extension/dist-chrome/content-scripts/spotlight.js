var spotlight=(function(){function e(e){return e}var t={50:`#f5f3ff`,100:`#ede9fe`,200:`#ddd6fe`,500:`#8b5cf6`,600:`#7c3aed`,700:`#6d28d9`},n={100:`#f1f5f9`,200:`#e2e8f0`,400:`#94a3b8`,500:`#64748b`,700:`#334155`,900:`#0f172a`},r=`
:host {
  all: initial;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
  color: ${n[900]};
  -webkit-font-smoothing: antialiased;
}

.backdrop {
  position: fixed;
  inset: 0;
  z-index: 2147483646;
  pointer-events: auto;
  background: transparent;
}

.overlay {
  position: fixed;
  top: 80px;
  left: 50%;
  transform: translateX(-50%) translateY(0);
  width: 540px;
  max-width: 90vw;
  background: #ffffff;
  border-radius: 18px;
  /* Soft brand-tinted shadow — violet 600 at low alpha + a neutral lift. */
  box-shadow:
    0 1px 2px rgba(15, 23, 42, 0.06),
    0 8px 24px rgba(124, 58, 237, 0.18),
    0 24px 64px rgba(124, 58, 237, 0.14);
  z-index: 2147483647;
  padding: 16px 16px 14px 16px;
  opacity: 0;
  transition: opacity 180ms ease, transform 220ms ease;
  box-sizing: border-box;
}

.overlay.open {
  opacity: 1;
}

.overlay.closing {
  opacity: 0;
  transform: translateX(-50%) translateY(-4px);
}

.row {
  display: flex;
  align-items: center;
  gap: 10px;
}

.icon {
  width: 22px;
  height: 22px;
  flex: 0 0 22px;
  color: ${t[600]};
}

input.input {
  flex: 1 1 auto;
  border: none;
  outline: none;
  font-size: 17px;
  line-height: 24px;
  padding: 8px 4px;
  background: transparent;
  color: ${n[900]};
  font-weight: 500;
}

input.input::placeholder {
  color: ${n[400]};
  font-weight: 400;
}

button.save {
  flex: 0 0 auto;
  border: none;
  cursor: pointer;
  padding: 9px 18px;
  border-radius: 999px;
  font-size: 14px;
  font-weight: 600;
  color: #ffffff;
  background: linear-gradient(135deg, ${t[500]} 0%, ${t[700]} 100%);
  box-shadow: 0 4px 12px rgba(124, 58, 237, 0.32);
  transition: transform 120ms ease, opacity 120ms ease, box-shadow 120ms ease;
  letter-spacing: 0.01em;
}

button.save:disabled {
  background: ${n[200]};
  color: ${n[500]};
  cursor: not-allowed;
  box-shadow: none;
}

button.save:not(:disabled):active {
  transform: scale(0.97);
}

.chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 10px;
}

button.chip {
  border: 1px solid ${n[200]};
  background: #ffffff;
  color: ${n[700]};
  padding: 5px 11px;
  border-radius: 999px;
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  transition: background 120ms ease, color 120ms ease, border-color 120ms ease, transform 120ms ease;
  font-family: inherit;
}

button.chip:hover {
  border-color: ${t[200]};
  color: ${t[700]};
}

button.chip.active {
  background: ${t[50]};
  border-color: ${t[200]};
  color: ${t[700]};
}

button.chip:active {
  transform: scale(0.97);
}

.tags {
  margin-top: 8px;
}

input.tagInput {
  width: 100%;
  border: 1px solid ${n[200]};
  border-radius: 12px;
  padding: 8px 12px;
  font-size: 13px;
  outline: none;
  color: ${n[700]};
  font-family: inherit;
  transition: border-color 120ms ease;
  box-sizing: border-box;
  background: ${n[100]};
}

input.tagInput:focus {
  border-color: ${t[200]};
  background: #ffffff;
}

input.tagInput::placeholder {
  color: ${n[400]};
}
`,i=[`idea`,`article`,`recipe`,`video`,`food`,`place`],a={idea:`Idea`,article:`Article`,recipe:`Recipe`,video:`Video`,food:`Food`,place:`Place`,product:`Product`,event:`Event`,fitness:`Fitness`,career:`Career`,academia:`Academia`,other:`Note`},o=3,s=220,c=null,l=null,u=!1;function d(){if(c){l?.focus(),l?.select();return}f()}function f(){u=!1,c=document.createElement(`div`),c.setAttribute(`data-silo-spotlight`,``);let e=c.attachShadow({mode:`closed`}),t=document.createElement(`style`);t.textContent=r,e.appendChild(t);let n=document.createElement(`div`);n.className=`backdrop`;let s=document.createElement(`div`);s.className=`overlay`,s.setAttribute(`role`,`dialog`),s.setAttribute(`aria-label`,`Save to Silo`);let d=document.createElement(`div`);d.className=`row`;let f=_(),g=document.createElement(`input`);g.type=`text`,g.className=`input`,g.placeholder=`What did you find?`,g.autocomplete=`off`,g.spellcheck=!1;let v=document.createElement(`button`);v.className=`save`,v.type=`button`,v.textContent=`Save`,v.disabled=!0,d.appendChild(f),d.appendChild(g),d.appendChild(v);let y=document.createElement(`div`);y.className=`chips`;let b=`idea`,x=[];for(let e of i){let t=document.createElement(`button`);t.type=`button`,t.className=`chip`+(e===b?` active`:``),t.textContent=a[e],t.dataset.classification=e,t.addEventListener(`click`,()=>{b=e;for(let t of x)t.classList.toggle(`active`,t.dataset.classification===e)}),y.appendChild(t),x.push(t)}let S=document.createElement(`div`);S.className=`tags`;let C=document.createElement(`input`);C.type=`text`,C.className=`tagInput`,C.placeholder=`Tags, comma separated`,C.autocomplete=`off`,C.spellcheck=!1,S.appendChild(C),s.appendChild(d),s.appendChild(y),s.appendChild(S),e.appendChild(n),e.appendChild(s),document.body.appendChild(c),l=g,requestAnimationFrame(()=>{s.classList.add(`open`),g.focus()}),g.addEventListener(`input`,()=>{v.disabled=g.value.trim().length<o});let w=async()=>{if(v.disabled||u)return;v.disabled=!0;let e=g.value.trim(),t=m(C.value);try{let n=await chrome.runtime.sendMessage({type:`silo:save-item`,item:h(e,b,t)});if(!n?.ok)throw Error(n?.error||`background save failed`)}catch(e){console.error(`[silo spotlight] save failed`,e)}p(s)};v.addEventListener(`click`,w),g.addEventListener(`keydown`,e=>{e.key===`Enter`&&(e.preventDefault(),w())}),C.addEventListener(`keydown`,e=>{e.key===`Enter`&&(e.preventDefault(),w())}),e.addEventListener(`keydown`,e=>{e.key===`Escape`&&(e.preventDefault(),p(s))}),n.addEventListener(`click`,()=>p(s))}function p(e){u||(u=!0,e.classList.remove(`open`),e.classList.add(`closing`),window.setTimeout(()=>{c?.remove(),c=null,l=null,u=!1},s))}function m(e){return e.split(`,`).map(e=>e.trim()).filter(e=>e.length>0)}function h(e,t,n){let r=new Date().toISOString();return{id:g(),type:`note`,classification:t,title:e,tags:n,archived:!1,viewed:!1,created_at:r,updated_at:r}}function g(){let e=globalThis.crypto;return e&&typeof e.randomUUID==`function`?e.randomUUID():`silo_${Date.now().toString(36)}_${Math.random().toString(36).slice(2,10)}`}function _(){let e=document.createElementNS(`http://www.w3.org/2000/svg`,`svg`);e.setAttribute(`viewBox`,`0 0 24 24`),e.setAttribute(`fill`,`none`),e.setAttribute(`stroke`,`currentColor`),e.setAttribute(`stroke-width`,`2`),e.setAttribute(`stroke-linecap`,`round`),e.setAttribute(`stroke-linejoin`,`round`),e.classList.add(`icon`);let t=document.createElementNS(`http://www.w3.org/2000/svg`,`path`);return t.setAttribute(`d`,`M12 3l1.6 4.2L18 9l-4.4 1.8L12 15l-1.6-4.2L6 9l4.4-1.8L12 3zM19 14l.8 2.1L22 17l-2.2.9L19 20l-.8-2.1L16 17l2.2-.9L19 14zM5 14l.8 2.1L8 17l-2.2.9L5 20l-.8-2.1L2 17l2.2-.9L5 14z`),e.appendChild(t),e}var v=e({matches:[`<all_urls>`],runAt:`document_idle`,main(){chrome.runtime.onMessage.addListener(e=>{e?.type===`silo:open-spotlight`&&d()})}}),y={debug:(...e)=>([...e],void 0),log:(...e)=>([...e],void 0),warn:(...e)=>([...e],void 0),error:(...e)=>([...e],void 0)},b=globalThis.browser?.runtime?.id?globalThis.browser:globalThis.chrome,x=class e extends Event{static EVENT_NAME=S(`wxt:locationchange`);constructor(t,n){super(e.EVENT_NAME,{}),this.newUrl=t,this.oldUrl=n}};function S(e){return`${b?.runtime?.id}:spotlight:${e}`}var C=typeof globalThis.navigation?.addEventListener==`function`;function w(e){let t,n=!1;return{run(){n||(n=!0,t=new URL(location.href),C?globalThis.navigation.addEventListener(`navigate`,e=>{let n=new URL(e.destination.url);n.href!==t.href&&(window.dispatchEvent(new x(n,t)),t=n)},{signal:e.signal}):e.setInterval(()=>{let e=new URL(location.href);e.href!==t.href&&(window.dispatchEvent(new x(e,t)),t=e)},1e3))}}}var T=class e{static SCRIPT_STARTED_MESSAGE_TYPE=S(`wxt:content-script-started`);id;abortController;locationWatcher=w(this);constructor(e,t){this.contentScriptName=e,this.options=t,this.id=Math.random().toString(36).slice(2),this.abortController=new AbortController,this.stopOldScripts(),this.listenForNewerScripts()}get signal(){return this.abortController.signal}abort(e){return this.abortController.abort(e)}get isInvalid(){return b.runtime?.id??this.notifyInvalidated(),this.signal.aborted}get isValid(){return!this.isInvalid}onInvalidated(e){return this.signal.addEventListener(`abort`,e),()=>this.signal.removeEventListener(`abort`,e)}block(){return new Promise(()=>{})}setInterval(e,t){let n=setInterval(()=>{this.isValid&&e()},t);return this.onInvalidated(()=>clearInterval(n)),n}setTimeout(e,t){let n=setTimeout(()=>{this.isValid&&e()},t);return this.onInvalidated(()=>clearTimeout(n)),n}requestAnimationFrame(e){let t=requestAnimationFrame((...t)=>{this.isValid&&e(...t)});return this.onInvalidated(()=>cancelAnimationFrame(t)),t}requestIdleCallback(e,t){let n=requestIdleCallback((...t)=>{this.signal.aborted||e(...t)},t);return this.onInvalidated(()=>cancelIdleCallback(n)),n}addEventListener(e,t,n,r){t===`wxt:locationchange`&&this.isValid&&this.locationWatcher.run(),e.addEventListener?.(t.startsWith(`wxt:`)?S(t):t,n,{...r,signal:this.signal})}notifyInvalidated(){this.abort(`Content script context invalidated`),y.debug(`Content script "${this.contentScriptName}" context invalidated`)}stopOldScripts(){document.dispatchEvent(new CustomEvent(e.SCRIPT_STARTED_MESSAGE_TYPE,{detail:{contentScriptName:this.contentScriptName,messageId:this.id}})),this.options?.noScriptStartedPostMessage||window.postMessage({type:e.SCRIPT_STARTED_MESSAGE_TYPE,contentScriptName:this.contentScriptName,messageId:this.id},`*`)}verifyScriptStartedEvent(e){let t=e.detail?.contentScriptName===this.contentScriptName,n=e.detail?.messageId===this.id;return t&&!n}listenForNewerScripts(){let t=e=>{!(e instanceof CustomEvent)||!this.verifyScriptStartedEvent(e)||this.notifyInvalidated()};document.addEventListener(e.SCRIPT_STARTED_MESSAGE_TYPE,t),this.onInvalidated(()=>document.removeEventListener(e.SCRIPT_STARTED_MESSAGE_TYPE,t))}},E={debug:(...e)=>([...e],void 0),log:(...e)=>([...e],void 0),warn:(...e)=>([...e],void 0),error:(...e)=>([...e],void 0)};return(async()=>{try{let{main:e,...t}=v;return await e(new T(`spotlight`,t))}catch(e){throw E.error(`The content script "spotlight" crashed on startup!`,e),e}})()})();
spotlight;