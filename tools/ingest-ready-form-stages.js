/**
 * ReADY multi-step form — stage ingestion (run on the LIVE site)
 *
 * MODES (CONFIG.MODE):
 * - "ingest" (default): You click Next between wizard pages. After each page loads, we automatically run a
 *   full radio branch DFS (all conditional paths on that screen), save every state, then restore your
 *   selections so you can keep going. Stops when a button contains the word "submit". One combined JSON.
 * - "manual-poll": Poll only — snapshot on structure change, no automatic branch walk (lighter).
 * - "radio-branch-dfs": Current page only — branch exploration only (debug).
 *
 * SAFETY: submit event capture on #requestScreenForm — blocks real submission.
 *
 * Tunables: CONFIG below.
 */
(function () {
  const CONFIG = {
    /** "ingest" | "manual-poll" | "radio-branch-dfs" */
    MODE: "ingest",

    /** radio-branch-dfs: max unique radio states (safety cap) */
    BRANCH_DFS_MAX_STATES: 500,
    /** Skip branching on these group names (e.g. pre-select emergency yourself, then add ["emergency"]) */
    BRANCH_DFS_SKIP_GROUP_NAMES: [],
    /** radio-branch-dfs: omit form HTML in JSON to save memory */
    BRANCH_DFS_OMIT_HTML: true,

    /** How long to keep watching (ms) while you step through manually */
    MAX_WATCH_MS: 45 * 60 * 1000,
    /** How often to check for a new screen or the word "submit" */
    POLL_MS: 600,
    /** After each radio click while settling conditionals */
    RADIO_SETTLE_MS: 550,
    RADIO_MAX_PASSES: 40,
    PENDING_MAX_WAIT_MS: 120000,
    PENDING_POLL_MS: 250,
    AUTO_FILL_MINIMAL: true,
    FILL_RANDOM_PLACEHOLDER: true,
    GUARD_FORM_SUBMIT: true,
    INCLUDE_FORM_HTML_SNIPPET: true,
    HTML_MAX_CHARS: 80000,
    /** Stop when /\bsubmit\b/i matches visible button (or input[type=submit]) label */
    STOP_ON_SUBMIT_WORD: true,
    /** Extra selectors for snapshot metadata only (not used to stop) */
    SUBMIT_SELECTORS: [
      "button.btn-success",
      "button.btn-outline-success",
      'button.btn-primary[type="submit"]',
      "#requestScreenSubmit",
      "#requestScreenComplete",
    ],
  };

  function visible(el) {
    if (!el) return false;
    const s = window.getComputedStyle(el);
    return s.display !== "none" && s.visibility !== "hidden" && el.offsetParent !== null;
  }

  function labelTextFor(el) {
    if (el.labels && el.labels.length) {
      return Array.from(el.labels)
        .map((l) => l.textContent.replace(/\s+/g, " ").trim())
        .filter(Boolean)
        .join(" | ");
    }
    const id = el.id;
    if (id && typeof CSS !== "undefined" && CSS.escape) {
      const lab = document.querySelector(`label[for="${CSS.escape(id)}"]`);
      if (lab) return lab.textContent.replace(/\s+/g, " ").trim();
    }
    return null;
  }

  function randomToken() {
    return "INGEST-" + Math.random().toString(36).slice(2, 10) + "-" + Date.now().toString(36);
  }

  function dispatchReactFriendly(el) {
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    if (el.tagName === "TEXTAREA" || el.tagName === "INPUT") {
      Object.keys(el).forEach((k) => {
        if (k.startsWith("__react") && el[k] && el[k].onChange) {
          try {
            el[k].onChange({ target: el });
          } catch (_) {}
        }
      });
    }
  }

  /** True while the wizard shows Loading / Pending instead of Next (see ready-form-stages1.json stage 4). */
  function isPendingLoadingUi() {
    const pending = document.getElementById("requestScreenPending");
    if (pending && visible(pending)) return true;
    const next = document.getElementById("requestScreenNext");
    if (next && visible(next) && /loading/i.test((next.textContent || "").trim())) return true;
    return false;
  }

  async function waitUntilNotPending() {
    const start = Date.now();
    while (Date.now() - start < CONFIG.PENDING_MAX_WAIT_MS) {
      if (!isPendingLoadingUi()) return true;
      await sleep(CONFIG.PENDING_POLL_MS);
    }
    console.warn("[ingest-ready-form] Timed out waiting for Loading / Pending to finish.");
    return false;
  }

  /**
   * Green / final submit button (visible). Does not need to be green if id matches.
   */
  function findTerminalSubmitButton() {
    const form = document.getElementById("requestScreenForm");
    if (!form) return null;

    for (const sel of CONFIG.SUBMIT_SELECTORS) {
      const el = form.querySelector(sel);
      if (el && visible(el) && !el.disabled) return el;
    }

    const buttons = form.querySelectorAll("button");
    for (const b of buttons) {
      if (!visible(b) || b.disabled) continue;
      const id = (b.id || "").toLowerCase();
      const txt = (b.textContent || "").replace(/\s+/g, " ").trim().toLowerCase();
      if (id.includes("submit") || id.includes("complete")) return b;
      if (
        (txt === "submit" || txt.includes("submit request") || txt.includes("send") || txt.includes("finish")) &&
        !txt.includes("next") &&
        !txt.includes("previous")
      ) {
        if (b.classList.contains("btn-success") || b.classList.contains("btn-primary")) return b;
      }
    }
    return null;
  }

  function describeSubmitCandidate(btn) {
    if (!btn) return null;
    return {
      id: btn.id || null,
      className: btn.className,
      text: (btn.textContent || "").replace(/\s+/g, " ").trim(),
      disabled: btn.disabled,
    };
  }

  const SUBMIT_WORD_RE = /\bsubmit\b/i;

  function pageHasSubmitWord() {
    if (!CONFIG.STOP_ON_SUBMIT_WORD) return false;
    const form = document.getElementById("requestScreenForm");
    if (!form) return false;
    const nodes = form.querySelectorAll("button, input[type='submit'], input[type='button']");
    for (const el of nodes) {
      if (!visible(el) || el.disabled) continue;
      const label = (el.textContent || el.value || "").trim();
      if (SUBMIT_WORD_RE.test(label)) return true;
    }
    return false;
  }

  function describeSubmitWordMatches() {
    const form = document.getElementById("requestScreenForm");
    if (!form) return [];
    const out = [];
    form.querySelectorAll("button, input[type='submit']").forEach((el) => {
      if (!visible(el)) return;
      const label = (el.textContent || el.value || "").trim();
      if (SUBMIT_WORD_RE.test(label)) {
        out.push({
          id: el.id || null,
          tag: el.tagName,
          text: label,
          className: el.className,
          disabled: el.disabled,
        });
      }
    });
    return out;
  }

  function snapshotStage(index) {
    const form = document.getElementById("requestScreenForm");
    const main = document.getElementById("navigatorTarget");
    const fields = [];

    if (form) {
      const controls = form.querySelectorAll("input, select, textarea");
      controls.forEach((el) => {
        const t = (el.type || "").toLowerCase();
        if (t === "hidden") return;
        fields.push({
          tag: el.tagName.toLowerCase(),
          type: el.type || null,
          name: el.name || null,
          id: el.id || null,
          value: el.value != null ? String(el.value) : null,
          checked: el.type === "checkbox" || el.type === "radio" ? el.checked : undefined,
          required: !!el.required,
          disabled: !!el.disabled,
          label: labelTextFor(el),
          placeholder: el.placeholder || null,
          visible: visible(el),
        });
      });
    }

    const nextEl = document.getElementById("requestScreenNext");
    const pendingEl = document.getElementById("requestScreenPending");
    const submitEl = findTerminalSubmitButton();

    const out = {
      index,
      capturedAt: new Date().toISOString(),
      url: location.href,
      screen: main ? main.getAttribute("data-screen") : null,
      state: main ? main.getAttribute("data-state") : null,
      h1: document.querySelector("#requestScreenForm h1")?.textContent?.trim()
        || document.querySelector("main h1")?.textContent?.trim()
        || null,
      ui: {
        mode: "manual-next",
        pendingLoading: isPendingLoadingUi(),
        submitWordVisible: pageHasSubmitWord(),
        submitWordMatches: describeSubmitWordMatches(),
        nextButton: nextEl
          ? {
              exists: true,
              disabled: nextEl.disabled,
              id: nextEl.id,
              text: (nextEl.textContent || "").trim(),
              visible: visible(nextEl),
            }
          : { exists: false },
        pendingButton: pendingEl
          ? {
              exists: true,
              id: pendingEl.id,
              text: (pendingEl.textContent || "").trim(),
              visible: visible(pendingEl),
              disabled: pendingEl.disabled,
            }
          : { exists: false },
        terminalSubmitButton: describeSubmitCandidate(submitEl),
      },
      fieldCount: fields.length,
      fields,
    };

    if (CONFIG.INCLUDE_FORM_HTML_SNIPPET && form) {
      out.formHtmlSnippet = form.innerHTML.slice(0, CONFIG.HTML_MAX_CHARS);
    }

    return out;
  }

  function autoFillMinimal() {
    if (!CONFIG.AUTO_FILL_MINIMAL) return;

    const emergencyNo = document.querySelector('input[name="emergency"][value="no"]');
    if (emergencyNo && !emergencyNo.checked) emergencyNo.click();

    const ack = document.querySelector('input[name="acknowledge"]') || document.querySelector('input[name="aknowledge"]');
    if (ack && ack.type === "checkbox" && !ack.checked) ack.click();

    const alt = document.querySelectorAll('input[name="alternateContactYN"]');
    if (alt.length && !Array.from(alt).some((r) => r.checked)) alt[0].click();
  }

  /**
   * One radio group at a time: click first unselected group’s first visible option, wait, repeat.
   * Picks up newly injected groups (conditional follow-ups).
   */
  async function settleConditionalRadios() {
    const form = document.getElementById("requestScreenForm");
    if (!form) return;

    for (let pass = 0; pass < CONFIG.RADIO_MAX_PASSES; pass++) {
      const byName = new Map();
      form.querySelectorAll('input[type="radio"][name]').forEach((r) => {
        if (!r.name || r.disabled) return;
        if (!visible(r)) return;
        if (!byName.has(r.name)) byName.set(r.name, []);
        byName.get(r.name).push(r);
      });

      let foundUncheckd = false;
      for (const [, radios] of byName) {
        const checked = radios.some((r) => r.checked);
        if (!checked && radios.length) {
          const pick = radios.find((r) => visible(r) && !r.disabled) || radios[0];
          pick.click();
          foundUncheckd = true;
          await sleep(CONFIG.RADIO_SETTLE_MS);
          break;
        }
      }

      if (!foundUncheckd) break;
    }
  }

  function autoFillRandomSync() {
    if (!CONFIG.FILL_RANDOM_PLACEHOLDER) return;
    const form = document.getElementById("requestScreenForm");
    if (!form) return;
    const tok = randomToken();

    form.querySelectorAll("textarea").forEach((el) => {
      if (!visible(el) || el.disabled) return;
      if (el.value && el.value.trim()) return;
      el.value = "Ingest-only test description. " + tok;
      dispatchReactFriendly(el);
    });

    form.querySelectorAll("input").forEach((el) => {
      if (!visible(el) || el.disabled) return;
      const t = (el.type || "text").toLowerCase();
      if (["hidden", "radio", "checkbox", "file", "button", "submit", "reset"].includes(t)) return;
      if (el.value && el.value.trim()) return;
      if (t === "number") el.value = "1";
      else el.value = tok.slice(0, 24);
      dispatchReactFriendly(el);
    });

    form.querySelectorAll("select").forEach((sel) => {
      if (!visible(sel) || sel.disabled) return;
      const opts = Array.from(sel.options).filter((o) => o.value !== "" && !o.disabled);
      if (opts.length) {
        sel.value = opts[0].value;
        dispatchReactFriendly(sel);
      }
    });
  }

  async function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

  async function autoFillSelect2JQuery() {
    if (!CONFIG.FILL_RANDOM_PLACEHOLDER) return;
    const $ = window.jQuery;
    if (!$) return;

    const form = document.getElementById("requestScreenForm");
    if (!form) return;

    const selects = form.querySelectorAll("select");
    for (const sel of selects) {
      if (!visible(sel) || sel.disabled) continue;
      const $s = $(sel);
      if (!$s.data("select2")) continue;
      if (sel.value && String(sel.value).trim()) continue;

      const id = sel.id;
      if (!id) continue;

      try {
        $s.select2("open");
        await sleep(400);
        const searchTerm = "a";
        const sf = $(".select2-search__field");
        if (sf.length) {
          sf.val(searchTerm).trigger("input");
        }
        await sleep(2200);
        let clicked = false;
        $(".select2-results__option").each(function () {
          const txt = $(this).text().trim().toLowerCase();
          if (!txt || txt === "no results found" || txt.includes("searching") || txt.includes("loading")) return;
          $(this).trigger("mouseup");
          clicked = true;
          return false;
        });
        if (!clicked) {
          try {
            $s.select2("close");
          } catch (_) {}
        }
        await sleep(300);
      } catch (e) {
        console.warn("[ingest-ready-form] Select2 fill skipped:", id, e);
      }
    }
  }

  /**
   * Full pass: minimal → radios (cascade) → text/select → Select2 → radios again (new conditionals).
   */
  async function autoFillAll() {
    autoFillMinimal();
    await sleep(150);
    await settleConditionalRadios();
    await sleep(150);
    autoFillRandomSync();
    await sleep(150);
    await autoFillSelect2JQuery();
    await sleep(200);
    await settleConditionalRadios();
  }

  /** Text/selects only — branch DFS drives radios itself (no auto radio cascade). */
  async function autoFillNonRadioOnly() {
    autoFillMinimal();
    await sleep(150);
    autoFillRandomSync();
    await sleep(150);
    await autoFillSelect2JQuery();
  }

  function getRadioStateKey() {
    const form = document.getElementById("requestScreenForm");
    if (!form) return "{}";
    const o = {};
    form.querySelectorAll('input[type="radio"][name]').forEach((r) => {
      if (r.checked) o[r.name] = r.value;
    });
    return JSON.stringify(o, Object.keys(o).sort());
  }

  /** Restore radio selections after branch exploration (best-effort). */
  function applyRadioStateKey(keyStr) {
    let o;
    try {
      o = JSON.parse(keyStr || "{}");
    } catch {
      return;
    }
    const form = document.getElementById("requestScreenForm");
    if (!form) return;
    for (const name of Object.keys(o)) {
      const val = o[name];
      form.querySelectorAll('input[type="radio"]').forEach((r) => {
        if (r.name === name && r.value === val && visible(r) && !r.disabled) {
          r.click();
        }
      });
    }
  }

  /**
   * First radio group in DOM order with 2+ visible options (branching point).
   */
  function firstGroupWithMultipleVisibleRadios(form) {
    const skip = new Set(CONFIG.BRANCH_DFS_SKIP_GROUP_NAMES || []);
    const order = [];
    const byName = new Map();
    form.querySelectorAll('input[type="radio"]').forEach((r) => {
      if (!r.name || skip.has(r.name) || r.disabled) return;
      if (!visible(r)) return;
      if (!byName.has(r.name)) {
        byName.set(r.name, []);
        order.push(r.name);
      }
      byName.get(r.name).push(r);
    });
    for (const name of order) {
      const radios = byName.get(name).filter((x) => visible(x) && !x.disabled);
      if (radios.length >= 2) {
        return { name, radios };
      }
    }
    return null;
  }

  /**
   * Walk all radio branches on the current wizard screen; returns snapshot list (does not install submit guard).
   */
  async function collectBranchDFSForPage(pageIndex) {
    const form = document.getElementById("requestScreenForm");
    const visited = new Set();
    const results = [];

    const savedHtml = CONFIG.INCLUDE_FORM_HTML_SNIPPET;
    if (CONFIG.BRANCH_DFS_OMIT_HTML) {
      CONFIG.INCLUDE_FORM_HTML_SNIPPET = false;
    }

    async function dfs() {
      await waitUntilNotPending();
      await autoFillNonRadioOnly();

      const key = getRadioStateKey();
      if (visited.has(key)) return;
      if (visited.size >= CONFIG.BRANCH_DFS_MAX_STATES) {
        console.warn("[ingest-ready-form] BRANCH_DFS_MAX_STATES reached — stopping DFS for this page.");
        return;
      }
      visited.add(key);

      const snap = snapshotStage(results.length);
      snap.branchMeta = {
        pageIndex,
        radioStateKey: key,
        branchIndexOnPage: results.length,
      };
      results.push(snap);
      console.info(
        "[ingest-ready-form]   branch %s on page %s — radios: %s",
        results.length,
        pageIndex,
        Object.keys(JSON.parse(key)).join(", ") || "(none)"
      );

      const grp = firstGroupWithMultipleVisibleRadios(form);
      if (!grp) return;

      const prev = grp.radios.find((r) => r.checked);

      for (const r of grp.radios) {
        r.click();
        await sleep(CONFIG.RADIO_SETTLE_MS);
        await dfs();
      }

      if (prev) {
        prev.click();
      } else if (grp.radios[0]) {
        grp.radios[0].click();
      }
      await sleep(CONFIG.RADIO_SETTLE_MS);
    }

    try {
      await dfs();
    } catch (e) {
      console.error("[ingest-ready-form] branch DFS error:", e);
    } finally {
      CONFIG.INCLUDE_FORM_HTML_SNIPPET = savedHtml;
    }

    return results;
  }

  async function runBranchDFS() {
    const form = document.getElementById("requestScreenForm");
    let unguardSubmit = function () {};

    if (CONFIG.GUARD_FORM_SUBMIT && form) {
      const stop = (e) => {
        e.preventDefault();
        e.stopPropagation();
        console.warn("[ingest-ready-form] Blocked form submit (branch DFS).");
      };
      form.addEventListener("submit", stop, true);
      unguardSubmit = () => form.removeEventListener("submit", stop, true);
      console.info("[ingest-ready-form] Submit guard installed.");
    }

    console.info(
      "[ingest-ready-form] radio-branch-dfs — this page only. Max states: %s",
      CONFIG.BRANCH_DFS_MAX_STATES
    );

    let results = [];
    try {
      results = await collectBranchDFSForPage(0);
      console.info("[ingest-ready-form] Branch DFS done — %s unique radio states.", results.length);
    } finally {
      unguardSubmit();
    }

    const text = JSON.stringify(results, null, 2);
    console.log("[ingest-ready-form] BRANCH JSON follows + download ready-form-branches.json\n\n" + text);

    try {
      const blob = new Blob([text], { type: "application/json" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = "ready-form-branches.json";
      a.click();
      URL.revokeObjectURL(a.href);
    } catch (e) {
      console.warn("[ingest-ready-form] Download failed:", e);
    }

    return results;
  }

  function fieldSignature(snap) {
    return JSON.stringify(
      (snap.fields || []).map((f) => ({
        name: f.name,
        type: f.type,
        id: f.id,
        value: f.value,
        checked: f.checked,
      }))
    );
  }

  /** Ignore values — only detect wizard step changes (avoids duplicate captures while autofilling). */
  function structureSignature(snap) {
    return JSON.stringify(
      (snap.fields || []).map((f) => ({
        name: f.name,
        type: f.type,
        id: f.id,
      }))
    );
  }

  async function run() {
    const form = document.getElementById("requestScreenForm");
    let unguardSubmit = function () {};

    if (CONFIG.GUARD_FORM_SUBMIT && form) {
      const stop = (e) => {
        e.preventDefault();
        e.stopPropagation();
        console.warn("[ingest-ready-form] Blocked form submit (ingestion mode only).");
      };
      form.addEventListener("submit", stop, true);
      unguardSubmit = () => form.removeEventListener("submit", stop, true);
      console.info("[ingest-ready-form] Submit guard installed on #requestScreenForm.");
    }

    const t0 = Date.now();

    if (CONFIG.MODE === "manual-poll") {
      const stages = [];
      let lastStructure = null;

      console.info("[ingest-ready-form] manual-poll — poll every %sms, MAX_WATCH=%s min", CONFIG.POLL_MS, Math.round(CONFIG.MAX_WATCH_MS / 60000));
      console.info(
        "[ingest-ready-form] You click Next. We snapshot structure changes; stop on \"submit\". No automatic radio branch walk."
      );

      try {
        while (Date.now() - t0 < CONFIG.MAX_WATCH_MS) {
          await waitUntilNotPending();
          await autoFillAll();

          const snap = snapshotStage(stages.length);
          const struct = structureSignature(snap);

          if (snap.ui.submitWordVisible) {
            const prev = stages[stages.length - 1];
            if (!prev || !prev.ui.submitWordVisible) stages.push(snap);
            else stages[stages.length - 1] = snap;
            console.info("[ingest-ready-form] Stopping — saw \"submit\". Not clicked.");
            break;
          }

          if (stages.length === 0 || struct !== lastStructure) {
            stages.push(snap);
            lastStructure = struct;
            console.info("[ingest-ready-form] Stage %s — screen=%s fields=%s", stages.length - 1, snap.screen, snap.fieldCount);
          }

          await sleep(CONFIG.POLL_MS);
        }

        if (Date.now() - t0 >= CONFIG.MAX_WATCH_MS) {
          console.warn("[ingest-ready-form] MAX_WATCH_MS elapsed.");
        }

        const text = JSON.stringify(stages, null, 2);
        console.log("[ingest-ready-form] DONE\n\n" + text);
        try {
          const blob = new Blob([text], { type: "application/json" });
          const a = document.createElement("a");
          a.href = URL.createObjectURL(blob);
          a.download = "ready-form-stages.json";
          a.click();
          URL.revokeObjectURL(a.href);
        } catch (e) {
          console.warn("[ingest-ready-form] Download failed:", e);
        }
        return { mode: "manual-poll", stages };
      } finally {
        unguardSubmit();
        console.info("[ingest-ready-form] Submit guard removed.");
      }
    }

    /** Unified ingest: you press Next; after each page load we DFS all radio branches, restore, accumulate. */
    const pages = [];
    let pageIndex = 0;
    let exploredForCurrentPage = false;
    let prevPending = false;

    console.info("[ingest-ready-form] ingest mode — you click Next between pages.");
    console.info(
      "[ingest-ready-form] After each page loads: we walk every radio branch on that screen, save states, restore your selections, then you continue. Stops when a button contains \"submit\"."
    );

    try {
      while (Date.now() - t0 < CONFIG.MAX_WATCH_MS) {
        await waitUntilNotPending();

        const pendingNow = isPendingLoadingUi();
        if (pendingNow) {
          prevPending = true;
          await sleep(CONFIG.POLL_MS);
          continue;
        }

        if (prevPending) {
          exploredForCurrentPage = false;
          pageIndex++;
          prevPending = false;
          console.info("[ingest-ready-form] — New wizard page (pageIndex=%s) after Next —", pageIndex);
        }

        await autoFillAll();

        const snapCheck = snapshotStage(pages.length);
        if (snapCheck.ui.submitWordVisible) {
          pages.push({
            pageIndex,
            stoppedHere: true,
            wizardSnapshot: snapCheck,
            radioBranches: [],
          });
          console.info("[ingest-ready-form] Stopping — \"submit\" visible (not clicked).");
          break;
        }

        if (!exploredForCurrentPage) {
          const initialKey = getRadioStateKey();
          console.info(
            "[ingest-ready-form] Exploring all radio branches on page %s (then restoring your selections)…",
            pageIndex
          );

          const radioBranches = await collectBranchDFSForPage(pageIndex);
          applyRadioStateKey(initialKey);
          await sleep(350);

          const snapAfter = snapshotStage(pages.length);
          pages.push({
            pageIndex,
            wizardStepSnapshot: snapAfter,
            radioStateBeforeExplore: initialKey,
            radioBranches,
            branchCount: radioBranches.length,
          });
          exploredForCurrentPage = true;
          console.info(
            "[ingest-ready-form] Page %s: saved %s radio states. Restored prior selection — click Next when ready.",
            pageIndex,
            radioBranches.length
          );
        }

        await sleep(CONFIG.POLL_MS);
      }

      if (Date.now() - t0 >= CONFIG.MAX_WATCH_MS) {
        console.warn("[ingest-ready-form] MAX_WATCH_MS elapsed — stopping.");
      }

      const out = {
        mode: "ingest",
        generatedAt: new Date().toISOString(),
        pages,
      };

      const text = JSON.stringify(out, null, 2);
      console.log("[ingest-ready-form] DONE — ready-form-ingest.json\n\n" + text);

      try {
        const blob = new Blob([text], { type: "application/json" });
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = "ready-form-ingest.json";
        a.click();
        URL.revokeObjectURL(a.href);
      } catch (e) {
        console.warn("[ingest-ready-form] Download failed:", e);
      }

      return out;
    } finally {
      unguardSubmit();
      console.info("[ingest-ready-form] Submit guard removed.");
    }
  }

  if (CONFIG.MODE === "radio-branch-dfs") {
    return runBranchDFS();
  }
  return run();
})();
