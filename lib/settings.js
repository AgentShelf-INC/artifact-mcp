// Admin-only Settings: generate per-org upload API keys for the team, and revoke them.
import { PORTAL_CSS, escHtml as esc } from "./portal.js";

function fmt(s) {
  const m = String(s || "").match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : "";
}

function keyRow(k) {
  const revoked = !!k.revoked_at;
  return `<tr data-id="${esc(k.client_id)}" class="${revoked ? "revoked" : ""}">
    <td class="mono name">${esc(k.client_id)}</td>
    <td>${k.label ? esc(k.label) : '<span class="dim">—</span>'}</td>
    <td><span class="org-tag" data-org="${esc(k.org)}">${esc(k.org)}</span></td>
    <td class="mono dim">${fmt(k.created_at)}</td>
    <td class="status">${revoked ? '<span class="pill off">revoked</span>' : '<span class="pill on">active</span>'}</td>
    <td class="right">${revoked ? "" : '<button class="revoke" type="button">Revoke</button>'}</td>
  </tr>`;
}

export function renderSettings(viewer, keys, orgs) {
  const rows = keys.length
    ? keys.map(keyRow).join("")
    : `<tr><td colspan="6" class="dim">No keys yet. Generate one below.</td></tr>`;
  const orgOptions = [...new Set(orgs)].map((o) => `<option value="${esc(o)}"></option>`).join("");

  return `<!doctype html><html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Settings &middot; Artifacts</title>
<style>${PORTAL_CSS}
.back{font-family:var(--font-mono);font-size:.8rem;color:var(--brass);text-decoration:none}
.back:hover{text-decoration:underline}
.panel{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:1.4rem 1.5rem;margin-top:1.6rem}
.panel h2{font-family:var(--font-display);font-size:1.35rem;margin:0 0 .3rem}
.panel p.lede{color:var(--ink-2);margin:0 0 1.2rem;font-size:.9rem}
.form-row{display:flex;gap:.8rem;flex-wrap:wrap;align-items:flex-end}
.field{display:flex;flex-direction:column;gap:.35rem}
.field label{font-family:var(--font-mono);font-size:.72rem;color:var(--ink-3);text-transform:uppercase;letter-spacing:.05em}
.field input{font:inherit;background:var(--ground);border:1px solid var(--line);border-radius:8px;padding:.5rem .7rem;color:var(--ink);min-width:200px}
.btn{font-family:var(--font-mono);font-size:.82rem;border:1px solid var(--brass);color:var(--brass);background:transparent;border-radius:8px;padding:.55rem 1rem;cursor:pointer}
.btn:hover{background:var(--brass);color:var(--card)}
.err{color:var(--danger);font-family:var(--font-mono);font-size:.8rem;margin:.7rem 0 0;min-height:1em}
.reveal{display:none;margin-top:1.1rem;border:1px solid var(--brass);border-radius:10px;padding:1rem 1.1rem;background:color-mix(in srgb, var(--brass) 8%, var(--card))}
.reveal.show{display:block}
.reveal h3{margin:0 0 .5rem;font-size:.95rem}
.reveal .warn{color:var(--ink-2);font-size:.82rem;margin:.4rem 0 .8rem}
.secretbox{display:flex;gap:.5rem;align-items:center}
.secretbox code{font-family:var(--font-mono);font-size:.82rem;background:var(--ground);border:1px solid var(--line);border-radius:7px;padding:.5rem .7rem;flex:1;overflow-x:auto;white-space:nowrap}
.copy{font-family:var(--font-mono);font-size:.78rem;border:1px solid var(--line);background:var(--card);color:var(--ink);border-radius:7px;padding:.5rem .7rem;cursor:pointer}
table{width:100%;border-collapse:collapse;margin-top:.5rem}
th{text-align:left;font-family:var(--font-mono);font-size:.7rem;text-transform:uppercase;letter-spacing:.05em;color:var(--ink-3);font-weight:600;padding:.5rem .6rem;border-bottom:1px solid var(--line)}
td{padding:.6rem;border-bottom:1px solid var(--line-2);font-size:.9rem}
td.mono{font-family:var(--font-mono);font-size:.82rem}
td.dim,.dim{color:var(--ink-3)}
td.right{text-align:right}
tr.revoked{opacity:.55}
.org-tag{font-family:var(--font-mono);font-size:.75rem;font-weight:600}
.org-tag[data-org="agentshelf"]{color:var(--org-agentshelf)}
.org-tag[data-org="trustedtech"]{color:var(--org-trustedtech)}
.org-tag[data-org="cairn"]{color:var(--org-cairn)}
.pill{font-family:var(--font-mono);font-size:.72rem;padding:.15rem .55rem;border-radius:999px;border:1px solid var(--line)}
.pill.on{color:var(--org-trustedtech)}
.pill.off{color:var(--ink-3)}
.revoke{font-family:var(--font-mono);font-size:.76rem;color:var(--danger);border:1px solid transparent;background:none;border-radius:7px;padding:.3rem .55rem;cursor:pointer}
.revoke:hover{border-color:var(--danger)}
.usage{font-family:var(--font-mono);font-size:.78rem;color:var(--ink-2);background:var(--ground-2);border-radius:8px;padding:.8rem 1rem;margin-top:1rem;line-height:1.6;overflow-x:auto}
</style></head>
<body>
<div class="wrap">
  <header class="masthead">
    <div><p class="eyebrow"><a class="back" href="/">&larr; Artifacts</a></p><h1 class="title">Settings</h1></div>
    <div class="whoami"><span>signed in</span><span class="badge">${esc(viewer.email)} · <span class="role">admin</span></span></div>
  </header>

  <section class="panel">
    <h2>Generate an API key</h2>
    <p class="lede">Give a teammate or agent an upload key scoped to one org. The secret is shown once — copy it now.</p>
    <div class="form-row">
      <div class="field"><label for="name">Key name</label><input id="name" placeholder="e.g. alice-agentshelf" autocomplete="off"></div>
      <div class="field"><label for="label">Display label</label><input id="label" placeholder="e.g. Alice" autocomplete="off"></div>
      <div class="field"><label for="org">Org</label><input id="org" list="orgs" placeholder="e.g. agentshelf" autocomplete="off"><datalist id="orgs">${orgOptions}</datalist></div>
      <button class="btn" id="gen" type="button">Generate key</button>
    </div>
    <p class="err" id="err"></p>
    <div class="reveal" id="reveal">
      <h3>Key created &mdash; copy the secret now</h3>
      <p class="warn">This is the only time the secret is shown. Store it in a password manager or the client's config.</p>
      <div class="secretbox"><code id="secret"></code><button class="copy" id="copy" type="button">Copy</button></div>
      <div class="usage" id="usage"></div>
    </div>
  </section>

  <section class="panel">
    <h2>Keys</h2>
    <p class="lede">Active keys can publish to their org. Revoking takes effect within a minute — no redeploy.</p>
    <table>
      <thead><tr><th>Name</th><th>Label</th><th>Org</th><th>Created</th><th>Status</th><th></th></tr></thead>
      <tbody id="keys">${rows}</tbody>
    </table>
  </section>
</div>
<script>${SCRIPT}</script>
</body></html>`;
}

const SCRIPT = `
(function(){
  var gen=document.getElementById('gen'), err=document.getElementById('err'),
      name=document.getElementById('name'), org=document.getElementById('org'),
      label=document.getElementById('label'),
      reveal=document.getElementById('reveal'), secret=document.getElementById('secret'),
      usage=document.getElementById('usage'), keys=document.getElementById('keys');

  function fmt(s){var m=(s||'').match(/^(\\d{4})-(\\d{2})-(\\d{2})/);return m?m[1]+'-'+m[2]+'-'+m[3]:'';}

  gen.addEventListener('click',function(){
    err.textContent=''; gen.disabled=true; gen.textContent='…';
    fetch('/settings/keys',{method:'POST',headers:{'content-type':'application/json'},
      body:JSON.stringify({clientId:name.value,org:org.value,label:label.value})})
    .then(function(r){return r.json().then(function(d){return {ok:r.ok,d:d};});})
    .then(function(res){
      gen.disabled=false; gen.textContent='Generate key';
      if(!res.ok){err.textContent=res.d.error||'Could not create key';return;}
      var d=res.d;
      secret.textContent=d.secret;
      usage.textContent='client_id: '+d.clientId+'\\norg: '+d.org+'\\n\\nMCP url: https://artifact.neilblackman.dev/mcp\\nHeader: Authorization: Bearer '+d.secret;
      reveal.classList.add('show');
      var empty=keys.querySelector('td[colspan]'); if(empty) empty.closest('tr').remove();
      var tr=document.createElement('tr'); tr.dataset.id=d.clientId;
      tr.innerHTML='<td class="mono name">'+d.clientId+'</td><td>'+(d.label?d.label:'<span class="dim">—</span>')+'</td><td><span class="org-tag" data-org="'+d.org+'">'+d.org+'</span></td><td class="mono dim">'+fmt(d.created_at)+'</td><td class="status"><span class="pill on">active</span></td><td class="right"><button class="revoke" type="button">Revoke</button></td>';
      keys.insertBefore(tr,keys.firstChild);
      name.value=''; label.value='';
    }).catch(function(){gen.disabled=false;gen.textContent='Generate key';err.textContent='Network error';});
  });

  document.getElementById('copy').addEventListener('click',function(){
    navigator.clipboard.writeText(secret.textContent).then(function(){var b=document.getElementById('copy');b.textContent='Copied';setTimeout(function(){b.textContent='Copy';},1400);});
  });

  keys.addEventListener('click',function(e){
    var b=e.target.closest('.revoke'); if(!b) return;
    var tr=b.closest('tr'), id=tr.dataset.id;
    if(!confirm('Revoke key "'+id+'"? Any client using it stops working within a minute.')) return;
    b.textContent='…';
    fetch('/settings/keys/'+encodeURIComponent(id)+'/revoke',{method:'POST',headers:{'accept':'application/json'}})
    .then(function(r){return r.json();}).then(function(d){
      if(d.revoked){tr.classList.add('revoked');tr.querySelector('.status').innerHTML='<span class="pill off">revoked</span>';tr.querySelector('.right').innerHTML='';}
      else{b.textContent='Revoke';alert(d.error||'Could not revoke');}
    }).catch(function(){b.textContent='Revoke';alert('Network error');});
  });
})();
`;
