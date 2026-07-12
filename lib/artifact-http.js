const DOCUMENT_SANDBOX = "sandbox allow-scripts allow-popups allow-forms allow-modals";

// This is deliberately a server-owned constant. It is never interpolated with artifact
// content, and is only added to the explicit ?anchor=1 representation.
export const ANCHOR_BRIDGE_MARKER = "artifact-anchor-bridge";
export const ANCHOR_BRIDGE = `<script id="${ANCHOR_BRIDGE_MARKER}">(function(){try{\n"use strict";var d=document,w=window,picking=false,anchors=[];\nfunction clamp(n){n=Number(n);return Number.isFinite(n)?Math.max(0,Math.min(1,n)):null;}\nfunction dimensions(){var h=d.documentElement,b=d.body||{};return {w:Math.max(h.scrollWidth,h.clientWidth,b.scrollWidth||0,b.clientWidth||0,1),h:Math.max(h.scrollHeight,h.clientHeight,b.scrollHeight||0,b.clientHeight||0,1)};}\nfunction post(message){try{w.parent.postMessage(message,"*");}catch(_){}}\nfunction pathFor(el){try{var bits=[],node=el,depth=0;while(node&&node.nodeType===1&&depth++<8){var tag=node.tagName.toLowerCase(),i=1,prev=node;while((prev=prev.previousElementSibling))i++;bits.unshift(tag+":nth-child("+i+")");if(node===d.documentElement)break;node=node.parentElement;}return bits.join(">");}catch(_){return "";}}\nfunction position(anchor){try{var x=clamp(anchor&&anchor.x),y=clamp(anchor&&anchor.y),el=null;if(anchor&&typeof anchor.path==="string"&&anchor.path){try{el=d.querySelector(anchor.path);}catch(_){}}var size=dimensions();if(el){var rect=el.getBoundingClientRect();return {id:String(anchor.id||""),x:rect.left+rect.width/2,y:rect.top+rect.height/2,lost:false};}if(x===null||y===null)return {id:String(anchor&&anchor.id||""),lost:true};var px=x*size.w-w.scrollX,py=y*size.h-w.scrollY;if(!Number.isFinite(px)||!Number.isFinite(py))return {id:String(anchor.id||""),lost:true};return {id:String(anchor.id||""),x:px,y:py,lost:false};}catch(_){return {id:String(anchor&&anchor.id||""),lost:true};}}\nfunction repaint(){try{post({type:"anchor:positions",anchors:anchors.map(position)});}catch(_){}}\nfunction pick(ev){try{if(!picking)return;var el=ev.target&&ev.target.nodeType===1?ev.target:ev.target&&ev.target.parentElement;if(!el)return;ev.preventDefault();ev.stopPropagation();var rect=el.getBoundingClientRect(),size=dimensions();post({type:"anchor:picked",x:clamp((rect.left+rect.width/2+w.scrollX)/size.w),y:clamp((rect.top+rect.height/2+w.scrollY)/size.h),path:pathFor(el)});picking=false;d.removeEventListener("click",pick,true);}catch(_){}}\nfunction receive(ev){try{if(ev.source!==w.parent||!ev.data||typeof ev.data!=="object")return;var type=ev.data.type;if(type==="anchor:pick-on"){if(!picking){picking=true;d.addEventListener("click",pick,true);}}else if(type==="anchor:pick-off"){picking=false;d.removeEventListener("click",pick,true);}else if(type==="anchor:repaint"){anchors=Array.isArray(ev.data.anchors)?ev.data.anchors.slice(0,200):[];repaint();}}catch(_){}}\nw.addEventListener("message",receive);w.addEventListener("resize",repaint);d.addEventListener("scroll",repaint,true);w.addEventListener("load",function(){post({type:"anchor:ready"});repaint();});post({type:"anchor:ready"});\n}catch(_){}})();</script>`;

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
