/**
 * Runs in the page MAIN world (jQuery / Select2 / React available).
 * Loaded via chrome.scripting.executeScript({ files, world: "MAIN" }).
 */
(function () {
  "use strict";

  var REBOT_DOM_DEBUG = true;
  function domLog(name, detail) {
    if (!REBOT_DOM_DEBUG) return;
    console.log("%c[ReADY Bot][DOM]", "color:#4ECDC4;font-weight:600", name, detail !== undefined ? detail : "");
  }

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  function clearResult() {
    const prev = document.getElementById("__readybot_result");
    if (prev) prev.remove();
  }

  async function clickTemplate(catId) {
    domLog("clickTemplate", catId);
    const btn = document.getElementById(catId);
    if (btn) {
      btn.scrollIntoView({ behavior: "smooth", block: "center" });
      btn.style.outline = "3px solid #CFAE70";
      await sleep(600);
      btn.click();
    }
    return { ok: !!btn };
  }

  async function standardAckAndContact() {
    domLog("standardAckAndContact");
    const ack = document.querySelector("input[name=aknowledge]");
    if (ack && !ack.checked) ack.click();
    await sleep(500);
    const radios = document.querySelectorAll("input[name=alternateContactYN]");
    if (radios.length > 0) radios[0].click();
    await sleep(500);
    return { ok: true };
  }

  async function residentialEmergencyNo() {
    domLog("residentialEmergencyNo");
    const radios = document.querySelectorAll("input[name=emergency]");
    if (radios.length > 1) radios[1].click();
    await sleep(500);
    return { ok: true };
  }

  async function residentialWorkTypeRadios(issueLower) {
    domLog("residentialWorkTypeRadios");
    const text = issueLower;
    const radios = document.querySelectorAll("input[name=workType]");
    let idx = 0;
    if (
      text.includes("heat") || text.includes("air") || text.includes("filter") ||
      text.includes("cold") || text.includes("hot") || text.includes("temperature")
    ) {
      idx = 4;
    } else if (text.includes("light") || text.includes("electri") || text.includes("power")) {
      idx = 6;
    } else if (text.includes("pest") || text.includes("bug") || text.includes("roach")) {
      idx = 7;
    } else if (
      text.includes("plumb") || text.includes("water") || text.includes("sink") ||
      text.includes("toilet") || text.includes("leak")
    ) {
      idx = 8;
    }
    if (radios.length > idx) radios[idx].click();
    await sleep(1000);
    return { ok: true };
  }

  async function residentialSecondaryRadios(issueLower) {
    domLog("residentialSecondaryRadios");
    const text = issueLower;
    const heatRadios = document.querySelectorAll("input[name=heatAir]");
    if (heatRadios.length > 0) {
      if (text.includes("hot") || text.includes("warm")) heatRadios[0].click();
      else if (text.includes("cold") || text.includes("freez")) heatRadios[1].click();
      else heatRadios[3].click();
    }
    const pwRadios = document.querySelectorAll("input[name=plumbingWater]");
    if (pwRadios.length > 0) {
      if (text.includes("toilet")) pwRadios[0].click();
      else if (text.includes("sink")) pwRadios[1].click();
      else if (text.includes("shower")) pwRadios[2].click();
      else pwRadios[0].click();
    }
    await sleep(1000);
    return { ok: true };
  }

  async function residentialLocationAck() {
    domLog("residentialLocationAck");
    const ack = document.querySelector("input[name=acknowledge]");
    if (ack && !ack.checked) ack.click();
    await sleep(500);
    return { ok: true };
  }

  async function standardWorkDetailsCheckboxes(issueLower) {
    domLog("standardWorkDetailsCheckboxes");
    const text = issueLower;
    const checkboxes = document.querySelectorAll("input[name=problem]");
    checkboxes.forEach((cb) => {
      const label = cb.parentElement ? cb.parentElement.textContent.trim().toLowerCase() : "";
      if ((text.includes("hot") || text.includes("warm") || text.includes("heat")) && label.includes("too hot")) cb.click();
      if ((text.includes("cold") || text.includes("freez") || text.includes("cool")) && label.includes("too cold")) cb.click();
      if (text.includes("leak") && label.includes("leak")) cb.click();
      if (text.includes("thermostat") && label.includes("thermostat")) cb.click();
      if (text.includes("noise") && label.includes("noise")) cb.click();
      if ((text.includes("exhaust") || text.includes("fan")) && label.includes("exhaust")) cb.click();
      if ((text.includes("filter") || text.includes("vent")) && label.includes("exhaust")) cb.click();
    });
    await sleep(1000);
    return { ok: true };
  }

  async function clickNext() {
    domLog("clickNext", "requestScreenNext");
    const btn = document.getElementById("requestScreenNext");
    if (btn) {
      btn.style.outline = "3px solid #CFAE70";
      await sleep(500);
      btn.click();
    }
    return { ok: !!btn };
  }

  async function setSelect2(elementId, searchTerm) {
    domLog("setSelect2", { elementId, searchTerm });
    clearResult();
    const $ = window.jQuery;
    if (!$) {
      return { found: false, error: "jQuery missing" };
    }
    const sel = $(document.getElementById(elementId));
    if (!sel.length) {
      return { found: false, error: "element not found" };
    }
    sel.select2("open");
    await sleep(500);
    const sf = $(".select2-search__field");
    if (sf.length) {
      sf.val(searchTerm).trigger("input");
    }
    await sleep(2500);
    let found = false;
    const results = $(".select2-results__option");
    results.each(function () {
      const txt = $(this).text().trim().toLowerCase();
      if (txt !== "no results found" && txt !== "searching…" && txt !== "loading…" && !found) {
        $(this).trigger("mouseup");
        found = true;
      }
    });
    const el = document.createElement("div");
    el.id = "__readybot_result";
    el.style.display = "none";
    el.textContent = JSON.stringify({ found, count: results.length });
    document.body.appendChild(el);
    return { found, count: results.length };
  }

  async function typeBrief(elementId, text) {
    domLog("typeBrief", { elementId, len: (text || "").length });
    clearResult();
    const ta = document.getElementById(elementId);
    if (!ta) return { filled: false };

    ta.scrollIntoView({ behavior: "smooth", block: "center" });
    ta.style.outline = "3px solid #CFAE70";
    ta.style.outlineOffset = "2px";
    ta.focus();
    ta.value = "";

    await new Promise((resolve) => {
      const full = text;
      let i = 0;
      const tick = () => {
        ta.value = full.substring(0, i + 1);
        Object.keys(ta).forEach((k) => {
          if (k.startsWith("__react") && ta[k] && ta[k].onChange) {
            ta[k].onChange({ target: ta });
          }
        });
        ta.dispatchEvent(new Event("input", { bubbles: true }));
        i++;
        if (i >= full.length) {
          ta.dispatchEvent(new Event("change", { bubbles: true }));
          const done = document.createElement("div");
          done.id = "__readybot_result";
          done.style.display = "none";
          done.textContent = JSON.stringify({ filled: true });
          document.body.appendChild(done);
          resolve();
        } else {
          setTimeout(tick, 40);
        }
      };
      tick();
    });

    return { filled: true };
  }

  window.__REBOT__ = {
    clickTemplate,
    standardAckAndContact,
    residentialEmergencyNo,
    residentialWorkTypeRadios,
    residentialSecondaryRadios,
    residentialLocationAck,
    standardWorkDetailsCheckboxes,
    clickNext,
    setSelect2,
    typeBrief,
  };
})();
