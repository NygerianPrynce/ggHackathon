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
      await sleep(320);
      btn.click();
    }
    return { ok: !!btn };
  }

  async function standardAckAndContact() {
    domLog("standardAckAndContact");
    const ack = document.querySelector("input[name=aknowledge]");
    if (ack && !ack.checked) ack.click();
    await sleep(280);
    const radios = document.querySelectorAll("input[name=alternateContactYN]");
    if (radios.length > 0) radios[0].click();
    await sleep(280);
    return { ok: true };
  }

  async function residentialEmergencyNo() {
    domLog("residentialEmergencyNo");
    const radios = document.querySelectorAll("input[name=emergency]");
    if (radios.length > 1) radios[1].click();
    await sleep(280);
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
    await sleep(550);
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
    await sleep(550);
    return { ok: true };
  }

  async function residentialLocationAck() {
    domLog("residentialLocationAck");
    const ack = document.querySelector("input[name=acknowledge]");
    if (ack && !ack.checked) ack.click();
    await sleep(280);
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
    await sleep(550);
    return { ok: true };
  }

  async function clickElementById(elementId) {
    domLog("clickElementById", elementId);
    // Poll up to 4s — React may briefly unmount the button after field updates
    const deadline = Date.now() + 4000;
    let el = null;
    while (Date.now() < deadline) {
      el = document.getElementById(elementId);
      if (el) break;
      await sleep(200);
    }
    if (!el) {
      return { ok: false, error: "not found: " + elementId };
    }
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    await sleep(220);
    el.click();
    return { ok: true };
  }

  async function clickNext() {
    domLog("clickNext", "requestScreenNext");
    // Wait up to 4s for the Next button — React may temporarily unmount it during re-renders
    const deadline = Date.now() + 4000;
    let btn = null;
    while (Date.now() < deadline) {
      btn = document.getElementById("requestScreenNext");
      if (btn) break;
      await sleep(200);
    }
    if (btn) {
      btn.style.outline = "3px solid #CFAE70";
      await sleep(220);
      btn.click();
    }
    return { ok: !!btn };
  }

  function dispatchReactFriendlyChange(el) {
    // Standard DOM events
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    // Also trigger React's internal synthetic event handler if present
    Object.keys(el).forEach(function(k) {
      if (k.startsWith("__react") && el[k] && typeof el[k].onChange === "function") {
        try { el[k].onChange({ target: el, currentTarget: el }); } catch(_) {}
      }
    });
  }

  async function waitForSelect2Element(elementId, timeoutMs) {
    const ms = timeoutMs || 8000;
    const deadline = Date.now() + ms;
    while (Date.now() < deadline) {
      const el = document.getElementById(elementId);
      if (el) return { ok: true };
      await sleep(200);
    }
    return { ok: false, error: "timeout waiting for #" + elementId };
  }

  async function waitForRadioGroup(name, minCount, timeoutMs) {
    const min = minCount || 2;
    const ms = timeoutMs || 20000;
    const deadline = Date.now() + ms;
    while (Date.now() < deadline) {
      const n = document.querySelectorAll('input[name="' + name + '"]').length;
      if (n >= min) return { ok: true, count: n };
      await sleep(200);
    }
    const count = document.querySelectorAll('input[name="' + name + '"]').length;
    return { ok: false, count, error: "timeout waiting for input[name=" + name + "]" };
  }

  async function setRadioNameValue(name, value) {
    domLog("setRadioNameValue", { name, value });
    let nodes = document.querySelectorAll('input[name="' + name + '"]');
    if (!nodes.length && document.getElementById(name)) {
      nodes = document.querySelectorAll("#" + name + ' input[type="radio"]');
    }
    if (value === "__other__" || value === "") {
      for (let i = 0; i < nodes.length; i++) {
        const el = nodes[i];
        if (el.type === "radio" && (!el.value || el.value === "")) {
          const lab = el.closest("label");
          if (lab) lab.click();
          else el.click();
          dispatchReactFriendlyChange(el);
          return { ok: true };
        }
      }
    }
    for (let i = 0; i < nodes.length; i++) {
      const el = nodes[i];
      if (el.type === "radio" && el.value === value) {
        const lab = el.closest("label");
        if (lab) lab.click();
        else el.click();
        dispatchReactFriendlyChange(el);
        return { ok: true };
      }
    }
    return {
      ok: false,
      error: "radio not found for " + name + "=" + value + " (found " + nodes.length + " inputs)",
    };
  }

  async function setCheckboxNameValues(name, values) {
    domLog("setCheckboxNameValues", { name, values });
    const want = {};
    (values || []).forEach(function (v) {
      want[v] = true;
    });
    let n = 0;
    const nodes = document.querySelectorAll('input[name="' + name + '"]');
    for (let i = 0; i < nodes.length; i++) {
      const el = nodes[i];
      if (want[el.value] && !el.checked) {
        el.click();
        n++;
      }
    }
    return { ok: n > 0, count: n };
  }

  async function setAcknowledgeYes() {
    domLog("setAcknowledgeYes");
    // Try by name+value first, then by id (checkbox may only have id, not name)
    let el = document.querySelector('input[name="acknowledge"][value="yes"]')
           || document.querySelector('input[name="acknowledge"]')
           || document.querySelector('[data-group-id="acknowledge"] input[type="checkbox"]');
    if (el && !el.checked) {
      el.click();
      dispatchReactFriendlyChange(el);
    }
    return { ok: !!el };
  }

  async function waitForAcknowledge(timeoutMs) {
    const ms = timeoutMs || 10000;
    const deadline = Date.now() + ms;
    while (Date.now() < deadline) {
      const el = document.querySelector('input[name="acknowledge"]')
               || document.getElementById("acknowledge");
      if (el) return { ok: true };
      await sleep(200);
    }
    return { ok: false, error: "timeout waiting for acknowledge input" };
  }

  async function setTextInputById(id, text) {
    domLog("setTextInputById", { id, len: (text || "").length });
    const el = document.getElementById(id);
    if (!el) return { ok: false };
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    el.focus();
    el.value = text || "";
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    return { ok: true };
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
    await sleep(300);
    const sf = $(".select2-search__field");
    if (sf.length) {
      sf.val(searchTerm).trigger("input");
    }
    await sleep(1100);
    let found = false;
    const results = $(".select2-results__option");
    const termLower = String(searchTerm || "").toLowerCase();
    // Prefer exact match first, then startsWith, then first non-empty result
    let exactMatch = null;
    let startsWithMatch = null;
    let firstResult = null;
    results.each(function () {
      const txt = $(this).text().trim();
      const txtLower = txt.toLowerCase();
      if (txtLower === "no results found" || txtLower === "searching…" || txtLower === "loading…") return;
      if (!firstResult) firstResult = this;
      if (txtLower === termLower && !exactMatch) exactMatch = this;
      if (txtLower.startsWith(termLower) && !startsWithMatch) startsWithMatch = this;
    });
    const pick = exactMatch || startsWithMatch || firstResult;
    if (pick) {
      $(pick).trigger("mousedown");
      await sleep(40);
      $(pick).trigger("mouseup");
      await sleep(500); // let Select2 process and cascade

      // Verify the selection actually registered by reading back Select2's value
      try {
        const chosen = sel.select2("data");
        if (chosen && chosen.length > 0) {
          const chosenText = (chosen[0].text || "").toLowerCase();
          if (chosenText.includes(termLower) || termLower.includes(chosenText)) {
            found = true;
          }
        }
      } catch (_) {
        // select2("data") unavailable — fall back to trusting the event fired
        found = true;
      }
    }
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
          setTimeout(tick, 22);
        }
      };
      tick();
    });

    return { filled: true };
  }

  /**
   * Compact view of the ReADY request form for the service worker to reconcile with form-profiles.
   */
  function getReADYFormSnapshot() {
    const form =
      document.getElementById("requestScreenForm") ||
      document.querySelector("#requestScreen form") ||
      document.querySelector("form");
    const out = {
      formFound: !!form,
      url: typeof location !== "undefined" ? location.href : "",
      title: document.title || "",
      headline: "",
      schemaKeys: [],
      radioGroups: {},
      checkboxNames: [],
      selectIds: [],
      textareaIds: [],
      textInputIds: [],
      pendingVisible: !!document.getElementById("requestScreenPending"),
    };
    if (!form) return out;

    const h = form.querySelector("h1, h2, h3, .card-title, .modal-title");
    if (h && h.textContent) out.headline = h.textContent.trim().slice(0, 200);

    const seenKey = {};
    /** One row per schema key: human label text from the page (for AI + parity with profile). */
    out.labeledFields = [];
    const seenLabelKey = {};
    form.querySelectorAll("[data-schema-key]").forEach((el) => {
      const k = el.getAttribute("data-schema-key");
      if (k && !seenKey[k]) {
        seenKey[k] = true;
        out.schemaKeys.push(k);
      }
      if (!k || seenLabelKey[k]) return;
      seenLabelKey[k] = true;
      let labelText = "";
      const id = el.id;
      if (id) {
        const labels = form.querySelectorAll("label[for]");
        for (let li = 0; li < labels.length; li++) {
          if (labels[li].getAttribute("for") === id) {
            labelText = (labels[li].textContent || "").replace(/\s+/g, " ").trim().slice(0, 240);
            break;
          }
        }
      }
      if (!labelText) {
        const scope = el.closest(".card-body") || el.parentElement;
        const lab2 = scope && scope.querySelector("label.label-secondary, label");
        if (lab2 && lab2.textContent) {
          labelText = (lab2.textContent || "").replace(/\s+/g, " ").trim().slice(0, 240);
        }
      }
      out.labeledFields.push({
        schemaKey: k,
        labelText: labelText || k,
        inputId: id || "",
        tag: el.tagName,
      });
    });

    const radioSeen = {};
    form.querySelectorAll('input[type="radio"]').forEach((r) => {
      const n = r.name;
      if (!n) return;
      if (!radioSeen[n]) radioSeen[n] = [];
      if (radioSeen[n].indexOf(r.value) === -1) radioSeen[n].push(r.value);
    });
    out.radioGroups = radioSeen;

    const cbSeen = {};
    form.querySelectorAll('input[type="checkbox"]').forEach((c) => {
      const n = c.name;
      if (n && !cbSeen[n]) {
        cbSeen[n] = true;
        out.checkboxNames.push(n);
      }
    });

    form.querySelectorAll("select").forEach((s) => {
      if (s.id) out.selectIds.push(s.id);
    });
    form.querySelectorAll("textarea").forEach((t) => {
      if (t.id) out.textareaIds.push(t.id);
    });
    form.querySelectorAll('input[type="text"], input[type="date"], input:not([type])').forEach((inp) => {
      if (inp.id && inp.type !== "radio" && inp.type !== "checkbox" && inp.type !== "hidden") {
        out.textInputIds.push(inp.id);
      }
    });

    domLog("getReADYFormSnapshot", out);
    return out;
  }

  /** Values already on the Review step (Vanderbilt often pre-fills name/email from the session). */
  function getResidentialContactFieldValues() {
    const keys = ["contactName", "contactNumber", "contactEmail"];
    const out = {};
    for (const id of keys) {
      const el = document.getElementById(id);
      if (!el) {
        out[id] = { present: false, value: "", empty: true, hasError: false };
        continue;
      }
      const v = String(el.value != null ? el.value : "").trim();
      const group = el.closest(".form-group");
      const hasError = !!(group && group.classList && group.classList.contains("has-error"));
      out[id] = {
        present: true,
        value: v,
        empty: !v,
        hasError,
      };
    }
    domLog("getResidentialContactFieldValues", out);
    return out;
  }

  window.__REBOT__ = {
    clickTemplate,
    clickElementById,
    standardAckAndContact,
    residentialEmergencyNo,
    residentialWorkTypeRadios,
    residentialSecondaryRadios,
    residentialLocationAck,
    standardWorkDetailsCheckboxes,
    clickNext,
    setSelect2,
    typeBrief,
    setRadioNameValue,
    waitForRadioGroup,
    waitForSelect2Element,
    setCheckboxNameValues,
    setAcknowledgeYes,
    waitForAcknowledge,
    setTextInputById,
    getReADYFormSnapshot,
    getResidentialContactFieldValues,
  };
})();
