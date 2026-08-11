// The page half of the studio: fetches the engine sources, boots them inside
// fengari, and turns clicks into the same requests the harness makes. All the
// deciding happens in Lua — this file renders answers and never re-implements
// one rule of the permission model.

"use strict";

const $ = (id) => document.getElementById(id);

const fatal = (text) => {
  const banner = $("fatal");
  banner.textContent = text;
  banner.classList.remove("hidden");
};

// ── the engine ───────────────────────────────────────────────────────────────

const ENGINE_FILES = {
  store: "engine/store.lua",
  collections: "engine/collections.lua",
  permissions: "engine/permissions.lua",
  framework: "engine/framework.lua",
  capabilities: "engine/capabilities.lua",
};

let L = null;

function runChunk(source, name) {
  const { lua, lauxlib, to_luastring, to_jsstring } = fengari;
  if (lauxlib.luaL_loadbuffer(L, to_luastring(source), null, to_luastring(name)) !== lua.LUA_OK
      || lua.lua_pcall(L, 0, 0, 0) !== lua.LUA_OK) {
    const message = to_jsstring(lua.lua_tostring(L, -1));
    lua.lua_pop(L, 1);
    throw new Error(name + ": " + message);
  }
}

// Values ride in the bridge's own tab-separated format, so tabs can never be
// data. Newlines are data in exactly one place — a config file's text.
function sanitize(value, keepNewlines) {
  let text = String(value ?? "").replace(/\t/g, "  ");
  if (!keepNewlines) text = text.replace(/[\r\n]/g, " ");
  return text;
}

function ask(op, fields, keepNewlinesFor) {
  const { lua, to_luastring, to_jsstring } = fengari;
  const parts = ["op=" + op];
  for (const [key, value] of Object.entries(fields || {})) {
    parts.push(key + "=" + sanitize(value, key === keepNewlinesFor));
  }
  lua.lua_getglobal(L, to_luastring("studio"));
  lua.lua_pushstring(L, to_luastring(parts.join("\t")));
  if (lua.lua_pcall(L, 1, 1, 0) !== lua.LUA_OK) {
    const message = to_jsstring(lua.lua_tostring(L, -1));
    lua.lua_pop(L, 1);
    throw new Error(message);
  }
  const reply = JSON.parse(to_jsstring(lua.lua_tostring(L, -1)));
  lua.lua_pop(L, 1);
  if (reply && reply.ok === false && reply.error) throw new Error(reply.error);
  return reply;
}

// Every click that reaches the engine goes through this: an engine complaint
// lands in the banner with its own words, and a success clears it. Live-mode
// handlers are async — a rejected promise is the same complaint, later.
function guarded(fn) {
  return () => {
    Promise.resolve()
      .then(fn)
      .then(() => $("fatal").classList.add("hidden"))
      .catch((error) => fatal("The engine refused: " + error.message));
  };
}

// ── the two backends ─────────────────────────────────────────────────────────
// The same page serves two worlds. Offline (Pages, a local folder): the
// in-tab engine is the whole truth, download to apply. Live (served by a
// pal-up panel): the engine still answers every question — booted from the
// server's real file — but writes travel through the daemon's capability
// door, so the game stays the single writer of its own config.

const backend = {
  mode: "offline",       // "live" when this origin answers /api/session
  authenticated: false,  // the panel session cookie, shared by same origin
  sandbox: false,        // live origin, but the user loaded their own file
};
let livePlayers = [];    // online players, for the lens — live mode only

async function detectBackend() {
  try {
    const reply = await fetch("/api/session", { headers: { accept: "application/json" } });
    if (!reply.ok) return;
    const json = await reply.json();
    if (typeof json.authenticated === "boolean") {
      backend.mode = "live";
      backend.authenticated = json.authenticated;
    }
  } catch { /* a static host — offline is the answer */ }
}

async function api(method, url, body) {
  const reply = await fetch(url, {
    method,
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await reply.json().catch(() => ({}));
  if (!reply.ok) throw new Error(json.error || url + " → " + reply.status);
  return json;
}

// One bridge call, envelope in, envelope out — the same door the panel and
// every token client uses, audit log included.
async function bridgeCall(type, target, data) {
  const clean = {};
  for (const [key, value] of Object.entries(data || {})) {
    if (value !== "" && value !== null && value !== undefined) clean[key] = value;
  }
  const result = await api("POST", "/api/bridge/call", { type, target: target || "", data: clean });
  if (result.ok === false) {
    // This one runs inside the game, so "no answer" means the agent did not
    // pick the action up — a stopped server, not a refused request.
    const why = /timed? ?out|no answer/i.test(String(result.error || ""))
      ? "the game did not answer within six seconds — is the server running?"
      : (result.error || "the server refused");
    throw new Error(type + ": " + why);
  }
  return result;
}

// How each studio edit is spelled at the capability door.
const LIVE_OPS = {
  entry: (f) => bridgeCall("group.set_entry", "", {
    group: f.group, node: f.node, effect: f.effect, where: f.where, until: f.until_stamp,
  }),
  entry_remove: (f) => bridgeCall("group.remove_entry", "", { group: f.group, node: f.node }),
  grant: (f) => bridgeCall("permission.grant", f.player, {
    node: f.node, effect: f.effect, where: f.where, until: f.until_stamp,
  }),
  revoke: (f) => bridgeCall("permission.revoke", f.player, { node: f.node }),
  group_new: (f) => bridgeCall("group.create", "", { name: f.name, tag: f.tag, weight: f.weight }),
  group_delete: (f) => bridgeCall("group.delete", "", { name: f.name }),
  assign: (f) => bridgeCall("group.assign", f.player, { group: f.group }),
  unassign: (f) => bridgeCall("group.unassign", f.player, { group: f.group }),
};

// Every edit goes through here. Offline and sandbox: the local engine, as
// ever. Live: the capability that says the same thing, then the server's file
// re-fetched — the game wrote it, the studio only ever mirrors it.
// `defer` means this edit is one of a run: apply it, but leave the redraw and
// the live write-back to whoever is driving the run. Without it a stamp across
// thirty cells re-rendered the whole page thirty times, synchronously, which
// is exactly as responsive as it sounds.
async function edit(op, fields, defer) {
  // Live, a write is a round trip into the running game: the daemon queues the
  // action and waits up to six seconds for the agent to pick it up and answer.
  // With nothing on screen saying so, that reads as a frozen page — and the
  // second click it invites queues a second action.
  const live = backend.mode === "live" && backend.authenticated && !backend.sandbox;
  if (live && !defer) {
    busy(true);
    await breathe();
    try {
      return await applyEdit(op, fields, defer);
    } finally {
      busy(false);
    }
  }
  return applyEdit(op, fields, defer);
}

async function applyEdit(op, fields, defer) {
  if (backend.mode === "live" && backend.authenticated && !backend.sandbox) {
    if (op === "set_default") {
      // No capability flips an operator default — that is the hand-edit path,
      // which a running server re-reads within seconds. It goes back to the
      // file that owns the node: a mod's nodes live with the mod.
      const wrote = ask("set_default", fields);
      const files = ask("render").files;
      // Palladium's own folder holds the central file, so "not in a mod
      // folder" no longer identifies it — its name does.
      const owning = wrote.mod
        ? files.find((f) => f.name.endsWith("/" + wrote.mod + "/settings.config"))
        : files.find((f) => f.name.endsWith("/permissions.config"));
      await api("PUT", "/api/bridge/permissions-file", {
        mod: wrote.mod || undefined,
        text: owning ? owning.text : ask("render").config,
      });
    } else {
      await LIVE_OPS[op](fields);
    }
    if (!defer) await liveLoad();
    return;
  }
  ask(op, fields);
  markUnsaved();
  if (!defer) refreshAll();
}

async function liveLoad() {
  const served = await api("GET", "/api/bridge/permissions-file");
  backend.sandbox = false;
  const all = served.files || [];
  const central = all.find((f) => !f.mod);
  const perMod = all.filter((f) => f.mod);
  bootFrom(
    [{ name: "permissions.config", text: String((central && central.text) ?? served.text ?? "") }],
    {},
    "the live server" + (perMod.length ? " — and " + perMod.length + " mod file(s)" : ""),
    perMod,
    true,
  );
  try {
    const online = await api("GET", "/api/bridge/players");
    livePlayers = (online.players || []).map((p) => ({
      id: String(p.playerId || p.userid || p.id || ""),
      name: String(p.name || ""),
    })).filter((p) => p.id);
  } catch { livePlayers = []; }
  fillLensPick();
  modeBanner();
}

function modeBanner() {
  const banner = $("modebanner");
  if (backend.mode !== "live") {
    banner.classList.add("hidden");
    return;
  }
  banner.classList.remove("hidden");
  if (!backend.authenticated) {
    banner.className = "banner warn";
    banner.textContent = "This origin has a live panel. Sign in there, then reload this page to edit the real server.";
    setChip("chipmode", "not signed in", "bad", banner.textContent);
  } else if (backend.sandbox) {
    banner.className = "banner warn";
    banner.innerHTML = "Sandbox — this copy is local and the live server is untouched. Download to apply, or ";
    const back = document.createElement("button");
    back.type = "button";
    back.className = "linklike";
    back.textContent = "return to the live server";
    back.onclick = guarded(liveLoad);
    banner.appendChild(back);
    banner.appendChild(document.createTextNode("."));
    setChip("chipmode", "sandbox", "bad",
      "This copy is local and the live server is untouched — click to go back to it.");
  } else {
    banner.className = "banner live";
    banner.textContent = "Connected — this is the live server's config. Edits apply as you make them, through the same audited door as the panel.";
  }
}

async function initEngine() {
  const names = ["memfs.lua", "boot.lua", ...Object.values(ENGINE_FILES)];
  let texts;
  try {
    texts = await Promise.all(names.map(async (name) => {
      const reply = await fetch(name);
      if (!reply.ok) throw new Error(name + " → " + reply.status);
      return reply.text();
    }));
  } catch (error) {
    fatal("Cannot fetch the engine files (" + error.message + "). This page needs to be served — "
      + "opening index.html straight from disk keeps fetch() from reading its neighbours.");
    return false;
  }

  const { lua, lauxlib, lualib, to_luastring } = fengari;
  L = lauxlib.luaL_newstate();
  lualib.luaL_openlibs(L);

  const sources = {};
  Object.keys(ENGINE_FILES).forEach((key, index) => { sources[key] = texts[2 + index]; });
  lua.lua_createtable(L, 0, 5);
  for (const [key, value] of Object.entries(sources)) {
    lua.lua_pushstring(L, to_luastring(value));
    lua.lua_setfield(L, -2, to_luastring(key));
  }
  lua.lua_setglobal(L, to_luastring("STUDIO_SOURCES"));

  runChunk(texts[0], "memfs.lua");
  runChunk(texts[1], "boot.lua");
  return true;
}

// ── state and refresh ────────────────────────────────────────────────────────

let booted = false;
let lastInfo = null;
let simPlayers = [];   // { id, name, groups }
let lastLensId = null; // who the lens is pointed at, re-asked after edits

function show(id) { $(id).classList.remove("hidden"); }

// ── tabs ─────────────────────────────────────────────────────────────────────
// Load and Health stay above the fold; everything else is one panel at a time.

const TAB_IDS = ["overviewpanel", "datapanel", "commandpanel", "permspanel", "settingspanel",
  "agentpanel"];
// The Agent tab's own sub-panels, siblings like the Permissions ones.
const AGENT_SUBS = ["eventspanel", "hookspanel", "peoplepanel", "palspanel",
  "buildpanel"];
// Permissions holds its own: the grid, the per-player lens and group
// membership. Trying a command lives with Commands; taking the file back is
// the banner at the top of every tab.
const PERM_SUBS = ["matrixpanel", "lenspanel", "grouppanel", "simpanel"];

function setTab(id) {
  for (const panel of TAB_IDS) $(panel).classList.toggle("hidden", panel !== id);
  for (const button of document.querySelectorAll("#tabs button")) {
    button.classList.toggle("active", button.dataset.tab === id);
  }
  // The sub-panels are siblings, so they follow their parent by hand.
  const inPerms = id === "permspanel";
  for (const panel of PERM_SUBS) {
    $(panel).classList.toggle("hidden", !inPerms || !permBelongs(panel, permSub));
  }
  const inAgent = id === "agentpanel";
  for (const panel of AGENT_SUBS) {
    $(panel).classList.toggle("hidden", !inAgent || panel !== agentSub);
  }

  if (id === "datapanel") refreshData();
  if (id === "settingspanel") refreshSettings();
  if (id === "overviewpanel") refreshOverview();
  // The stream only ticks while somebody is looking at it.
  if (inAgent) startAgentPoll(); else stopAgentPoll();
}

let agentSub = "eventspanel";

function setAgentSub(id) {
  agentSub = id;
  for (const panel of AGENT_SUBS) $(panel).classList.toggle("hidden", panel !== id);
  for (const button of document.querySelectorAll("#agenttabs button")) {
    button.classList.toggle("active", button.dataset.agentsub === id);
  }
  if (id === "hookspanel") refreshHooks();
  if (id === "peoplepanel") refreshPeople();
  if (id === "palspanel") refreshWorldPals();
}

let permSub = "matrixpanel";

// A sub-tab is not always one panel: group membership belongs with the grid,
// and trying a command as somebody belongs with the people rather than with
// the command reference. One rule, used by both the tab switch and the
// sub-tab switch — when it lived in only one of them, arriving at Permissions
// showed the grid without its groups until you clicked away and back.
function permBelongs(panel, sub) {
  return panel === sub
    || (sub === "matrixpanel" && panel === "grouppanel")
    || (sub === "lenspanel" && panel === "simpanel");
}

function setPermSub(id) {
  permSub = id;
  for (const panel of PERM_SUBS) {
    $(panel).classList.toggle("hidden", !permBelongs(panel, id));
  }
  for (const button of document.querySelectorAll("#permtabs button")) {
    button.classList.toggle("active", button.dataset.sub === id);
  }
}

// Offline, the config only exists in this tab: a reload is a delete. The
// browser will only show its own generic warning, and only if something has
// actually changed, so the flag is set by every edit and cleared by a download.
let unsaved = false;

function markUnsaved() {
  const live = backend.mode === "live" && backend.authenticated && !backend.sandbox;
  if (live) return;
  unsaved = true;
  $("applybanner").classList.add("dirty");
}

window.addEventListener("beforeunload", (event) => {
  if (!unsaved) return;
  event.preventDefault();
  event.returnValue = "";
});

// The three chips in the top line each own a panel below it. One at a time:
// two open drawers is the crowded header this replaced.
const DRAWERS = { chipsource: "load", chiphealth: "health", chipmode: "modepanel" };

function openDrawer(which) {
  for (const [chip, panel] of Object.entries(DRAWERS)) {
    const on = panel === which;
    $(panel).classList.toggle("hidden", !on);
    $(chip).setAttribute("aria-expanded", String(on));
    $(chip).classList.toggle("open", on);
  }
}

function toggleDrawer(which) {
  openDrawer($(which).classList.contains("hidden") ? which : null);
}

// A chip says its own state in a word. Loud only when something is wrong —
// a config that reads clean should not shout about it.
function setChip(id, text, tone, title) {
  const chip = $(id);
  chip.textContent = text;
  chip.className = "chip" + (tone ? " " + tone : "")
    + (chip.getAttribute("aria-expanded") === "true" ? " open" : "");
  if (title) chip.title = title;
}

function enableTabs() {
  for (const button of document.querySelectorAll("#tabs button")) button.disabled = false;
}

function refreshHealth(info) {
  wantHealth = false;
  const list = $("problems");
  list.textContent = "";
  for (const problem of info.problems) {
    const item = document.createElement("li");
    item.textContent = problem;
    list.appendChild(item);
  }
  $("cleanbadge").classList.toggle("hidden", info.problems.length > 0);
  const modlist = $("modlist");
  modlist.textContent = "";
  for (const mod of info.mods || []) {
    const item = document.createElement("li");
    if (mod.ok) {
      const words = mod.commands.map((c) => c.word).join(", ");
      item.textContent = mod.name + " — loaded" + (words ? ", commands: " + words : "");
    } else {
      item.className = "refused";
      item.textContent = mod.name + " — refused: " + mod.error;
    }
    for (const trouble of mod.troubles) {
      const sub = document.createElement("li");
      sub.className = "trouble";
      sub.textContent = mod.name + ": " + trouble;
      modlist.appendChild(sub);
    }
    modlist.appendChild(item);
  }
  $("bootlog").textContent = info.logs.join("\n");

  const refused = (info.mods || []).filter((m) => !m.ok).length;
  const count = info.problems.length;
  if (count || refused) {
    const bits = [];
    if (count) bits.push(count + " problem" + (count === 1 ? "" : "s"));
    if (refused) bits.push(refused + " mod" + (refused === 1 ? "" : "s") + " refused");
    setChip("chiphealth", bits.join(", "), "bad", "Click for the detail");
    // Something is wrong: that is worth the space, so it asks to open itself.
    // Acted on after the load panel has closed, or it would close this too.
    wantHealth = true;
  } else {
    const loaded = (info.mods || []).length;
    setChip("chiphealth", loaded ? "clean · " + loaded + " mod" + (loaded === 1 ? "" : "s") : "clean",
      "good", "Everything read clean — click for the engine log");
  }
}

let wantHealth = false;

// Who is in which group, and who has been given something of their own. Both
// are read off the same config, so a person appears wherever they belong
// rather than only where somebody remembered to list them.
function membership(info) {
  const byGroup = new Map();
  // Matched the way the engine matches: a hand-written `Moderator` is the
  // `moderator` group, and a count that disagreed with the resolver would be
  // worse than no count at all.
  const canonical = new Map();
  for (const group of info.groups || []) {
    byGroup.set(group.name, []);
    canonical.set(group.name.toLowerCase(), group.name);
  }
  for (const player of info.players || []) {
    for (const written of String(player.groups || "").split(",").map((g) => g.trim()).filter(Boolean)) {
      const name = canonical.get(written.toLowerCase()) || written;
      if (!byGroup.has(name)) byGroup.set(name, []);
      byGroup.get(name).push(player);
    }
  }
  return byGroup;
}

// Asked before anything that cannot be taken back. The promise resolves only
// on yes, so a cancelled question simply never runs the work.
// showModal() on a dialog inside a display:none ancestor raises the backdrop
// and renders nothing: the page stops taking clicks and there is no dialog to
// answer. Every dialog here lives outside the panels for that reason, and this
// refuses to open one that has been moved back in rather than locking the tab.
function openDialog(id) {
  const dialog = $(id);
  dialog.showModal();
  if (dialog.getBoundingClientRect().width === 0) {
    dialog.close();
    throw new Error("the " + id + " cannot be shown from here — it is inside a hidden panel");
  }
}

function confirmThen(question, run) {
  $("confirmtitle").textContent = question.title;
  $("confirmbody").textContent = question.body;
  $("confirmyes").textContent = question.verb;
  const dialog = $("confirmdialog");
  return new Promise((resolve) => {
    let settled = false;
    const close = (go) => {
      if (settled) return;
      settled = true;
      dialog.close();
      $("confirmyes").onclick = null;
      $("confirmno").onclick = null;
      resolve(go ? run() : undefined);
    };
    $("confirmyes").onclick = () => close(true);
    $("confirmno").onclick = () => close(false);
    // Escape closes a dialog without either button; without this the promise
    // never settles and whatever was waiting on it waits forever.
    dialog.addEventListener("close", () => close(false), { once: true });
    openDialog("confirmdialog");
    $("confirmno").focus();
  });
}

const expandedGroups = new Set();

function refreshGroups(info) {
  const host = $("grouplist");
  host.textContent = "";
  const byGroup = membership(info);

  for (const group of info.groups || []) {
    const members = byGroup.get(group.name) || [];
    const card = document.createElement("div");
    card.className = "groupcard";

    const head = document.createElement("div");
    head.className = "grouphead";

    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "expander";
    toggle.textContent = expandedGroups.has(group.name) ? "▾" : "▸";
    toggle.title = "show who is in this group";
    toggle.onclick = () => {
      if (expandedGroups.has(group.name)) expandedGroups.delete(group.name);
      else expandedGroups.add(group.name);
      refreshGroups(lastInfo);
  refreshPlayers(lastInfo);
    };
    head.appendChild(toggle);

    const name = document.createElement("b");
    name.textContent = group.name;
    head.appendChild(name);

    const meta = document.createElement("span");
    meta.className = "fine";
    meta.textContent = "weight " + group.weight
      + (group.tag ? " · tag " + group.tag : "")
      + (group.is_default ? " · everybody starts here" : "")
      + " · " + members.length + " member(s)";
    head.appendChild(meta);

    const spacer = document.createElement("span");
    spacer.className = "grow";
    head.appendChild(spacer);

    const add = iconButton("add", "Put somebody in " + group.name, "go");
    add.onclick = () => openMemberDialog(group.name);
    head.appendChild(add);

    if (!group.is_default) {
      const remove = iconButton("trash", "Delete the group " + group.name, "danger");
      remove.onclick = guarded(() => confirmThen({
        title: "Delete the group " + group.name + "?",
        body: (members.length
            ? members.length + " player(s) are in it and would fall back to the default group. "
            : "Nobody is in it. ")
          + "Every allow and deny written on it goes too, and nothing here undoes that.",
        verb: "Delete " + group.name,
      }, () => edit("group_delete", { name: group.name })));
      head.appendChild(remove);
    }
    card.appendChild(head);

    if (expandedGroups.has(group.name)) {
      const list = document.createElement("ul");
      list.className = "memberlist";
      if (members.length === 0) {
        const empty = document.createElement("li");
        empty.className = "fine";
        empty.textContent = group.is_default
          ? "Everybody is in this group without being named in it."
          : "Nobody is in this group yet.";
        list.appendChild(empty);
      }
      for (const member of members) {
        const item = document.createElement("li");
        const who = document.createElement("button");
        who.type = "button";
        who.className = "linklike";
        who.textContent = personLabel(member.id);
        who.title = member.id;
        who.onclick = () => { setPermSub("lenspanel"); showPlayer(member.id); };
        item.appendChild(who);
        if (member.overrides) {
          const flag = document.createElement("span");
          flag.className = "pill self";
          flag.textContent = member.overrides + " override(s)";
          item.appendChild(flag);
        }
        const drop = iconButton("remove", "Take them out of " + group.name, "danger");
        drop.onclick = guarded(() => confirmThen({
          title: "Take " + shortId(member.id) + " out of " + group.name + "?",
          body: "They keep any override of their own, and fall back to whatever their "
            + "remaining groups allow.",
          verb: "Remove them",
        }, () => edit("unassign", { player: member.id, group: group.name })));
        item.appendChild(drop);
        list.appendChild(item);
      }
      card.appendChild(list);
    }
    host.appendChild(card);
  }
}

// Everyone the config names, with the rank that decides for them and whether
// they carry anything of their own.
function refreshPlayers(info) {
  const host = $("playerlist");
  if (!host) return;
  host.textContent = "";
  const players = info.players || [];
  if (players.length === 0) {
    const empty = document.createElement("p");
    empty.className = "fine";
    empty.textContent = "This config names no players yet — a group grants, and a player "
      + "appears here once they are put in one or given an override.";
    host.appendChild(empty);
    return;
  }
  const table = document.createElement("table");
  table.className = "plain";
  const head = table.insertRow();
  for (const label of ["player", "rank", "of their own", ""]) {
    const cell = document.createElement("th");
    cell.textContent = label;
    head.appendChild(cell);
  }
  // Heaviest rank first, so the people who can do most are at the top.
  const weightOf = new Map((info.groups || []).map((g) => [g.name, g.weight]));
  const sorted = players.slice().sort((a, b) => {
    const rank = (p) => Math.max(-1, ...String(p.groups || "").split(",")
      .map((g) => weightOf.get(g.trim()) ?? -1));
    return rank(b) - rank(a) || a.id.localeCompare(b.id);
  });
  for (const player of sorted) {
    const row = table.insertRow();
    const cell = row.insertCell();
    cell.textContent = personLabel(player.id);
    cell.title = player.id;
    row.insertCell().textContent = player.groups || "the default group";
    const own = row.insertCell();
    if (player.overrides) {
      const flag = document.createElement("span");
      flag.className = "pill self";
      flag.textContent = player.overrides + " override(s)";
      own.appendChild(flag);
    } else {
      own.className = "fine";
      own.textContent = "—";
    }
    const actions = row.insertCell();
    const look = iconButton("eye", "Look at what " + shortId(player.id) + " may do");
    look.onclick = () => showPlayer(player.id);
    actions.appendChild(look);
  }
  host.appendChild(table);
}

function showPlayer(id) {
  lastLensId = id;
  runLens();
  $("lensdetail").classList.remove("hidden");
}

// Which groups this person is in, from their side. The group cards can take
// somebody out; until now nothing could put them in another one without going
// to find that group first, which is the wrong way round when the person is
// what you are looking at.
function renderLensGroups(id, reply) {
  const host = $("lensgroups");
  host.textContent = "";
  if (reply.simulated) {
    const note = document.createElement("span");
    note.className = "fine";
    note.textContent = "Simulated — change their groups where you made them up, below.";
    host.appendChild(note);
    return;
  }

  const label = document.createElement("span");
  label.className = "fine";
  label.textContent = "groups:";
  host.appendChild(label);

  const inGroup = new Set(reply.groups.map((g) => g.name));
  for (const group of reply.groups) {
    const chip = document.createElement("span");
    chip.className = "pill self groupchip";
    chip.textContent = group.name;
    const drop = iconButton("remove", "Take them out of " + group.name, "danger");
    drop.onclick = guarded(() => confirmThen({
      title: "Take " + shortId(id) + " out of " + group.name + "?",
      body: "They keep any override of their own, and fall back to whatever their "
        + "remaining groups allow.",
      verb: "Remove them",
      // refreshAll redraws the groups and the players; the lens is looking at
      // one person and has to be told to look again.
    }, async () => { await edit("unassign", { player: id, group: group.name }); showPlayer(id); }));
    chip.appendChild(drop);
    host.appendChild(chip);
  }
  if (inGroup.size === 0) {
    const none = document.createElement("span");
    none.className = "fine";
    none.textContent = "none — the default group answers for them";
    host.appendChild(none);
  }

  const spare = ((lastInfo && lastInfo.groups) || []).filter(
    (g) => !inGroup.has(g.name) && !g.is_default);
  if (spare.length === 0) return;
  const pick = document.createElement("select");
  pick.setAttribute("aria-label", "Add to a group");
  const first = document.createElement("option");
  first.value = "";
  first.textContent = "add to a group…";
  pick.appendChild(first);
  for (const group of spare) {
    const option = document.createElement("option");
    option.value = group.name;
    option.textContent = group.name + " (" + group.weight + ")";
    pick.appendChild(option);
  }
  pick.onchange = guarded(async () => {
    if (!pick.value) return;
    await edit("assign", { player: id, group: pick.value });
    showPlayer(id);
  });
  host.appendChild(pick);
}

function openMemberDialog(group) {
  $("memberdialogname").textContent = "Add somebody to " + group;
  $("pid").value = "";
  $("pid").dataset.group = group;
  openDialog("memberdialog");
}

// One line at the top saying what happens to an edit, per connection.
function applyBanner(fileCount) {
  const banner = $("applybanner");
  const live = backend.mode === "live" && backend.authenticated && !backend.sandbox;
  // Connected, the mode banner already says every change is on the server;
  // saying it twice in the same drawer is noise.
  banner.classList.toggle("hidden", live);
  banner.classList.toggle("islive", live);
  const words = live
    ? "Connected — every change here is already on the server."
    : fileCount === 0
      ? "Offline — nothing has changed yet, so there is nothing to put back."
      : "Offline — " + (fileCount === 1 ? "one file has" : fileCount + " files have")
        + " changed in this tab. Download and put "
        + (fileCount === 1 ? "it" : "them") + " back where "
        + (fileCount === 1 ? "it" : "they") + " came from; a running server "
        + "re-reads within seconds. Nothing you did not change is written.";
  $("applytext").textContent = words;
  setChip("chipmode",
    live ? "on the server"
      : fileCount === 0 ? "offline"
      : fileCount === 1 ? "1 file to download" : fileCount + " files to download",
    live ? "good" : fileCount ? "bad" : "", words);
  // Nothing to take away when the server already has it, or when nothing moved.
  $("applyactions").classList.toggle("hidden", live || fileCount === 0);
  $("download").textContent = fileCount === 1 ? "Download the changed file"
    : "Download " + fileCount + " changed files";
}

// What each file held when it was loaded. A download that wrote every config
// whether or not it differed made an operator copy four files back to change
// one, and gave them no way to tell which one mattered.
let baseline = new Map();

function rememberBaseline() {
  baseline = new Map();
  for (const file of ask("render").files) baseline.set(file.name, file.text);
}

function changedFiles() {
  return ask("render").files.filter((f) => baseline.get(f.name) !== f.text);
}

function refreshExport() {
  applyBanner(changedFiles().length);
}

const MARKS = {
  yes: { text: "✓", title: "may" },
  self: { text: "@me", title: "allowed with a constraint — a self-call passes" },
  cond: { text: "if", title: "allowed only under a condition the bare call does not meet" },
  no: { text: "✗", title: "may not" },
};

function refreshMatrix() {
  const reply = ask("matrix");
  const table = $("matrix");
  table.textContent = "";
  // A server with a few mods has a hundred nodes; the grid is only useful if
  // you can get to the handful you came for. Matches the node and the words
  // that describe it, so "give" and "hand items over" both find give_item.
  const wanted = ($("matrixsearch") ? $("matrixsearch").value : "").trim().toLowerCase();
  const nodes = reply.nodes.filter((n) => !wanted
    || n.id.toLowerCase().includes(wanted)
    || String(n.description || "").toLowerCase().includes(wanted));
  if ($("matrixcount")) {
    $("matrixcount").textContent = wanted
      ? nodes.length + " of " + reply.nodes.length + " node(s)"
      : reply.nodes.length + " node(s)";
  }

  const head = table.insertRow();
  const nodeHead = document.createElement("th");
  nodeHead.textContent = "node";
  nodeHead.className = "node";
  head.appendChild(nodeHead);
  const defaultHead = document.createElement("th");
  defaultHead.textContent = "default";
  head.appendChild(defaultHead);
  for (const group of reply.groups) {
    const cell = document.createElement("th");
    cell.textContent = group.name + (group.weight ? " (" + group.weight + ")" : "");
    head.appendChild(cell);
  }

  if (nodes.length === 0) {
    const row = table.insertRow();
    const cell = row.insertCell();
    cell.colSpan = reply.groups.length + 2;
    cell.className = "fine";
    cell.textContent = "No node matches that.";
    return;
  }

  let section = null;
  for (const node of nodes) {
    const prefix = node.id.includes(".") ? node.id.split(".")[0] : node.id;
    if (prefix !== section) {
      section = prefix;
      const row = table.insertRow();
      row.className = "section";
      const cell = row.insertCell();
      cell.colSpan = reply.groups.length + 2;
      cell.textContent = prefix;
    }
    const row = table.insertRow();
    const name = row.insertCell();
    name.className = "node";
    name.textContent = node.id;
    if (node.description) name.title = node.description;

    const fallback = row.insertCell();
    fallback.className = "default " + node.default;
    fallback.textContent = node.default;
    fallback.title = "the answer when no group or override says anything — click to flip";
    fallback.onclick = guarded(() =>
      edit("set_default", { node: node.id, effect: node.default === "allow" ? "deny" : "allow" }));

    for (const group of reply.groups) {
      const cell = reply.cells[group.name][node.id];
      const kind = cell.allowed ? "yes" : cell.self ? "self" : cell.conditional ? "cond" : "no";
      const box = row.insertCell();
      box.className = "cell " + kind;
      box.textContent = MARKS[kind].text;
      box.title = MARKS[kind].title + "\ndecided by: " + (cell.source || "nothing")
        + (cell.where ? "\n" + cell.where : "")
        + (cell.why ? "\nbare call fails: " + cell.why : "");
      // With a stamp picked, a drag paints; without one, a click opens the
      // cell. One gesture cannot mean both, so the mode is explicit.
      box.dataset.group = group.name;
      box.dataset.node = node.id;
      box.onclick = () => {
        if (stamp) return;
        openCellEditor("group", group.name, node.id, cell);
      };
      box.onmousedown = (event) => {
        if (!stamp) return;
        event.preventDefault();
        painting = true;
        painted.clear();
        paintCell(box);
      };
      box.onmouseenter = () => {
        if (painting) paintCell(box);
      };
    }
  }
}

function refreshAll() {
  lastInfo = ask("info");
  refreshHealth(lastInfo);
  refreshGroups(lastInfo);
  refreshPlayers(lastInfo);
  refreshExport();
  refreshMatrix();
  fillLensPick();
  try {
    lastCommands = ask("commands").commands;
  } catch {
    lastCommands = [];
  }
  renderCommandList($("cmdsearch") ? $("cmdsearch").value : "");
}


// ── overview ─────────────────────────────────────────────────────────────────

function refreshOverview() {
  const reply = ask("overview");
  const host = $("overviewmods");
  host.textContent = "";
  if (reply.mods.length === 0) {
    const empty = document.createElement("p");
    empty.className = "fine";
    empty.textContent = "No mods are loaded. Drop a mod folder above to see it here.";
    host.appendChild(empty);
    return;
  }
  for (const mod of reply.mods) {
    const card = document.createElement("div");
    card.className = "modcard" + (mod.ok ? "" : " broken");

    const title = document.createElement("h3");
    title.textContent = mod.name + (mod.version ? " " + mod.version : "");
    const state = document.createElement("span");
    state.className = "pill " + (mod.ok ? "good" : "bad");
    state.textContent = mod.ok ? "loaded" : "refused";
    title.appendChild(state);
    card.appendChild(title);

    if (mod.description) {
      const about = document.createElement("p");
      about.className = "fine";
      about.textContent = mod.description;
      card.appendChild(about);
    }

    if (mod.ok) {
      const counts = document.createElement("p");
      counts.className = "fine";
      counts.textContent = [
        mod.counts.commands + " command(s)",
        mod.counts.events + " event handler(s)",
        mod.counts.nodes + " permission node(s)",
        mod.counts.collections + " collection(s)",
      ].join(" · ");
      card.appendChild(counts);
    }

    const files = document.createElement("ul");
    files.className = "filelist";
    for (const file of mod.files) {
      const item = document.createElement("li");
      item.className = file.present ? "there" : "missing";
      item.textContent = file.present
        ? file.name + " — " + file.bytes + " bytes"
        : file.name + " — not written yet";
      files.appendChild(item);
    }
    card.appendChild(files);

    for (const trouble of mod.troubles) {
      const line = document.createElement("p");
      line.className = "trouble";
      line.textContent = trouble;
      card.appendChild(line);
    }
    host.appendChild(card);
  }
}

// ── data ─────────────────────────────────────────────────────────────────────

const dataMuted = new Set();

function refreshData() {
  const reply = ask("data");
  const owners = [...new Set(reply.collections.map((c) => c.owner))].sort();

  const toggles = $("datatoggles");
  toggles.textContent = "";
  for (const owner of owners) {
    const chip = document.createElement("li");
    chip.className = dataMuted.has(owner) ? "off" : "";
    chip.textContent = owner;
    chip.style.cursor = "pointer";
    chip.onclick = () => {
      if (dataMuted.has(owner)) dataMuted.delete(owner);
      else dataMuted.add(owner);
      refreshData();
    };
    toggles.appendChild(chip);
  }

  const lines = [];
  for (const collection of reply.collections) {
    if (dataMuted.has(collection.owner)) continue;
    lines.push(`── ${collection.name} — ${collection.description || "no description"}`
      + ` [${collection.storage}] ${collection.count} record(s)`);
    for (const record of collection.records) {
      const fields = record.fields.map((f) => `${f.key}=${f.value}`).join("  ");
      lines.push(`   ${record.id}  ${fields}`);
    }
    if (collection.count === 0) lines.push("   (empty)");
    lines.push("");
  }
  $("datastream").textContent = lines.length
    ? lines.join("\n")
    : "Nothing to show — every mod is switched off above.";
}

// ── settings ─────────────────────────────────────────────────────────────────

function refreshSettings() {
  const reply = ask("settings");
  const host = $("settingsmods");
  host.textContent = "";
  if (reply.mods.length === 0) {
    const empty = document.createElement("p");
    empty.className = "fine";
    empty.textContent = "No mod declares any settings.";
    host.appendChild(empty);
    return;
  }
  for (const mod of reply.mods) {
    const card = document.createElement("div");
    card.className = "modcard";
    const title = document.createElement("h3");
    title.textContent = mod.mod;
    card.appendChild(title);

    const table = document.createElement("table");
    table.className = "plain settings";
    const head = table.insertRow();
    for (const label of ["setting", "value", "the author's default", ""]) {
      const cell = document.createElement("th");
      cell.textContent = label;
      head.appendChild(cell);
    }
    for (const row of mod.settings) {
      const line = table.insertRow();
      line.insertCell().textContent = row.key;

      const valueCell = line.insertCell();
      const input = document.createElement("input");
      input.value = row.value;
      input.spellcheck = false;
      valueCell.appendChild(input);

      const author = line.insertCell();
      author.className = "fine";
      author.textContent = row.author ?? "—";

      const actions = line.insertCell();
      actions.className = "actions";
      const save = iconButton("save", "Save " + row.key, "go");
      save.onclick = guarded(async () => {
        await editSetting(mod.mod, row.key, input.value);
        refreshSettings();
      });
      actions.appendChild(save);
      if (row.overridden && row.author != null) {
        const reset = iconButton("reset", "Put " + row.key + " back to the author's default");
        reset.onclick = guarded(async () => {
          await editSetting(mod.mod, row.key, row.author);
          refreshSettings();
        });
        actions.appendChild(reset);
      }
      if (row.overridden) line.classList.add("changed");
    }
    card.appendChild(table);
    host.appendChild(card);
  }
}

// A setting is a line in the mod's own settings.config, so live mode puts that
// file back rather than reaching for a capability — there is none for this.
async function editSetting(mod, key, value) {
  const wrote = ask("set_setting", { mod, key, value });
  if (backend.mode === "live" && backend.authenticated && !backend.sandbox) {
    busy(true);
    await breathe();
    try {
      const file = ask("render").files.find((f) => f.name === wrote.file);
      await api("PUT", "/api/bridge/permissions-file", {
        mod: wrote.mod,
        text: file ? file.text : "",
      });
      await liveLoad();
    } finally {
      busy(false);
    }
  } else {
    markUnsaved();
    refreshAll();
  }
}

// ── suggestions ──────────────────────────────────────────────────────────────
// One dropdown, attached to any input, fed by a function that reads the caret
// and says what could come next. Everything it offers is drawn from what is
// actually loaded — the groups in this config, the players it names, the
// fields this node's call really carries — so a suggestion is never a guess.

let suggestBox = null;
let suggestFor = null;
let suggestItems = [];
let suggestAt = 0;

function closeSuggest() {
  if (suggestBox) suggestBox.classList.add("hidden");
  suggestFor = null;
}

function ensureSuggestBox() {
  if (suggestBox) return suggestBox;
  suggestBox = document.createElement("ul");
  suggestBox.className = "suggest hidden";
  document.addEventListener("click", (event) => {
    if (suggestBox && !suggestBox.contains(event.target) && event.target !== suggestFor) closeSuggest();
  });
  // Fixed to the viewport, so a scrolling page would leave it behind: follow
  // the field instead. A wheel over the list scrolls the list, not the page.
  const follow = () => { if (suggestFor) placeSuggest(suggestFor); };
  window.addEventListener("scroll", follow, true);
  window.addEventListener("resize", follow);
  // stopPropagation alone does not hold a wheel: the browser scrolls the list
  // and then chains what is left to the page. `overscroll-behavior: contain`
  // in the stylesheet is what stops the chain; this only keeps the page's own
  // handlers out of it.
  suggestBox.addEventListener("wheel", (event) => event.stopPropagation(), { passive: true });
  return suggestBox;
}

function renderSuggest(input, items, total) {
  const box = ensureSuggestBox();
  // A dialog opened with showModal() lives in the browser's top layer, which
  // no z-index can reach from below. The list has to be a child of that dialog
  // to appear over it — so it moves to whichever one owns the field.
  const layer = input.closest("dialog") || document.body;
  if (box.parentNode !== layer) layer.appendChild(box);
  suggestFor = input;
  suggestItems = items;
  suggestAt = 0;
  box.textContent = "";
  if (items.length === 0) { box.classList.add("hidden"); return; }
  items.forEach((item, index) => {
    const li = document.createElement("li");
    li.className = index === suggestAt ? "on" : "";
    const label = document.createElement("b");
    if (item.element) {
      const dot = document.createElement("i");
      dot.className = "el el-" + String(item.element).toLowerCase();
      dot.title = item.element;
      label.appendChild(dot);
    }
    label.appendChild(document.createTextNode(item.label));
    li.appendChild(label);
    if (item.hint) {
      const hint = document.createElement("span");
      hint.textContent = item.hint;
      li.appendChild(hint);
    }
    li.onmousedown = (event) => { event.preventDefault(); applySuggest(input, item); };
    box.appendChild(li);
  });
  // The list is capped so it stays a list; the tail is reachable by typing.
  if (total && total > items.length) {
    const more = document.createElement("li");
    more.className = "more";
    more.textContent = (total - items.length) + " more — keep typing to narrow it";
    box.appendChild(more);
  }
  placeSuggest(input);
  box.classList.remove("hidden");
}

// Fixed to the viewport, so the same coordinates are right whether the list
// hangs off the page or off a dialog centred over it.
function placeSuggest(input) {
  if (!suggestBox) return;
  const rect = input.getBoundingClientRect();
  const room = window.innerHeight - rect.bottom;
  suggestBox.style.left = rect.left + "px";
  suggestBox.style.minWidth = rect.width + "px";
  if (room < 180 && rect.top > room) {
    suggestBox.style.top = "auto";
    suggestBox.style.bottom = window.innerHeight - rect.top + 2 + "px";
    suggestBox.style.maxHeight = Math.max(80, rect.top - 12) + "px";
  } else {
    suggestBox.style.bottom = "auto";
    suggestBox.style.top = rect.bottom + 2 + "px";
    suggestBox.style.maxHeight = Math.max(80, room - 12) + "px";
  }
}

function applySuggest(input, item) {
  const caret = input.selectionStart ?? input.value.length;
  const before = input.value.slice(0, caret);
  const after = input.value.slice(caret);
  // A list field replaces only the entry being typed and leaves a comma ready
  // for the next; everything else replaces the token at the caret.
  const list = input.dataset.list === "true";
  const start = list ? before.search(/[^,]*$/) : before.search(/[^\s]*$/);
  // A catalogue name is not an entry, so it gets no separator after it.
  const insert = list && !item.keepOpen ? item.insert + ", " : item.insert;
  input.value = before.slice(0, start) + insert + after;
  const at = start + insert.length;
  input.setSelectionRange(at, at);
  closeSuggest();
  input.dispatchEvent(new Event("input"));
  input.focus();
  // Choosing `?pals` is choosing where to look, not what to say — the list
  // reopens on that catalogue instead of closing on a half-finished token.
  if (item.keepOpen) input.dispatchEvent(new Event("focus"));
}

function attachSuggest(input, source) {
  const update = () => {
    const caret = input.selectionStart ?? input.value.length;
    const items = source(input.value, caret) || [];
    renderSuggest(input, items.slice(0, 200), items.length);
  };
  input.addEventListener("input", update);
  input.addEventListener("focus", update);
  input.addEventListener("keydown", (event) => {
    const box = suggestBox;
    if (!box || box.classList.contains("hidden") || suggestFor !== input) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      suggestAt = (suggestAt + (event.key === "ArrowDown" ? 1 : -1) + suggestItems.length)
        % suggestItems.length;
      [...box.children].forEach((li, i) => li.classList.toggle("on", i === suggestAt));
    } else if (event.key === "Enter" || event.key === "Tab") {
      if (suggestItems[suggestAt]) {
        event.preventDefault();
        applySuggest(input, suggestItems[suggestAt]);
      }
    } else if (event.key === "Escape") {
      closeSuggest();
    }
  });
}

// What is actually loaded, for the suggesters to draw on.
function knownPlayers() {
  const out = [];
  for (const p of livePlayers) out.push({ id: p.id, name: p.name, note: "online now" });
  for (const p of simPlayers) out.push({ id: p.id, name: p.name, note: "simulated" });
  for (const p of (lastInfo && lastInfo.players) || []) {
    out.push({ id: p.id, name: p.id.slice(0, 8) + "…", note: p.groups || "no groups" });
  }
  return out;
}

function knownGroups() {
  return ((lastInfo && lastInfo.groups) || []).map((g) => ({
    label: g.name, hint: "weight " + g.weight, insert: g.name,
  }));
}

// The fields a constraint on this node can test: the call's own parameters,
// plus the ones every targeted call carries.
// The call's own parameters come first: they are what the command is about.
// `target` is always the player a call acts on — beside whom a pal spawns, to
// whom an item goes — never the thing itself, so it reads after them and says
// so plainly rather than leaving "target" to be guessed at.
const TARGET_FIELDS = [
  { name: "target", hint: "the player it acts on — @me, or a player id", kind: "player" },
  { name: "target_group", hint: "that player's highest group", kind: "group" },
  { name: "target_weight", hint: "that group's weight; a self-call is -1", kind: "weight" },
];

function constraintFields(node) {
  const capability = (window.PALLADIUM_STUDIO?.capabilities || []).find((c) => c.type === node);
  const own = [];
  let targeted = false;
  if (capability) {
    targeted = capability.target === "player";
    for (const [name, p] of Object.entries(capability.params)) {
      own.push({ name, kind: p.type, hint: fieldHint(name, p.type, p.required) });
    }
  }
  for (const command of (lastCommands || [])) {
    if (command.node !== node) continue;
    if (command.target === "player") targeted = true;
    for (const p of command.params || []) {
      if (own.some((f) => f.name === p.name)) continue;
      own.push({ name: p.name, kind: p.kind, hint: fieldHint(p.name, p.kind, p.required) });
    }
  }
  return targeted ? own.concat(TARGET_FIELDS) : own;
}

// A field's hint says what it holds, not only its type: "item_id" is what the
// engine calls it, "a pal species" is what somebody writing a rule means.
function fieldHint(name, kind, required) {
  const what = catalogFor(kind, name) === (window.PALLADIUM_CATALOG || {}).pals ? "a pal species"
    : catalogFor(kind, name) === (window.PALLADIUM_CATALOG || {}).traits ? "a passive skill"
    : catalogFor(kind, name) ? "an item id"
    : kind === "bool" ? "true or false"
    : kind === "int" || kind === "number" ? "a number"
    : String(kind || "text");
  return what + (required ? ", required" : "");
}

// What a field's value can be. A constraint on `item` is answered by items, on
// `target` by the players this config knows — the same catalogues the command
// form picks from, because they are the same values.
// Sorted by name and not truncated to the first handful: an unsorted slice of
// 40 out of 753 is why opening a picker looked broken — Lamball was in there,
// just never on screen. The list scrolls, so length is not the problem.
function catalogMatches(source, wanted) {
  const rows = [];
  for (const [id, meta] of Object.entries(source || {})) {
    const label = String(meta.name ?? meta);
    if (wanted && !id.toLowerCase().includes(wanted) && !label.toLowerCase().includes(wanted)) continue;
    const bits = [];
    if (meta.tier != null) bits.push("tier " + meta.tier);
    if (meta.effect) bits.push(meta.effect);
    if (meta.element) bits.push(meta.element);
    bits.push(id);
    rows.push({ label, hint: bits.join(" · "), insert: id, element: meta.element || null,
      sort: label.toLowerCase() });
  }
  rows.sort((a, b) => (a.sort < b.sort ? -1 : a.sort > b.sort ? 1 : 0));
  return rows;
}

function valueSuggestions(field, token, kind) {
  const catalog = window.PALLADIUM_CATALOG || {};
  const forced = forcedCatalogue(String(token || "").trim());
  if (forced) return forced.pick || forced.rows;
  const wanted = String(token || "").trim().toLowerCase();
  const name = String(field || "").toLowerCase();

  const fromCatalog = (source) => catalogMatches(source, wanted);

  // The declaration decides, so a mod that names its parameter `creature` and
  // declares it a species is answered with species — the same rule the command
  // form already follows. The names below are the fallback for a field nothing
  // declared, not the rule.
  const declared = catalogFor(kind, name);
  if (declared) return fromCatalog(declared);
  if (kind === "bool") {
    return [{ label: "true", hint: "", insert: "true" }, { label: "false", hint: "", insert: "false" }];
  }

  if (name === "item") return fromCatalog(catalog.items);
  if (name === "species" || name === "pal") return fromCatalog(catalog.pals);
  if (name === "traits" || name === "trait") return fromCatalog(catalog.traits);
  if (name === "target") {
    const out = [{ label: "@me", hint: "the caller themselves", insert: "@me" }];
    for (const player of knownPlayers()) {
      if (!wanted || player.name.toLowerCase().includes(wanted)) {
        out.push({ label: player.name, hint: player.note, insert: player.id });
      }
    }
    return out;
  }
  if (name === "target_group" || name === "group") {
    return knownGroups().filter((g) => !wanted || g.label.toLowerCase().includes(wanted));
  }
  if (name === "rare" || name === "hostile" || name.startsWith("is_")) {
    return [{ label: "true", hint: "", insert: "true" }, { label: "false", hint: "", insert: "false" }];
  }
  if (name === "target_weight" || name === "group_weight") {
    // The weights this config actually uses, so a rank rule can be written
    // against a real tier rather than a guessed number.
    return knownGroups().map((g) => ({
      label: String(g.hint).replace("weight ", ""), hint: "the weight of " + g.label,
      insert: String(g.hint).replace("weight ", ""),
    }));
  }
  return [];
}

// The constraint box, as a little grammar: `where`, a field, an operator, a
// value — then `and` / `or` and around again. Every step offers only what can
// legally come next, and the values come from what is loaded.
const CONSTRAINT_OPS = ["in", "<=", ">=", "!=", "=", "<", ">"];

function constraintSuggestions(node) {
  return (text, caret) => {
    const before = String(text || "").slice(0, caret ?? (text || "").length);
    const token = (before.match(/[^\s]*$/) || [""])[0];

    // Before `where` there is only `where`.
    if (!/\bwhere\b/.test(before)) {
      return "where".startsWith(token.toLowerCase())
        ? [{ label: "where", hint: "start a rule", insert: "where " }] : [];
    }

    // The clause being written: everything after the last `and` / `or`.
    const body = before.replace(/^[\s\S]*?\bwhere\b/, "");
    const clause = body.split(/\s+(?:and|or)\s+/).pop();
    const parsed = clause.match(
      /^\s*([\w_]+)?\s*(in|<=|>=|!=|=|<|>)?\s*([\s\S]*)$/);
    const field = parsed[1] || "";
    const operator = parsed[2] || "";
    const rest = parsed[3] || "";
    const fields = constraintFields(node);

    if (field && operator) {
      // A value, then a space, is a finished condition — for a list too, since
      // a comma is how the list carries on. Offer to chain another clause.
      const finished = /\S\s+$/.test(rest) && !/,\s*$/.test(rest);
      if (finished) {
        return [
          { label: "and", hint: "both must hold — binds tighter than or", insert: "and " },
          { label: "or", hint: "either alternative may hold", insert: "or " },
        ];
      }
      // `in` takes a comma-separated list, so only the entry being typed counts.
      const valueToken = operator === "in" ? (rest.split(",").pop() || "") : rest;
      const declared = fields.find((f) => f.name === field);
      const values = valueSuggestions(field, valueToken, declared && declared.kind);
      if (operator === "in") {
        return values.map((v) => (v.keepOpen ? v : { ...v, insert: v.insert + "," }));
      }
      if (values.length === 0 && valueToken === "") {
        return [{ label: "…a value", hint: "whatever this field holds", insert: "" }];
      }
      return values;
    }

    if (field && !operator) {
      // A complete field name, then a space: the operators it can take.
      const known = fields.some((f) => f.name === field);
      if (known && /\s$/.test(clause)) {
        return CONSTRAINT_OPS.map((op) => ({
          label: op,
          hint: op === "in" ? "one of a comma-separated list" : "compare",
          insert: op + " ",
        }));
      }
      return fields
        .filter((f) => f.name.startsWith(field))
        .map((f) => ({ label: f.name, hint: f.hint, insert: f.name + " " }));
    }

    return fields.map((f) => ({ label: f.name, hint: f.hint, insert: f.name + " " }));
  };
}

let lastCommands = [];

// ── how a call is spelled, four ways ─────────────────────────────────────────
// The same action, as chat, as a mod would write it, as a script mod would,
// and as HTTP. Not a template each: one compiled call rendered four times, so
// they cannot drift from each other or from what actually ran.

function luaLiteral(value) {
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(String(value));
}

function callForms(action, target, params) {
  const pairs = Object.entries(params || {});
  const chatBits = pairs.map(([k, v]) => `${k}=${v}`);
  const written = String(target || "");
  const mention = !written ? ""
    : written.startsWith("@") ? " " + written
    : " @" + shortId(written);
  const chat = "!" + action + mention + (chatBits.length ? " " + chatBits.join(" ") : "");

  const luaTable = "{ " + pairs.map(([k, v]) => `${k} = ${luaLiteral(v)}`).join(", ") + " }";
  const [ns, verb] = action.includes(".") ? [action.split(".")[0], action.split(".").slice(1).join(".")] : ["", action];
  const lua = ns
    ? `pal.${ns}.${verb}(${target ? JSON.stringify(target) : "nil"}, ${luaTable}, function(ok, err, data)\n`
      + `    if not ok then return pal.log("failed: " .. tostring(err)) end\n`
      + `end)`
    : `pal.call(${JSON.stringify(action)}, ${target ? JSON.stringify(target) : "nil"}, ${luaTable})`;

  const jsObject = JSON.stringify(Object.fromEntries(pairs), null, 2).replace(/\n/g, "\n  ");
  const ts = ns
    ? `await pal.${ns}.${verb}(${target ? JSON.stringify(target) : "null"}, ${jsObject});`
    : `await pal.call(${JSON.stringify(action)}, ${target ? JSON.stringify(target) : "null"}, ${jsObject});`;

  const body = JSON.stringify(
    { type: action, target: target || "", data: Object.fromEntries(pairs) }, null, 2);
  const http = `curl -X POST http://<panel>:3000/api/bridge/call \\\n`
    + `  -H 'Authorization: Bearer palup_…' \\\n`
    + `  -H 'content-type: application/json' \\\n`
    + `  -d '${body.replace(/\n\s*/g, " ")}'`;

  return [
    { label: "In game", hint: "typed in chat by a player who may", text: chat },
    { label: "From a mod (Lua)", hint: "inside a mod.lua handler", text: lua },
    { label: "From a script mod (TS)", hint: "the panel-run half of a mod", text: ts },
    { label: "Over HTTP", hint: "any language, with an API token", text: http },
  ];
}

function openShow(action, target, params) {
  $("showname").textContent = action;
  const host = $("showforms");
  host.textContent = "";
  for (const form of callForms(action, target, params)) {
    const block = document.createElement("div");
    block.className = "callform";
    const head = document.createElement("div");
    head.className = "row";
    const title = document.createElement("b");
    title.textContent = form.label;
    const hint = document.createElement("span");
    hint.className = "fine";
    hint.textContent = form.hint;
    const copy = document.createElement("button");
    copy.type = "button";
    copy.className = "quiet";
    copy.textContent = "copy";
    const pre = document.createElement("pre");
    pre.textContent = form.text;
    copy.onclick = () => copyText(form.text, copy, pre);
    head.appendChild(title);
    head.appendChild(hint);
    head.appendChild(copy);
    block.appendChild(head);
    block.appendChild(pre);
    host.appendChild(block);
  }
  openDialog("showdialog");
}

// The clipboard API needs a permission this page does not always have — inside
// the panel it is an iframe, and a denied write rejects silently. The old
// selection trick works everywhere, so it is the fallback, and either way the
// button says what happened rather than leaving it to faith.
function copyText(text, button, shown) {
  const said = (word) => {
    if (!button) return;
    const was = button.textContent;
    button.textContent = word;
    setTimeout(() => { button.textContent = was; }, 1600);
  };
  const fallback = () => {
    const box = document.createElement("textarea");
    box.value = text;
    box.setAttribute("readonly", "");
    box.style.position = "fixed";
    box.style.opacity = "0";
    (document.querySelector("dialog[open]") || document.body).appendChild(box);
    box.select();
    let ok = false;
    try {
      ok = document.execCommand("copy");
    } catch {
      ok = false;
    }
    box.remove();
    if (ok) return said("copied");
    // Both doors refused. Select the text that is already on screen, so the
    // keyboard shortcut has something to act on — telling somebody to press
    // Ctrl+C with nothing selected is not an answer.
    if (shown) {
      const range = document.createRange();
      range.selectNodeContents(shown);
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      said("selected — press ⌘/Ctrl+C");
    } else {
      said("could not copy");
    }
  };
  if (!navigator.clipboard?.writeText) return fallback();
  navigator.clipboard.writeText(text).then(() => said("copied"), fallback);
}

// ── the command form ─────────────────────────────────────────────────────────
// A command picked from the list becomes a form of its declared parameters,
// each field knowing what it holds: an item_id offers items by name, a species
// offers pals, a target offers the players this config knows. Then Run — or
// Show, which is the same call written four ways.

let chosenCommand = null;

function catalogFor(kind, paramName) {
  const catalog = window.PALLADIUM_CATALOG || {};
  const name = String(paramName || "").toLowerCase();
  const type = String(kind || "").toLowerCase();
  // A declaration that says what it holds is believed before a name that only
  // hints at it, so a mod's `creature: species` is answered with species.
  if (type === "species" || type === "pal_id") return catalog.pals;
  if (type === "trait" || type === "traits" || type === "passive") return catalog.traits;
  if (name === "species" || name === "pal") return catalog.pals;
  if (name === "traits" || name === "trait") return catalog.traits;
  if (type === "item_id") return catalog.items;
  return null;
}

// A catalog is id → display name; a picker offers the name and inserts the id,
// because the engine only ever accepts the id.
// Every generated catalogue, by the name you ask for it with. A field's type
// decides what it offers by default, but `?` overrides that anywhere: `?pals`
// in a box that expects an item still lists pals. Nothing about a field can
// put a catalogue out of reach.
// The first three are the game's, generated at build time. The last three are
// this config's own, so `?groups` in a fresh tab lists nothing until something
// is loaded — which is the honest answer.
const CATALOGUES = [
  { key: "items", hint: "every item id",
    rows: (w) => catalogMatches((window.PALLADIUM_CATALOG || {}).items, w) },
  { key: "pals", hint: "every pal species",
    rows: (w) => catalogMatches((window.PALLADIUM_CATALOG || {}).pals, w) },
  { key: "traits", hint: "every passive skill",
    rows: (w) => catalogMatches((window.PALLADIUM_CATALOG || {}).traits, w) },
  { key: "groups", hint: "the groups in this config",
    rows: (w) => knownGroups().filter((g) => !w || g.label.toLowerCase().includes(w)) },
  { key: "players", hint: "the players this config names",
    rows: (w) => knownPlayers()
      .filter((p) => !w || p.name.toLowerCase().includes(w) || p.id.toLowerCase().includes(w))
      .map((p) => ({ label: p.name, hint: p.note, insert: p.id })) },
  { key: "permissions", hint: "every permission node",
    rows: (w) => knownNodes().filter((n) => !w || n.label.toLowerCase().includes(w)) },
];

// Every node the engine knows about: what the mods registered, plus the
// capabilities, which is the same list the grid draws its rows from.
function knownNodes() {
  const seen = new Map();
  for (const node of (lastInfo && lastInfo.nodes) || []) {
    seen.set(node.id, { label: node.id, hint: node.description || "default " + node.default,
      insert: node.id });
  }
  for (const command of lastCommands || []) {
    if (command.node && !seen.has(command.node)) {
      seen.set(command.node, { label: command.node, hint: command.word + " — " + command.source,
        insert: command.node });
    }
  }
  return [...seen.values()].sort((a, b) => (a.label < b.label ? -1 : 1));
}

// A token starting with `?` is a catalogue request: `?` alone lists them,
// `?pals` lists that one, and anything after the name filters within it.
function forcedCatalogue(token) {
  const text = String(token || "");
  if (!text.startsWith("?")) return null;
  const rest = text.slice(1);
  const chosen = CATALOGUES.find((c) => rest.toLowerCase().startsWith(c.key));
  if (!chosen) {
    const wanted = rest.toLowerCase();
    return {
      pick: CATALOGUES
        .filter((c) => !wanted || c.key.startsWith(wanted))
        .map((c) => ({ label: "?" + c.key, hint: c.hint, insert: "?" + c.key, keepOpen: true })),
    };
  }
  const filter = rest.slice(chosen.key.length).replace(/^[:\s]+/, "").trim().toLowerCase();
  const rows = chosen.rows(filter);
  return { rows: rows.length ? rows : [{ label: "nothing in ?" + chosen.key + " yet",
    hint: chosen.hint, insert: "" }] };
}

function catalogSuggestions(kind, paramName, isList) {
  return (text, caret) => {
    // Only the entry being typed matters in a list field.
    const upto = String(text || "").slice(0, caret ?? (text || "").length);
    const token = (isList ? (upto.split(",").pop() || "") : upto).trim();
    const forced = forcedCatalogue(token);
    if (forced) return forced.pick || forced.rows;
    const catalog = catalogFor(kind, paramName);
    if (!catalog) return [];
    return catalogMatches(catalog, token.toLowerCase());
  };
}

function renderCommandList(filter) {
  const host = $("cmdlist");
  host.textContent = "";
  const wanted = String(filter || "").replace(/^!/, "").toLowerCase();
  const matches = (lastCommands || []).filter((c) => commandMatches(c, wanted));
  for (const command of matches.slice(0, 60)) {
    const item = document.createElement("button");
    item.type = "button";
    item.className = "cmdchip" + (chosenCommand && chosenCommand.word === command.word ? " on" : "");
    item.textContent = command.word;
    const from = document.createElement("span");
    from.textContent = command.source;
    item.appendChild(from);
    item.onclick = () => chooseCommand(command, true);
    host.appendChild(item);
  }
  if (matches.length === 0) {
    const none = document.createElement("p");
    none.className = "fine";
    none.textContent = "Nothing matches that.";
    host.appendChild(none);
  }
  renderCommandReference(wanted);
}

function chooseCommand(command, narrow) {
  chosenCommand = command;
  // Picking one is saying "this is the one I want", so the long list becomes
  // that one — and the search box says why, which is also how to undo it.
  if (narrow) $("cmdsearch").value = command.word;
  renderCommandList($("cmdsearch").value);
  $("cmdall").classList.toggle("hidden", $("cmdsearch").value.trim() === "");
  $("cmdform").classList.remove("hidden");
  $("cmdname").textContent = command.word;
  $("cmdhelp").textContent = command.help
    || (command.kind === "capability"
      ? "A built-in capability, gated by " + command.node + "."
      : "From " + command.source + ", gated by " + (command.node || "nothing"));

  const fields = $("cmdfields");
  fields.textContent = "";
  $("cmdout").textContent = "";

  if (command.target === "player") {
    const people = knownPlayers();
    const hint = people.length
      ? "who it acts on — " + people.length + " known"
      : "who it acts on — no players in this config yet, so type an id";
    fields.appendChild(fieldRow("target", hint, "", (input) => {
      attachSuggest(input, (text) => {
        const wanted = String(text || "").trim().toLowerCase();
        const out = [{ label: "@me", hint: "whoever runs it", insert: "@me" }];
        for (const player of knownPlayers()) {
          if (!wanted || player.name.toLowerCase().includes(wanted)
            || player.id.toLowerCase().startsWith(wanted)) {
            out.push({ label: player.name, hint: player.note + " · " + player.id.slice(0, 8) + "…",
              insert: player.id });
          }
        }
        return out;
      });
    }));
  }
  for (const p of command.params || []) {
    const bits = [p.kind];
    if (p.required) bits.push("required");
    if (p.min !== undefined || p.max !== undefined) bits.push((p.min ?? "") + "…" + (p.max ?? ""));
    if (p.default !== undefined) bits.push("default " + p.default);
    // Traits are a comma-separated list; everything else takes one value.
    const isList = /^traits?$/i.test(p.name);
    if (isList) bits.push("comma-separated");
    fields.appendChild(fieldRow(p.name, bits.join(", "), p.default ?? "", (input) => {
      if (p.kind === "bool") return;
      if (isList) input.dataset.list = "true";
      const source = catalogSuggestions(p.kind, p.name, isList);
      if (source("", 0)?.length) attachSuggest(input, source);
      if (p.default !== undefined) input.value = String(p.default);
    }, p.kind));
  }
  if (!command.declared) {
    const note = document.createElement("p");
    note.className = "fine";
    note.textContent = "This command parses its own arguments, so there are no fields to fill. "
      + "Type it in full below and try it as a player.";
    fields.appendChild(note);
  }

  const live = backend.mode === "live" && backend.authenticated;
  $("cmdrun").disabled = !live || command.kind !== "capability";
  $("cmdnote").textContent = !live
    ? "Not connected to a panel — Show gives you the call to run yourself."
    : command.kind !== "capability"
      ? "A mod's command runs in the game, not through the panel's door — Show it, or try it below."
      : "";
}

function fieldRow(name, hint, value, decorate, kind) {
  const label = document.createElement("label");
  label.className = "cmdfield" + (kind === "bool" ? " boolfield" : "");
  const title = document.createElement("span");
  title.textContent = name;
  const help = document.createElement("i");
  help.textContent = hint;
  const input = document.createElement("input");
  input.dataset.param = name;
  if (kind === "bool") {
    // A yes-or-no answer is a switch, not two words somebody has to spell.
    input.type = "checkbox";
    input.dataset.bool = "true";
    input.checked = value === true || String(value).toLowerCase() === "true";
  } else {
    input.value = value === undefined || value === null ? "" : String(value);
  }
  input.autocomplete = "off";
  label.appendChild(title);
  label.appendChild(input);
  label.appendChild(help);
  if (decorate) decorate(input);
  return label;
}

function commandValues() {
  const params = {};
  let target = "";
  const kinds = new Map((chosenCommand?.params || []).map((p) => [p.name, p.kind]));
  for (const input of $("cmdfields").querySelectorAll("input")) {
    if (input.dataset.bool === "true") {
      // A box left unticked is a real answer, so it is sent rather than
      // dropped — otherwise "no" and "did not say" would be the same call.
      params[input.dataset.param] = input.checked;
      continue;
    }
    const value = input.value.trim();
    if (value === "") continue;
    if (input.dataset.param === "target") {
      target = value;
      continue;
    }
    // Typed as declared: an int sent as a string reads wrong in every form,
    // and the HTTP door validates against the same schema this came from.
    if (input.dataset.list === "true") {
      const cleaned = value.split(",").map((v) => v.trim()).filter(Boolean).join(",");
      if (cleaned) params[input.dataset.param] = cleaned;
      continue;
    }
    const kind = kinds.get(input.dataset.param);
    if (kind === "int" || kind === "number") {
      const asNumber = Number(value);
      params[input.dataset.param] = Number.isFinite(asNumber) ? asNumber : value;
    } else if (kind === "bool") {
      params[input.dataset.param] = value.toLowerCase() === "true";
    } else {
      params[input.dataset.param] = value;
    }
  }
  return { target, params };
}

// ── loading ──────────────────────────────────────────────────────────────────

// `fromLive` says where these bytes came from. It used to be inferred by
// matching the label against a fixed sentence, so renaming the label quietly
// made every live load call itself a sandbox.
function bootFrom(files, mods, label, homes, fromLive) {
  try {
    ask("reset");
    for (const file of files) {
      ask("file", { name: "permissions.config", text: file.text }, "text");
    }
    for (const [name, folder] of Object.entries(mods || {})) {
      for (const [file, text] of Object.entries(folder)) {
        ask("mod", { name, file, text }, "text");
      }
    }
    // A live server's per-mod node files: staged into the folders the engine
    // reads them from, so its inventory matches the server's exactly.
    for (const home of homes || []) {
      ask("home_file", { name: home.mod, text: home.text }, "text");
    }
    ask("boot");
    rememberBaseline();
    booted = true;
    backend.sandbox = backend.mode === "live" && !fromLive;
    $("loadedname").textContent = label;
    refreshAll();
    enableTabs();
    setPermSub("matrixpanel");
    setTab("overviewpanel");
    collapseLoad(label);
    modeBanner();
  } catch (error) {
    fatal("The engine refused: " + error.message);
  }
}

function collapseLoad(label) {
  $("loadedwhat").textContent = label;
  $("loadsummary").classList.remove("hidden");
  $("loadbody").classList.add("hidden");
  setChip("chipsource", label, "", "Loaded: " + label + " — click to load something else");
  document.body.classList.add("booted");
  // The way in has been used, so it steps aside — unless the config that came
  // through it has something wrong, which is worth the space.
  openDrawer(wantHealth ? "health" : null);
}

// Which files inside a mod folder matter to the engine; everything else in
// the folder (README, tests) is noise here.
// What a mod folder can contribute. `permissions.config` is deliberately not
// here: a mod's nodes live in its settings.config now, so the only file by
// that name is the central one — and treating it as a mod's file is what made
// a dropped folder lose every group and every player in it.
const MOD_FILES = new Set([
  "mod.lua", "settings.config", "settings.example.config",
]);

function stagedName(text, fallback) {
  const declared = text.match(/name\s*=\s*"([\w.-]+)"/);
  return declared ? declared[1] : fallback;
}

// Loose files and whole folders arrive mixed; sort them into the two kinds of
// staging the engine knows. A loose mod.lua is named by its own `name = "…"`
// line — the framework refuses a folder that disagrees with it anyway.
async function stageAndBoot(entries) {
  const files = [];
  const mods = {};
  const labels = [];
  const ignored = [];
  for (const entry of entries) {
    if (entry.dir && MOD_FILES.has(entry.name)) {
      const text = await entry.file.text();
      const name = entry.name === "mod.lua" ? stagedName(text, entry.dir) : entry.dir;
      mods[name] = mods[name] || {};
      mods[name][entry.name] = text;
    } else if (entry.name === "mod.lua") {
      const text = await entry.file.text();
      const name = stagedName(text, "");
      if (!name) {
        fatal('This mod.lua declares no name = "…" line — drop its whole folder instead.');
        return;
      }
      mods[name] = mods[name] || {};
      mods[name]["mod.lua"] = text;
    } else if (entry.name === "permissions.config") {
      files.push({ name: entry.name, text: await entry.file.text() });
    } else {
      // Everything else a folder happens to contain — a mod's Lua, the
      // generated type definitions, a README. Taking an unknown file as the
      // config was how dropping the Palladium folder filled the page with
      // "not `key = value`: ---@class …".
      ignored.push(entry.dir ? entry.dir + "/" + entry.name : entry.name);
    }
  }
  // A folder carrying settings.config but no mod.lua is a mod installed on a
  // server whose code was not handed over — the same thing a live panel serves.
  // Staging it as a mod would refuse it for having no code; staging it as that
  // mod's home keeps its settings and its nodes, which is all it has.
  const homes = [];
  for (const [name, folder] of Object.entries(mods)) {
    if (folder["mod.lua"]) continue;
    if (folder["settings.config"] || folder["settings.example.config"]) {
      homes.push({ mod: name, text: folder["settings.config"] || folder["settings.example.config"] });
    }
    delete mods[name];
  }
  for (const name of Object.keys(mods)) labels.push(name + "/");
  for (const home of homes) labels.push(home.mod + "/");
  for (const file of files) labels.push(file.name);
  if (labels.length === 0) {
    fatal(ignored.length
      ? "Nothing here is a config or a mod: " + ignored.slice(0, 4).join(", ")
        + (ignored.length > 4 ? " and " + (ignored.length - 4) + " more." : "")
        + " Drop permissions.config, or a mod folder."
      : "Nothing to load.");
    return;
  }
  bootFrom(files, mods, labels.join(", "), homes);
  if (ignored.length > 0) {
    const note = $("ignorednote");
    note.classList.remove("hidden");
    note.textContent = ignored.length + " file(s) in what you dropped are not configs and were "
      + "left alone: " + ignored.slice(0, 6).join(", ")
      + (ignored.length > 6 ? " and " + (ignored.length - 6) + " more." : "");
  }
}

async function loadFileList(list) {
  const entries = [];
  for (const file of list) {
    // The folder that holds the file, not the folder the picker started in:
    // picking Palladium/mods/ gave every file the name `mods`, so each mod's
    // settings landed under one made-up mod called after the parent.
    const path = file.webkitRelativePath || "";
    const parts = path.split("/").filter(Boolean);
    const dir = parts.length > 1 ? parts[parts.length - 2] : null;
    entries.push({ name: file.name, dir, file });
  }
  await stageAndBoot(entries);
}

// A drop can carry directories; those need walking, one level of the tree at
// a time, which only the entry API offers.
function walkEntry(entry, dir, out) {
  return new Promise((resolve) => {
    if (entry.isFile) {
      entry.file((file) => {
        out.push({ name: entry.name, dir, file });
        resolve();
      }, () => resolve());
    } else if (entry.isDirectory) {
      const reader = entry.createReader();
      reader.readEntries(async (children) => {
        for (const child of children) await walkEntry(child, entry.name, out);
        resolve();
      }, () => resolve());
    } else {
      resolve();
    }
  });
}

async function loadDropped(dataTransfer) {
  const items = [...(dataTransfer.items || [])];
  const out = [];
  const walks = [];
  for (const item of items) {
    const entry = item.webkitGetAsEntry && item.webkitGetAsEntry();
    if (entry) walks.push(walkEntry(entry, null, out));
  }
  if (walks.length > 0) {
    await Promise.all(walks);
    await stageAndBoot(out);
  } else {
    await loadFileList(dataTransfer.files);
  }
}

// ── the cell editor ──────────────────────────────────────────────────────────

// ── the stamp ────────────────────────────────────────────────────────────────
// Setting one cell at a time is fine for one; a tier's worth of nodes is not.
// A stamp turns the grid into a surface you paint, and every stroke goes
// through the same edit path a dialog would.

let stamp = null;         // "allow" | "deny" | "inherit", or null for off
let painting = false;
const painted = new Set(); // this stroke's cells, so a drag never re-writes one
let paintQueue = [];

function setStamp(next) {
  stamp = next;
  for (const button of document.querySelectorAll(".stamp")) {
    button.classList.toggle("on",
      (button.id === "stampoff" && !stamp)
      || (button.id === "stampallow" && stamp === "allow")
      || (button.id === "stampdeny" && stamp === "deny")
      || (button.id === "stampclear" && stamp === "inherit"));
  }
  $("matrix").classList.toggle("stamping", Boolean(stamp));
  $("stampnote").textContent = stamp
    ? "Drag across cells to set them to " + stamp + "."
    : "With a stamp picked, drag across cells to set them all. Clicking one still opens it.";
}

function paintCell(box) {
  const key = box.dataset.group + "\u0000" + box.dataset.node;
  if (painted.has(key)) return;
  painted.add(key);
  // Painted immediately so the stroke reads as it happens; the writes are
  // applied together when the mouse comes up, because each one re-boots the
  // engine and doing that per cell mid-drag would crawl.
  box.className = "cell " + (stamp === "allow" ? "yes" : stamp === "deny" ? "no" : "pending");
  box.textContent = stamp === "allow" ? "✓" : stamp === "deny" ? "✗" : "–";
  paintQueue.push({ group: box.dataset.group, node: box.dataset.node, effect: stamp });
}

async function finishPaint() {
  if (!painting) return;
  painting = false;
  const work = paintQueue;
  paintQueue = [];
  if (work.length === 0) return;
  const note = $("stampnote");
  busy(true);
  try {
    let done = 0;
    for (const change of work) {
      if (change.effect === "inherit") {
        await edit("entry_remove", { group: change.group, node: change.node }, true);
      } else {
        await edit("entry", {
          group: change.group, node: change.node, effect: change.effect,
          where: "", until_stamp: "",
        }, true);
      }
      done += 1;
      note.textContent = "Applying " + done + " of " + work.length + "…";
      // Hand the frame back when enough work has piled up to be worth a
      // repaint — not on every cell, because a yield costs more than the edit.
      await breathe(50);
    }
    // One redraw for the run, not one per cell.
    if (backend.mode === "live" && backend.authenticated && !backend.sandbox) await liveLoad();
    else refreshAll();
    note.textContent = work.length + " cell(s) set to " + work[0].effect + ".";
  } catch (error) {
    fatal("The engine refused: " + error.message);
  } finally {
    busy(false);
  }
}

// The engine is synchronous Lua on this thread, so nothing repaints while it
// runs. Yielding between steps is what makes progress visible at all — but a
// frame is not something to wait on: a hidden or backgrounded tab never paints,
// and a run that waited for one would simply stop. Whichever comes first.
let lastBreath = 0;

function breathe(afterMs) {
  const now = performance.now();
  if (afterMs && now - lastBreath < afterMs) return Promise.resolve();
  lastBreath = now;
  return new Promise((resolve) => {
    let done = false;
    const once = () => { if (!done) { done = true; lastBreath = performance.now(); resolve(); } };
    requestAnimationFrame(once);
    setTimeout(once, 30);
  });
}

function busy(on) {
  document.body.classList.toggle("busy", on);
}

let editing = null;

// The same answer a cell's hover carries, as visible text — a tooltip nobody
// finds is an answer nobody got.
function storyOf(cell) {
  const kind = cell.allowed ? "yes" : cell.self ? "self" : cell.conditional ? "cond" : "no";
  const bits = [MARKS[kind].title];
  bits.push("decided by " + (cell.source === "user" ? "their own override"
    : cell.source === "default" ? "the node's default"
    : cell.source === "unregistered" ? "nothing — a node nobody registered is denied"
    : cell.source ? "the entry in " + cell.source : "nothing"));
  if (cell.where) bits.push("rule: " + cell.where);
  if (cell.until_stamp) bits.push("expires " + cell.until_stamp);
  if (cell.why) bits.push("a bare call fails because " + cell.why);
  return { kind, text: bits.join("\n"), line: bits.join(" · ") };
}

// One dialog for both kinds of entry: a group's, or a player's own override.
function openCellEditor(kind, name, node, cell) {
  editing = { kind, name, node };
  $("cellname").textContent = (kind === "player" ? "override for " + shortId(name) : name)
    + " × " + node;
  $("cellstory").textContent = storyOf(cell).text;
  const decidedHere = kind === "player"
    ? cell.source === "user"
    : cell.source === "group:" + name;
  $("celleffect").value = decidedHere
    ? (cell.allowed || cell.self || cell.conditional ? "allow" : "deny") : "inherit";
  // A cell decided here may still carry no rule, and `undefined` printed
  // into the box became the first half of whatever got typed next.
  $("cellwhere").value = (decidedHere && cell.where) || "";
  // Its own date, not a blank one — reopening a dated grant showed nothing and
  // saving from there would have quietly dropped the date.
  $("celluntil").value = (decidedHere && cell.until_stamp) || "";
  renderCellFields(node);
  attachSuggest($("cellwhere"), constraintSuggestions(node));
  openDialog("celldialog");
}

// A 32-hex id names nobody. Whenever something knows the person behind one —
// the simulator, or a live server's player list — say the name and keep the id
// for the tooltip.
function nameOf(id) {
  const simulated = simPlayers.find((p) => p.id === id);
  if (simulated) return simulated.name;
  const live = livePlayers.find((p) => p.id === id);
  if (live && live.name) return live.name;
  return null;
}

function shortId(id) {
  return nameOf(id) || (id.length > 12 ? id.slice(0, 8) + "…" : id);
}

// The same, but keeping the id visible when there is room for both.
function personLabel(id) {
  const name = nameOf(id);
  return name ? name + " · " + id.slice(0, 8) + "…" : id;
}

// What this call actually carries, so a constraint is written against the
// arguments rather than guessed at. Each one is a button: clicking it puts the
// field into the box, joined with `and` if a clause is already there.
function renderCellFields(node) {
  const host = $("cellfields");
  host.textContent = "";
  const fields = constraintFields(node);
  const words = (lastCommands || []).filter((c) => c.node === node).map((c) => c.word);

  const lead = document.createElement("span");
  lead.textContent = fields.length
    ? (words.length ? words.join(", ") + " carries:" : "This call carries:")
    : "This call carries no fields, so a constraint on it can never hold.";
  host.appendChild(lead);
  if (!fields.length) return;

  const list = document.createElement("ul");
  list.className = "chips fieldchips";
  for (const field of fields) {
    const item = document.createElement("li");
    const button = document.createElement("button");
    button.type = "button";
    button.className = "linklike";
    button.textContent = field.name;
    button.title = "Add `" + field.name + "` to the constraint";
    button.onclick = () => insertField(field.name);
    item.appendChild(button);
    const kind = document.createElement("span");
    kind.textContent = field.hint;
    item.appendChild(kind);
    list.appendChild(item);
  }
  host.appendChild(list);
}

function insertField(name) {
  const box = $("cellwhere");
  const text = box.value.trim();
  box.value = text === "" ? "where " + name + " "
    : /\b(and|or|where)$/.test(text) ? text + " " + name + " "
    : text + " and " + name + " ";
  box.focus();
  box.setSelectionRange(box.value.length, box.value.length);
  box.dispatchEvent(new Event("input"));
}

// ── the player lens ──────────────────────────────────────────────────────────

// The simulator's actor list, and nothing else — the player table is how you
// reach somebody this config names, so a second dropdown saying the same names
// was a row of controls doing what a click already did.
function fillLensPick() {
  renderSimActors();
}

// One simulated player needs no chooser: there is nothing to choose. None at
// all needs neither the chooser nor the row it sits in.
function renderSimActors() {
  const actor = $("simactor");
  actor.textContent = "";
  for (const player of simPlayers) {
    const option = document.createElement("option");
    option.value = player.id;
    option.textContent = player.name;
    actor.appendChild(option);
  }
  actor.classList.toggle("hidden", simPlayers.length < 2);
  $("simrunrow").classList.toggle("hidden", simPlayers.length === 0);
  $("simnobody").classList.toggle("hidden", simPlayers.length > 0);
  $("simone").textContent = simPlayers.length === 1 ? "as " + simPlayers[0].name : "";
  $("simone").classList.toggle("hidden", simPlayers.length !== 1);
}

function runLens() {
  const id = lastLensId;
  if (!id) return;
  const reply = ask("lens", { player: id });

  const groups = reply.groups.map((g) => g.name + " (" + g.weight + ")").join(", ");
  $("lenswho").textContent = reply.player
    + " — standing: " + reply.standing + " (" + reply.weight + ")"
    + " · groups: " + (groups || "none — the default group answers")
    + (reply.simulated ? " · simulated, never written to the config" : "");

  renderLensGroups(id, reply);

  const overrides = $("lensoverrides");
  overrides.textContent = "";
  overrides.classList.toggle("hidden", reply.overrides.length === 0);
  for (const entry of reply.overrides) {
    const item = document.createElement("li");
    item.textContent = "their own override: " + entry.effect + " " + entry.node
      + (entry.where ? " " + entry.where : "")
      + (entry.until_stamp ? " until " + entry.until_stamp : "");
    overrides.appendChild(item);
  }

  const table = $("lens");
  table.textContent = "";
  let section = null;
  for (const row of reply.rows) {
    const prefix = row.id.includes(".") ? row.id.split(".")[0] : row.id;
    if (prefix !== section) {
      section = prefix;
      const divider = table.insertRow();
      const cell = divider.insertCell();
      cell.colSpan = 3;
      cell.innerHTML = "<b>" + prefix + "</b>";
    }
    const line = table.insertRow();
    line.insertCell().textContent = row.id;
    const story = storyOf(row);
    const mark = line.insertCell();
    mark.className = "mark cell " + story.kind;
    mark.textContent = MARKS[story.kind].text;
    const tale = line.insertCell();
    tale.className = "tale";
    tale.textContent = story.line;
    line.style.cursor = "pointer";
    line.onclick = () => openCellEditor("player", id, row.id, row);
  }
}

// ── wiring ───────────────────────────────────────────────────────────────────

window.addEventListener("DOMContentLoaded", async () => {
  const manifest = window.PALLADIUM_STUDIO || { version: "?", capabilities: [] };
  $("version").textContent = "This page speaks Palladium " + manifest.version
    + " — a config from another version loads, with its unknown nodes listed as they are.";


  for (const button of document.querySelectorAll("#tabs button")) {
    button.addEventListener("click", () => {
      if (button.disabled) return;
      setTab(button.dataset.tab);
    });
  }
  for (const button of document.querySelectorAll("#permtabs button")) {
    button.addEventListener("click", () => setPermSub(button.dataset.sub));
  }
  for (const button of document.querySelectorAll("#agenttabs button")) {
    button.addEventListener("click", () => setAgentSub(button.dataset.agentsub));
  }
  $("cmdall").onclick = () => {
    $("cmdsearch").value = "";
    renderCommandList("");
    $("cmdall").classList.add("hidden");
  };
  $("matrixsearch").addEventListener("input", refreshMatrix);
  $("palrefresh").onclick = guarded(refreshWorldPals);
  $("statssave").onclick = guarded(saveStats);
  $("statsclose").onclick = () => $("statsdialog").close();
  setTab("commandpanel");

  await detectBackend();
  modeBanner();
  // The agent is a thing you can only look at when there is one running.
  $("agenttab").classList.toggle("hidden", !agentAvailable());

  const ready = await initEngine();
  if (!ready) return;

  // A signed-in panel origin opens straight onto the live server; everyone
  // else gets the load screen. A failed live load falls back to it too.
  if (backend.mode === "live" && backend.authenticated) {
    try {
      await liveLoad();
    } catch (error) {
      fatal("Could not load the live config: " + error.message);
    }
  }

  const dropzone = $("dropzone");
  dropzone.addEventListener("dragover", (event) => {
    event.preventDefault();
    dropzone.classList.add("hover");
  });
  dropzone.addEventListener("dragleave", () => dropzone.classList.remove("hover"));
  dropzone.addEventListener("drop", (event) => {
    event.preventDefault();
    dropzone.classList.remove("hover");
    loadDropped(event.dataTransfer);
  });
  $("filepick").addEventListener("change", (event) => loadFileList(event.target.files));
  $("modpick").addEventListener("change", (event) => loadFileList(event.target.files));
  for (const chip of Object.keys(DRAWERS)) {
    $(chip).addEventListener("click", () => toggleDrawer(DRAWERS[chip]));
  }
  $("loadchange").onclick = () => {
    $("loadsummary").classList.add("hidden");
    $("loadbody").classList.remove("hidden");
  };

  $("fresh").onclick = () => bootFrom([], {}, "a fresh server's defaults");
  $("loadpasted").onclick = () => {
    const text = $("paste").value;
    if (text.trim() !== "") bootFrom([{ name: "permissions.config", text }], {}, "pasted text");
  };

  // The command line suggests words that exist and players this config knows.
  attachSuggest($("simline"), (text, caret) => {
    const before = text.slice(0, caret);
    const token = (before.match(/[^\s]*$/) || [""])[0];
    if (token.startsWith("@")) {
      const wanted = token.slice(1).toLowerCase();
      const out = [{ label: "@me", hint: "yourself", insert: "@me" }];
      for (const player of knownPlayers()) {
        if (!wanted || player.name.toLowerCase().includes(wanted)) {
          out.push({ label: "@" + player.name, hint: player.note, insert: "@" + player.name });
        }
      }
      return out;
    }
    if (before.trim() === token) {
      // Matched anywhere after the `!`, because the list holds full names
      // (`!player.heal`) while people type the short one they know (`!heal`).
      const wanted = token.replace(/^!/, "").toLowerCase();
      return (lastCommands || [])
        .filter((c) => !wanted || c.word.slice(1).toLowerCase().includes(wanted))
        .map((c) => ({
          label: c.word,
          hint: c.help ? c.help.slice(0, 60) : (c.source + " · " + c.node),
          insert: c.word + " ",
        }));
    }
    return [];
  });

  attachSuggest($("pid"), (text) => {
    const wanted = text.trim().toLowerCase();
    return knownPlayers()
      .filter((p) => !wanted || p.name.toLowerCase().includes(wanted) || p.id.toLowerCase().startsWith(wanted))
      .map((p) => ({ label: p.name, hint: p.note + " · " + p.id.slice(0, 8) + "…", insert: p.id }));
  });
  // Groups the config actually has.
  attachSuggest($("simgroups"), (text, caret) => {
    const token = (text.slice(0, caret).match(/[^,\s]*$/) || [""])[0];
    return knownGroups().filter((g) => !token || g.label.startsWith(token));
  });

  $("cmdsearch").addEventListener("input", () => {
    renderCommandList($("cmdsearch").value);
    $("cmdall").classList.toggle("hidden", $("cmdsearch").value.trim() === "");
  });
  $("cmdshow").onclick = () => {
    if (!chosenCommand) return;
    const { target, params } = commandValues();
    // A mod's word is what a player types; a capability is the action itself.
    openShow(chosenCommand.kind === "capability"
      ? chosenCommand.node : chosenCommand.word.replace(/^!/, ""), target, params);
  };
  $("cmdrun").onclick = guarded(async () => {
    if (!chosenCommand) return;
    const { target, params } = commandValues();
    const out = $("cmdout");
    out.textContent = "";
    busy(true);
    await breathe();
    let result;
    try {
      result = await bridgeCall(chosenCommand.node, target, params);
    } finally {
      busy(false);
    }
    const line = document.createElement("p");
    line.className = result.ok === true ? "did" : "not";
    const bits = Object.entries(result.data || {})
      .filter(([, v]) => typeof v !== "object" && v !== "")
      .map(([k, v]) => k + "=" + v).join(" ");
    line.textContent = result.ok === true
      ? "ok" + (bits ? " · " + bits : "")
      : "failed — " + (result.error || "");
    out.appendChild(line);
  });

  $("stampoff").onclick = () => setStamp(null);
  $("stampallow").onclick = () => setStamp("allow");
  $("stampdeny").onclick = () => setStamp("deny");
  $("stampclear").onclick = () => setStamp("inherit");
  // Released anywhere: a drag that ends off the table still has to apply.
  document.addEventListener("mouseup", () => { void finishPaint(); });

  $("cellclose").onclick = () => $("celldialog").close();
  $("showclose").onclick = () => $("showdialog").close();
  $("cellapply").onclick = guarded(async () => {
    if (!editing) return;
    const effect = $("celleffect").value;
    const where = $("cellwhere").value.trim();
    const until_stamp = $("celluntil").value.trim();
    if (editing.kind === "player") {
      if (effect === "inherit") await edit("revoke", { player: editing.name, node: editing.node });
      else await edit("grant", { player: editing.name, node: editing.node, effect, where, until_stamp });
    } else {
      if (effect === "inherit") await edit("entry_remove", { group: editing.name, node: editing.node });
      else await edit("entry", { group: editing.name, node: editing.node, effect, where, until_stamp });
    }
    $("celldialog").close();
    if (editing.kind === "player") { showPlayer(editing.name); setPermSub("lenspanel"); }
  });

  $("simadd").onclick = guarded(() => {
    const name = $("simname").value.trim();
    if (name === "") return;
    const groups = $("simgroups").value.trim();
    const id = Array.from(crypto.getRandomValues(new Uint8Array(16)))
      .map((b) => b.toString(16).padStart(2, "0")).join("").toUpperCase();
    simPlayers.push({ id, name, groups });
    ask("player", { id, name, groups });
    $("simname").value = "";
    $("simgroups").value = "";
    renderSimPlayers();
  });

  $("simrun").onclick = guarded(() => {
    const actor = $("simactor").value;
    const line = $("simline").value;
    if (!actor || line.trim() === "") return;
    const reply = ask("simulate", { actor, line });
    const out = $("simout");
    out.textContent = "";
    const said = document.createElement("p");
    const who = simPlayers.find((p) => p.id === actor);
    said.className = "msg";
    said.textContent = (who ? who.name : actor) + ": " + line;
    out.appendChild(said);
    for (const message of reply.messages) {
      const line2 = document.createElement("p");
      line2.className = "msg";
      line2.textContent = "server → " + message.text;
      out.appendChild(line2);
    }
    const verdict = document.createElement("p");
    if (reply.executed) {
      const params = Object.entries(reply.executed.params)
        .map(([key, value]) => key + "=" + value).join(" ");
      verdict.className = "did";
      verdict.textContent = "executed " + reply.executed.action
        + " on " + reply.executed.target + (params ? " with " + params : "");
    } else if (!reply.handled) {
      verdict.className = "not";
      verdict.textContent = "plain chat — not a command";
    } else if (reply.messages.length > 0) {
      // A mod command that only talks back executed nothing on the engine —
      // its answer above is the whole outcome.
      verdict.className = "did";
      verdict.textContent = "the command answered";
    } else {
      verdict.className = "not";
      verdict.textContent = "nothing was executed";
    }
    out.appendChild(verdict);

    if (reply.executed) {
      const show = document.createElement("button");
      show.type = "button";
      show.className = "quiet";
      show.textContent = "Show";
      show.onclick = () => openShow(
        reply.executed.action, reply.executed.target, reply.executed.params);
      out.appendChild(show);

      if (backend.mode === "live" && backend.authenticated) {
        const run = document.createElement("button");
        run.type = "button";
        run.textContent = "Run on the server";
        run.onclick = guarded(async () => {
          run.disabled = true;
          const result = await bridgeCall(
            reply.executed.action, reply.executed.target, reply.executed.params);
          const done = document.createElement("p");
          done.className = result.ok === true ? "did" : "not";
          const bits = Object.entries(result.data || {})
            .filter(([, v]) => typeof v !== "object" && v !== "")
            .map(([k, v]) => k + "=" + v).join(" ");
          done.textContent = "server: " + (result.ok === true ? "ok" : "failed — " + (result.error || ""))
            + (bits ? " · " + bits : "");
          out.appendChild(done);
        });
        out.appendChild(run);
      }
    }
  });

  $("gnew").onclick = () => {
    $("gname").value = ""; $("gweight").value = ""; $("gtag").value = "";
    openDialog("groupdialog");
  };
  $("gclose").onclick = () => $("groupdialog").close();
  $("gsave").onclick = guarded(async () => {
    const name = $("gname").value.trim();
    if (name === "") return;
    await edit("group_new", {
      name,
      weight: $("gweight").value.trim() || "0",
      tag: $("gtag").value.trim(),
    });
    $("groupdialog").close();
  });
  $("pclose").onclick = () => $("memberdialog").close();
  $("passign").onclick = guarded(async () => {
    const player = $("pid").value.trim();
    if (player === "") return;
    const group = $("pid").dataset.group;
    expandedGroups.add(group);
    await edit("assign", { player, group });
    $("memberdialog").close();
  });
  $("lensclose").onclick = () => $("lensdetail").classList.add("hidden");

  // Every config the engine holds, not just the central one: a mod's nodes
  // live in its own folder, so downloading one file would drop an edit to any
  // of them. Each keeps the path it has to be written back to.
  $("download").onclick = guarded(() => {
    for (const file of changedFiles()) {
      const blob = new Blob([file.text], { type: "text/plain" });
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = file.name.replace(/[\\/]/g, "__");
      link.click();
      URL.revokeObjectURL(link.href);
    }
    // What was downloaded is now what they have, so it is the new baseline —
    // download twice in a row and the second one has nothing to write.
    rememberBaseline();
    unsaved = false;
    $("applybanner").classList.remove("dirty");
    refreshExport();
  });
  $("copy").onclick = guarded(() => {
    const files = changedFiles();
    copyText(files.length === 1
      ? files[0].text
      : files.map((f) => "; ── " + f.name + " ──\n" + f.text).join("\n\n"), $("copy"));
  });
});

function renderSimPlayers() {
  const list = $("simlist");
  list.textContent = "";
  for (const player of simPlayers) {
    const chip = document.createElement("li");
    chip.textContent = player.name + (player.groups ? " (" + player.groups + ")" : "");
    const remove = document.createElement("button");
    remove.type = "button";
    remove.textContent = "×";
    remove.onclick = () => {
      simPlayers = simPlayers.filter((p) => p.id !== player.id);
      ask("forget_players");
      for (const kept of simPlayers) {
        ask("player", { id: kept.id, name: kept.name, groups: kept.groups });
      }
      renderSimPlayers();
    };
    chip.appendChild(remove);
    list.appendChild(chip);

  }
  renderSimActors();
}

// ── the command reference ───────────────────────────────────────────────────

function renderCommandReference(wanted) {
  const table = $("commands");
  table.textContent = "";
  const head = table.insertRow();
  for (const title of ["command", "does", "parameters", "gated by", "from"]) {
    const cell = document.createElement("th");
    cell.textContent = title;
    head.appendChild(cell);
  }

  // Mods first: they are the ones an operator had to go looking for. Every row
  // reads the same whether it came from a mod or from Palladium itself.
  const rows = (lastCommands || [])
    .filter((c) => commandMatches(c, wanted))
    .sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === "mod" ? -1 : 1;
      return a.word < b.word ? -1 : a.word > b.word ? 1 : 0;
    });
  for (const command of rows) {
    const row = table.insertRow();
    const words = [command.word];
    for (const alias of aliasesOf(command)) words.push(alias);
    const name = row.insertCell();
    const pick = document.createElement("button");
    pick.type = "button";
    pick.className = "cmdchip cmdpick"
      + (chosenCommand && chosenCommand.word === command.word ? " on" : "");
    pick.textContent = command.word;
    if (words.length > 1) {
      const alias = document.createElement("span");
      alias.textContent = words.slice(1).join(" ");
      pick.appendChild(alias);
    }
    pick.title = "Open " + command.word + " as a form";
    pick.onclick = () => {
      chooseCommand(command, true);
      $("cmdform").scrollIntoView({ block: "nearest" });
    };
    name.appendChild(pick);

    const does = row.insertCell();
    does.textContent = helpFor(command) || "—";

    const params = row.insertCell();
    params.className = "params";
    const pieces = [];
    if (command.target === "player") pieces.push("<b>target</b> — a player: @me, @Name or an id");
    for (const p of command.params || []) {
      let piece = "<b>" + escapeHtml(p.name) + "</b>: " + escapeHtml(p.kind || "string");
      if (p.required) piece += ", required";
      if (p.min !== undefined || p.max !== undefined) {
        piece += ", " + (p.min ?? "") + "…" + (p.max ?? "");
      }
      if (p.default !== undefined) piece += ", = " + escapeHtml(String(p.default));
      pieces.push(piece);
    }
    if (!pieces.length && command.kind === "mod" && !command.declared) {
      pieces.push("<i>the mod parses its own arguments</i>");
    }
    params.innerHTML = pieces.join("<br>") || "—";

    row.insertCell().textContent = command.node || "none — open to everybody";
    row.insertCell().textContent = command.source || "—";
  }

  const note = $("cmdtablenote");
  const mods = rows.filter((c) => c.kind === "mod").length;
  note.textContent = rows.length + " command(s)"
    + (mods ? " — " + mods + " from loaded mods, " + (rows.length - mods) + " built in." : ".")
    + (wanted ? " Matching “" + wanted + "”." : "");
}

// One definition of a match, so the chips above and the table below never
// disagree about what the search box found.
function commandMatches(command, wanted) {
  if (!wanted) return true;
  return command.word.slice(1).toLowerCase().includes(wanted)
    || (helpFor(command) || "").toLowerCase().includes(wanted)
    || String(command.source || "").toLowerCase().includes(wanted);
}

// The engine reports a capability's word but not its prose; the manifest has
// the prose. Match them up rather than duplicating either.
function helpFor(command) {
  if (command.help) return command.help;
  const capability = ((window.PALLADIUM_STUDIO || {}).capabilities || []).find((c) => c.type === command.node);
  if (!capability) return "";
  return (capability.scope === "write" ? "✎ " : "") + capability.summary;
}

// A capability answers to its short name too, when nothing else claims it.
function aliasesOf(command) {
  if (command.kind !== "capability") return [];
  const short = String(command.node || "").split(/\.(.+)/)[1];
  if (!short) return [];
  const clashes = (lastCommands || []).filter(
    (c) => String(c.node || "").split(/\.(.+)/)[1] === short).length;
  return clashes === 1 ? ["!" + short] : [];
}

function escapeHtml(text) {
  return String(text).replace(/[&<>"]/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
}

// ── the agent, as it is running ──────────────────────────────────────────────
// Everything on this tab comes from the daemon's read-only bridge routes, so it
// only exists in live mode. Offline the tab button is not rendered at all.

let events = [];
let eventCursor = 0;
let eventFilter = new Set();
let agentTimer = null;
let worldPals = [];
let inspected = [];

function agentAvailable() {
  return backend.mode === "live" && backend.authenticated;
}

function startAgentPoll() {
  if (!agentAvailable() || agentTimer) return;
  pollEvents();
  agentTimer = setInterval(pollEvents, 2000);
}

function stopAgentPoll() {
  clearInterval(agentTimer);
  agentTimer = null;
}

async function pollEvents() {
  try {
    const reply = await api("GET", "/api/bridge/events?since=" + eventCursor + "&limit=500");
    eventCursor = reply.cursor ?? eventCursor;
    // The stream is for this run, and a run can be long — keep the tail.
    events = events.concat(reply.events || []).slice(-1000);
    renderEvents();
  } catch {
    // A dropped poll is not worth a banner; the next tick tries again.
  }
}

function renderEvents() {
  const types = [...new Set(events.map(chipOf))].sort();
  const chips = $("eventtypes");
  chips.textContent = "";
  const all = document.createElement("li");
  all.className = "chip" + (eventFilter.size ? "" : " on");
  all.textContent = "all";
  all.onclick = () => { eventFilter = new Set(); renderEvents(); };
  chips.appendChild(all);
  for (const type of types) {
    const chip = document.createElement("li");
    chip.className = "chip" + (eventFilter.has(type) ? " on" : "");
    chip.textContent = type;
    chip.onclick = () => {
      if (eventFilter.has(type)) eventFilter.delete(type); else eventFilter.add(type);
      renderEvents();
    };
    chips.appendChild(chip);
  }

  const shown = events.filter((e) => !eventFilter.size || eventFilter.has(chipOf(e)));
  $("eventcount").textContent = shown.length + " of " + events.length;
  const log = $("eventlog");
  const atBottom = log.scrollTop + log.clientHeight >= log.scrollHeight - 24;
  log.textContent = shown.length
    ? shown.map((e) => clock(e.at) + "  " + chipOf(e).padEnd(16) + "  " + summarise(e)).join("\n")
    : "Nothing on the stream yet.";
  if (atBottom) log.scrollTop = log.scrollHeight;
}

function chipOf(event) {
  return event.kind === "result" ? "result" : event.type;
}

function clock(at) {
  return new Date(at * 1000).toTimeString().slice(0, 8);
}

function seenAt(at) {
  return at ? new Date(at * 1000).toISOString().slice(0, 16).replace("T", " ") : "—";
}

// One line per event. An unknown type falls back to its raw fields, so a
// capability added to the manifest reads here before anyone writes a case.
function summarise(event) {
  const who = event.subject?.name ?? event.subject?.id ?? "";
  const data = event.data || {};
  if (event.kind === "result") {
    return event.type + " → " + (event.ok ? "ok" : "failed (" + (event.error ?? "") + ")")
      + " " + flatten(data);
  }
  switch (event.type) {
    case "player.chat": return who + ": " + data.message;
    case "player.join":
      return who + " joined" + (data.firstEver ? " — first time ever" : "")
        + " (join #" + (data.joins ?? "?") + ")";
    case "player.leave": return who + " left";
    case "player.respawn": return who + " respawned";
    case "player.death":
      return data.killer?.name ? who + " was killed by " + data.killer.name : who + " died";
    case "npc.spawn":
      return data.species + " lv" + data.level + (data.rare ? " (rare)" : "") + " spawned";
    case "bridge.ready": return data.agent + " v" + data.version + " loaded";
    case "bridge.hook": return data.hook + " — " + (data.ok ? "registered" : "failed");
    default: return (who + " " + flatten(data)).trim();
  }
}

function flatten(data) {
  return Object.entries(data)
    .map(([k, v]) => k + "=" + (typeof v === "object" && v !== null ? JSON.stringify(v) : v))
    .join(" ");
}

async function refreshHooks() {
  const schema = await api("GET", "/api/bridge/schema");
  $("agentlabel").textContent = schema.agent?.name
    ? schema.agent.name + " v" + schema.agent.version
    : "no agent has announced itself";
  const table = $("hooktable");
  table.textContent = "";
  const head = table.insertRow();
  for (const title of ["event", "source", "stability", "status"]) {
    const cell = document.createElement("th");
    cell.textContent = title;
    head.appendChild(cell);
  }
  for (const capability of schema.capabilities || []) {
    if (capability.kind !== "event") continue;
    const row = table.insertRow();
    row.insertCell().textContent = capability.type;
    row.insertCell().textContent = capability.source?.hook ?? capability.runtime;
    pill(row.insertCell(), capability.stability, capability.stability === "stable");
    pill(row.insertCell(), capability.live ? "live" : "not registered", !!capability.live);
  }
}

// The verbs that repeat down a table. Drawn rather than spelled, with the word
// itself kept as the label a screen reader reads and a hover shows.
const ICONS = {
  save: "M5 3h9l5 5v13H5z M9 3v6h6 M8 21v-6h8v6",
  reset: "M4 10a8 8 0 1 1 2 6 M4 5v5h5",
  add: "M12 5v14 M5 12h14",
  remove: "M5 12h14",
  trash: "M4 7h16 M9 7V4h6v3 M7 7l1 13h8l1-13",
  eye: "M3 12s4-7 9-7 9 7 9 7-4 7-9 7-9-7-9-7z M12 9.4a2.6 2.6 0 1 0 0 5.2 2.6 2.6 0 0 0 0-5.2z",
  chart: "M4 20V10 M10 20V4 M16 20v-7 M22 20H2",
};

function iconButton(name, label, tone) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "icon" + (tone ? " " + tone : "");
  button.title = label;
  button.setAttribute("aria-label", label);
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "1.8");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  for (const d of ICONS[name].split(" M")) {
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", d.startsWith("M") ? d : "M" + d);
    svg.appendChild(path);
  }
  button.appendChild(svg);
  return button;
}

function pill(cell, text, good) {
  const span = document.createElement("span");
  span.className = "pill " + (good ? "good" : "bad");
  span.textContent = text;
  cell.appendChild(span);
}

async function refreshPeople() {
  const reply = await api("GET", "/api/bridge/players");
  const players = reply.players || [];
  $("peoplecount").textContent = players.length + " known";
  const table = $("peopletable");
  table.textContent = "";
  const head = table.insertRow();
  for (const title of ["name", "user id", "joins", "first seen", "last seen", "tags", ""]) {
    const cell = document.createElement("th");
    cell.textContent = title;
    head.appendChild(cell);
  }
  if (!players.length) {
    const row = table.insertRow();
    const cell = row.insertCell();
    cell.colSpan = 7;
    cell.className = "fine";
    cell.textContent = "Nobody has connected while the bridge was running yet.";
    return;
  }
  for (const player of players) {
    const row = table.insertRow();
    const name = row.insertCell();
    name.textContent = player.name + " ";
    if (player.online) pill(name, "online", true);
    row.insertCell().textContent = player.userid;
    row.insertCell().textContent = player.joins;
    row.insertCell().textContent = seenAt(player.firstSeen);
    row.insertCell().textContent = seenAt(player.lastSeen);
    const tags = Object.entries(player.tags || {});
    row.insertCell().textContent = tags.length ? tags.map(([k, v]) => k + "=" + v).join(" ") : "—";
    const actions = row.insertCell();
    const stats = iconButton("chart", "Read and edit " + player.name + "'s stats");
    // Reading a stat means reaching into a live character, so an offline id
    // has nothing to read.
    stats.disabled = !player.online;
    stats.onclick = guarded(() => openStats("player", player.userid, player.name));
    actions.appendChild(stats);
  }
}

async function refreshWorldPals() {
  const table = $("paltable");
  table.textContent = "";
  $("palcount").textContent = "asking the server…";
  try {
    const reply = await bridgeCall("pal.list", null, {});
    worldPals = reply.data?.pals || [];
  } catch (error) {
    $("palcount").textContent = error.message;
    return;
  }
  $("palcount").textContent = worldPals.length + " loaded";
  const head = table.insertRow();
  for (const title of ["species", "level", "id", ""]) {
    const cell = document.createElement("th");
    cell.textContent = title;
    head.appendChild(cell);
  }
  for (const pal of worldPals) {
    const row = table.insertRow();
    const species = row.insertCell();
    species.textContent = pal.species + " ";
    if (pal.rare) pill(species, "rare", true);
    row.insertCell().textContent = pal.level;
    row.insertCell().textContent = pal.id || "—";
    const actions = row.insertCell();
    const look = iconButton("eye", "Inspect this pal");
    look.disabled = !pal.id;
    look.onclick = guarded(() => inspectPal(pal.id));
    actions.appendChild(look);
    const stats = iconButton("chart", "Read and edit this pal's stats");
    stats.disabled = !pal.id;
    stats.onclick = guarded(() => openStats("pal", pal.id, pal.species));
    actions.appendChild(stats);
  }
}

// Inspecting a wild pal and a spawned one side by side is how the difference
// between them gets found, so the rows accumulate rather than replace.
async function inspectPal(id) {
  const reply = await bridgeCall("pal.inspect", null, { pal: id });
  inspected = inspected.filter((r) => r.pal !== reply.data?.pal).concat(reply.data || []);
  const host = $("palinspect");
  host.textContent = "";
  if (!inspected.length) return;
  const note = document.createElement("p");
  note.className = "fine";
  note.textContent = "Inspect a wild pal and a spawned one — the row that differs is why one "
    + "fights back. A hate system that is present only means the machinery is there.";
  host.appendChild(note);
  const table = document.createElement("table");
  table.className = "plain";
  const head = table.insertRow();
  for (const title of ["pal", "controller", "owner", "otomo", "spawn type", "hate system"]) {
    const cell = document.createElement("th");
    cell.textContent = title;
    head.appendChild(cell);
  }
  for (const row of inspected) {
    const line = table.insertRow();
    line.insertCell().textContent = row.species;
    line.insertCell().textContent = row.controller;
    line.insertCell().textContent = row.owner;
    line.insertCell().textContent = row.isOtomo ? "yes" : "no";
    line.insertCell().textContent = row.spawnedType ?? "—";
    line.insertCell().textContent = row.hateSystem ? "present" : "none";
  }
  const wrap = document.createElement("div");
  wrap.className = "scroll";
  wrap.appendChild(table);
  host.appendChild(wrap);
}

// ── stats ────────────────────────────────────────────────────────────────────
// Reading a stat and writing it are two different capabilities, and a status
// point is spent rather than assigned, so this is a form of its own rather than
// one of the generated command forms.

const STAT_FIELDS = [
  { key: "hp", label: "HP", editable: true, hint: "absolute", only: "" },
  { key: "maxHp", label: "Max HP", editable: true, hint: "computed by the game", only: "" },
  { key: "hunger", label: "Hunger", editable: true, hint: "absolute", only: "" },
  { key: "maxHunger", label: "Max hunger", editable: false, hint: "", only: "" },
  { key: "shield", label: "Shield", editable: true, hint: "absolute", only: "" },
  { key: "maxShield", label: "Max shield", editable: true, hint: "absolute", only: "" },
  { key: "sanity", label: "Sanity", editable: false, hint: "", only: "" },
  { key: "level", label: "Level", editable: true, hint: "1-100", only: "" },
  { key: "rank", label: "Star rank", editable: true, hint: "1-5", only: "pal" },
  { key: "talentMelee", label: "Attack (melee IV)", editable: true, hint: "0-100", only: "pal" },
  { key: "talentShot", label: "Attack (ranged IV)", editable: true, hint: "0-100", only: "pal" },
  { key: "talentDefense", label: "Defense IV", editable: true, hint: "0-100", only: "pal" },
  { key: "talentHp", label: "HP IV", editable: true, hint: "0-100", only: "pal" },
  { key: "rankAttack", label: "Attack souls", editable: true, hint: "0-10", only: "pal" },
  { key: "rankDefence", label: "Defense souls", editable: true, hint: "0-10", only: "pal" },
  { key: "rankCraftSpeed", label: "Work speed souls", editable: true, hint: "0-10", only: "pal" },
  { key: "craftSpeed", label: "Work speed", editable: false, hint: "", only: "pal" },
];

let statsTarget = null;
let statsValues = {};

async function openStats(kind, id, name) {
  statsTarget = { kind, id, name };
  statsValues = {};
  $("statstitle").textContent = name + " — stats";
  $("statsresult").textContent = "reading…";
  $("statuspoints").textContent = "";
  renderStats();
  openDialog("statsdialog");
  try {
    const reply = kind === "player"
      ? await bridgeCall("player.stats", id, {})
      : await bridgeCall("pal.stats", null, { pal: id });
    statsValues = reply.data?.stats || {};
    $("statsresult").textContent = "";
  } catch (error) {
    $("statsresult").textContent = error.message;
  }
  renderStats();
  if (kind === "player") refreshStatusPoints(id);
}

function renderStats() {
  const table = $("statstable");
  table.textContent = "";
  const head = table.insertRow();
  for (const title of ["stat", "current", "set to"]) {
    const cell = document.createElement("th");
    cell.textContent = title;
    head.appendChild(cell);
  }
  for (const field of STAT_FIELDS) {
    if (field.only && field.only !== statsTarget?.kind) continue;
    const row = table.insertRow();
    row.insertCell().textContent = field.label;
    const value = statsValues[field.key];
    row.insertCell().textContent =
      value === null || value === undefined ? "—" : String(Math.round(value * 100) / 100);
    const set = row.insertCell();
    if (!field.editable) {
      set.className = "fine";
      set.textContent = "read-only";
      continue;
    }
    const input = document.createElement("input");
    input.type = "number";
    input.placeholder = field.hint;
    input.dataset.stat = field.key;
    set.appendChild(input);
  }
}

// With no reader for the spent counts on this build the names still come back,
// and a name is all it takes to spend on it — so the rows come from those.
async function refreshStatusPoints(id) {
  const host = $("statuspoints");
  host.textContent = "";
  const title = document.createElement("h3");
  title.textContent = "Status points";
  host.appendChild(title);
  const note = document.createElement("p");
  note.className = "fine";
  note.textContent = "What the game computes a player's max HP, stamina, attack and carry weight "
    + "from — the player equivalent of a pal's IVs. Points are spent, so these add.";
  host.appendChild(note);

  let points = {}, names = [];
  try {
    const reply = await bridgeCall("player.status_points", id, {});
    points = reply.data?.points || {};
    names = reply.data?.names || Object.keys(points);
  } catch (error) {
    // The error carries what the build does declare, which is the diagnostic.
    const failed = document.createElement("p");
    failed.className = "fine";
    failed.textContent = error.message;
    host.appendChild(failed);
    return;
  }
  const table = document.createElement("table");
  table.className = "plain";
  const head = table.insertRow();
  for (const label of ["stat", "spent", "add"]) {
    const cell = document.createElement("th");
    cell.textContent = label;
    head.appendChild(cell);
  }
  for (const name of names) {
    const row = table.insertRow();
    row.insertCell().textContent = name;
    row.insertCell().textContent = points[name] ?? "—";
    const actions = row.insertCell();
    actions.className = "actions";
    const input = document.createElement("input");
    input.type = "number";
    input.placeholder = "+";
    actions.appendChild(input);
    const spend = document.createElement("button");
    spend.type = "button";
    spend.textContent = "spend";
    spend.onclick = guarded(async () => {
      const amount = Number(input.value);
      if (!Number.isFinite(amount) || amount === 0) return;
      const reply = await bridgeCall("player.status_point", id, { stat: name, points: amount });
      $("statsresult").textContent = name + " → " + flatten(reply.data || {});
      input.value = "";
      refreshStatusPoints(id);
    });
    actions.appendChild(spend);
  }
  const wrap = document.createElement("div");
  wrap.className = "scroll";
  wrap.appendChild(table);
  host.appendChild(wrap);
}

async function saveStats() {
  if (!statsTarget) return;
  const data = {};
  for (const input of $("statstable").querySelectorAll("input[data-stat]")) {
    const raw = input.value.trim();
    if (raw === "") continue;
    const value = Number(raw);
    if (Number.isFinite(value)) data[input.dataset.stat] = value;
  }
  if (!Object.keys(data).length) {
    $("statsresult").textContent = "nothing to change";
    return;
  }
  busy(true);
  await breathe();
  let reply;
  try {
    reply = statsTarget.kind === "player"
      ? await bridgeCall("player.set_stats", statsTarget.id, data)
      : await bridgeCall("pal.set_stats", null, { pal: statsTarget.id, ...data });
  } finally {
    busy(false);
  }
  statsValues = reply.data?.stats || statsValues;
  $("statsresult").textContent = "saved — " + Object.keys(data).join(", ");
  renderStats();
}
