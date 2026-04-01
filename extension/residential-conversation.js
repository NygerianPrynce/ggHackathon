/**
 * Profile-driven Q&A for Residential Hall maintenance (keyword parsing, no LLM).
 * Depends on global RESIDENTIAL_HALL_ROOM_MAINTENANCE from form-profiles.
 */
/* global RESIDENTIAL_HALL_ROOM_MAINTENANCE */

function residentialNormalize(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s/|.-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Extra hints: user issue text can steer workType before explicit pick. */
var RESIDENTIAL_WORKTYPE_HINTS = [
  { test: /\b(light|lights|lamp|bulb|outlet|electri|power|breaker|switch)\b/i, value: "light/electrical" },
  { test: /\b(heat|cold|hot|ac|hvac|air|thermostat|temperature)\b/i, value: "heat/air" },
  { test: /\b(plumb|toilet|sink|faucet|drain|clog|leak|water|shower|tub)\b/i, value: "plumbing/water" },
  { test: /\b(pest|bug|roach|mouse|mice|rat|ant|spider|insect)\b/i, value: "pests" },
  { test: /\b(elevator|lift)\b/i, value: "elevators" },
  { test: /\b(door|window|blind|ceiling)\b/i, value: "doors/windows/blinds/ceilings" },
  { test: /\b(furniture|desk|bed|dresser|chair|closet)\b/i, value: "furniture" },
  { test: /\b(fridge|refrigerat|stove|microwave|dishwasher|washer|dryer)\b/i, value: "appliance" },
  { test: /\b(clean|housekeep|toilet paper|shower curtain)\b/i, value: "housekeeping" },
  { test: /\b(vend|machine|snack)\b/i, value: "vending machine" },
  { test: /\b(wifi|internet|it|computer|comcast|network)\b/i, value: "IT issues" },
  { test: /\b(stain|discolor|mold|mildew|spot)\b/i, value: "surface discoloration" },
];

function residentialFieldVisible(field, answers) {
  if (!field || !field.showWhen) return true;
  const sw = field.showWhen;
  if (sw.equals != null) return answers[sw.schemaKey] === sw.equals;
  if (sw.isOther) {
    const v = answers[sw.schemaKey];
    return v === "" || v === "__other__";
  }
  return true;
}

function residentialScoreOption(text, value, label) {
  const t = residentialNormalize(text);
  let score = 0;
  const v = residentialNormalize(value);
  const l = residentialNormalize(label);
  if (v && t.includes(v)) score += 5;
  if (l) {
    const parts = l.split(/[^a-z0-9]+/).filter((x) => x.length > 2);
    for (const p of parts) {
      if (t.includes(p)) score += 2;
    }
  }
  const words = t.split(" ").filter((w) => w.length > 2);
  if (v) {
    for (const w of words) {
      if (v.includes(w) || w.includes(v)) score += 1;
    }
  }
  return score;
}

/**
 * @param {string} text
 * @param {{ value: string, label: string }[]} options
 * @returns {{ value: string, label: string } | null}
 */
function residentialPickRadio(text, options) {
  const t = residentialNormalize(text);
  if (!t) return null;
  if (/\b(yes|yeah|yep|correct|right|first)\b/.test(t) && options.length > 0) {
    return options[0];
  }
  if (/\b(no|nope|not|second)\b/.test(t) && options.length > 1) {
    return options[1];
  }
  let best = null;
  let bestScore = 0;
  for (const opt of options) {
    const s = residentialScoreOption(text, opt.value, opt.label);
    if (s > bestScore) {
      bestScore = s;
      best = opt;
    }
  }
  return bestScore >= 2 ? best : null;
}

/**
 * @param {Record<string, string>} answers
 * @param {any} branch
 * @returns {any | null} field def or null
 */
function residentialNextInBranch(branch, answers) {
  if (!branch) return null;
  for (const f of branch.fields || []) {
    if (f.type === "static") {
      const flag = "__read_" + f.schemaKey;
      if (!answers[flag]) return f;
      continue;
    }
    if (!residentialFieldVisible(f, answers)) continue;
    const sk = f.schemaKey;
    if (f.type === "radio" && answers[sk] == null) return f;
    if (f.type === "checkbox" && answers[sk] == null) return f;
    if ((f.type === "text" || f.type === "date" || f.type === "textarea") && answers[sk] == null) return f;
  }
  if (branch.nested) {
    const dwb = answers.doorsWindowsBlinds;
    if (dwb && branch.nested[dwb]) {
      const sub = residentialNextInBranch(branch.nested[dwb], answers);
      if (sub) return sub;
    }
  }
  return null;
}

/**
 * @param {any} profile
 * @param {{ page: number, answers: Record<string, string> }} state
 * @returns {{ kind: "field", field: any } | { kind: "advance" } | { kind: "handoff_location" } | { kind: "finished" }}
 */
function residentialGetNext(profile, state) {
  const stages = profile.stages;
  const answers = state.answers;

  if (state.page === 1) {
    const em = stages[0].fields[0];
    if (answers.emergency == null) return { kind: "field", field: em };
    /* ReADY non-emergency flow only — do not advance while "yes" is selected. */
    if (answers.emergency === "yes") {
      return { kind: "emergency_yes_hold" };
    }
    return { kind: "advance" };
  }

  if (state.page === 2) {
    const s2 = stages[1];
    if (answers.workType == null) {
      return { kind: "field", field: s2.fields[0] };
    }
    const wt = answers.workType;
    const branch = s2.branches[wt];
    const next = residentialNextInBranch(branch, answers);
    if (next) return { kind: "field", field: next };

    const tail = s2.commonTail || [];
    for (const f of tail) {
      if (answers[f.schemaKey] == null) return { kind: "field", field: f };
    }
    return { kind: "advance" };
  }

  if (state.page === 3) {
    const s3 = stages[2];
    for (let i = 0; i < s3.fields.length; i++) {
      const f = s3.fields[i];
      if (f.type === "static") continue;
      if (f.schemaKey === "yourName") continue;
      if (f.schemaKey && f.schemaKey.indexOf("location|") === 0) break;
      if (f.schemaKey === "acknowledge" && answers.acknowledge == null) {
        return { kind: "field", field: f };
      }
    }
    return { kind: "handoff_location" };
  }

  if (state.page === 4) {
    const s4 = stages[3];
    const a = answers;
    /* Voice UX: only ask for phone; name/email come from DOM merge + silent AI fill in the background. */
    if (a.contactNumber == null) {
      const phone = (s4.fields || []).find(function (x) {
        return x.schemaKey === "contactNumber";
      });
      if (phone) return { kind: "field", field: phone };
    }
    for (const f of s4.fields || []) {
      if (f.type === "static") continue;
      if (f.readonly) continue;
      if (f.schemaKey === "workOrderDescription" || f.schemaKey === "woDescriptionForMapping") continue;
      if (f.schemaKey === "contactName" || f.schemaKey === "contactEmail") continue;
      if ((f.type === "text" || f.type === "textarea") && answers[f.schemaKey] == null) {
        return { kind: "field", field: f };
      }
    }
    return { kind: "click_action", domId: "requestScreenReview", label: "Review" };
  }

  if (state.page === 5) {
    return { kind: "finished" };
  }

  return { kind: "finished" };
}

/**
 * Plain text for side panel + voice/TTS (ElevenLabs): no bullets, no pasted form walls, no markdown.
 */
function stripVoicePanelText(s) {
  if (s == null || s === "") return s;
  let t = String(s);
  t = t.replace(/\*\*([^*]+)\*\*/g, "$1");
  t = t.replace(/\*([^*]+)\*/g, "$1");
  t = t.replace(/^[•·]\s*/gm, "");
  t = t.replace(/\n{3,}/g, "\n\n");
  return t.trim();
}

/**
 * Short, speakable prompts — keyword path when the LLM did not set a custom line.
 */
function residentialFormatSpokenPrompt(field, issueHint, profile) {
  if (!field) return "What should I tell maintenance?";
  const sk = field.schemaKey;
  const ft = field.type;

  if (sk === "emergency") {
    return "Alright, first thing — is this an emergency situation?";
  }

  if (sk === "workType") {
    let suggestedLabel = null;
    if (issueHint && profile && profile.stages && profile.stages[1] && profile.stages[1].fields[0]) {
      const wtField = profile.stages[1].fields[0];
      for (let hi = 0; hi < RESIDENTIAL_WORKTYPE_HINTS.length; hi++) {
        const h = RESIDENTIAL_WORKTYPE_HINTS[hi];
        if (h.test.test(issueHint)) {
          const opt = (wtField.options || []).find(function (o) {
            return o.value === h.value;
          });
          if (opt) {
            suggestedLabel = String(opt.label || opt.value).replace(/\s+/g, " ").trim();
            break;
          }
        }
      }
    }
    if (suggestedLabel) {
      return (
        "Based on what you described, it sounds like this falls under " +
        suggestedLabel +
        ". Does that sound right, or would you say it's something different?"
      );
    }
    return "Got it. What type of issue is this — lights or electrical, plumbing, heat or AC, pests, or something else?";
  }

  if (sk === "brief" || (ft === "textarea" && (field.domId === "brief" || sk === "brief"))) {
    return "Can you give me a bit more detail on what’s going on — where exactly it is, what you’re seeing, and how urgent it feels?";
  }

  if (sk === "acknowledge") {
    return "Just so you know, after-hours requests may not be addressed until the next business day. Do you want to go ahead and submit?";
  }

  if (ft === "radio" && field.options && field.options.length) {
    const parts = field.options
      .slice(0, 10)
      .map((o) => String(o.label || o.value).replace(/\s+/g, " ").trim());
    return `Which of these best describes it: ${parts.join(", ")}?`;
  }

  if (ft === "checkbox" && field.options && field.options.length) {
    const parts = field.options.slice(0, 10).map((o) => o.label || o.value);
    return `Which of these apply? You can name more than one: ${parts.join(", ")}.`;
  }

  if (ft === "static") {
    return "Just say continue when you’re ready to move on.";
  }

  if (sk === "contactNumber") {
    return "And what’s the best phone number to reach you at, including the area code?";
  }
  if (sk === "contactName") {
    return "What name should I put on the request?";
  }
  if (sk === "contactEmail") {
    return "What email address should they use to follow up with you?";
  }

  if (ft === "text" || ft === "date") {
    const lab = (field.label || "").replace(/\s+/g, " ").trim();
    if (lab.length > 0 && lab.length < 180) {
      return `Can you give me the ${lab.toLowerCase()}?`;
    }
    return "What should I put in this field?";
  }

  return "Go ahead, I’m listening.";
}

function residentialFormatQuestion(field, issueHint, profile) {
  if (!field) return "Please answer.";
  let lines = [];
  if (field.schemaKey === "acknowledge" && profile && profile.stages && profile.stages[2]) {
    const tw = profile.stages[2].fields.find(function (x) {
      return x.schemaKey === "timeWarning";
    });
    if (tw && tw.label) lines.push(tw.label);
  }
  if (field.help) lines.push(field.help);
  if (field.label) lines.push(field.label);
  if (field.type === "radio" && field.options && field.options.length) {
    const opts = field.options
      .map((o) => "• " + (o.label || o.value))
      .slice(0, 14)
      .join("\n");
    lines.push("Options (say one or describe):\n" + opts);
  }
  if (field.type === "checkbox" && field.options && field.options.length) {
    lines.push("You can list multiple (e.g. insects and spiders).");
    lines.push(field.options.map((o) => "• " + o.label).join("\n"));
  }
  if (field.type === "static") {
    lines.push("Reply **continue** when you've read this.");
  }
  if (field.schemaKey === "contactNumber") {
    lines.push("Use digits; include area code if U.S. (e.g. 6155551234).");
  }
  if (issueHint && field.schemaKey === "workType") {
    lines.unshift('Your issue: "' + issueHint + '"');
    const hints = [];
    for (const h of RESIDENTIAL_WORKTYPE_HINTS) {
      if (h.test.test(issueHint)) hints.push(h.value);
    }
    const uniq = [...new Set(hints)];
    if (uniq.length) {
      lines.push("Keyword hint (verify): " + uniq.join(", "));
    }
  }
  const body = lines.filter(Boolean).join("\n\n");
  return body;
}

/**
 * @returns {{ ok: boolean, value?: string, values?: string[], error?: string }}
 */
function residentialParseAnswer(text, field, answers, issueHint) {
  const raw = String(text || "").trim();
  if (!raw) return { ok: false, error: "Empty answer." };

  if (field.schemaKey === "acknowledge") {
    if (/\b(yes|yeah|yep|acknowledge|agree|understand|confirm)\b/i.test(raw)) {
      return { ok: true, value: "yes" };
    }
    return { ok: false, error: "Say **yes** to acknowledge and continue." };
  }

  if (field.type === "static") {
    if (/\b(continue|ok|yes|got it|read)\b/i.test(raw)) {
      return { ok: true, value: "read", flagKey: "__read_" + field.schemaKey };
    }
    return { ok: false, error: "Say **continue** after reading." };
  }

  if (field.type === "textarea") {
    const v = raw.length ? raw : String(issueHint || "");
    return { ok: true, value: v };
  }

  if (field.type === "text" || field.type === "date") {
    return { ok: true, value: raw };
  }

  if (field.type === "checkbox") {
    const t = residentialNormalize(raw);
    const picked = [];
    for (const o of field.options || []) {
      const lab = residentialNormalize(o.label);
      const val = residentialNormalize(o.value);
      if (t.includes(lab) || t.includes(val) || residentialScoreOption(raw, o.value, o.label) >= 2) {
        picked.push(o.value);
      }
    }
    if (!picked.length) {
      return { ok: false, error: "Couldn't match options — name one or more from the list." };
    }
    return { ok: true, values: picked };
  }

  if (field.type === "radio") {
    if (field.schemaKey === "emergency") {
      /* User already chose Yes — we asked 911/VUPD + whether to continue with routine form. "Yes" = set radio to No. */
      if (answers && answers.emergency === "yes") {
        const t = raw.trim();
        const lower = t.toLowerCase();
        if (
          /\b(still an emergency|still urgent|need 911|call 911|it is an emergency|yes it'?s an emergency|life.?threatening)\b/i.test(raw)
        ) {
          return { ok: true, value: "yes" };
        }
        if (
          /^(yes|y|yeah|yep|sure|ok|okay)\.?$/i.test(t) ||
          /\b(continue|go ahead|proceed|let'?s continue|the form|fill out|not an emergency|non-?emergency|no emergency|routine)\b/i.test(lower)
        ) {
          return { ok: true, value: "no" };
        }
        if (
          /\b(not an emergency|non-?emergency|no emergency|routine|maintenance)\b/i.test(raw) ||
          /^(no|n|nope)\.?$/i.test(t) ||
          /\bno\b/i.test(lower)
        ) {
          return { ok: true, value: "no" };
        }
        return {
          ok: false,
          error: "Say yes if you want to continue with this routine form, or say it is still an emergency.",
        };
      }
      const s = raw.trim().toLowerCase();
      if (
        /\b(not an emergency|non-?emergency|no emergency|routine|maintenance request|for maintenance|false alarm|never mind|changed my mind|actually no|not anymore|it's not|its not)\b/i.test(
          raw
        )
      ) {
        return { ok: true, value: "no" };
      }
      if (/^(yes|y|yeah|yep)\.?$/i.test(s) || /\byes\b/i.test(raw)) {
        return { ok: true, value: "yes" };
      }
      if (/^(no|n|nope)\.?$/i.test(s) || /^no\b/i.test(raw) || /\bno\b/i.test(raw)) {
        return { ok: true, value: "no" };
      }
    }
    let pick = residentialPickRadio(raw, field.options || []);
    if (!pick && field.schemaKey === "workType" && issueHint) {
      for (const h of RESIDENTIAL_WORKTYPE_HINTS) {
        if (h.test.test(issueHint)) {
          const match = (field.options || []).find((o) => o.value === h.value);
          if (match && /\b(yes|yep|correct|that|right)\b/i.test(raw)) {
            pick = match;
            break;
          }
        }
      }
    }
    if (!pick) {
      pick = residentialPickRadio(raw, field.options || []);
    }
    if (!pick) {
      return {
        ok: false,
        error: "Couldn't match an option — say one of the labels, or a short phrase (e.g. **light electrical**).",
      };
    }
    if (field.schemaKey === "surfaceDiscoloration" && (!pick.value || pick.value === "") && /other/i.test(raw)) {
      return { ok: true, value: "__other__" };
    }
    return { ok: true, value: pick.value };
  }

  return { ok: false, error: "Unsupported field type." };
}

/**
 * Ordered list of schema keys still empty (profile-driven intake checklist).
 * Does not include building/floor/room — those are filled in the location handoff.
 */
function residentialEnumerateMissingSchemaKeys(profile, answers) {
  const keys = [];
  const a = answers || {};
  if (a.emergency == null) {
    keys.push("emergency");
    return keys;
  }
  if (a.emergency === "yes") {
    keys.push("emergency");
    return keys;
  }

  if (a.workType == null) {
    keys.push("workType");
    return keys;
  }

  const s2 = profile.stages[1];
  const branch = s2.branches[a.workType];
  function walkBranch(br) {
    if (!br) return;
    for (const f of br.fields || []) {
      if (f.type === "static") {
        const flag = "__read_" + f.schemaKey;
        if (!a[flag]) keys.push(flag);
        continue;
      }
      if (!residentialFieldVisible(f, a)) continue;
      const sk = f.schemaKey;
      if (f.type === "radio" && a[sk] == null) keys.push(sk);
      else if (f.type === "checkbox" && a[sk] == null) keys.push(sk);
      else if ((f.type === "text" || f.type === "date" || f.type === "textarea") && a[sk] == null) keys.push(sk);
    }
    if (br.nested && a.doorsWindowsBlinds && br.nested[a.doorsWindowsBlinds]) {
      walkBranch(br.nested[a.doorsWindowsBlinds]);
    }
  }
  walkBranch(branch);

  for (const f of s2.commonTail || []) {
    if (a[f.schemaKey] == null) keys.push(f.schemaKey);
  }

  if (a.acknowledge == null) keys.push("acknowledge");

  if (a.contactNumber == null) keys.push("contactNumber");

  return keys;
}

function residentialRadioValueAllowed(field, val) {
  if (val == null) return false;
  const v = String(val);
  const opts = field.options || [];
  for (let i = 0; i < opts.length; i++) {
    const o = opts[i];
    if (o.value === v) return true;
    if (field.schemaKey === "surfaceDiscoloration" && v === "__other__" && (o.value === "" || /other/i.test(String(o.label || "")))) {
      return true;
    }
  }
  return false;
}

function residentialCheckboxValuesAllowed(field, vals) {
  const arr = Array.isArray(vals) ? vals : String(vals).split(/,|;/).map((s) => s.trim()).filter(Boolean);
  const allowed = new Set((field.options || []).map((o) => o.value));
  for (let i = 0; i < arr.length; i++) {
    if (!allowed.has(arr[i])) return false;
  }
  return arr.length > 0;
}

/**
 * Merge LLM fieldUpdates into answers; only keeps values that match the profile (intake-first safety).
 * Re-applies in passes so parent radios (e.g. doorsWindowsBlinds) land before nested (ceiling).
 * @returns {{ merged: Record<string, string>, dropped: string[] }}
 */
function residentialSanitizeFieldUpdates(profile, answers, updates) {
  const dropped = [];
  const merged = Object.assign({}, answers || {});
  const pending = Object.assign({}, updates || {});

  function tryBranchField(branch, k, val) {
    if (!branch) return false;
    for (let fi = 0; fi < (branch.fields || []).length; fi++) {
      const f = branch.fields[fi];
      if (!f || f.schemaKey !== k) continue;
      if (f.type === "radio") {
        if (residentialRadioValueAllowed(f, val)) {
          let vv = String(val);
          if (f.schemaKey === "surfaceDiscoloration" && vv === "__other__") merged[k] = "";
          else merged[k] = vv;
          return true;
        }
      }
      if (f.type === "checkbox" && f.schemaKey === "pestType") {
        if (residentialCheckboxValuesAllowed(f, val)) {
          const arr = Array.isArray(val) ? val : String(val).split(/,|;/).map((s) => s.trim()).filter(Boolean);
          merged[k] = arr.join(",");
          return true;
        }
      }
      if (f.type === "text" || f.type === "date" || f.type === "textarea") {
        if (residentialFieldVisible(f, merged) && val != null && String(val).trim().length) {
          merged[k] = String(val).trim();
          return true;
        }
      }
    }
    if (branch.nested && merged.doorsWindowsBlinds && branch.nested[merged.doorsWindowsBlinds]) {
      return tryBranchField(branch.nested[merged.doorsWindowsBlinds], k, val);
    }
    return false;
  }

  function tryOneKey(k, val) {
    if (k.indexOf("__read_") === 0) {
      if (val) merged[k] = "yes";
      return true;
    }
    if (k === "emergency") {
      const vv = String(val).toLowerCase();
      if (vv === "yes" || vv === "no") {
        merged.emergency = vv;
        return true;
      }
      return false;
    }
    if (k === "workType") {
      const wtField = profile.stages[1].fields[0];
      if (residentialRadioValueAllowed(wtField, val)) {
        merged.workType = String(val);
        return true;
      }
      return false;
    }
    if (k === "brief" || k === "acknowledge" || k === "contactName" || k === "contactNumber" || k === "contactEmail") {
      if (val != null && String(val).trim().length) {
        merged[k] = String(val).trim();
        return true;
      }
      return false;
    }
    const wt = merged.workType;
    if (!wt) return false;
    const branch = profile.stages[1].branches[wt];
    return tryBranchField(branch, k, val);
  }

  for (let pass = 0; pass < 24; pass++) {
    const keys = Object.keys(pending);
    if (!keys.length) break;
    let progressed = false;
    for (let i = 0; i < keys.length; i++) {
      const k = keys[i];
      const val = pending[k];
      if (tryOneKey(k, val)) {
        delete pending[k];
        progressed = true;
      }
    }
    if (!progressed) break;
  }

  Object.keys(pending).forEach(function (k) {
    dropped.push(k);
  });

  if (merged.acknowledge != null && String(merged.acknowledge).toLowerCase() === "yes") merged.acknowledge = "yes";

  return { merged, dropped };
}
