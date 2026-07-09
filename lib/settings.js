// Admin-only Settings: generate per-org upload API keys for the team, and revoke them.
import { PORTAL_CSS, PORTAL_FAVICON, escHtml as esc } from "./portal.js";

function fmt(s) {
  const m = String(s || "").match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : "";
}

function keyRow(k) {
  const revoked = !!k.revoked_at;
  return `<tr data-id="${esc(k.client_id)}" class="${revoked ? "revoked" : ""}">
    <td data-label="Key" class="mono name"><span class="key-glyph" aria-hidden="true">K</span>${esc(k.client_id)}</td>
    <td data-label="Publisher">${k.label ? esc(k.label) : '<span class="dim">Not labeled</span>'}</td>
    <td data-label="Organization"><span class="org-tag" data-org="${esc(k.org)}"><span class="org-keyline"></span>${esc(k.org)}</span></td>
    <td data-label="Created" class="mono dim">${fmt(k.created_at)}</td>
    <td data-label="Status" class="status">${revoked ? '<span class="pill off"><span></span>Revoked</span>' : '<span class="pill on"><span></span>Active</span>'}</td>
    <td class="right">${revoked ? "" : '<button class="revoke" type="button">Revoke</button>'}</td>
  </tr>`;
}

export function renderSettings(viewer, keys, orgs) {
  const activeCount = keys.filter((k) => !k.revoked_at).length;
  const revokedCount = keys.length - activeCount;
  const allOrgs = [...new Set([...orgs, ...keys.map((k) => k.org)].filter(Boolean))];
  const rows = keys.length
    ? keys.map(keyRow).join("")
    : `<tr class="empty-row"><td colspan="6"><strong>No upload keys yet.</strong><span>Issue the first tenant-scoped key above.</span></td></tr>`;
  const orgOptions = allOrgs.map((o) => `<option value="${esc(o)}"></option>`).join("");

  return `<!doctype html><html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark"><link rel="icon" href="${PORTAL_FAVICON}"><title>Settings &middot; Artifact Index</title>
<script>(function(){try{var t=localStorage.getItem('artifact-theme');if(t)document.documentElement.dataset.theme=t;}catch(e){}})();</script>
<style>${PORTAL_CSS}
.settings-main{padding-top:0}
.settings-hero{display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:end;gap:2rem;padding:3.8rem 0 2.3rem;border-bottom:1px solid var(--line)}
.settings-hero h1{font:500 3.8rem/.95 var(--font-display);letter-spacing:-.045em;margin:0}.settings-hero h1 em{font-weight:400;color:var(--brass)}
.settings-copy{color:var(--ink-2);max-width:43rem;margin:1rem 0 0;font-size:.92rem;line-height:1.6}
.settings-stats{display:flex;align-items:stretch;border:1px solid var(--line);background:var(--card);box-shadow:var(--shadow)}
.settings-stat{min-width:92px;padding:.75rem .9rem;border-left:1px solid var(--line)}.settings-stat:first-child{border-left:0}.settings-stat strong,.settings-stat span{display:block}.settings-stat strong{font:500 1.8rem/1 var(--font-display)}.settings-stat span{font:600 .56rem/1.4 var(--font-mono);text-transform:uppercase;letter-spacing:.07em;color:var(--ink-3);margin-top:.35rem}
.settings-section{display:grid;grid-template-columns:145px minmax(0,1fr);gap:2rem;padding:2.5rem 0;border-bottom:1px solid var(--line)}
.section-index{font:400 2.6rem/.9 var(--font-display);color:var(--brass);letter-spacing:-.03em}.section-index span{display:block;font:700 .58rem/1.3 var(--font-mono);color:var(--ink-3);text-transform:uppercase;letter-spacing:.09em;margin-top:.55rem}
.settings-panel{min-width:0}.settings-panel h2{font:600 1.45rem/1.15 var(--font-display);letter-spacing:-.01em;margin:0 0 .4rem}.lede{color:var(--ink-2);margin:0 0 1.35rem;font-size:.86rem;line-height:1.55;max-width:48rem}
.key-form{background:var(--card);border:1px solid var(--line);border-left:3px solid var(--brass);padding:1.15rem;box-shadow:var(--shadow)}
.form-row{display:grid;grid-template-columns:minmax(170px,1fr) minmax(150px,.8fr) minmax(150px,.75fr) auto;gap:.85rem;align-items:end}
.field{display:flex;flex-direction:column;gap:.36rem;min-width:0}.field label{font:700 .61rem var(--font-mono);color:var(--ink-2);text-transform:uppercase;letter-spacing:.065em}.field input{width:100%;font-size:.84rem;background:var(--ground);border:1px solid var(--line);border-radius:5px;padding:.58rem .65rem;color:var(--ink);min-width:0}.field input::placeholder{color:var(--ink-3)}.field input:focus{border-color:var(--brass);outline:0;box-shadow:0 0 0 3px color-mix(in srgb,var(--brass) 13%,transparent)}.field small{font:.58rem/1.35 var(--font-mono);color:var(--ink-3);min-height:1.6em}
.btn{min-height:2.45rem;font:700 .68rem var(--font-mono);border:1px solid var(--ink);color:var(--card);background:var(--ink);border-radius:5px;padding:.62rem .9rem;cursor:pointer;white-space:nowrap}.btn:hover{background:var(--brass);border-color:var(--brass);color:#fff}.btn:disabled{opacity:.55;cursor:wait}
.err{color:var(--danger);font:600 .7rem var(--font-mono);margin:.75rem 0 0;min-height:1em}
.reveal{display:none;margin-top:1rem;border:1px solid var(--brass);border-left-width:3px;padding:1rem 1.1rem;background:var(--brass-soft)}.reveal.show{display:block}.reveal:focus{outline:0}.reveal-head{display:flex;align-items:flex-start;justify-content:space-between;gap:1rem}.reveal h3{font:600 1rem var(--font-display);margin:0}.reveal .warn{color:var(--ink-2);font-size:.76rem;margin:.25rem 0 0}.once{font:700 .57rem var(--font-mono);letter-spacing:.08em;text-transform:uppercase;color:var(--brass);border:1px solid var(--brass);padding:.2rem .4rem;white-space:nowrap}
.secretbox{display:flex;gap:.5rem;align-items:stretch;margin-top:.85rem}.secretbox code{font:.76rem var(--font-mono);background:var(--ground);border:1px solid var(--line);border-radius:4px;padding:.58rem .7rem;flex:1;overflow-x:auto;white-space:nowrap;color:var(--ink)}.copy{font:700 .66rem var(--font-mono);border:1px solid var(--line);background:var(--card);color:var(--ink);border-radius:4px;padding:.5rem .75rem;cursor:pointer}.copy:hover{border-color:var(--brass);color:var(--brass)}
.usage{font:.67rem/1.65 var(--font-mono);white-space:pre-wrap;color:var(--ink-2);background:color-mix(in srgb,var(--ground) 74%,transparent);border-left:2px solid var(--line);padding:.7rem .8rem;margin-top:.7rem;overflow-x:auto}
.registry{border-top:2px solid var(--ink)}.table-wrap{overflow-x:auto}table{width:100%;border-collapse:collapse}th{text-align:left;font:700 .59rem var(--font-mono);text-transform:uppercase;letter-spacing:.07em;color:var(--ink-3);padding:.7rem .6rem;border-bottom:1px solid var(--line)}td{padding:.78rem .6rem;border-bottom:1px solid var(--line-2);font-size:.82rem;vertical-align:middle}td.mono{font:600 .72rem var(--font-mono)}td.dim,.dim{color:var(--ink-3)}td.right{text-align:right}.name{display:flex;align-items:center;gap:.55rem}.key-glyph{width:1.55rem;height:1.55rem;display:grid;place-items:center;border:1px solid var(--line);color:var(--brass);font:600 .78rem var(--font-display);background:var(--card);flex:none}tr.revoked{opacity:.56}tr:hover:not(.empty-row){background:color-mix(in srgb,var(--card) 70%,transparent)}
.org-tag{font:700 .68rem var(--font-mono);display:inline-flex;align-items:center;gap:.4rem;color:var(--org-admin)}.org-keyline{width:2px;height:1rem;background:currentColor}.org-tag[data-org="agentshelf"]{color:var(--org-agentshelf)}.org-tag[data-org="trustedtech"]{color:var(--org-trustedtech)}.org-tag[data-org="cairn"]{color:var(--org-cairn)}
.pill{display:inline-flex;align-items:center;gap:.38rem;font:700 .59rem var(--font-mono);letter-spacing:.035em;text-transform:uppercase}.pill>span{width:.42rem;height:.42rem;border-radius:50%;background:currentColor}.pill.on{color:var(--positive)}.pill.off{color:var(--ink-3)}
.revoke{font:700 .64rem var(--font-mono);color:var(--danger);border:1px solid transparent;background:none;border-radius:4px;padding:.38rem .5rem;cursor:pointer}.revoke:hover{border-color:var(--danger);background:color-mix(in srgb,var(--danger) 7%,transparent)}.empty-row td{text-align:center;padding:2rem;color:var(--ink-3)}.empty-row strong,.empty-row span{display:block}.empty-row strong{font:600 1rem var(--font-display);color:var(--ink)}.empty-row span{font-size:.75rem;margin-top:.2rem}
.settings-note{display:flex;gap:.7rem;align-items:flex-start;color:var(--ink-3);font-size:.75rem;line-height:1.55;margin:1rem 0 0}.settings-note strong{font:700 .62rem var(--font-mono);color:var(--brass);text-transform:uppercase;letter-spacing:.06em}
@media(max-width:900px){.settings-hero{grid-template-columns:1fr;align-items:start}.settings-stats{width:max-content}.form-row{grid-template-columns:1fr 1fr}.btn{grid-column:2}}
@media(max-width:680px){.settings-hero{padding:2.6rem 0 1.8rem}.settings-hero h1{font-size:3rem}.settings-stats{width:100%}.settings-stat{flex:1;min-width:0}.settings-section{grid-template-columns:1fr;gap:1rem;padding:2rem 0}.section-index{font-size:1.5rem;display:flex;align-items:baseline;gap:.55rem}.section-index span{display:inline}.form-row{grid-template-columns:1fr}.btn{grid-column:auto;width:100%}.key-form{padding:.9rem}.reveal-head{display:block}.once{display:inline-block;margin-top:.65rem}.secretbox{flex-direction:column}.copy{min-height:2.35rem}
  .table-wrap{overflow:visible}.registry{border-top-width:1px}thead{display:none}tbody{display:grid;gap:.7rem}tr{display:grid;grid-template-columns:1fr 1fr;background:var(--card);border:1px solid var(--line);border-left:3px solid var(--org-admin);padding:.65rem;box-shadow:var(--shadow)}td{display:block;border:0;padding:.42rem .45rem;min-width:0}td::before{content:attr(data-label);display:block;font:700 .53rem var(--font-mono);text-transform:uppercase;letter-spacing:.07em;color:var(--ink-3);margin-bottom:.22rem}td.name{display:flex;align-items:center;grid-column:1/-1}td.name::before{display:none}td.right{display:flex;justify-content:flex-end;align-items:end}.revoke{min-height:2rem}.empty-row{display:block}.empty-row td{display:block}.empty-row td::before{display:none}
}
@media(max-width:420px){.settings-hero h1{font-size:2.6rem}.settings-stat{padding:.65rem .55rem}.settings-stat strong{font-size:1.5rem}.settings-stat span{font-size:.5rem}tr{grid-template-columns:1fr}.name,.right{grid-column:1}.right{justify-content:flex-start!important}}
</style></head>
<body>
<a class="skip-link" href="#settings-content">Skip to settings</a>
<div class="wrap">
  <header class="masthead">
    <a class="brand" href="/" aria-label="Back to Artifact Index"><span class="brand-mark">A</span><span><strong>Artifact Index</strong><small>neilblackman.dev</small></span></a>
    <nav class="header-actions" aria-label="Account">
      <a class="header-link" href="/"><span aria-hidden="true">←</span><span>Gallery</span></a>
      <button class="header-link theme-toggle" id="theme" type="button" aria-label="Change color theme"><span aria-hidden="true">◐</span><span>Theme</span></button>
      <span class="identity" style="--identity-k:var(--org-admin)"><span class="identity-dot"></span><span class="identity-email">${esc(viewer.email)}</span><strong>Admin</strong></span>
      <a class="header-link signout" href="/cdn-cgi/access/logout"><span aria-hidden="true">↗</span><span>Sign out</span></a>
    </nav>
  </header>

  <main class="settings-main" id="settings-content">
    <section class="settings-hero">
      <div><p class="eyebrow">Administration · tenant access</p><h1>Publishing <em>Keys</em></h1><p class="settings-copy">Issue and retire the credentials agents use to publish into each organization’s private artifact index.</p></div>
      <div class="settings-stats" aria-label="Key registry summary">
        <div class="settings-stat"><strong>${activeCount}</strong><span>Active</span></div>
        <div class="settings-stat"><strong>${allOrgs.length}</strong><span>Organizations</span></div>
        <div class="settings-stat"><strong>${revokedCount}</strong><span>Revoked</span></div>
      </div>
    </section>

    <section class="settings-section" aria-labelledby="issue-title">
      <div class="section-index">01<span>Issue access</span></div>
      <div class="settings-panel">
        <h2 id="issue-title">Generate a tenant-scoped key</h2>
        <p class="lede">Create one credential per publishing agent or teammate. A key can publish only to the organization selected here.</p>
        <form class="key-form" id="key-form">
          <div class="form-row">
            <div class="field"><label for="name">Key name</label><input id="name" placeholder="alice-agentshelf" autocomplete="off" required><small>Stable machine-readable ID</small></div>
            <div class="field"><label for="label">Publisher label</label><input id="label" placeholder="Alice" autocomplete="off"><small>Shown on artifact cards</small></div>
            <div class="field"><label for="org">Organization</label><input id="org" list="orgs" placeholder="agentshelf" autocomplete="off" required><datalist id="orgs">${orgOptions}</datalist><small>Exact tenant destination</small></div>
            <button class="btn" id="gen" type="submit">Generate key</button>
          </div>
          <p class="err" id="err" role="alert"></p>
        </form>
        <div class="reveal" id="reveal" tabindex="-1" aria-live="polite">
          <div class="reveal-head"><div><h3>Key created — copy the secret now</h3><p class="warn">Store it in a password manager or the publishing agent’s protected configuration.</p></div><span class="once">Shown once</span></div>
          <div class="secretbox"><code id="secret"></code><button class="copy" id="copy" type="button">Copy secret</button></div>
          <div class="usage" id="usage"></div>
        </div>
      </div>
    </section>

    <section class="settings-section" aria-labelledby="registry-title">
      <div class="section-index">02<span>Registry</span></div>
      <div class="settings-panel">
        <h2 id="registry-title">Publishing key registry</h2>
        <p class="lede">Active credentials can publish immediately. Revocation prevents future uploads without removing artifacts already in the index.</p>
        <div class="registry"><div class="table-wrap">
          <table>
            <thead><tr><th>Key</th><th>Publisher</th><th>Organization</th><th>Created</th><th>Status</th><th></th></tr></thead>
            <tbody id="keys">${rows}</tbody>
          </table>
        </div></div>
        <p class="settings-note"><strong>Propagation</strong><span>Revocation takes effect within one minute. No service rebuild or redeploy is required.</span></p>
      </div>
    </section>
  </main>
  <footer class="footer"><span>Artifact Index · Administration</span><span>Secrets are never stored in plaintext</span></footer>
</div>
<script>${SCRIPT}</script>
</body></html>`;
}

const SCRIPT = `
(function(){
  var theme=document.getElementById('theme');
  if(theme)theme.addEventListener('click',function(){
    var current=document.documentElement.dataset.theme;
    var dark=window.matchMedia&&window.matchMedia('(prefers-color-scheme: dark)').matches;
    var next=current==='dark'?'light':current==='light'?'dark':dark?'light':'dark';
    document.documentElement.dataset.theme=next;
    try{localStorage.setItem('artifact-theme',next);}catch(e){}
  });

  var form=document.getElementById('key-form'),gen=document.getElementById('gen'),err=document.getElementById('err'),
      name=document.getElementById('name'),org=document.getElementById('org'),label=document.getElementById('label'),
      reveal=document.getElementById('reveal'),secret=document.getElementById('secret'),
      usage=document.getElementById('usage'),keys=document.getElementById('keys');

  function fmt(s){var m=(s||'').match(/^(\\d{4})-(\\d{2})-(\\d{2})/);return m?m[1]+'-'+m[2]+'-'+m[3]:'';}
  function safe(s){return String(s||'').replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}

  form.addEventListener('submit',function(e){
    e.preventDefault();err.textContent='';gen.disabled=true;gen.textContent='Generating…';
    fetch('/settings/keys',{method:'POST',headers:{'content-type':'application/json'},
      body:JSON.stringify({clientId:name.value,org:org.value,label:label.value})})
    .then(function(r){return r.json().then(function(d){return {ok:r.ok,d:d};});})
    .then(function(res){
      gen.disabled=false;gen.textContent='Generate key';
      if(!res.ok){err.textContent=res.d.error||'Could not create key';return;}
      var d=res.d;
      secret.textContent=d.secret;
      usage.textContent='client_id: '+d.clientId+'\\norg: '+d.org+'\\n\\nMCP url: https://artifact.neilblackman.dev/mcp\\nHeader: Authorization: Bearer '+d.secret;
      reveal.classList.add('show');reveal.focus();
      var empty=keys.querySelector('td[colspan]');if(empty)empty.closest('tr').remove();
      var tr=document.createElement('tr');tr.dataset.id=d.clientId;
      tr.innerHTML='<td data-label="Key" class="mono name"><span class="key-glyph" aria-hidden="true">K</span>'+safe(d.clientId)+'</td><td data-label="Publisher">'+(d.label?safe(d.label):'<span class="dim">Not labeled</span>')+'</td><td data-label="Organization"><span class="org-tag" data-org="'+safe(d.org)+'"><span class="org-keyline"></span>'+safe(d.org)+'</span></td><td data-label="Created" class="mono dim">'+fmt(d.created_at)+'</td><td data-label="Status" class="status"><span class="pill on"><span></span>Active</span></td><td class="right"><button class="revoke" type="button">Revoke</button></td>';
      keys.insertBefore(tr,keys.firstChild);name.value='';label.value='';
    }).catch(function(){gen.disabled=false;gen.textContent='Generate key';err.textContent='Network error — the key was not created.';});
  });

  document.getElementById('copy').addEventListener('click',function(){
    var b=this;
    navigator.clipboard.writeText(secret.textContent).then(function(){b.textContent='Copied';setTimeout(function(){b.textContent='Copy secret';},1400);}).catch(function(){b.textContent='Select and copy';secret.parentElement.querySelector('code').focus();});
  });

  keys.addEventListener('click',function(e){
    var b=e.target.closest('.revoke');if(!b)return;
    var tr=b.closest('tr'),id=tr.dataset.id;
    if(!confirm('Revoke key "'+id+'"? Its client will stop publishing within one minute.'))return;
    b.disabled=true;b.textContent='Revoking…';
    fetch('/settings/keys/'+encodeURIComponent(id)+'/revoke',{method:'POST',headers:{accept:'application/json'}})
    .then(function(r){return r.json();}).then(function(d){
      if(d.revoked){tr.classList.add('revoked');tr.querySelector('.status').innerHTML='<span class="pill off"><span></span>Revoked</span>';tr.querySelector('.right').innerHTML='';}
      else{b.disabled=false;b.textContent='Revoke';alert(d.error||'Could not revoke');}
    }).catch(function(){b.disabled=false;b.textContent='Revoke';alert('Network error');});
  });
})();
`;
