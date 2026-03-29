/**
 * ReADY Bot — MV3 service worker.
 * Orchestrates tab + MAIN-world automation. Text/intent logic lives here;
 * ElevenLabs can plug in at the side panel (voice → text) later.
 */
importScripts(
  "pipeline-debug.js",
  "constants.js",
  "form-profiles/residential-hall-room-maintenance.js"
);

/* global RESIDENTIAL_HALL_ROOM_MAINTENANCE */

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
    _building_set: false,
    _floor_set: false,
    _room_set: false,
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
async function execMain(tabId, method, argv = []) {
  pipelineLog("automation", "→ MAIN." + method, argv);
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
    await sleep(1000);
  }
  return false;
}

async function waitAfterNavigation(tabId) {
  await sleep(5000);
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
    await sleep(3000);
  }
  await sleep(2000);
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
    const r = await execMain(tabId, "setSelect2", ["locationPropertybldg", botSession.building]);
    if (r && r.found) {
      botSession._building_set = true;
      await sleep(2000);
    } else {
      botSession.building = null;
      botSession.step = "waiting_for_info";
      botSession.pending_question = "building";
      return;
    }
  }

  if (!botSession.floor) {
    botSession.step = "waiting_for_info";
    botSession.pending_question = "floor";
    pipelineLog("location", "pause → ask floor (voice follow-up)");
    return;
  }

  if (!botSession._floor_set) {
    const r = await execMain(tabId, "setSelect2", ["locationFloorflrId", botSession.floor]);
    if (r && r.found) {
      botSession._floor_set = true;
      await sleep(2000);
    } else {
      botSession.floor = null;
      botSession.step = "waiting_for_info";
      botSession.pending_question = "floor";
      return;
    }
  }

  if (!botSession.room) {
    botSession.step = "waiting_for_info";
    botSession.pending_question = "room";
    pipelineLog("location", "pause → ask room (voice follow-up)");
    return;
  }

  if (!botSession._room_set) {
    if (String(botSession.room).toLowerCase() === "skip") {
      botSession._room_set = true;
    } else {
      const r = await execMain(tabId, "setSelect2", ["locationLocationlocId", botSession.room]);
      if (r && r.found) {
        botSession._room_set = true;
        await sleep(1000);
      } else {
        botSession.room = null;
        botSession.step = "waiting_for_info";
        botSession.pending_question = "room";
        return;
      }
    }
  }

  if (mode === "standard") {
    await finishStandardForm(tabId);
  } else {
    await finishResidentialForm(tabId);
  }
}

async function finishStandardForm(tabId) {
  await execMain(tabId, "clickNext", []);
  await sleep(3000);

  const issue = (botSession.issue_text || "").toLowerCase();
  await execMain(tabId, "standardWorkDetailsCheckboxes", [issue]);
  await execMain(tabId, "typeBrief", ["comments", botSession.issue_text || ""]);
  await finishAutomation();
}

async function finishResidentialForm(tabId) {
  await execMain(tabId, "clickNext", []);
  await sleep(3000);
  await finishAutomation();
}

async function fillStandardForm(tabId) {
  botSession.step = "filling_form";
  await execMain(tabId, "standardAckAndContact", []);
  await handleLocationSetup(tabId, "standard");
}

async function fillResidentialForm(tabId) {
  botSession.step = "filling_form";
  await execMain(tabId, "residentialEmergencyNo", []);
  await execMain(tabId, "clickNext", []);
  await sleep(3000);

  const issue = (botSession.issue_text || "").toLowerCase();
  await execMain(tabId, "residentialWorkTypeRadios", [issue]);
  await execMain(tabId, "residentialSecondaryRadios", [issue]);
  await execMain(tabId, "typeBrief", ["brief", botSession.issue_text || ""]);
  await execMain(tabId, "clickNext", []);
  await sleep(3000);

  await execMain(tabId, "residentialLocationAck", []);
  await handleLocationSetup(tabId, "residential");
}

async function resumeStandardLocation(tabId) {
  botSession.step = "filling_form";
  await handleLocationSetup(tabId, "standard");
}

async function resumeResidentialLocation(tabId) {
  botSession.step = "filling_form";
  await handleLocationSetup(tabId, "residential");
}

async function runFillReadyForm(issueText) {
  pipelineGroup("pipeline", "runFillReadyForm");
  try {
    pipelineLog("intent", "issue text", issueText);
    lastStatusLogKey = "";
    resetSession();
    botSession.active = true;
    botSession.issue_text = issueText.trim();
    botSession.step = "filling_form";

    const [catId, catName] = matchCategory(botSession.issue_text);
    botSession.category_id = catId;
    botSession.category_name = catName;
    botSession.building = extractBuilding(botSession.issue_text);
    pipelineLog("intent", "category + building", {
      categoryId: catId,
      categoryName: catName,
      building: botSession.building,
    });

    const tab = await chrome.tabs.create({ url: READY_URL, active: true });
    botSession.tab_id = tab.id;
    pipelineLog("tab", "opened ReADY tab", { tabId: tab.id, url: READY_URL });

    pipelineLog("nav", "waitAfterNavigation (load / login)…");
    const ok = await waitAfterNavigation(tab.id);
    if (!ok && botSession.step === "error") {
      pipelineLog("nav", "aborted", botSession.error_message);
      return;
    }
    botSession.step = "filling_form";

    pipelineLog("flow", catId === RESIDENTIAL_CAT_ID ? "residential template" : "standard template");
    await execMain(tab.id, "clickTemplate", [catId]);
    await sleep(3000);

    if (catId === RESIDENTIAL_CAT_ID) {
      await fillResidentialForm(tab.id);
    } else {
      await fillStandardForm(tab.id);
    }
    pipelineLog("pipeline", "done (step=" + botSession.step + ")");
  } finally {
    pipelineGroupEnd();
  }
}

async function continueFormFill(answerText) {
  const raw = answerText.trim();
  const q = botSession.pending_question;
  pipelineLog("followup", "answer for " + q, raw);
  botSession.pending_question = null;
  botSession.step = "filling_form";

  if (q === "building") botSession.building = raw;
  else if (q === "floor") botSession.floor = raw;
  else if (q === "room") botSession.room = raw;

  const tabId = botSession.tab_id;
  if (!tabId) {
    botSession.step = "error";
    botSession.error_message = "Lost ReADY tab — start again.";
    return;
  }

  await sleep(500);

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
      });
    }
    const questionMap = {
      building: "🏢 What BUILDING is this issue in? (e.g., Stevenson Center, Rand Hall)",
      floor: "📐 What FLOOR? (e.g., First Floor, Basement)",
      room: "🚪 What ROOM NUMBER? (e.g., 101). Say skip if unknown.",
    };
    let question = null;
    if (waitingInfo) {
      question = questionMap[botSession.pending_question] || "Please provide more details.";
    } else if (waitingLogin) {
      question = "🔐 Sign in to Vanderbilt ReADY in the opened tab. Waiting for login…";
    }
    sendResponse({
      ...snapshotStatus(),
      question,
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
