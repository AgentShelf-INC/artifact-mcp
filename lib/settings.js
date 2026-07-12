// Admin-only Settings: manage organizations (name + email domains + category registry)
// and issue/revoke per-org publishing API keys.
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

function chip(kind, val) {
  return `<span class="chip" data-kind="${kind}" data-val="${esc(val)}">${esc(val)}<button class="chip-x" type="button" aria-label="Remove ${esc(val)}">&times;</button></span>`;
}

function chipRow(kind, values, placeholder) {
  const chips = (values || []).map((v) => chip(kind, v)).join("");
  return `<div class="chips" data-kind="${kind}">${chips}<form class="chip-add" data-kind="${kind}"><input placeholder="${placeholder}" autocomplete="off" spellcheck="false"><button type="submit" aria-label="Add">+</button></form></div>`;
}

const WEBHOOK_EVENTS = ["published", "updated", "restored", "deleted", "feedback", "resolved"];

function webhookRow(webhook) {
  const enabled = new Set(webhook.events || []);
  const pills = WEBHOOK_EVENTS.map((event) =>
    `<button class="wh-event ${enabled.has(event) ? "on" : ""}" type="button" data-event="${event}" aria-pressed="${enabled.has(event)}">${event}</button>`
  );
  return `<div class="webhook" data-id="${esc(webhook.id)}"><div class="webhook-head"><code>${esc(webhook.url)}</code>${webhook.label ? `<span>${esc(webhook.label)}</span>` : ""}<button class="wh-test" type="button">Test</button><button class="wh-remove" type="button" aria-label="Remove webhook">&times;</button></div><div class="wh-group"><small>Artifacts</small>${pills.slice(0, 4).join("")}</div><div class="wh-group"><small>Feedback</small>${pills.slice(4).join("")}</div></div>`;
}

function webhookSection(webhooks) {
  const rows = (webhooks || []).map(webhookRow).join("");
  const options = WEBHOOK_EVENTS.map((event) => `<label><input type="checkbox" value="${event}" checked>${event}</label>`).join("");
  return `<div class="org-row notifications"><span class="org-row-label">Notifications</span><div class="webhooks">${rows}<form class="webhook-add"><input name="label" placeholder="label (optional)" autocomplete="off"><input name="url" placeholder="https://discord.com/api/webhooks/..." autocomplete="off" required><div class="wh-preselect">${options}</div><button type="submit">Add webhook</button></form></div></div>`;
}

function orgCard(o) {
  const keyWord = o.keyCount === 1 ? "key" : "keys";
  return `<article class="org-card" data-org="${esc(o.name)}">
    <header class="org-card-head">
      <span class="org-tag" data-org="${esc(o.name)}"><span class="org-keyline"></span>${esc(o.name)}</span>
      ${o.label ? `<span class="org-label">${esc(o.label)}</span>` : ""}
      <span class="org-meta">${o.keyCount || 0} ${keyWord}</span>
      <button class="org-del" type="button">Delete</button>
    </header>
    <div class="org-row"><span class="org-row-label">Domains</span>${chipRow("domain", o.domains, "add domain")}</div>
    <div class="org-row"><span class="org-row-label">Categories</span>${chipRow("category", o.categories, "add category")}</div>
    ${webhookSection(o.webhooks)}
  </article>`;
}

export function renderSettings(viewer, keys, orgList) {
  orgList = Array.isArray(orgList) ? orgList : [];
  const orgNames = orgList.map((o) => o.name);
  const activeCount = keys.filter((k) => !k.revoked_at).length;
  const revokedCount = keys.length - activeCount;
  const rows = keys.length
    ? keys.map(keyRow).join("")
    : `<tr class="empty-row"><td colspan="6"><strong>No upload keys yet.</strong><span>Issue the first tenant-scoped key above.</span></td></tr>`;
  const orgCards = orgList.length
    ? orgList.map(orgCard).join("")
    : `<p class="lede org-empty">No organizations yet. Create the first one below — a domain you add here auto-tenants anyone who signs in with that email domain.</p>`;
  const orgOptions = orgNames.map((n) => `<option value="${esc(n)}">${esc(n)}</option>`).join("");

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
.field{display:flex;flex-direction:column;gap:.36rem;min-width:0}.field label{font:700 .61rem var(--font-mono);color:var(--ink-2);text-transform:uppercase;letter-spacing:.065em}.field input,.field select{width:100%;font-size:.84rem;background:var(--ground);border:1px solid var(--line);border-radius:5px;padding:.58rem .65rem;color:var(--ink);min-width:0}.field input::placeholder{color:var(--ink-3)}.field input:focus,.field select:focus{border-color:var(--brass);outline:0;box-shadow:0 0 0 3px color-mix(in srgb,var(--brass) 13%,transparent)}.field small{font:.58rem/1.35 var(--font-mono);color:var(--ink-3);min-height:1.6em}
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
.org-list{display:flex;flex-direction:column;gap:1rem}.org-empty{margin:0}
.org-card{background:var(--card);border:1px solid var(--line);border-left:3px solid var(--brass);box-shadow:var(--shadow)}
.org-card-head{display:flex;align-items:center;gap:.75rem;padding:.8rem 1.05rem;border-bottom:1px solid var(--line-2)}.org-card-head .org-tag{font-size:.82rem}
.org-label{font-size:.78rem;color:var(--ink-2)}
.org-meta{margin-left:auto;font:700 .57rem var(--font-mono);text-transform:uppercase;letter-spacing:.06em;color:var(--ink-3)}
.org-del{font:700 .61rem var(--font-mono);color:var(--danger);border:1px solid transparent;background:none;border-radius:4px;padding:.35rem .5rem;cursor:pointer}.org-del:hover{border-color:var(--danger);background:color-mix(in srgb,var(--danger) 7%,transparent)}
.org-row{display:grid;grid-template-columns:96px minmax(0,1fr);gap:.9rem;align-items:start;padding:.8rem 1.05rem}.org-row+.org-row{border-top:1px solid var(--line-2)}
.org-row-label{font:700 .57rem var(--font-mono);text-transform:uppercase;letter-spacing:.07em;color:var(--ink-3);padding-top:.5rem}
.chips{display:flex;flex-wrap:wrap;gap:.45rem;align-items:center;min-width:0}
.chip{display:inline-flex;align-items:center;gap:.35rem;font:600 .72rem var(--font-mono);background:var(--ground);border:1px solid var(--line);border-radius:999px;padding:.28rem .32rem .28rem .68rem;color:var(--ink)}
.chip-x{border:0;background:none;color:var(--ink-3);cursor:pointer;font-size:1rem;line-height:1;padding:0 .12rem}.chip-x:hover{color:var(--danger)}
.chip-add{display:inline-flex;align-items:center;gap:.35rem}
.chip-add input{font:.72rem var(--font-mono);background:var(--ground);border:1px dashed var(--line);border-radius:999px;padding:.3rem .6rem;color:var(--ink);width:9.5rem;min-width:0}.chip-add input:focus{border-color:var(--brass);border-style:solid;outline:0}
.chip-add button{border:1px solid var(--line);background:var(--card);color:var(--brass);border-radius:50%;width:1.5rem;height:1.5rem;cursor:pointer;font:700 .95rem/1 var(--font-mono);flex:none}.chip-add button:hover{border-color:var(--brass)}
.webhooks{display:flex;flex-direction:column;gap:.55rem;min-width:0}.webhook{border:1px solid var(--line-2);background:var(--ground);padding:.55rem .65rem}.webhook-head{display:flex;align-items:center;gap:.5rem;min-width:0}.webhook-head code{font:.67rem var(--font-mono);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.webhook-head span{font-size:.7rem;color:var(--ink-2)}.wh-test,.wh-remove,.webhook-add button{font:700 .6rem var(--font-mono);border:1px solid var(--line);background:var(--card);color:var(--ink);border-radius:4px;padding:.3rem .45rem;cursor:pointer}.wh-test{margin-left:auto}.wh-remove{color:var(--danger);font-size:1rem;line-height:1}.wh-group{display:flex;align-items:center;gap:.28rem;flex-wrap:wrap;margin-top:.45rem}.wh-group small{font:700 .52rem var(--font-mono);text-transform:uppercase;color:var(--ink-3);width:3.8rem}.wh-event{font:700 .56rem var(--font-mono);text-transform:capitalize;border:1px solid var(--line);background:transparent;color:var(--ink-3);border-radius:999px;padding:.24rem .42rem;cursor:pointer}.wh-event.on{background:var(--brass-soft);border-color:var(--brass);color:var(--brass)}.webhook-add{display:grid;grid-template-columns:minmax(110px,.55fr) minmax(190px,1fr) auto;gap:.45rem;align-items:center;border-top:1px dashed var(--line);padding-top:.55rem}.webhook-add input{min-width:0;font:.68rem var(--font-mono);background:var(--card);border:1px solid var(--line);border-radius:4px;padding:.38rem .45rem;color:var(--ink)}.wh-preselect{grid-column:1/-1;display:flex;gap:.5rem;flex-wrap:wrap;font:.58rem var(--font-mono);color:var(--ink-2)}.wh-preselect label{display:flex;gap:.22rem;align-items:center}
.org-new{background:var(--card);border:1px dashed var(--line);padding:1.05rem;margin-top:1rem}
.org-new-row{display:grid;grid-template-columns:minmax(140px,1fr) minmax(150px,1fr) minmax(120px,.8fr) auto;gap:.8rem;align-items:end}
@media(max-width:900px){.settings-hero{grid-template-columns:1fr;align-items:start}.settings-stats{width:max-content}.form-row{grid-template-columns:1fr 1fr}.form-row .btn{grid-column:2}.org-new-row{grid-template-columns:1fr 1fr}.org-new-row .btn{grid-column:2}}
@media(max-width:680px){.settings-hero{padding:2.6rem 0 1.8rem}.settings-hero h1{font-size:3rem}.settings-stats{width:100%}.settings-stat{flex:1;min-width:0}.settings-section{grid-template-columns:1fr;gap:1rem;padding:2rem 0}.section-index{font-size:1.5rem;display:flex;align-items:baseline;gap:.55rem}.section-index span{display:inline}.form-row{grid-template-columns:1fr}.form-row .btn{grid-column:auto;width:100%}.key-form{padding:.9rem}.reveal-head{display:block}.once{display:inline-block;margin-top:.65rem}.secretbox{flex-direction:column}.copy{min-height:2.35rem}.org-row{grid-template-columns:1fr;gap:.4rem}.org-new-row{grid-template-columns:1fr}.org-new-row .btn{grid-column:auto;width:100%}.webhook-add{grid-template-columns:1fr}.wh-preselect{grid-column:auto}
  .table-wrap{overflow:visible}.registry{border-top-width:1px}thead{display:none}tbody{display:grid;gap:.7rem}tbody tr{display:grid;grid-template-columns:1fr 1fr;background:var(--card);border:1px solid var(--line);border-left:3px solid var(--org-admin);padding:.65rem;box-shadow:var(--shadow)}tbody td{display:block;border:0;padding:.42rem .45rem;min-width:0}tbody td::before{content:attr(data-label);display:block;font:700 .53rem var(--font-mono);text-transform:uppercase;letter-spacing:.07em;color:var(--ink-3);margin-bottom:.22rem}td.name{display:flex;align-items:center;grid-column:1/-1}td.name::before{display:none}td.right{display:flex;justify-content:flex-end;align-items:end}.revoke{min-height:2rem}.empty-row{display:block}.empty-row td{display:block}.empty-row td::before{display:none}
}
@media(max-width:420px){.settings-hero h1{font-size:2.6rem}.settings-stat{padding:.65rem .55rem}.settings-stat strong{font-size:1.5rem}.settings-stat span{font-size:.5rem}tbody tr{grid-template-columns:1fr}.name,.right{grid-column:1}.right{justify-content:flex-start!important}}
</style></head>
<body>
<a class="skip-link" href="#settings-content">Skip to settings</a>
<div class="wrap">
  <header class="masthead">
    <a class="brand" href="/" aria-label="Back to Artifact Index"><span class="brand-mark">A</span><span><strong>Artifact Index</strong><small>neilblackman.dev</small></span></a>
    <nav class="header-actions" aria-label="Account">
      <a class="header-link" href="/"><span aria-hidden="true">&larr;</span><span>Gallery</span></a>
      <button class="header-link theme-toggle" id="theme" type="button" aria-label="Change color theme"><span aria-hidden="true">&#9680;</span><span>Theme</span></button>
      <span class="identity" style="--identity-k:var(--org-admin)"><span class="identity-dot"></span><span class="identity-email">${esc(viewer.email)}</span><strong>Admin</strong></span>
      <a class="header-link signout" href="/cdn-cgi/access/logout"><span aria-hidden="true">&#8599;</span><span>Sign out</span></a>
    </nav>
  </header>

  <main class="settings-main" id="settings-content">
    <section class="settings-hero">
      <div><p class="eyebrow">Administration &middot; tenants &amp; access</p><h1>Organizations &amp; <em>Keys</em></h1><p class="settings-copy">Define each organization, the email domains that route their team into it, and the categories they publish under &mdash; then issue the credentials their agents use to publish.</p></div>
      <div class="settings-stats" aria-label="Registry summary">
        <div class="settings-stat"><strong>${orgList.length}</strong><span>Orgs</span></div>
        <div class="settings-stat"><strong>${activeCount}</strong><span>Active keys</span></div>
        <div class="settings-stat"><strong>${revokedCount}</strong><span>Revoked</span></div>
      </div>
    </section>

    <section class="settings-section" aria-labelledby="orgs-title">
      <div class="section-index">01<span>Organizations</span></div>
      <div class="settings-panel">
        <h2 id="orgs-title">Organizations, domains &amp; categories</h2>
        <p class="lede">Anyone who signs in through Cloudflare Access with a registered email domain is placed in that org and sees only its artifacts. Categories are the folders their artifacts can be grouped under.</p>
        <div class="org-list" id="org-list">${orgCards}</div>
        <form class="org-new" id="org-new">
          <div class="org-new-row">
            <div class="field"><label for="o-name">Org name</label><input id="o-name" placeholder="agentshelf" autocomplete="off" spellcheck="false" required><small>Lowercase id used everywhere</small></div>
            <div class="field"><label for="o-domain">Email domain</label><input id="o-domain" placeholder="agentshelf.ai" autocomplete="off" spellcheck="false"><small>Optional &mdash; add more later</small></div>
            <div class="field"><label for="o-label">Label</label><input id="o-label" placeholder="Agentshelf" autocomplete="off"><small>Optional display name</small></div>
            <button class="btn" id="org-gen" type="submit">Create org</button>
          </div>
          <p class="err" id="o-err" role="alert"></p>
        </form>
      </div>
    </section>

    <section class="settings-section" aria-labelledby="issue-title">
      <div class="section-index">02<span>Issue access</span></div>
      <div class="settings-panel">
        <h2 id="issue-title">Generate a tenant-scoped key</h2>
        <p class="lede">Create one credential per publishing agent or teammate. A key can publish only to the organization selected here.</p>
        <form class="key-form" id="key-form">
          <div class="form-row">
            <div class="field"><label for="name">Key name</label><input id="name" placeholder="alice-agentshelf" autocomplete="off" required><small>Stable machine-readable ID</small></div>
            <div class="field"><label for="label">Publisher label</label><input id="label" placeholder="Alice" autocomplete="off"><small>Shown on artifact cards</small></div>
            <div class="field"><label for="org">Organization</label><select id="org" required><option value="" disabled selected>Select an org&hellip;</option>${orgOptions}</select><small>Registered orgs only</small></div>
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
      <div class="section-index">03<span>Registry</span></div>
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

  function safe(s){return String(s||'').replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
  function fmt(s){var m=(s||'').match(/^(\\d{4})-(\\d{2})-(\\d{2})/);return m?m[1]+'-'+m[2]+'-'+m[3]:'';}

  // ---------------- Organization registry ----------------
  var orgList=document.getElementById('org-list'),orgSelect=document.getElementById('org'),
      orgNew=document.getElementById('org-new'),oName=document.getElementById('o-name'),
      oDomain=document.getElementById('o-domain'),oLabel=document.getElementById('o-label'),oErr=document.getElementById('o-err');

  function chipEl(kind,val){
    var s=document.createElement('span');s.className='chip';s.dataset.kind=kind;s.dataset.val=val;
    s.innerHTML=safe(val)+'<button class="chip-x" type="button" aria-label="Remove">\\u00d7</button>';
    return s;
  }
  var webhookEvents=['published','updated','restored','deleted','feedback','resolved'];
  function webhookEl(w){
    var row=document.createElement('div');row.className='webhook';row.dataset.id=w.id;
    var events=w.events||[],pills=webhookEvents.map(function(event){var on=events.indexOf(event)>=0;return '<button class="wh-event '+(on?'on':'')+'" type="button" data-event="'+event+'" aria-pressed="'+on+'">'+event+'</button>';});
    row.innerHTML='<div class="webhook-head"><code>'+safe(w.url)+'</code>'+(w.label?'<span>'+safe(w.label)+'</span>':'')+'<button class="wh-test" type="button">Test</button><button class="wh-remove" type="button" aria-label="Remove webhook">&times;</button></div><div class="wh-group"><small>Artifacts</small>'+pills.slice(0,4).join('')+'</div><div class="wh-group"><small>Feedback</small>'+pills.slice(4).join('')+'</div>';
    return row;
  }
  function webhookForm(){return '<form class="webhook-add"><input name="label" placeholder="label (optional)" autocomplete="off"><input name="url" placeholder="https://discord.com/api/webhooks/..." autocomplete="off" required><div class="wh-preselect">'+webhookEvents.map(function(event){return '<label><input type="checkbox" value="'+event+'" checked>'+event+'</label>';}).join('')+'</div><button type="submit">Add webhook</button></form>';}
  function orgCardEl(o){
    var art=document.createElement('article');art.className='org-card';art.dataset.org=o.name;
    art.innerHTML='<header class="org-card-head"><span class="org-tag" data-org="'+safe(o.name)+'"><span class="org-keyline"></span>'+safe(o.name)+'</span>'+(o.label?'<span class="org-label">'+safe(o.label)+'</span>':'')+'<span class="org-meta">'+(o.keyCount||0)+' keys</span><button class="org-del" type="button">Delete</button></header>'
      +'<div class="org-row"><span class="org-row-label">Domains</span><div class="chips" data-kind="domain"><form class="chip-add" data-kind="domain"><input placeholder="add domain" autocomplete="off" spellcheck="false"><button type="submit" aria-label="Add">+</button></form></div></div>'
      +'<div class="org-row"><span class="org-row-label">Categories</span><div class="chips" data-kind="category"><form class="chip-add" data-kind="category"><input placeholder="add category" autocomplete="off" spellcheck="false"><button type="submit" aria-label="Add">+</button></form></div></div>'
      +'<div class="org-row notifications"><span class="org-row-label">Notifications</span><div class="webhooks">'+(o.webhooks||[]).map(function(w){return webhookEl(w).outerHTML;}).join('')+webhookForm()+'</div></div>';
    ['domain','category'].forEach(function(kind){
      var add=art.querySelector('.chips[data-kind="'+kind+'"] .chip-add');
      (kind==='domain'?(o.domains||[]):(o.categories||[])).forEach(function(v){add.parentNode.insertBefore(chipEl(kind,v),add);});
    });
    return art;
  }
  function removeOption(name){
    if(!orgSelect)return;
    for(var i=0;i<orgSelect.options.length;i++){if(orgSelect.options[i].value===name){orgSelect.remove(i);return;}}
  }

  if(orgList)orgList.addEventListener('submit',function(e){
    var wf=e.target.closest('.webhook-add');
    if(wf){e.preventDefault();var wcard=wf.closest('.org-card'),worg=wcard.dataset.org,wurl=wf.querySelector('[name="url"]'),wbtn=wf.querySelector('button'),events=Array.prototype.slice.call(wf.querySelectorAll('input[type="checkbox"]:checked')).map(function(i){return i.value;});wbtn.disabled=true;
      fetch('/settings/orgs/'+encodeURIComponent(worg)+'/webhooks',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({url:wurl.value,label:wf.querySelector('[name="label"]').value,events:events})}).then(function(r){return r.json().then(function(d){return {ok:r.ok,d:d};});}).then(function(res){wbtn.disabled=false;if(!res.ok){alert(res.d.error||'Could not add webhook');return;}wf.parentNode.insertBefore(webhookEl(res.d),wf);wf.reset();Array.prototype.forEach.call(wf.querySelectorAll('input[type="checkbox"]'),function(i){i.checked=true;});}).catch(function(){wbtn.disabled=false;alert('Network error');});return;}
    var f=e.target.closest('.chip-add');if(!f)return;e.preventDefault();
    var card=f.closest('.org-card'),org=card.dataset.org,kind=f.dataset.kind,input=f.querySelector('input'),val=input.value.trim();
    if(!val)return;
    var url='/settings/orgs/'+encodeURIComponent(org)+(kind==='domain'?'/domains':'/categories');
    var body=kind==='domain'?{domain:val}:{name:val};
    var btn=f.querySelector('button');btn.disabled=true;
    fetch(url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)})
    .then(function(r){return r.json().then(function(d){return {ok:r.ok,d:d};});})
    .then(function(res){btn.disabled=false;
      if(!res.ok){alert(res.d.error||'Could not add');input.focus();return;}
      f.parentNode.insertBefore(chipEl(kind,kind==='domain'?res.d.domain:res.d.name),f);input.value='';input.focus();
    }).catch(function(){btn.disabled=false;alert('Network error');});
  });

  if(orgList)orgList.addEventListener('click',function(e){
    var eventButton=e.target.closest('.wh-event');
    if(eventButton){var wh=eventButton.closest('.webhook'),card0=eventButton.closest('.org-card'),on=eventButton.classList.contains('on'),next=Array.prototype.slice.call(wh.querySelectorAll('.wh-event')).filter(function(b){return b!==eventButton?b.classList.contains('on'):!on;}).map(function(b){return b.dataset.event;});eventButton.disabled=true;fetch('/settings/orgs/'+encodeURIComponent(card0.dataset.org)+'/webhooks/'+encodeURIComponent(wh.dataset.id),{method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify({events:next})}).then(function(r){return r.json().then(function(d){return {ok:r.ok,d:d};});}).then(function(res){eventButton.disabled=false;if(!res.ok){alert(res.d.error||'Could not update events');return;}Array.prototype.forEach.call(wh.querySelectorAll('.wh-event'),function(b){var enabled=res.d.events.indexOf(b.dataset.event)>=0;b.classList.toggle('on',enabled);b.setAttribute('aria-pressed',enabled);});}).catch(function(){eventButton.disabled=false;alert('Network error');});return;}
    var testButton=e.target.closest('.wh-test');
    if(testButton){var testWh=testButton.closest('.webhook'),testCard=testButton.closest('.org-card');testButton.disabled=true;testButton.textContent='Sending…';fetch('/settings/orgs/'+encodeURIComponent(testCard.dataset.org)+'/webhooks/'+encodeURIComponent(testWh.dataset.id)+'/test',{method:'POST'}).then(function(r){return r.json().then(function(d){return {ok:r.ok,d:d};});}).then(function(res){testButton.disabled=false;testButton.textContent=res.ok?'Sent':'Test';if(!res.ok)alert(res.d.error||'Webhook test failed');}).catch(function(){testButton.disabled=false;testButton.textContent='Test';alert('Network error');});return;}
    var removeWebhook=e.target.closest('.wh-remove');
    if(removeWebhook){var removeWh=removeWebhook.closest('.webhook'),removeCard=removeWebhook.closest('.org-card');removeWebhook.disabled=true;fetch('/settings/orgs/'+encodeURIComponent(removeCard.dataset.org)+'/webhooks/'+encodeURIComponent(removeWh.dataset.id),{method:'DELETE'}).then(function(r){return r.json();}).then(function(d){if(d.removed)removeWh.remove();else{removeWebhook.disabled=false;alert(d.error||'Could not remove webhook');}}).catch(function(){removeWebhook.disabled=false;alert('Network error');});return;}
    var x=e.target.closest('.chip-x');
    if(x){
      var chip=x.closest('.chip'),card=x.closest('.org-card'),org=card.dataset.org,kind=chip.dataset.kind,val=chip.dataset.val;
      var opt={method:'DELETE'},url='/settings/orgs/'+encodeURIComponent(org);
      if(kind==='domain'){url+='/domains/'+encodeURIComponent(val);}
      else{url+='/categories';opt.headers={'content-type':'application/json'};opt.body=JSON.stringify({name:val});}
      x.disabled=true;
      fetch(url,opt).then(function(r){return r.json();}).then(function(d){
        if(d.removed!==false)chip.remove();else{x.disabled=false;alert(d.error||'Could not remove');}
      }).catch(function(){x.disabled=false;alert('Network error');});
      return;
    }
    var del=e.target.closest('.org-del');
    if(del){
      var card2=del.closest('.org-card'),org2=card2.dataset.org;
      if(!confirm('Delete organization "'+org2+'"? Its domain mappings and category list are removed. Existing artifacts and keys are NOT deleted.'))return;
      del.disabled=true;
      fetch('/settings/orgs/'+encodeURIComponent(org2),{method:'DELETE'}).then(function(r){return r.json();}).then(function(d){
        if(d.removed){card2.remove();removeOption(org2);}else{del.disabled=false;alert(d.error||'Could not delete');}
      }).catch(function(){del.disabled=false;alert('Network error');});
    }
  });

  if(orgNew)orgNew.addEventListener('submit',function(e){
    e.preventDefault();oErr.textContent='';
    var name=oName.value.trim();if(!name)return;
    var btn=document.getElementById('org-gen');btn.disabled=true;
    fetch('/settings/orgs',{method:'POST',headers:{'content-type':'application/json'},
      body:JSON.stringify({name:name,domain:oDomain.value.trim(),label:oLabel.value.trim()})})
    .then(function(r){return r.json().then(function(d){return {ok:r.ok,d:d};});})
    .then(function(res){btn.disabled=false;
      if(!res.ok){oErr.textContent=res.d.error||'Could not create org';return;}
      var empty=orgList.querySelector('.org-empty');if(empty)empty.remove();
      orgList.insertBefore(orgCardEl(res.d),orgList.firstChild);
      if(orgSelect){var o=document.createElement('option');o.value=res.d.name;o.textContent=res.d.name;orgSelect.appendChild(o);}
      oName.value='';oDomain.value='';oLabel.value='';oName.focus();
    }).catch(function(){btn.disabled=false;oErr.textContent='Network error — the org was not created.';});
  });

  // ---------------- Publishing keys ----------------
  var form=document.getElementById('key-form'),gen=document.getElementById('gen'),err=document.getElementById('err'),
      name=document.getElementById('name'),org=document.getElementById('org'),label=document.getElementById('label'),
      reveal=document.getElementById('reveal'),secret=document.getElementById('secret'),
      usage=document.getElementById('usage'),keys=document.getElementById('keys');

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
      keys.insertBefore(tr,keys.firstChild);name.value='';label.value='';org.selectedIndex=0;
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
