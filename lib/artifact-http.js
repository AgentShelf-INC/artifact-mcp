// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Neil Blackman
const DOCUMENT_SANDBOX = "sandbox allow-scripts allow-popups allow-forms allow-modals";

// This is deliberately a server-owned constant. It is never interpolated with artifact
// content, and is only added to the explicit ?anchor=1 representation.
export const ANCHOR_BRIDGE_MARKER = "artifact-anchor-bridge";
export const ANCHOR_BRIDGE = `<script id="${ANCHOR_BRIDGE_MARKER}">(function(){try{
"use strict";var d=document,w=window,picking=false,anchors=[],drag=null,selection=null,threshold=4;
function clamp(n){n=Number(n);return Number.isFinite(n)?Math.max(0,Math.min(1,n)):null;}
function dimensions(){var h=d.documentElement,b=d.body||{};return {w:Math.max(h.scrollWidth,h.clientWidth,b.scrollWidth||0,b.clientWidth||0,1),h:Math.max(h.scrollHeight,h.clientHeight,b.scrollHeight||0,b.clientHeight||0,1)};}
function post(message){try{w.parent.postMessage(message,"*");}catch(_){}}
function pathFor(el){try{var bits=[],node=el,depth=0;while(node&&node.nodeType===1&&depth++<8){var tag=node.tagName.toLowerCase(),i=1,prev=node;while((prev=prev.previousElementSibling))i++;bits.unshift(tag+":nth-child("+i+")");if(node===d.documentElement)break;node=node.parentElement;}return bits.join(">");}catch(_){return "";}}
function elementFor(ev){try{return ev.target&&ev.target.nodeType===1?ev.target:ev.target&&ev.target.parentElement||null;}catch(_){return null;}}
function clearSelection(){try{if(selection)selection.remove();selection=null;}catch(_){selection=null;}}
function showSelection(a,b){try{if(!selection){selection=d.createElement("div");selection.setAttribute("data-artifact-anchor-selection","");selection.style.cssText="position:fixed;z-index:2147483647;pointer-events:none;border:2px solid #a66a2c;background:rgba(166,106,44,.14);box-sizing:border-box;";(d.body||d.documentElement).appendChild(selection);}var left=Math.min(a.x,b.x),top=Math.min(a.y,b.y);selection.style.left=left+"px";selection.style.top=top+"px";selection.style.width=Math.abs(a.x-b.x)+"px";selection.style.height=Math.abs(a.y-b.y)+"px";}catch(_){}}
function stopPicking(){picking=false;drag=null;clearSelection();d.removeEventListener("pointerdown",down,true);d.removeEventListener("pointermove",move,true);d.removeEventListener("pointerup",up,true);d.removeEventListener("pointercancel",cancel,true);}
function position(anchor){try{var id=String(anchor&&anchor.id||""),x=clamp(anchor&&anchor.x),y=clamp(anchor&&anchor.y),bw=clamp(anchor&&anchor.w),bh=clamp(anchor&&anchor.h),box=bw!==null&&bh!==null&&bw>0&&bh>0;var size=dimensions();if(x===null||y===null)return {id:id,lost:true};if(box){var bx=x*size.w-w.scrollX,by=y*size.h-w.scrollY,pw=Math.min(bw,1-x)*size.w,ph=Math.min(bh,1-y)*size.h;if(!Number.isFinite(bx)||!Number.isFinite(by)||!Number.isFinite(pw)||!Number.isFinite(ph)||pw<=0||ph<=0)return {id:id,lost:true};return {id:id,x:bx,y:by,w:pw,h:ph,lost:false};}var px=x*size.w-w.scrollX,py=y*size.h-w.scrollY;if(!Number.isFinite(px)||!Number.isFinite(py))return {id:id,lost:true};return {id:id,x:px,y:py,lost:false};}catch(_){return {id:String(anchor&&anchor.id||""),lost:true};}}
function repaint(){try{post({type:"anchor:positions",anchors:anchors.map(position)});}catch(_){}}
function down(ev){try{if(!picking||ev.button!==undefined&&ev.button!==0)return;var el=elementFor(ev);if(!el)return;ev.preventDefault();ev.stopPropagation();drag={id:ev.pointerId,x:ev.clientX,y:ev.clientY,el:el,moved:false};}catch(_){}}
function move(ev){try{if(!drag||ev.pointerId!==drag.id)return;ev.preventDefault();ev.stopPropagation();if(Math.abs(ev.clientX-drag.x)>threshold||Math.abs(ev.clientY-drag.y)>threshold){drag.moved=true;showSelection({x:drag.x,y:drag.y},{x:ev.clientX,y:ev.clientY});}}catch(_){}}
function up(ev){try{if(!drag||ev.pointerId!==drag.id)return;ev.preventDefault();ev.stopPropagation();var current=drag,size=dimensions();if(current.moved){var left=Math.min(current.x,ev.clientX)+w.scrollX,top=Math.min(current.y,ev.clientY)+w.scrollY,bx=clamp(left/size.w),by=clamp(top/size.h),bw=Math.min(Math.abs(ev.clientX-current.x)/size.w,1-(bx===null?1:bx)),bh=Math.min(Math.abs(ev.clientY-current.y)/size.h,1-(by===null?1:by));if(bx!==null&&by!==null&&Number.isFinite(bw)&&Number.isFinite(bh)&&bw>0&&bh>0)post({type:"anchor:picked",x:bx,y:by,w:bw,h:bh,path:pathFor(current.el)});}else post({type:"anchor:picked",x:clamp((current.x+w.scrollX)/size.w),y:clamp((current.y+w.scrollY)/size.h),path:pathFor(current.el)});stopPicking();}catch(_){stopPicking();}}
function cancel(ev){try{if(drag&&ev.pointerId===drag.id)stopPicking();}catch(_){stopPicking();}}
function receive(ev){try{if(ev.source!==w.parent||!ev.data||typeof ev.data!=="object")return;var type=ev.data.type;if(type==="anchor:pick-on"){if(!picking){picking=true;d.addEventListener("pointerdown",down,true);d.addEventListener("pointermove",move,true);d.addEventListener("pointerup",up,true);d.addEventListener("pointercancel",cancel,true);}}else if(type==="anchor:pick-off"){stopPicking();}else if(type==="anchor:repaint"){anchors=Array.isArray(ev.data.anchors)?ev.data.anchors.slice(0,200):[];repaint();}}catch(_){}}
w.addEventListener("message",receive);w.addEventListener("resize",repaint);d.addEventListener("scroll",repaint,true);w.addEventListener("load",function(){post({type:"anchor:ready"});repaint();});post({type:"anchor:ready"});
}catch(_){}})();</script>`;

export function isHtmlContentType(contentType) {
  return /^text\/html(?:;|$)/i.test(String(contentType || ""));
}

export function injectAnchorBridge(content) {
  const html = Buffer.isBuffer(content) ? content.toString("utf8") : String(content);
  // Inject before the LAST </body>, not the first: a </body> can appear earlier inside a
  // <script> string or an HTML comment, and injecting there would land the bridge inside
  // that script/comment and corrupt the artifact. The real closing tag is the last one.
  const re = /<\/body\s*>/gi;
  let last = -1;
  for (let m = re.exec(html); m; m = re.exec(html)) last = m.index;
  return last === -1
    ? `${html}${ANCHOR_BRIDGE}`
    : `${html.slice(0, last)}${ANCHOR_BRIDGE}${html.slice(last)}`;
}

// Remove <script> blocks so a scriptless-sandboxed representation (e.g. the gallery preview
// thumbnails) doesn't emit "Blocked script execution" console noise for every inline script.
// Preview iframes deliberately omit allow-scripts; stripping the scripts server-side means
// nothing tries to run. Not a security control — the sandbox still is.
const SCRIPT_RE = /<script\b[^>]*>[\s\S]*?<\/script\s*>/gi;
export function stripScripts(content) {
  const html = Buffer.isBuffer(content) ? content.toString("utf8") : String(content);
  return html.replace(SCRIPT_RE, "");
}

export function rawArtifactHeaders(contentType, { downloadName } = {}) {
  // Apply the document sandbox to EVERY raw response, not just text/html. Uploaded
  // .svg (image/svg+xml) and .xml execute scripts as a document on direct navigation;
  // the sandbox CSP forces a null-origin context so any script can't reach same-origin
  // cookies/endpoints. Harmless (ignored) when the file is loaded as a subresource.
  const headers = {
    "content-type": contentType,
    "x-content-type-options": "nosniff",
    "referrer-policy": "no-referrer",
    "cache-control": "private, max-age=60",
    "content-security-policy": DOCUMENT_SANDBOX
  };
  if (downloadName) {
    headers["content-disposition"] = `attachment; filename="${downloadName}"`;
  }
  return headers;
}
