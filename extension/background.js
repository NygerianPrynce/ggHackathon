/**
 * ReADY Bot — MV3 service worker.
 * Orchestrates tab + MAIN-world automation. Text/intent logic lives here;
 * ElevenLabs can plug in at the side panel (voice → text) later.
 */
importScripts(
  "pipeline-debug.js",
  "constants.js",
  "normalize-transcript.js",
  "form-profiles/residential-hall-room-maintenance.js",
  "residential-conversation.js",
  "openai-residential.js"
);
try {
  importScripts("openai-secrets.js");
} catch (_e) {
  /* optional: copy openai-secrets.example.js → openai-secrets.js */
}

/* global RESIDENTIAL_HALL_ROOM_MAINTENANCE residentialGetNext residentialFormatSpokenPrompt residentialFormatQuestion residentialParseAnswer normalizeSpokenNumbersToDigits residentialOpenAIExtract residentialSanitizeFieldUpdates stripVoicePanelText */

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** @type {Record<string, any>} */
let botSession = createEmptySession();

/** Dedupe GET_STATUS logging in the service worker console */
let lastStatusLogKey = "";

function createEmptySession() {
  return {
    active: false,
    tab_id: null,
    step: null,
    pending_question: null,
    issue_text: "",
    category_id: null,
    category_name: null,
    building: null,
    floor: null,
    room: null,
    error_message: null,
    _acknowledge_done: false,
    _building_set: false,
    _floor_set: false,
    _room_set: false,
    residential_page: 1,
    residential_answers: {},
    residential_active: false,
    residential_pending_field: null,
    residential_last_error: null,
    residential_conversation_turns: [],
    residential_agent_question: null,
    residential_dom_committed: {},
    conversation_first: false,
    residential_location_confirmed: false,
  };
}

function resetSession() {
  botSession = createEmptySession();
}

function snapshotStatus() {
  const step = botSession.step || "idle";
  let status = step;
  if (step === "waiting_for_info") status = "waiting";
  if (step === "waiting_for_login") status = "waiting";
  return {
    status,
    raw_step: step,
    question: null,
    question_type: botSession.pending_question,
    message: botSession.error_message,
    category_name: botSession.category_name,
  };
}

async function ensureMainWorld(tabId) {
  await chrome.scripting.executeScript({
    target: { tabId },
    world: "MAIN",
    files: ["ready-main-world.js"],
  });
}

/**
 * @param {number} tabId
 * @param {string} method
 * @param {any[]} argv
 */
/** Copy non-empty Review contact fields from the live DOM so we only ask for blanks. */
async function mergeResidentialContactFromDom(tabId) {
  const data = await execMain(tabId, "getResidentialContactFieldValues", []);
  if (!data || data.error) {
    pipelineLog("residential", "contact DOM read failed", data);
    return;
  }
  const keys = ["contactName", "contactNumber", "contactEmail"];
  for (const k of keys) {
    const row = data[k];
    if (!row || !row.present || row.empty) continue;
    if (botSession.residential_answers[k] == null) {
      botSession.residential_answers[k] = row.value;
      pipelineLog("residential", "Review field already filled in DOM — skipping prompt", {
        schemaKey: k,
        valueLen: row.value.length,
      });
    }
  }
}

function extractEmailFromIssueText(text) {
  const m = String(text || "").match(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/);
  return m ? m[0] : null;
}

/** Fill contact name/email from AI + heuristics so review only needs a phone prompt. */
async function autoFillReviewIdentityIfNeeded(tabId) {
  const a = botSession.residential_answers;
  const issue = botSession.issue_text || "";
  const exFn = typeof self !== "undefined" ? self.extractReviewNameEmail : null;
  let ex = null;
  if (typeof exFn === "function") {
    try {
      ex = await exFn(issue);
    } catch (_e) {
      ex = null;
    }
  }
  if (a.contactName == null || a.contactName === "") {
    let name = ex && ex.contactName;
    if (!name) name = "Student";
    a.contactName = name;
    await execMain(tabId, "setTextInputById", ["contactName", name]);
    pipelineLog("residential", "auto-filled contactName (review)", { len: name.length });
  }
  if (a.contactEmail == null || a.contactEmail === "") {
    let email = ex && ex.contactEmail;
    if (!email) email = extractEmailFromIssueText(issue);
    a.contactEmail = email || "";
    await execMain(tabId, "setTextInputById", ["contactEmail", a.contactEmail]);
    pipelineLog("residential", "auto-filled contactEmail (review)", { hasEmail: !!a.contactEmail });
  }
}

/** Log live DOM vs residential profile field (keyword-driven flow stays aligned with the page). */
async function logResidentialDomVsProfile(tabId, profileField) {
  const snap = await execMain(tabId, "getReADYFormSnapshot", []);
  if (!snap || snap.error) {
    pipelineLog("residential", "DOM snapshot error", snap);
    return snap;
  }
  pipelineLog("residential", "DOM snapshot (live page)", snap);
  if (!profileField || !profileField.schemaKey) return snap;
  const sk = profileField.schemaKey;
  const hasSchema = snap.schemaKeys && snap.schemaKeys.indexOf(sk) !== -1;
  const hasRadio = snap.radioGroups && snap.radioGroups[sk];
  const hasCb = snap.checkboxNames && snap.checkboxNames.indexOf(sk) !== -1;
  if (profileField.type === "radio" && !hasSchema && !hasRadio) {
    pipelineLog("residential", "WARN: profile radio not on page yet", {
      schemaKey: sk,
      schemaKeys: snap.schemaKeys,
      radioNames: Object.keys(snap.radioGroups || {}),
    });
  }
  if (profileField.type === "checkbox" && !hasSchema && !hasCb) {
    pipelineLog("residential", "WARN: profile checkbox group not on page yet", {
      schemaKey: sk,
      checkboxNames: snap.checkboxNames,
    });
  }
  const domId = profileField.domId || (profileField.type === "textarea" ? "brief" : null);
  if ((profileField.type === "textarea" || profileField.type === "text" || profileField.type === "date") && domId) {
    const ids = (snap.textareaIds || []).concat(snap.textInputIds || []);
    if (ids.indexOf(domId) === -1) {
      pipelineLog("residential", "WARN: profile input id not in DOM", { domId, ids });
    }
  }
  return snap;
}

async function execMain(tabId, method, argv = []) {
  pipelineLog("automation", "→ MAIN." + method, argv);
  const MAX_RETRIES = 3;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      await ensureMainWorld(tabId);
      const [injected] = await chrome.scripting.executeScript({
        target: { tabId },
        world: "MAIN",
        func: async (name, args) => {
          const api = window.__REBOT__;
          if (!api || typeof api[name] !== "function") {
            return { error: "REBOT API missing: " + name };
          }
          return api[name](...args);
        },
        args: [method, argv],
      });
      const out = injected?.result;
      pipelineLog("automation", "← MAIN." + method, out);
      return out;
    } catch (err) {
      const msg = err?.message || String(err);
      const isFrameGone = msg.includes("Frame with ID") || msg.includes("No frame with id") || msg.includes("Cannot access");
      if (isFrameGone && attempt < MAX_RETRIES - 1) {
        pipelineLog("automation", "frame gone, retrying after navigation settles", { attempt, method });
        await sleep(1200);
        continue;
      }
      throw err;
    }
  }
}

async function waitForTabUrl(tabId, timeoutMs = 120000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const tab = await chrome.tabs.get(tabId).catch(() => null);
    if (!tab?.url) {
      await sleep(300);
      continue;
    }
    const u = tab.url.toLowerCase();
    if (!u.includes("login") && !u.includes("cas")) {
      return true;
    }
    await sleep(650);
  }
  return false;
}

async function waitAfterNavigation(tabId) {
  await sleep(2200);
  const tab = await chrome.tabs.get(tabId).catch(() => null);
  const url = tab?.url || "";
  if (url.toLowerCase().includes("login") || url.toLowerCase().includes("cas")) {
    pipelineLog("nav", "CAS / login page — waiting for manual sign-in (up to 90s)…", url);
    botSession.step = "waiting_for_login";
    const ok = await waitForTabUrl(tabId, 90000);
    if (!ok) {
      botSession.step = "error";
      botSession.error_message = "Login timed out — sign in to ReADY and try again.";
      return false;
    }
    await sleep(1200);
  }
  await sleep(900);
  return true;
}

async function finishAutomation() {
  botSession.step = "done";
  botSession.active = false;
}

async function handleLocationSetup(tabId, mode) {
  const issue = botSession.issue_text || "";
  pipelineLog("location", "handleLocationSetup", {
    mode,
    building: botSession.building,
    floor: botSession.floor,
    room: botSession.room,
    flags: {
      _building_set: botSession._building_set,
      _floor_set: botSession._floor_set,
      _room_set: botSession._room_set,
    },
  });

  if (!botSession.building) {
    botSession.step = "waiting_for_info";
    botSession.pending_question = "building";
    pipelineLog("location", "pause → ask building (voice follow-up)");
    return;
  }

  if (!botSession._building_set) {
    // Give the location page a moment to fully render before trying the dropdown
    await sleep(1000);

    // Click the after-hours acknowledge checkbox if present (residential page 3)
    if (mode === "residential" && !botSession._acknowledge_done) {
      const ackResult = await execMain(tabId, "setAcknowledgeYes", []);
      pipelineLog("location", "acknowledge click", ackResult);
      botSession._acknowledge_done = true;
      if (ackResult && ackResult.ok) {
        botSession.residential_answers.acknowledge = "yes";
        await sleep(300);
      }
    }

    const deadline = Date.now() + 15000;
    let buildingSet = false;
    while (Date.now() < deadline) {
      const r = await execMain(tabId, "setSelect2", ["locationPropertybldg", botSession.building]);
      if (r && r.found) { buildingSet = true; break; }
      await sleep(600);
    }
    if (!buildingSet) {
      botSession.building = null;
      botSession.step = "waiting_for_info";
      botSession.pending_question = "building";
      return;
    }
    botSession._building_set = true;
    // After building selection, wait for the cascade to fire and floor options to populate
    await sleep(1500);
  }

  if (!botSession.floor) {
    botSession.step = "waiting_for_info";
    botSession.pending_question = "floor";
    pipelineLog("location", "pause → ask floor (voice follow-up)");
    return;
  }

  if (!botSession._floor_set) {
    const deadline = Date.now() + 15000;
    let floorSet = false;
    while (Date.now() < deadline) {
      await sleep(600);
      const r = await execMain(tabId, "setSelect2", ["locationFloorflrId", botSession.floor]);
      if (r && r.found) { floorSet = true; break; }
    }
    if (!floorSet) {
      pipelineLog("location", "floor dropdown never loaded — aborting");
      botSession.step = "error";
      botSession.error_message = "The floor dropdown didn't load. Please try again.";
      return;
    }
    botSession._floor_set = true;
  }

  if (!botSession.room) {
    botSession.step = "waiting_for_info";
    botSession.pending_question = "room";
    pipelineLog("location", "pause → ask room (voice follow-up)");
    return;
  }

  if (!botSession._room_set) {
    const deadline = Date.now() + 15000;
    let roomSet = false;
    while (Date.now() < deadline) {
      await sleep(600);
      const r = await execMain(tabId, "setSelect2", ["locationLocationlocId", botSession.room]);
      if (r && r.found) { roomSet = true; break; }
    }
    if (!roomSet) {
      pipelineLog("location", "room dropdown never loaded — aborting");
      botSession.step = "error";
      botSession.error_message = "The room dropdown didn't load. Please try again.";
      return;
    }
    botSession._room_set = true;
    await sleep(400);
  }

  if (mode === "standard") {
    await finishStandardForm(tabId);
  } else {
    await finishResidentialForm(tabId);
  }
}

async function finishStandardForm(tabId) {
  await execMain(tabId, "clickNext", []);
  await sleep(1300);

  const issue = (botSession.issue_text || "").toLowerCase();
  await execMain(tabId, "standardWorkDetailsCheckboxes", [issue]);
  await execMain(tabId, "typeBrief", ["comments", botSession.issue_text || ""]);
  await finishAutomation();
}

async function finishResidentialForm(tabId) {
  await execMain(tabId, "clickNext", []);
  await sleep(1300);
  botSession.residential_page = 4;
  botSession.residential_active = true;
  pipelineLog("residential", "location done → review / contact stage (page 4)");
  await promptResidentialStep(tabId);
}

async function fillStandardForm(tabId) {
  botSession.step = "filling_form";
  await execMain(tabId, "standardAckAndContact", []);
  await handleLocationSetup(tabId, "standard");
}

async function promptResidentialStep(tabId) {
  botSession.residential_last_error = null;
  if (botSession.residential_page === 4) {
    await mergeResidentialContactFromDom(tabId);
    await autoFillReviewIdentityIfNeeded(tabId);
  }
  const profile = RESIDENTIAL_HALL_ROOM_MAINTENANCE;
  const state = { page: botSession.residential_page, answers: botSession.residential_answers };
  let next = residentialGetNext(profile, state);
  pipelineLog("residential", "compute next step", {
    page: state.page,
    kind: next && next.kind,
    answersSnapshot: { ...botSession.residential_answers },
  });
  let guard = 0;
  while (next && next.kind === "advance" && guard++ < 6) {
    pipelineLog("residential", "form page complete → clicking Next", {
      fromPage: state.page,
      answersSnapshot: { ...botSession.residential_answers },
    });
    await commitPrefillToDom(tabId);
    await sleep(300);
    const promptClickResult = await execMain(tabId, "clickNext", []);
    if (!promptClickResult || promptClickResult.ok === false) {
      console.log("[READYBOT] promptResidentialStep clickNext FAILED on page", state.page);
      botSession.step = "error";
      botSession.error_message = "Could not advance the form. The ReADY tab may need a refresh.";
      return;
    }
    await sleep(1300);
    botSession.residential_page += 1;
    state.page = botSession.residential_page;
    if (state.page === 2) {
      pipelineLog("residential", "waiting for workType radios on page 2…");
      await execMain(tabId, "waitForRadioGroup", ["workType", 2, 20000]);
    }
    if (state.page === 3) {
      pipelineLog("residential", "waiting for acknowledge checkbox on page 3…");
      await execMain(tabId, "waitForRadioGroup", ["acknowledge", 1, 20000]);
    }
    next = residentialGetNext(profile, state);
    pipelineLog("residential", "after Next, next step", { page: state.page, kind: next && next.kind });
  }
  if (!next || !next.kind) {
    pipelineLog("residential", "invalid next from profile walker", next);
    botSession.step = "error";
    botSession.error_message = "Residential flow internal error (next step).";
    return;
  }
  if (next.kind === "handoff_location") {
    pipelineLog("residential", "profile form done → location (building / floor / room)", {
      answersSnapshot: { ...botSession.residential_answers },
    });
    botSession.residential_active = false;
    botSession.residential_pending_field = null;
    botSession.pending_question = null;
    botSession.step = "filling_form";
    await handleLocationSetup(tabId, "residential");
    return;
  }
  if (next.kind === "finished") {
    pipelineLog("residential", "flow finished", { answersSnapshot: { ...botSession.residential_answers } });
    await finishAutomation();
    return;
  }
  if (next.kind === "click_action") {
    pipelineLog("residential", "click UI action", { domId: next.domId, label: next.label });
    botSession.step = "filling_form";
    botSession.pending_question = null;
    botSession.residential_pending_field = null;
    // Commit any pre-filled contact fields (contactNumber etc.) before clicking Review
    await commitPrefillToDom(tabId);
    await sleep(800);
    const r = await execMain(tabId, "clickElementById", [next.domId]);
    if (!r || r.ok === false) {
      pipelineLog("residential", "click failed", r);
      botSession.step = "error";
      botSession.error_message =
        (r && r.error) || "Could not click the Review button — focus the ReADY tab and try again.";
      return;
    }
    await sleep(1300);
    botSession.residential_page += 1;
    await promptResidentialStep(tabId);
    return;
  }
  if (next.kind === "emergency_yes_hold") {
    pipelineLog("residential", "emergency=yes — staying on page 1 until user continues with non-emergency flow");
    const em = profile.stages[0].fields[0];
    botSession.step = "waiting_for_info";
    botSession.pending_question = "residential_field";
    botSession.residential_pending_field = em;
    botSession.residential_agent_question =
      "Okay, if this is a life-safety emergency, please call 911 or VUPD right away. " +
      "If it's not that urgent and you'd like to file a routine maintenance request instead, just say continue.";
    return;
  }
  if (next.kind === "field") {
    const f = next.field;
    await logResidentialDomVsProfile(tabId, f);
    pipelineLog("residential", "asking user (side panel)", {
      schemaKey: f && f.schemaKey,
      type: f && f.type,
      label: f && f.label,
      page: botSession.residential_page,
    });
    console.log("[READYBOT] 7. Asking question | field:", f && f.schemaKey, "| page:", botSession.residential_page, "| answeredSoFar:", JSON.stringify(botSession.residential_answers));
    botSession.step = "waiting_for_info";
    botSession.pending_question = "residential_field";
    botSession.residential_pending_field = next.field;
    return;
  }
  pipelineLog("residential", "unknown next.kind", next);
}

function appendResidentialConversation(role, content) {
  if (!botSession.residential_conversation_turns) botSession.residential_conversation_turns = [];
  botSession.residential_conversation_turns.push({
    role: role,
    content: String(content || "").slice(0, 4000),
  });
  if (botSession.residential_conversation_turns.length > 24) {
    botSession.residential_conversation_turns = botSession.residential_conversation_turns.slice(-24);
  }
}

function buildParsedFromAgentValue(field, val) {
  if (val == null) return null;
  if (field.type === "radio") {
    if (field.schemaKey === "surfaceDiscoloration" && String(val) === "") {
      return { ok: true, value: "__other__" };
    }
    return { ok: true, value: String(val) };
  }
  if (field.type === "checkbox") {
    const arr = Array.isArray(val)
      ? val
      : String(val)
          .split(/,|;/)
          .map((s) => s.trim())
          .filter(Boolean);
    return { ok: true, values: arr };
  }
  if (field.type === "textarea" || field.type === "text" || field.type === "date") {
    return { ok: true, value: String(val) };
  }
  return null;
}

function residentialSessionHasAnswerForField(f, answers) {
  if (!f || !answers) return false;
  if (f.type === "static") {
    return !!answers["__read_" + f.schemaKey];
  }
  const sk = f.schemaKey;
  const v = answers[sk];
  if (v === undefined || v === null) return false;
  if (f.schemaKey === "surfaceDiscoloration" && v === "") return true;
  if ((f.type === "text" || f.type === "textarea" || f.type === "date") && String(v).trim() === "") {
    return false;
  }
  return true;
}

/**
 * Commit all pre-filled session answers to the live DOM that haven't been written yet.
 * Called before clicking Next so the form's required-field validation passes.
 */
async function commitPrefillToDom(tabId) {
  const profile = RESIDENTIAL_HALL_ROOM_MAINTENANCE;
  const a = botSession.residential_answers;
  const committed = botSession.residential_dom_committed;
  const page = botSession.residential_page;
  const stages = profile.stages;
  if (page < 1 || page > stages.length) return;
  const stage = stages[page - 1];

  async function tryCommit(f) {
    if (!f || f.type === "static") return;
    const sk = f.schemaKey;
    if (committed[sk]) return;
    if (!residentialSessionHasAnswerForField(f, a)) return;
    const parsed = buildParsedFromAgentValue(f, a[sk]);
    if (!parsed) return;
    pipelineLog("residential", "commitPrefill → DOM", { schemaKey: sk, page });
    console.log("[READYBOT] commitPrefill writing to DOM:", sk, "=", a[sk]);
    await commitResidentialFieldAnswer(tabId, f, parsed, { skipPrompt: true });
    if (sk === "workType") {
      console.log("[READYBOT] workType selected, waiting for branch render...");
      await sleep(1000);
    }
  }

  for (const f of stage.fields || []) {
    await tryCommit(f);
  }

  if (page === 2) {
    const wt = a.workType;
    const branch = wt && stage.branches && stage.branches[wt];
    if (branch) {
      for (const f of branch.fields || []) {
        await tryCommit(f);
        if (f.schemaKey === "doorsWindowsBlinds" && a.doorsWindowsBlinds && branch.nested) {
          const nested = branch.nested[a.doorsWindowsBlinds];
          if (nested) {
            for (const nf of nested.fields || []) await tryCommit(nf);
          }
        }
      }
    }
    for (const f of stage.commonTail || []) {
      await tryCommit(f);
    }
  }

  if (page === 4) {
    // Contact fields — fill contactNumber (and name/email if present in session)
    const s4 = profile.stages[3];
    for (const f of s4.fields || []) {
      if (f.readonly || f.schemaKey === "workOrderDescription" || f.schemaKey === "woDescriptionForMapping") continue;
      if (f.schemaKey === "contactName" || f.schemaKey === "contactEmail" || f.schemaKey === "contactNumber") {
        await tryCommit(f);
      }
    }
  }
}

/**
 * Apply everything already in residential_answers to the live form (intake-first),
 * advancing pages until blocked or handoff.
 */
async function flushResidentialSessionToDom(tabId) {
  const profile = RESIDENTIAL_HALL_ROOM_MAINTENANCE;
  botSession.residential_last_error = null;
  let guard = 0;
  while (guard++ < 150) {
    if (botSession.residential_page === 4) {
      await mergeResidentialContactFromDom(tabId);
      await autoFillReviewIdentityIfNeeded(tabId);
    }
    const state = { page: botSession.residential_page, answers: botSession.residential_answers };
    let next = residentialGetNext(profile, state);
    let adv = 0;
    while (next && next.kind === "advance" && adv++ < 8) {
      // Commit any pre-filled answers to DOM before clicking Next
      await commitPrefillToDom(tabId);
      await sleep(300);
      pipelineLog("residential", "flush → Next (page complete)", { page: state.page });
      const clickResult = await execMain(tabId, "clickNext", []);
      if (!clickResult || clickResult.ok === false) {
        pipelineLog("residential", "flush: clickNext failed (required field not filled in DOM?)", { page: state.page });
        console.log("[READYBOT] clickNext FAILED on page", state.page, "-- stopping flush, prompting user");
        await promptResidentialStep(tabId);
        return;
      }
      await sleep(1300);
      botSession.residential_page += 1;
      state.page = botSession.residential_page;
      if (state.page === 2) {
        await execMain(tabId, "waitForRadioGroup", ["workType", 2, 20000]);
      }
      if (state.page === 3) {
        await execMain(tabId, "waitForRadioGroup", ["acknowledge", 1, 20000]);
      }
      next = residentialGetNext(profile, state);
    }

    if (!next || !next.kind) {
      pipelineLog("residential", "flush: invalid next", next);
      break;
    }
    if (next.kind === "handoff_location") {
      pipelineLog("residential", "flush → handoff_location");
      botSession.residential_active = false;
      botSession.residential_pending_field = null;
      botSession.pending_question = null;
      botSession.step = "filling_form";
      await handleLocationSetup(tabId, "residential");
      return;
    }
    if (next.kind === "finished") {
      await finishAutomation();
      return;
    }
    if (next.kind === "click_action" || next.kind === "emergency_yes_hold") {
      await promptResidentialStep(tabId);
      return;
    }
    if (next.kind === "field") {
      const f = next.field;
      const a = botSession.residential_answers;
      if (f.type === "static") {
        if (a["__read_" + f.schemaKey]) {
          continue;
        }
        await promptResidentialStep(tabId);
        return;
      }
      if (!residentialSessionHasAnswerForField(f, a)) {
        await promptResidentialStep(tabId);
        return;
      }
      const parsed = buildParsedFromAgentValue(f, a[f.schemaKey]);
      if (!parsed) {
        await promptResidentialStep(tabId);
        return;
      }
      const ok = await commitResidentialFieldAnswer(tabId, f, parsed, { skipPrompt: true });
      if (!ok) {
        await promptResidentialStep(tabId);
        return;
      }
      continue;
    }
    await promptResidentialStep(tabId);
    return;
  }
  await promptResidentialStep(tabId);
}

/**
 * @returns {Promise<boolean>} true if DOM + session updated successfully
 */
async function commitResidentialFieldAnswer(tabId, field, parsed, options) {
  const skipPrompt = options && options.skipPrompt;
  const a = botSession.residential_answers;
  const sk = field.schemaKey;

  if (sk === "acknowledge") {
    pipelineLog("residential", "DOM: setAcknowledgeYes");
    const r = await execMain(tabId, "setAcknowledgeYes", []);
    if (r && r.error) {
      pipelineLog("residential", "DOM error (acknowledge)", r);
      botSession.residential_last_error = r.error || "Could not check the acknowledge box — keep the ReADY tab focused.";
      if (!skipPrompt) botSession.step = "waiting_for_info";
      return false;
    }
    // ok: false means the checkbox wasn't present (business hours — no after-hours gate)
    a[sk] = "yes";
    pipelineLog("residential", "acknowledge OK → next step");
    if (!skipPrompt) {
      await sleep(380);
      await promptResidentialStep(tabId);
    }
    return true;
  }

  if (field.type === "radio") {
    let val = parsed.value;
    const domVal = sk === "surfaceDiscoloration" && val === "__other__" ? "__other__" : val;
    pipelineLog("residential", "DOM: setRadioNameValue", { name: sk, value: domVal });
    const r = await execMain(tabId, "setRadioNameValue", [sk, domVal]);
    if (!r || r.error || r.ok === false) {
      pipelineLog("residential", "DOM failed (radio)", r);
      botSession.residential_last_error =
        (r && r.error) ||
        "Could not select that option on the page. Focus the ReADY tab, then answer again.";
      if (!skipPrompt) botSession.step = "waiting_for_info";
      return false;
    }
    pipelineLog("residential", "radio OK", { schemaKey: sk, storedValue: val });
    if (sk === "surfaceDiscoloration" && val === "__other__") {
      a[sk] = "";
    } else {
      a[sk] = val;
    }
  } else if (field.type === "checkbox" && sk === "pestType") {
    pipelineLog("residential", "DOM: setCheckboxNameValues", { name: sk, values: parsed.values });
    const r = await execMain(tabId, "setCheckboxNameValues", [sk, parsed.values]);
    if (!r || r.error || r.ok === false) {
      pipelineLog("residential", "DOM failed (pest checkboxes)", r);
      botSession.residential_last_error = (r && r.error) || "Could not set pest checkboxes.";
      if (!skipPrompt) botSession.step = "waiting_for_info";
      return false;
    }
    a[sk] = parsed.values.join(",");
    pipelineLog("residential", "pest checkboxes OK", { stored: a[sk] });
  } else if (field.type === "textarea") {
    pipelineLog("residential", "DOM: typeBrief", { id: field.domId || "brief", len: (parsed.value || "").length });
    const r = await execMain(tabId, "typeBrief", [field.domId || "brief", parsed.value]);
    if (!r || r.error || r.filled !== true) {
      pipelineLog("residential", "DOM failed (brief)", r);
      botSession.residential_last_error = (r && r.error) || "Could not fill the description field.";
      if (!skipPrompt) botSession.step = "waiting_for_info";
      return false;
    }
    a[sk] = parsed.value;
    pipelineLog("residential", "brief OK");
  } else if (field.type === "text" || field.type === "date") {
    pipelineLog("residential", "DOM: setTextInputById", { id: field.domId });
    const r = await execMain(tabId, "setTextInputById", [field.domId, parsed.value]);
    if (!r || r.error || r.ok === false) {
      pipelineLog("residential", "DOM failed (text)", r);
      botSession.residential_last_error = (r && r.error) || "Could not fill that field.";
      if (!skipPrompt) botSession.step = "waiting_for_info";
      return false;
    }
    a[sk] = parsed.value;
    pipelineLog("residential", "text field OK", { schemaKey: sk });
  } else {
    return false;
  }

  // Track that this field has been written to DOM
  botSession.residential_dom_committed[sk] = true;

  if (!skipPrompt) {
    pipelineLog("residential", "answer applied → computing next question");
    await sleep(380);
    await promptResidentialStep(tabId);
  }
  return true;
}

async function applyResidentialBatchFromAgent(tabId, fieldUpdates) {
  const profile = RESIDENTIAL_HALL_ROOM_MAINTENANCE;
  const sanitizeFn = typeof residentialSanitizeFieldUpdates === "function" ? residentialSanitizeFieldUpdates : null;
  if (!sanitizeFn) {
    pipelineLog("residential", "intake: residentialSanitizeFieldUpdates missing", {});
    await promptResidentialStep(tabId);
    return;
  }
  const sanitized = sanitizeFn(profile, botSession.residential_answers, fieldUpdates);
  if (sanitized.dropped && sanitized.dropped.length) {
    pipelineLog("residential", "intake sanitize dropped", sanitized.dropped);
  }
  botSession.residential_answers = sanitized.merged;
  botSession.residential_last_error = null;
  await flushResidentialSessionToDom(tabId);
}

async function applyResidentialAnswer(tabId, raw) {
  const field = botSession.residential_pending_field;
  if (!field) {
    pipelineLog("residential", "applyResidentialAnswer: no pending field", {});
    return;
  }

  const normalized = normalizeSpokenNumbersToDigits(String(raw || "").trim());
  console.log("[READYBOT] 8. Answer received | field:", field && field.schemaKey, "| answer:", normalized);
  appendResidentialConversation("user", normalized);
  botSession.residential_agent_question = null;

  await logResidentialDomVsProfile(tabId, field);

  let domSnap = null;
  try {
    domSnap = await execMain(tabId, "getReADYFormSnapshot", []);
  } catch (_e) {
    domSnap = null;
  }

  const extractFn = typeof self !== "undefined" ? self.residentialOpenAIExtract : null;
  const agent =
    typeof extractFn === "function" && botSession.category_id === RESIDENTIAL_CAT_ID
      ? await extractFn({
          userText: normalized,
          issueText: botSession.issue_text,
          answers: Object.assign({}, botSession.residential_answers),
          page: botSession.residential_page,
          pendingField: field,
          domSnapshot: domSnap,
          conversation: botSession.residential_conversation_turns || [],
        })
      : null;

  console.log("[READYBOT] 9. OpenAI agent result:", JSON.stringify(agent));
  if (agent && agent.fieldUpdates && Object.keys(agent.fieldUpdates).length > 0) {
    botSession.residential_last_error = null;
    if (agent.followUpQuestion) {
      botSession.residential_agent_question = agent.followUpQuestion;
    }
    appendResidentialConversation("assistant", agent.followUpQuestion || "Recorded that in the form.");
    let fu = agent.fieldUpdates;
    if (botSession.residential_page === 1 && fu) {
      const e = fu.emergency;
      fu = e != null ? { emergency: e } : {};
      if (!Object.keys(fu).length) {
        pipelineLog("residential", "page 1 — ignoring non-emergency fieldUpdates from model", agent.fieldUpdates);
      }
    }
    pipelineLog("residential", "OpenAI agent fieldUpdates", fu);
    if (Object.keys(fu).length) {
      await applyResidentialBatchFromAgent(tabId, fu);
    } else {
      botSession.step = "waiting_for_info";
      await promptResidentialStep(tabId);
    }
    return;
  }

  if (agent && agent.followUpQuestion) {
    botSession.residential_agent_question = agent.followUpQuestion;
  }

  pipelineLog("residential", "user answered (keyword path)", {
    schemaKey: field.schemaKey,
    type: field.type,
    raw: normalized,
  });
  const parsed = residentialParseAnswer(
    normalized,
    field,
    botSession.residential_answers,
    botSession.issue_text
  );
  if (!parsed.ok) {
    pipelineLog("residential", "parse failed (say again)", { error: parsed.error, schemaKey: field.schemaKey });
    botSession.residential_last_error = parsed.error;
    botSession.step = "waiting_for_info";
    return;
  }
  pipelineLog("residential", "parsed OK", {
    schemaKey: field.schemaKey,
    parsed: { ...parsed, values: parsed.values },
  });
  botSession.residential_last_error = null;
  const a = botSession.residential_answers;

  if (parsed.flagKey) {
    a[parsed.flagKey] = "yes";
    pipelineLog("residential", "static notice acknowledged", { flagKey: parsed.flagKey });
    await sleep(260);
    await promptResidentialStep(tabId);
    return;
  }

  await commitResidentialFieldAnswer(tabId, field, parsed, { skipPrompt: false });
}

async function fillResidentialForm(tabId) {
  botSession.step = "filling_form";
  botSession.residential_active = true;
  botSession.residential_page = 1;
  botSession.residential_answers = {};
  botSession.residential_pending_field = null;
  botSession.residential_last_error = null;
  pipelineLog("residential", "waiting for emergency radios in DOM…");

  console.log("[READYBOT] 4. fillResidentialForm started | issue:", botSession.issue_text);
  // Kick off LLM intake bootstrap in parallel while form loads — pre-fill everything except emergency
  const bootstrapFn = typeof self !== "undefined" ? self.residentialOpenAIIntakeBootstrap : null;
  const bootstrapPromise =
    typeof bootstrapFn === "function"
      ? bootstrapFn(botSession.issue_text).catch(() => null)
      : Promise.resolve(null);

  const ready = await execMain(tabId, "waitForRadioGroup", ["emergency", 2, 25000]);
  if (!ready || ready.ok === false) {
    pipelineLog("residential", "emergency radios never appeared", ready);
    botSession.step = "error";
    botSession.error_message =
      "Residential form did not load in time (emergency question). Focus the ReADY tab and try again.";
    botSession.active = false;
    return;
  }
  pipelineLog("residential", "emergency radios ready", { count: ready.count });

  // Apply bootstrap results — skip emergency (always ask for safety)
  const bootstrap = await bootstrapPromise;
  if (bootstrap && bootstrap.fieldUpdates && Object.keys(bootstrap.fieldUpdates).length) {
    const updates = Object.assign({}, bootstrap.fieldUpdates);
    delete updates.emergency;
    // Never pre-fill brief -- always ask so user gives proper detail
    delete updates.brief;
    if (Object.keys(updates).length) {
      pipelineLog("residential", "intake bootstrap pre-fill", updates);
      const sanitized = residentialSanitizeFieldUpdates(RESIDENTIAL_HALL_ROOM_MAINTENANCE, {}, updates);
      if (sanitized.dropped && sanitized.dropped.length) {
        pipelineLog("residential", "bootstrap dropped", sanitized.dropped);
      }
      botSession.residential_answers = sanitized.merged;
      pipelineLog("residential", "pre-filled from issue text", { ...botSession.residential_answers });
      console.log("[READYBOT] 6. Pre-filled answers:", JSON.stringify(botSession.residential_answers));
    }
  }

  await logResidentialDomVsProfile(tabId, { schemaKey: "emergency", type: "radio" });
  // Hard rule: first voice step is always "Is this an emergency?" — emergency never auto-filled
  await promptResidentialStep(tabId);
}

async function resumeStandardLocation(tabId) {
  botSession.step = "filling_form";
  await handleLocationSetup(tabId, "standard");
}

async function resumeResidentialLocation(tabId) {
  botSession.step = "filling_form";
  await handleLocationSetup(tabId, "residential");
}

// ═══════════════════════════════════════════════════════════════════════════
// CONVERSATION-FIRST ARCHITECTURE
// Phase 1: collect all info through conversation (no form open)
// Phase 2: open form and fill everything in one sequential sweep
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Advance through completed pages without touching the DOM, then ask
 * the user for the next thing we need. When everything is collected,
 * kick off startFillPhase().
 */
/**
 * Set a question using the LLM to vary phrasing. Falls back to baseText immediately
 * so the side panel always has something to show even before the LLM responds.
 */
async function setQuestion(baseText) {
  // Don't set residential_agent_question until LLM responds — avoids flicker
  // where the side panel briefly shows the base text then snaps to the varied version.
  const fn = typeof self !== "undefined" ? self.generateVariedQuestion : null;
  if (typeof fn === "function") {
    const isEmergencyField = botSession.residential_pending_field && botSession.residential_pending_field.schemaKey === "emergency";
    const varied = await fn(baseText, botSession.issue_text, { noUrgency: !isEmergencyField }).catch(() => null);
    botSession.residential_agent_question = (varied && varied.length > 0) ? varied : baseText;
  } else {
    botSession.residential_agent_question = baseText;
  }
  // Only flip to waiting_for_info now that the question is ready
  botSession.step = "waiting_for_info";
}

async function promptNextConversationStep() {
  const profile = RESIDENTIAL_HALL_ROOM_MAINTENANCE;
  botSession.step = "filling_form";
  botSession.residential_agent_question = null;
  botSession.residential_last_error = null;

  // If we haven't confirmed this is a residential issue, ask first
  if (!botSession.residential_location_confirmed) {
    botSession.pending_question = "confirm_residential";
    await setQuestion("Quick question — is this happening in your residential space, like a dorm room or campus apartment, or somewhere else on campus?");
    return;
  }

  let guard = 0;
  while (guard++ < 10) {
    const state = { page: botSession.residential_page, answers: botSession.residential_answers };
    const next = residentialGetNext(profile, state);
    if (!next) break;

    if (next.kind === "advance") {
      // This page is fully answered in session — advance counter (no DOM click needed)
      botSession.residential_page += 1;
      continue;
    }
    if (next.kind === "emergency_yes_hold") {
      botSession.pending_question = "residential_field";
      botSession.residential_pending_field = profile.stages[0].fields[0];
      await setQuestion(
        "If this is a real emergency, please call 911 or VUPD right away. " +
        "Otherwise just say continue and we'll file a routine maintenance request."
      );
      return;
    }
    if (next.kind === "field") {
      botSession.pending_question = "residential_field";
      botSession.residential_pending_field = next.field;
      const baseQ = residentialFormatSpokenPrompt(
        next.field,
        botSession.issue_text,
        typeof RESIDENTIAL_HALL_ROOM_MAINTENANCE !== "undefined" ? RESIDENTIAL_HALL_ROOM_MAINTENANCE : null
      );
      await setQuestion(baseQ);
      return;
    }
    if (next.kind === "handoff_location") {
      // Form fields done — now collect location
      if (!botSession.building) {
        botSession.pending_question = "building";
        await setQuestion("Which building is this in?");
        return;
      }
      if (!botSession.floor) {
        botSession.pending_question = "floor";
        await setQuestion("And which floor?");
        return;
      }
      if (!botSession.room) {
        botSession.pending_question = "room";
        await setQuestion("What's the room number?");
        return;
      }
      // Location done — jump to page 4 for contact number
      botSession.residential_page = 4;
      continue;
    }
    if (next.kind === "click_action" || next.kind === "finished") {
      // Everything collected — start filling the form
      await startFillPhase();
      return;
    }
    break;
  }

  // Fallback
  await startFillPhase();
}

/**
 * Handle a user answer during conversation-first mode.
 * Only updates session — no DOM writes.
 */
async function handleConversationAnswer(raw) {
  const field = botSession.residential_pending_field;
  const q = botSession.pending_question;
  const normalized = normalizeSpokenNumbersToDigits(raw);
  appendResidentialConversation("user", normalized);
  botSession.step = "filling_form";
  botSession.residential_agent_question = null;
  console.log("[READYBOT] conversation answer | q:", q, "| field:", field && field.schemaKey, "| text:", normalized);

  // ── Emergency field: bypass OpenAI, use direct keyword match ─────────────
  if (q === "residential_field" && field && field.schemaKey === "emergency") {
    const lower = normalized.toLowerCase();
    const isYes = lower.includes("yes") || lower.includes("yeah") || lower.includes("yep") ||
      lower.includes("yup") || lower.includes("emergency") ||
      lower.includes("it is");
    const isNo = lower.includes("no") || lower.includes("nope") || lower.includes("not") ||
      lower.includes("nah") || lower.includes("routine") || lower.includes("not urgent") ||
      lower.includes("non-urgent") || lower.includes("not an emergency");
    // isNo wins if both match (e.g. "no it's not urgent" hits "urgent" for yes but "no"/"not" for no)
    if (isNo || isYes) {
      botSession.residential_answers.emergency = isNo ? "no" : "yes";
      botSession.pending_question = null;
      await promptNextConversationStep();
      return;
    }
  }

  // ── Emergency yes-hold: user says "continue" to proceed as non-emergency ──
  if (q === "residential_field" && field && field.schemaKey === "emergency" &&
      botSession.residential_answers.emergency === "yes") {
    const lower = normalized.toLowerCase();
    const wantsContinue = lower.includes("continue") || lower.includes("proceed") ||
      lower.includes("not an emergency") || lower.includes("routine") ||
      lower.includes("never mind") || lower.includes("no") || lower.includes("cancel");
    if (wantsContinue) {
      botSession.residential_answers.emergency = "no";
      botSession.pending_question = null;
      await promptNextConversationStep();
      return;
    }
  }

  // ── Residential location confirmation ───────────────────────────────────
  if (q === "confirm_residential") {
    const lower = normalized.toLowerCase();
    const confirmed = lower.includes("yes") || lower.includes("yeah") ||
      lower.includes("yep") || lower.includes("correct") ||
      lower.includes("dorm") || lower.includes("room") ||
      lower.includes("hall") || lower.includes("apartment") ||
      lower.includes("suite") || lower.includes("it is") ||
      lower.includes("uh huh") || lower.includes("yup");
    if (confirmed) {
      botSession.residential_location_confirmed = true;
      botSession.pending_question = null;
      await promptNextConversationStep();
    } else {
      // Not a residential issue — let the user know we can only handle residential requests this way
      botSession.step = "error";
      botSession.error_message =
        "Got it! For non-residential issues, please visit ready.app.vanderbilt.edu and submit a request directly.";
    }
    return;
  }

  // ── Location answers ────────────────────────────────────────────────────
  if (q === "building" || q === "floor" || q === "floor_retry" || q === "room" || q === "room_retry") {
    const fn = typeof self !== "undefined" ? self.normalizeLocationUtterance : null;
    let norm = normalized;
    if (typeof fn === "function") {
      const r = await fn(q, normalized).catch(() => null);
      if (r && r.value) norm = r.value;
    }
    if ((q === "room" || q === "room_retry") && /^\s*skip\s*$/i.test(norm)) norm = "";
    if (q === "building") botSession.building = norm;
    else if (q === "floor" || q === "floor_retry") botSession.floor = norm;
    else if (q === "room" || q === "room_retry") botSession.room = norm;
    botSession.pending_question = null;
    await promptNextConversationStep();
    return;
  }

  // ── Form field answers — try OpenAI first, keyword fallback second ───────
  const extractFn = typeof self !== "undefined" ? self.residentialOpenAIExtract : null;
  const agent = typeof extractFn === "function"
    ? await extractFn({
        userText: normalized,
        issueText: botSession.issue_text,
        answers: Object.assign({}, botSession.residential_answers),
        page: botSession.residential_page || 1,
        pendingField: field,
        domSnapshot: null,
        conversation: botSession.residential_conversation_turns || [],
      }).catch(() => null)
    : null;

  console.log("[READYBOT] OpenAI result:", JSON.stringify(agent));

  if (agent && agent.fieldUpdates && Object.keys(agent.fieldUpdates).length) {
    if (agent.followUpQuestion) {
      botSession.residential_agent_question = stripVoicePanelText(agent.followUpQuestion);
      appendResidentialConversation("assistant", agent.followUpQuestion);
    }
    let fu = agent.fieldUpdates;
    // Page 1 safety: only allow emergency field on page 1
    if ((botSession.residential_page || 1) === 1 && fu) {
      const e = fu.emergency;
      fu = e != null ? { emergency: e } : {};
    }
    if (Object.keys(fu).length) {
      const sanitized = residentialSanitizeFieldUpdates(RESIDENTIAL_HALL_ROOM_MAINTENANCE, botSession.residential_answers, fu);
      botSession.residential_answers = sanitized.merged;
      console.log("[READYBOT] session answers now:", JSON.stringify(botSession.residential_answers));
    }
    await promptNextConversationStep();
    return;
  }

  if (agent && agent.followUpQuestion) {
    botSession.residential_agent_question = stripVoicePanelText(agent.followUpQuestion);
  }

  // Keyword fallback
  if (field) {
    const parsed = residentialParseAnswer(normalized, field, botSession.residential_answers, botSession.issue_text);
    if (parsed.ok) {
      const a = botSession.residential_answers;
      if (parsed.flagKey) {
        a[parsed.flagKey] = "yes";
      } else if (field.type === "radio") {
        a[field.schemaKey] = parsed.value;
      } else if (field.type === "checkbox") {
        a[field.schemaKey] = parsed.values.join(",");
      } else {
        a[field.schemaKey] = parsed.value;
      }
      botSession.residential_last_error = null;
      await promptNextConversationStep();
    } else {
      botSession.residential_last_error = parsed.error;
      botSession.step = "waiting_for_info";
    }
  } else {
    await promptNextConversationStep();
  }
}

/**
 * All info collected. Open the ReADY form and fill everything in one sweep.
 */
async function startFillPhase() {
  pipelineLog("residential", "conversation complete — starting fill phase");
  console.log("[READYBOT] FILL PHASE START | answers:", JSON.stringify(botSession.residential_answers));
  console.log("[READYBOT] location:", botSession.building, botSession.floor, botSession.room);

  botSession.conversation_first = false;
  botSession.step = "filling_form";
  botSession.residential_page = 1;
  botSession.residential_dom_committed = {};

  const tab = await chrome.tabs.create({ url: READY_URL, active: true });
  botSession.tab_id = tab.id;
  pipelineLog("tab", "opened ReADY tab for fill phase", { tabId: tab.id });

  const ok = await waitAfterNavigation(tab.id);
  if (!ok && botSession.step === "error") return;
  botSession.step = "filling_form";

  await execMain(tab.id, "clickTemplate", [RESIDENTIAL_CAT_ID]);

  // Page 1 — poll until emergency radios appear (no fixed sleep needed)
  const ready = await execMain(tab.id, "waitForRadioGroup", ["emergency", 2, 25000]);
  if (!ready || ready.ok === false) {
    botSession.step = "error";
    botSession.error_message = "Form did not load (emergency page). Reload the ReADY tab and try again.";
    return;
  }

  await commitPrefillToDom(tab.id);  // commits emergency
  const p1 = await execMain(tab.id, "clickNext", []);
  if (!p1 || !p1.ok) {
    botSession.step = "error";
    botSession.error_message = "Could not advance past page 1. Make sure emergency is answered.";
    return;
  }
  // Poll until workType radios appear — no fixed sleep
  botSession.residential_page = 2;
  await execMain(tab.id, "waitForRadioGroup", ["workType", 2, 20000]);

  // Page 2 — commit workType + branch fields + brief
  await commitPrefillToDom(tab.id);
  const p2 = await execMain(tab.id, "clickNext", []);
  if (!p2 || !p2.ok) {
    botSession.step = "error";
    botSession.error_message = "Could not advance past page 2. Some required fields may be missing.";
    return;
  }
  botSession.residential_page = 3;

  botSession._acknowledge_done = false;
  botSession._building_set = false;
  botSession._floor_set = false;
  botSession._room_set = false;
  // handleLocationSetup clicks Next to page 4 when done, then calls finishResidentialForm
  await handleLocationSetup(tab.id, "residential");
}

async function openAndFillStandardForm(catId) {
  const tab = await chrome.tabs.create({ url: READY_URL, active: true });
  botSession.tab_id = tab.id;
  pipelineLog("tab", "opened ReADY tab", { tabId: tab.id, url: READY_URL });
  pipelineLog("nav", "waitAfterNavigation (load / login)…");
  const ok = await waitAfterNavigation(tab.id);
  if (!ok && botSession.step === "error") return;
  botSession.step = "filling_form";
  await execMain(tab.id, "clickTemplate", [catId]);
  await sleep(1200);
  await fillStandardForm(tab.id);
}

async function runFillReadyForm(issueText) {
  pipelineGroup("pipeline", "runFillReadyForm");
  try {
    pipelineLog("intent", "issue text", issueText);
    lastStatusLogKey = "";
    resetSession();
    botSession.active = true;
    botSession.issue_text = normalizeSpokenNumbersToDigits(issueText.trim());
    botSession.step = "filling_form";
    console.log("[READYBOT] 1. RUN_BOT received:", botSession.issue_text);

    const [catId, catName] = matchCategory(botSession.issue_text);
    botSession.category_id = catId;
    botSession.category_name = catName;
    if (catId === RESIDENTIAL_CAT_ID) {
      // Pre-extract building from initial message — saves one round-trip if user already said it
      botSession.building = extractBuilding(botSession.issue_text);
      botSession.floor = null;
      botSession.room = null;
      botSession._acknowledge_done = false;
      botSession._building_set = false;
      botSession._floor_set = false;
      botSession._room_set = false;
      botSession.residential_conversation_turns = [{ role: "user", content: botSession.issue_text }];
    } else {
      botSession.building = extractBuilding(botSession.issue_text);
    }
    pipelineLog("intent", "category + building", {
      categoryId: catId,
      categoryName: catName,
      building: botSession.building,
    });
    console.log("[READYBOT] 2. Category matched:", catName, "| id:", catId, "| building:", botSession.building);
    console.log("[READYBOT]    Is residential?", catId === RESIDENTIAL_CAT_ID);

    if (catId === RESIDENTIAL_CAT_ID) {
      // ── Conversation-first: collect everything before opening the form ──
      botSession.conversation_first = true;
      botSession.residential_page = 1;
      // Mark confirmed if the user explicitly said dorm/room/apartment in their message
      const tl = botSession.issue_text.toLowerCase();
      botSession.residential_location_confirmed = (
        tl.includes("my room") || tl.includes("in my room") ||
        tl.includes("my dorm") || tl.includes("in my dorm") ||
        tl.includes("dorm room") || tl.includes("residence hall") ||
        tl.includes("my apartment") || tl.includes("in my apartment") ||
        tl.includes("my suite") || tl.includes("my hall")
      );

      // Run LLM intake bootstrap to pre-fill what we can from the first message
      const bootstrapFn = typeof self !== "undefined" ? self.residentialOpenAIIntakeBootstrap : null;
      if (typeof bootstrapFn === "function") {
        const bootstrap = await bootstrapFn(botSession.issue_text).catch(() => null);
        console.log("[READYBOT] bootstrap:", JSON.stringify(bootstrap));
        if (bootstrap && bootstrap.fieldUpdates) {
          const updates = Object.assign({}, bootstrap.fieldUpdates);
          delete updates.emergency; // always ask
          delete updates.brief;     // always ask for detail
          const sanitized = residentialSanitizeFieldUpdates(RESIDENTIAL_HALL_ROOM_MAINTENANCE, {}, updates);
          botSession.residential_answers = sanitized.merged;
          console.log("[READYBOT] pre-filled from bootstrap:", JSON.stringify(botSession.residential_answers));
        }
      }

      await promptNextConversationStep();
    } else {
      // Categories where the issue might be in a dorm room — ask before routing
      const POSSIBLY_RESIDENTIAL = new Set([
        "LatFPA6SkypytJAKY",  // Electrical
        "phf3HbLdpD6eDhYko",  // Plumbing Fixtures
        "DqBtyxFmaj4FNJNFZ",  // Temperature/HVAC
        "yZu5BcaGKbGTLDMei",  // Pest Control
        "zqmrxp5aZxTf6jbem",  // Leaks/Gas Leaks
        "ou4Zow2YbimZytRSr",  // Elevator
      ]);
      const tl = botSession.issue_text.toLowerCase();
      const alreadySaidLocation = (
        tl.includes("my room") || tl.includes("in my room") ||
        tl.includes("my dorm") || tl.includes("in my dorm") ||
        tl.includes("dorm room") || tl.includes("residence hall") ||
        tl.includes("my apartment") || tl.includes("in my apartment") ||
        tl.includes("my suite") || tl.includes("my hall") ||
        tl.includes("building") || tl.includes("lab") || tl.includes("library") ||
        tl.includes("office") || tl.includes("classroom") || tl.includes("gym") ||
        tl.includes("outside") || tl.includes("hallway") || tl.includes("bathroom")
      );

      if (POSSIBLY_RESIDENTIAL.has(catId) && !alreadySaidLocation) {
        // Ask before opening any form
        botSession.conversation_first = false; // not residential mode yet
        botSession.pending_question = "confirm_residential_or_standard";
        await setQuestion("Quick question — is this happening in your residential space, like a dorm room or campus apartment, or somewhere else on campus like a classroom or common building?");
        return;
      }

      // Standard form: open tab immediately (existing flow)
      botSession.conversation_first = false;
      await openAndFillStandardForm(catId);
    }
    pipelineLog("pipeline", "done (step=" + botSession.step + ")");
  } finally {
    pipelineGroupEnd();
  }
}

async function continueFormFill(answerText) {
  const raw = normalizeSpokenNumbersToDigits(String(answerText || "").trim());
  const q = botSession.pending_question;
  pipelineLog("followup", "answer for " + q, raw);

  // ── Residential-or-standard routing question ─────────────────────────────
  if (q === "confirm_residential_or_standard") {
    const lower = raw.toLowerCase();
    const isResidential = lower.includes("yes") || lower.includes("yeah") ||
      lower.includes("yep") || lower.includes("yup") || lower.includes("correct") ||
      lower.includes("dorm") || lower.includes("room") || lower.includes("hall") ||
      lower.includes("apartment") || lower.includes("suite") ||
      lower.includes("it is") || lower.includes("uh huh");
    botSession.pending_question = null;
    if (isResidential) {
      // Switch to residential conversation-first flow
      botSession.conversation_first = true;
      botSession.category_id = RESIDENTIAL_CAT_ID;
      botSession.category_name = "Residential Hall Room Maintenance Issue";
      botSession.residential_page = 1;
      botSession.residential_location_confirmed = true;
      botSession.residential_conversation_turns = [{ role: "user", content: botSession.issue_text }];
      // Run bootstrap to pre-fill what the original issue text told us
      const bootstrapFn = typeof self !== "undefined" ? self.residentialOpenAIIntakeBootstrap : null;
      if (typeof bootstrapFn === "function") {
        const bootstrap = await bootstrapFn(botSession.issue_text).catch(() => null);
        if (bootstrap && bootstrap.fieldUpdates) {
          const updates = Object.assign({}, bootstrap.fieldUpdates);
          delete updates.emergency;
          delete updates.brief;
          const sanitized = residentialSanitizeFieldUpdates(RESIDENTIAL_HALL_ROOM_MAINTENANCE, {}, updates);
          botSession.residential_answers = sanitized.merged;
        }
      }
      await promptNextConversationStep();
    } else {
      // Proceed with the originally matched standard category
      await openAndFillStandardForm(botSession.category_id);
    }
    return;
  }

  // ── Conversation-first mode: no tab open yet ──────────────────────────────
  if (botSession.conversation_first) {
    await handleConversationAnswer(raw);
    return;
  }

  const tabId = botSession.tab_id;
  if (!tabId) {
    botSession.step = "error";
    botSession.error_message = "Lost ReADY tab — start again.";
    return;
  }

  if (q === "residential_field") {
    pipelineLog("residential", "follow-up → applyResidentialAnswer", { raw });
    await applyResidentialAnswer(tabId, raw);
    return;
  }

  botSession.pending_question = null;
  botSession.step = "filling_form";

  let norm = raw;
  if (q === "building" || q === "floor" || q === "room") {
    const fn = typeof self !== "undefined" ? self.normalizeLocationUtterance : null;
    if (typeof fn === "function") {
      try {
        const r = await fn(q, raw);
        if (r && r.value != null && String(r.value).trim().length) {
          norm = String(r.value).trim();
        }
      } catch (_e) {
        /* keep norm = raw */
      }
    }
    if ((q === "room" || q === "room_retry") && /^\s*skip\s*$/i.test(norm)) {
      norm = "";
    }
  }

  if (q === "building") botSession.building = norm;
  else if (q === "floor" || q === "floor_retry") botSession.floor = norm;
  else if (q === "room" || q === "room_retry") botSession.room = norm;

  await sleep(280);

  if (botSession.category_id === RESIDENTIAL_CAT_ID) {
    await resumeResidentialLocation(tabId);
  } else {
    await resumeStandardLocation(tabId);
  }
}

chrome.runtime.onInstalled.addListener(() => {
  if (chrome.sidePanel?.setPanelBehavior) {
    chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
  }
});

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === "GET_STATUS") {
    const waitingInfo = botSession.step === "waiting_for_info" && botSession.pending_question;
    const waitingLogin = botSession.step === "waiting_for_login";
    const statusKey = [botSession.step, botSession.pending_question, botSession.error_message || ""].join("|");
    if (statusKey !== lastStatusLogKey) {
      lastStatusLogKey = statusKey;
      pipelineLog("poll", "state changed", {
        step: botSession.step,
        pending: botSession.pending_question,
        category: botSession.category_name,
        residentialPage: botSession.residential_page,
        residentialField: botSession.residential_pending_field && botSession.residential_pending_field.schemaKey,
      });
    }
    const questionMap = {
      building: "Which building is this in?",
      floor: "And which floor?",
      floor_retry: "Sorry about that — just need to confirm the floor number one more time.",
      room: "What's the room number?",
      room_retry: "And the room number again — just need to confirm that one.",
      confirm_residential: "Quick question — is this in your residential space, like a dorm room or campus apartment, or is it somewhere else on campus?",
      confirm_residential_or_standard: "Quick question — is this happening in your residential space, like a dorm room or campus apartment, or is it somewhere else on campus like a classroom or common building?",
    };
    let question = null;
    if (waitingInfo) {
      // Always prefer the pre-generated (LLM-varied) question if available
      if (botSession.residential_agent_question) {
        question = stripVoicePanelText(botSession.residential_agent_question);
      } else {
        question = questionMap[botSession.pending_question] || "Could you give me a bit more detail on that?";
      }
      if (botSession.residential_last_error) {
        question =
          "That did not stick. " +
          stripVoicePanelText(botSession.residential_last_error) +
          (question ? " " + question : "");
      }
    } else if (waitingLogin) {
      question = "Sign in to ReADY in the tab that opened. I will continue once you are logged in.";
    }
    // Show a helpful message while the bot is filling the form
    if (!question && botSession.step === "filling_form" && !botSession.conversation_first) {
      question = null; // side panel shows its own "Working on the form..." spinner
    }
    if (question != null && typeof question === "string") {
      question = stripVoicePanelText(question);
    }
    const pendingSchemaKey = botSession.residential_pending_field && botSession.residential_pending_field.schemaKey;
    sendResponse({
      ...snapshotStatus(),
      question,
      isContactNumberQuestion: pendingSchemaKey === "contactNumber",
    });
    return true;
  }

  if (msg.type === "RUN_BOT") {
    const issue = (msg.issue || "").trim();
    if (!issue) {
      sendResponse({ ok: false, error: "No issue text." });
      return true;
    }
    pipelineLog("message", "RUN_BOT received", issue);
    runFillReadyForm(issue).catch((e) => {
      console.error(e);
      botSession.step = "error";
      botSession.error_message = String(e?.message || e);
      botSession.active = false;
    });
    sendResponse({ ok: true, message: "Started ReADY bot" });
    return true;
  }

  if (msg.type === "GET_RESIDENTIAL_FORM_PROFILE") {
    sendResponse({
      ok: true,
      profile:
        typeof RESIDENTIAL_HALL_ROOM_MAINTENANCE !== "undefined"
          ? RESIDENTIAL_HALL_ROOM_MAINTENANCE
          : null,
    });
    return true;
  }

  if (msg.type === "ANSWER_FOLLOWUP") {
    const text = (msg.text || "").trim();
    if (!text) {
      sendResponse({ ok: false, error: "Empty answer." });
      return true;
    }
    pipelineLog("message", "ANSWER_FOLLOWUP", text);
    continueFormFill(text).catch((e) => {
      console.error(e);
      botSession.step = "error";
      botSession.error_message = String(e?.message || e);
    });
    sendResponse({ ok: true });
    return true;
  }

  return false;
});
