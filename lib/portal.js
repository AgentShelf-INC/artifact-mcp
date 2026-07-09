// Server-rendered gallery portal. Cards show a live (sandboxed, scaled) preview of the
// real artifact, the uploader, and admin/owner delete. Light + dark themes.

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );
}

const ORG_HUES = {
  agentshelf: "--org-agentshelf",
  trustedtech: "--org-trustedtech",
  cairn: "--org-cairn"
};
function orgVar(org) {
  return ORG_HUES[org] || "--org-admin";
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function fmtDate(s) {
  // created_at is 'YYYY-MM-DD HH:MM:SS' (UTC). Render as 'Mon D'.
  const m = String(s || "").match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return "";
  return `${MONTHS[Number(m[2]) - 1]} ${Number(m[3])}`;
}

function card(a) {
  const hue = `var(${orgVar(a.org)})`;
  const desc = a.description ? `<p class="desc">${esc(a.description)}</p>` : "";
  return `
  <article class="card" data-id="${esc(a.id)}" data-org="${esc(a.org)}"
           data-q="${esc((a.title + " " + a.client_id + " " + (a.description || "")).toLowerCase())}"
           style="--k:${hue}">
    <div class="preview">
      <iframe class="pv" src="/${esc(a.id)}" sandbox="" scrolling="no" loading="lazy"
              title="${esc(a.title)} preview" tabindex="-1"></iframe>
      <div class="glass"></div>
      <span class="pid">/${esc(a.id)}</span>
    </div>
    <div class="label">
      <h3 class="card-title">${esc(a.title)}</h3>
      ${desc}
      <div class="meta">
        <span class="org-tag">${esc(a.org)}</span><span class="sep">·</span>
        <span class="up">&uarr; ${esc(a.client_id)}</span><span class="sep">·</span>
        <span>${fmtDate(a.created_at)}</span>
      </div>
      <div class="actions">
        <a class="act open" href="/${esc(a.id)}" target="_blank" rel="noopener">Open &#8599;</a>
        <button class="act del" type="button" aria-label="Delete ${esc(a.title)}">Delete</button>
        <span class="confirm" role="group" aria-label="Confirm delete">
          <span class="q">Delete?</span><button class="yes" type="button">yes</button><button class="no" type="button">cancel</button>
        </span>
      </div>
    </div>
  </article>`;
}

// sections: [{ org, items: [row,...] }]. viewer: { email, org, isAdmin }.
export function renderGallery(viewer, sections) {
  const total = sections.reduce((n, s) => n + s.items.length, 0);
  const showChips = sections.length > 1;
  const role = viewer.isAdmin ? "admin" : esc(viewer.org || "member");

  const chips = showChips
    ? `<div class="filters" id="filters">
        <button class="chip" data-org="all" aria-pressed="true">all</button>
        ${sections
          .map(
            (s) =>
              `<button class="chip" data-org="${esc(s.org)}" aria-pressed="false"><span class="dot" style="background:var(${orgVar(
                s.org
              )})"></span>${esc(s.org)}</button>`
          )
          .join("")}
      </div>`
    : "";

  const body =
    total === 0
      ? `<p class="empty-all">No artifacts yet. Publish one with the <code>publish_artifact</code> tool and it lands here.</p>`
      : sections
          .filter((s) => s.items.length)
          .map(
            (s) => `
      <section class="org" data-org="${esc(s.org)}">
        <div class="org-head">
          <span class="org-name" style="color:var(${orgVar(s.org)})">${esc(s.org)}</span>
          <span class="org-rule"></span>
          <span class="org-n">${s.items.length}</span>
        </div>
        <div class="grid">${s.items.map(card).join("")}</div>
      </section>`
          )
          .join("");

  return `<!doctype html><html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Artifacts &middot; neilblackman.dev</title>
<style>${CSS}</style></head>
<body>
<div class="wrap">
  <header class="masthead">
    <div><p class="eyebrow">artifact.neilblackman.dev</p><h1 class="title">Artifacts</h1></div>
    <div class="whoami"><span>signed in</span><span class="badge">${esc(viewer.email)} · <span class="role">${role}</span></span></div>
  </header>
  <div class="toolbar">
    <label class="search"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></svg>
      <input id="q" type="search" placeholder="Search titles, uploaders…" aria-label="Search artifacts"></label>
    ${chips}
    <span class="count" id="count">${total} artifact${total === 1 ? "" : "s"} · ${sections.length} org${sections.length === 1 ? "" : "s"}</span>
  </div>
  <div id="stage">${body}</div>
  <p class="empty" id="empty">No artifacts match. Try a different search.</p>
</div>
<script>${SCRIPT}</script>
</body></html>`;
}

const CSS = `
:root{
  --font-display:ui-serif,"Iowan Old Style","Hoefler Text",Georgia,serif;
  --font-ui:system-ui,-apple-system,"Segoe UI",sans-serif;
  --font-mono:ui-monospace,"SF Mono","JetBrains Mono",Menlo,monospace;
  --ground:#E7E9ED;--ground-2:#DDE0E6;--card:#FFFFFF;--ink:#1B2430;--ink-2:#55606E;--ink-3:#8A94A0;
  --line:#CCD2DA;--line-2:#E1E5EA;--brass:#A9711F;--danger:#A63643;
  --sheen:linear-gradient(180deg,rgba(255,255,255,.55),rgba(255,255,255,0) 42%);
  --org-agentshelf:#3B6EA5;--org-trustedtech:#3F7A57;--org-cairn:#8F6231;--org-admin:#6A5B92;
}
@media (prefers-color-scheme:dark){:root{
  --ground:#12161C;--ground-2:#0D1116;--card:#1A2028;--ink:#E7EAEE;--ink-2:#9AA4B0;--ink-3:#69737E;
  --line:#2A323C;--line-2:#222932;--brass:#D8A24C;--danger:#D06A74;
  --sheen:linear-gradient(180deg,rgba(255,255,255,.10),rgba(255,255,255,0) 42%);
  --org-agentshelf:#6F9BD1;--org-trustedtech:#6FB088;--org-cairn:#C79A63;--org-admin:#9E8FCB;}}
:root[data-theme="light"]{--ground:#E7E9ED;--ground-2:#DDE0E6;--card:#FFFFFF;--ink:#1B2430;--ink-2:#55606E;--ink-3:#8A94A0;--line:#CCD2DA;--line-2:#E1E5EA;--brass:#A9711F;--danger:#A63643;--sheen:linear-gradient(180deg,rgba(255,255,255,.55),rgba(255,255,255,0) 42%);--org-agentshelf:#3B6EA5;--org-trustedtech:#3F7A57;--org-cairn:#8F6231;--org-admin:#6A5B92;}
:root[data-theme="dark"]{--ground:#12161C;--ground-2:#0D1116;--card:#1A2028;--ink:#E7EAEE;--ink-2:#9AA4B0;--ink-3:#69737E;--line:#2A323C;--line-2:#222932;--brass:#D8A24C;--danger:#D06A74;--sheen:linear-gradient(180deg,rgba(255,255,255,.10),rgba(255,255,255,0) 42%);--org-agentshelf:#6F9BD1;--org-trustedtech:#6FB088;--org-cairn:#C79A63;--org-admin:#9E8FCB;}
*{box-sizing:border-box}
body{margin:0;background:var(--ground);color:var(--ink);font-family:var(--font-ui);-webkit-font-smoothing:antialiased;line-height:1.5}
.wrap{max-width:1120px;margin:0 auto;padding:2.4rem 1.5rem 5rem}
.masthead{display:flex;justify-content:space-between;align-items:flex-end;gap:1rem;padding-bottom:1.1rem;border-bottom:1px solid var(--line);flex-wrap:wrap}
.eyebrow{font-family:var(--font-mono);font-size:.72rem;letter-spacing:.04em;color:var(--ink-3);margin:0 0 .35rem}
.title{font-family:var(--font-display);font-weight:600;font-size:2.5rem;line-height:1;letter-spacing:-.01em;margin:0}
.whoami{display:flex;align-items:center;gap:.55rem;font-family:var(--font-mono);font-size:.8rem;color:var(--ink-2)}
.whoami .badge{border:1px solid var(--line);border-radius:999px;padding:.2rem .6rem;color:var(--ink);background:var(--card)}
.whoami .role{color:var(--brass);font-weight:600}
.toolbar{display:flex;align-items:center;gap:.9rem;flex-wrap:wrap;margin:1.3rem 0 .4rem}
.search{flex:1;min-width:200px;display:flex;align-items:center;gap:.5rem;background:var(--card);border:1px solid var(--line);border-radius:8px;padding:.5rem .7rem}
.search input{border:0;background:none;outline:none;color:var(--ink);font:inherit;width:100%}
.search input::placeholder{color:var(--ink-3)}
.search svg{flex:none;color:var(--ink-3)}
.filters{display:flex;gap:.4rem;flex-wrap:wrap}
.chip{font-family:var(--font-mono);font-size:.75rem;padding:.35rem .7rem;border-radius:999px;border:1px solid var(--line);background:var(--card);color:var(--ink-2);cursor:pointer}
.chip[aria-pressed="true"]{color:var(--ink);border-color:var(--ink-2);background:var(--ground-2)}
.chip .dot{display:inline-block;width:.5rem;height:.5rem;border-radius:2px;margin-right:.45rem;vertical-align:middle;transform:translateY(-1px)}
.count{font-family:var(--font-mono);font-size:.75rem;color:var(--ink-3);white-space:nowrap}
.org{margin-top:2.4rem}
.org-head{display:flex;align-items:baseline;gap:.7rem;margin-bottom:1rem}
.org-name{font-family:var(--font-mono);font-size:.82rem;letter-spacing:.06em;text-transform:uppercase;font-weight:600}
.org-rule{flex:1;height:1px;background:var(--line)}
.org-n{font-family:var(--font-mono);font-size:.75rem;color:var(--ink-3)}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(268px,1fr));gap:1.2rem}
.card{background:var(--card);border:1px solid var(--line);border-radius:12px;overflow:hidden;display:flex;flex-direction:column;transition:transform .18s ease,box-shadow .18s ease,border-color .18s ease}
.card:hover{transform:translateY(-3px);box-shadow:0 14px 30px -18px rgba(0,0,0,.45);border-color:var(--ink-3)}
.card::before{content:"";display:block;height:2px;background:var(--k)}
.preview{position:relative;aspect-ratio:16/10;overflow:hidden;background:var(--ground-2);border-bottom:1px solid var(--line-2)}
.preview .pv{position:absolute;top:0;left:0;width:400%;height:400%;border:0;transform:scale(.25);transform-origin:top left;pointer-events:none;background:#fff}
.preview .glass{position:absolute;inset:0;background:var(--sheen);pointer-events:none}
.preview .pid{position:absolute;left:.55rem;bottom:.5rem;font-family:var(--font-mono);font-size:.66rem;color:#fff;background:rgba(20,26,34,.62);padding:.12rem .4rem;border-radius:4px}
.label{padding:.85rem .95rem 1rem;display:flex;flex-direction:column;gap:.55rem;flex:1}
.card-title{font-family:var(--font-display);font-weight:600;font-size:1.12rem;line-height:1.2;margin:0;text-wrap:balance}
.desc{font-size:.86rem;color:var(--ink-2);margin:0;line-height:1.4}
.meta{display:flex;align-items:center;gap:.6rem;flex-wrap:wrap;font-family:var(--font-mono);font-size:.73rem;color:var(--ink-3);margin-top:auto}
.org-tag{color:var(--k);font-weight:600}
.up{color:var(--ink-2)}
.sep{color:var(--line)}
.actions{display:flex;align-items:center;gap:.5rem;margin-top:.35rem}
.act{font-family:var(--font-mono);font-size:.76rem;border:1px solid var(--line);background:transparent;color:var(--ink);border-radius:7px;padding:.34rem .6rem;cursor:pointer;text-decoration:none;display:inline-flex;align-items:center;gap:.3rem}
.act.open:hover{border-color:var(--brass);color:var(--brass)}
.act.del{color:var(--danger);border-color:transparent;margin-left:auto}
.act.del:hover{border-color:var(--danger)}
.confirm{display:none;align-items:center;gap:.45rem;margin-left:auto;font-family:var(--font-mono);font-size:.74rem}
.confirm.show{display:inline-flex}
.confirm .q{color:var(--danger)}
.confirm button{font:inherit;border:0;background:none;cursor:pointer}
.confirm .yes{color:var(--danger);font-weight:600}
.confirm .no{color:var(--ink-2)}
.empty,.empty-all{color:var(--ink-3);font-family:var(--font-mono);font-size:.85rem}
.empty{display:none;padding:2rem 0}
.empty-all{padding:3rem 0}
.empty-all code{color:var(--brass)}
:focus-visible{outline:2px solid var(--brass);outline-offset:2px;border-radius:4px}
.card{opacity:0;transform:translateY(8px);animation:rise .5s ease forwards}
@keyframes rise{to{opacity:1;transform:none}}
@media (prefers-reduced-motion:reduce){.card{transition:none;opacity:1;transform:none;animation:none}.card:hover{transform:none}}
`;

const SCRIPT = `
(function(){
  var cards=[].slice.call(document.querySelectorAll('.card'));
  cards.forEach(function(c,i){ c.style.animationDelay=(i%12*40)+'ms'; });
  var q=document.getElementById('q'), count=document.getElementById('count'), empty=document.getElementById('empty');
  var active='all';
  function apply(){
    var term=(q.value||'').trim().toLowerCase(); var shown=0; var orgs={};
    cards.forEach(function(c){
      if(!c.isConnected) return;
      var ok=(active==='all'||c.dataset.org===active)&&(!term||c.dataset.q.indexOf(term)>-1);
      c.style.display=ok?'':'none'; if(ok){shown++;orgs[c.dataset.org]=1;}
    });
    document.querySelectorAll('.org').forEach(function(sec){
      var any=sec.querySelector('.card:not([style*="display: none"])');
      sec.style.display=any?'':'none';
    });
    if(empty) empty.style.display=shown?'none':'block';
    if(count) count.textContent=shown+' artifact'+(shown===1?'':'s')+' · '+Object.keys(orgs).length+' org'+(Object.keys(orgs).length===1?'':'s');
  }
  var f=document.getElementById('filters');
  if(f) f.addEventListener('click',function(e){var b=e.target.closest('.chip');if(!b)return;
    [].forEach.call(f.querySelectorAll('.chip'),function(c){c.setAttribute('aria-pressed',c===b);});
    active=b.dataset.org; apply();});
  if(q) q.addEventListener('input',apply);

  document.addEventListener('click',function(e){
    var del=e.target.closest('.del'); var yes=e.target.closest('.yes'); var no=e.target.closest('.no');
    if(del){var card=del.closest('.card');del.style.display='none';card.querySelector('.confirm').classList.add('show');return;}
    if(no){var card=no.closest('.card');card.querySelector('.confirm').classList.remove('show');card.querySelector('.del').style.display='';return;}
    if(yes){
      var card=yes.closest('.card'); var id=card.dataset.id; yes.textContent='…';
      fetch('/'+id,{method:'DELETE',headers:{'accept':'application/json'}}).then(function(r){
        if(r.ok){card.style.transition='opacity .25s,transform .25s';card.style.opacity='0';card.style.transform='scale(.96)';setTimeout(function(){card.remove();apply();},240);}
        else{r.json().catch(function(){return{};}).then(function(d){yes.textContent='yes';alert('Delete failed: '+(d&&d.error||r.status));});}
      }).catch(function(){yes.textContent='yes';alert('Delete failed: network error');});
      return;
    }
  });
})();
`;
