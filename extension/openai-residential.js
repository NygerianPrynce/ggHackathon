/**
 * OpenAI-assisted extraction for residential flow: infer multiple form fields from natural language.
 * API key: set self.OPENAI_API_KEY in openai-secrets.js (gitignored) — see openai-secrets.example.js
 */
/* global RESIDENTIAL_HALL_ROOM_MAINTENANCE residentialEnumerateMissingSchemaKeys */

function getOpenAIApiKey() {
  try {
    return typeof self !== "undefined" && self.OPENAI_API_KEY ? String(self.OPENAI_API_KEY).trim() : "";
  } catch (e) {
    return "";
  }
}

function residentialBuildLLMContext(profile, answers) {
  var lines = [];
  lines.push("=== Allowed exact values (radio/checkbox must match EXACTLY) ===");
  lines.push("emergency: yes | no");
  var s2 = profile.stages[1];
  var wtField = s2.fields[0];
  lines.push(
    "workType: " +
      wtField.options
        .map(function (o) {
          return '"' + o.value + '"';
        })
        .join(", ")
  );

  var branches = s2.branches || {};
  var bname;
  for (bname in branches) {
    if (!Object.prototype.hasOwnProperty.call(branches, bname)) continue;
    var branch = branches[bname];
    lines.push('\n--- If workType is "' + bname + '" ---');
    var fi;
    for (fi = 0; fi < (branch.fields || []).length; fi++) {
      var f = branch.fields[fi];
      if (f.type === "radio" && f.options) {
        lines.push(
          f.schemaKey +
            " (radio): " +
            f.options
              .map(function (o) {
                return '"' + o.value + '"';
              })
              .join(" | ")
        );
      }
      if (f.type === "checkbox" && f.options) {
        lines.push(
          f.schemaKey +
            " (checkbox, one or more): " +
            f.options
              .map(function (o) {
                return '"' + o.value + '"';
              })
              .join(" | ")
        );
      }
      if (f.type === "text" || f.type === "date") {
        lines.push(f.schemaKey + " (" + f.type + "): free text");
      }
    }
    var nested = branch.nested;
    if (nested) {
      var subk;
      for (subk in nested) {
        if (!Object.prototype.hasOwnProperty.call(nested, subk)) continue;
        var nb = nested[subk];
        lines.push('nested under doorsWindowsBlinds="' + subk + '":');
        for (fi = 0; fi < (nb.fields || []).length; fi++) {
          f = nb.fields[fi];
          if (f.type === "radio" && f.options) {
            lines.push(
              "  " +
                f.schemaKey +
                ": " +
                f.options
                  .map(function (o) {
                    return '"' + o.value + '"';
                  })
                  .join(" | ")
            );
          }
        }
      }
    }
  }
  lines.push("\nbrief (textarea): free text — describe work needed.");
  lines.push("acknowledge (page 3): user affirms — store as yes.");
  lines.push("contactName, contactNumber, contactEmail (page 4): text.");

  var wt = answers.workType;
  if (wt) {
    lines.push('\nCurrent workType in session: "' + wt + '" — prefer fields under that branch.');
  }
  return lines.join("\n");
}

/**
 * Structured slice of the form PROFILE for the conceptual page (matches residential_page).
 * Gives the model schema + purpose of each field without dumping the whole PDF.
 */
function residentialBuildProfileSliceForPage(profile, page, answers) {
  var lines = [];
  var stages = profile.stages;
  if (!stages || page < 1 || page > stages.length) {
    return "Profile: unknown page index.";
  }
  var stage = stages[page - 1];
  lines.push("FORM_PROFILE stage " + page + " — " + (stage.label || "") + " (id " + (stage.id || page) + ")");

  function appendFieldList(title, fields) {
    if (!fields || !fields.length) return;
    lines.push(title);
    var fi;
    for (fi = 0; fi < fields.length; fi++) {
      var f = fields[fi];
      if (!f || f.type === "static") {
        if (f && f.label) lines.push("  [notice] " + String(f.label).slice(0, 160));
        continue;
      }
      var row = "  • " + f.schemaKey + " [" + f.type + "]";
      if (f.label) row += " — " + String(f.label).slice(0, 140);
      lines.push(row);
      if (f.type === "radio" && f.options && f.options.length) {
        var vals = f.options
          .slice(0, 12)
          .map(function (o) {
            return o.value;
          })
          .join("; ");
        lines.push("    allowed values: " + vals);
      }
    }
  }

  appendFieldList("Fields:", stage.fields || []);

  if (page === 2) {
    if (answers.workType && stage.branches) {
      var br = stage.branches[answers.workType];
      if (br) {
        appendFieldList('Branch fields when workType is "' + answers.workType + '":', br.fields || []);
        if (br.nested && answers.doorsWindowsBlinds && br.nested[answers.doorsWindowsBlinds]) {
          appendFieldList(
            'Nested under doors/windows choice "' + answers.doorsWindowsBlinds + '":',
            br.nested[answers.doorsWindowsBlinds].fields || []
          );
        }
      }
    }
    appendFieldList("After category questions, everyone completes:", stage.commonTail || []);
  }

  return lines.join("\n");
}

/**
 * Tells the model what the user actually sees so followUpQuestion stays on-theme.
 */
function residentialBuildStageGuidance(profile, page, pendingField, domSnapshot) {
  var keys = (domSnapshot && domSnapshot.schemaKeys) || [];
  var keySet = {};
  var i;
  for (i = 0; i < keys.length; i++) {
    keySet[keys[i]] = true;
  }
  var pendingKey = pendingField && pendingField.schemaKey;
  var pendingLabel = pendingField && pendingField.label;
  var lines = [];

  lines.push("CURRENT_STEP_RULES (you MUST follow these for followUpQuestion and tone):");
  lines.push("");

  if (page === 1) {
    lines.push("- Screen: Emergency only (fire/flood/loss of power vs routine).");
    lines.push("- followUpQuestion must ONLY address emergency vs non-emergency. Do NOT mention contact, phone, email, or building/room.");
    return lines.join("\n");
  }

  if (page === 2) {
    lines.push("- Screen: Pick work category (workType), follow-up radios for that category, then a written description in the **brief** textarea.");
    lines.push(
      "- Correlate **visibleFormSchemaKeys** / DOM with the Residential profile branches: ask only what is still missing for that work type, and fill fieldUpdates as the user answers — do not wait for the UI to catch up before asking the next missing detail."
    );
    lines.push("- DOM shows these schema areas (may include): " + (keys.length ? keys.join(", ") : "(unknown)"));
    if (pendingLabel) {
      lines.push("- App is currently asking for field: **" + pendingKey + "** — " + String(pendingLabel).slice(0, 120));
    }
    if (keySet.brief || pendingKey === "brief") {
      lines.push(
        "- User sees the big box: \u201cDescribe what is needed\u2026\u201d \u2014 ask about **details of the repair** (what broke, where exactly, what they noticed, access). Sound supportive. Do NOT ask about urgency or how soon it needs to be fixed."
      );
      lines.push("- Do NOT ask them to share phone, email, or “contact maintenance” here — that happens on a **later Review** screen.");
    }
    if (keySet.electrical || pendingKey === "electrical") {
      lines.push("- Topic: electrical sub-issue (e.g. light out). Stay in that lane.");
    }
    if (keySet.workType || pendingKey === "workType") {
      lines.push("- Topic: choosing the main work category — stay in that lane.");
    }
    lines.push("- FORBIDDEN on page 2: asking for contact info, callback number, or email for staff.");
    return lines.join("\n");
  }

  if (page === 3) {
    lines.push("- Screen: After-hours notice + acknowledge + **building / floor / room** location.");
    lines.push("- followUpQuestion should match: acknowledgment and/or where the issue is. Do NOT ask for work-type details already past.");
    if (keySet.acknowledge || pendingKey === "acknowledge") {
      lines.push("- User may need to acknowledge after-hours — keep questions about that + location.");
    }
    lines.push("- Still do NOT ask for Review-page contact fields unless DOM shows contactName/contactNumber on this screen (rare).");
    return lines.join("\n");
  }

  if (page === 4) {
    lines.push("- Screen: **Review** — work order summary + **contact name / phone / email** for the request.");
    lines.push("- DOM schema keys: " + (keys.length ? keys.join(", ") : "unknown"));
    lines.push("- HERE it is appropriate to mention confirming how maintenance can reach them (name, phone, email) if those fields are visible or still needed.");
    return lines.join("\n");
  }

  lines.push("- Unknown page — keep followUpQuestion aligned with pending field: " + (pendingKey || "n/a"));
  return lines.join("\n");
}

/** Last line of defense if the model still mentions contact info or urgency on the wrong step. */
function sanitizeFollowUpQuestionForStage(page, fq) {
  if (!fq || typeof fq !== "string") return null;
  var t = fq.trim();
  // Strip urgency questions on any page — emergency is handled separately
  if (/\b(how urgent|urgently|urgency|how soon|how quickly|time.sensitive|priority|how important)\b/i.test(t)) {
    return null;
  }
  if (page === 2) {
    if (
      /\b(phone|email|contact info|contact information|share your contact|callback|reach you at|text you|call you back)\b/i.test(
        t
      )
    ) {
      return null;
    }
  }
  if (page === 1) {
    if (/\b(phone|email|room number|building)\b/i.test(t) && !/\b(911|emergency|life|safety|fire|flood)\b/i.test(t)) {
      return null;
    }
  }
  return t;
}

/**
 * @param {{
 *   userText: string,
 *   issueText: string,
 *   answers: Record<string, string>,
 *   page: number,
 *   pendingField: { schemaKey?: string, label?: string } | null,
 *   domSnapshot: object | null,
 *   conversation: { role: string, content: string }[],
 * }} payload
 * @returns {Promise<{ fieldUpdates: Record<string, unknown>, followUpQuestion: string | null } | null>}
 */
async function residentialOpenAIExtract(payload) {
  var key = getOpenAIApiKey();
  if (!key) return null;

  var profile = typeof RESIDENTIAL_HALL_ROOM_MAINTENANCE !== "undefined" ? RESIDENTIAL_HALL_ROOM_MAINTENANCE : null;
  if (!profile) return null;

  var context = residentialBuildLLMContext(profile, payload.answers || {});
  var conv = (payload.conversation || []).slice(-12);
  var stageGuidance = residentialBuildStageGuidance(
    profile,
    payload.page,
    payload.pendingField || null,
    payload.domSnapshot || null
  );
  var profileSlice = residentialBuildProfileSliceForPage(profile, payload.page, payload.answers || {});
  var missingKeys =
    typeof residentialEnumerateMissingSchemaKeys === "function"
      ? residentialEnumerateMissingSchemaKeys(profile, payload.answers || {})
      : [];
  var userPayload = {
    formPage: payload.page,
    originalIssueFromUser: payload.issueText || "",
    userLatestMessage: payload.userText || "",
    pendingFieldSchemaKey: payload.pendingField && payload.pendingField.schemaKey,
    pendingFieldLabel: payload.pendingField && payload.pendingField.label,
    visibleFormSchemaKeys: (payload.domSnapshot && payload.domSnapshot.schemaKeys) || [],
    visibleLabeledFields: (payload.domSnapshot && payload.domSnapshot.labeledFields) || [],
    formProfileSliceForThisPage: profileSlice,
    currentStageGuidance: stageGuidance,
    answersSoFar: payload.answers || {},
    missingSchemaKeys: missingKeys,
    domHeadline: payload.domSnapshot && payload.domSnapshot.headline,
    recentConversation: conv,
  };

  var system =
    "You are the conversational brain for a Vanderbilt ReADY **Residential Hall** maintenance assistant. " +
    "The app fills the real form in the browser; you output (1) structured fieldUpdates when you can infer them, and (2) followUpQuestion — the ONLY message the user reads next. " +
    "\n\nMEMORY: Read originalIssueFromUser and recentConversation. If they already said e.g. “my light isn’t working,” remember it — refer back (“the light issue you mentioned”) and do NOT ask them to repeat the same fact unless clarifying details. " +
    "\n\nPAGE + SCHEMA: Use formProfileSliceForThisPage (official field list for this step) together with visibleLabeledFields / visibleFormSchemaKeys (what is literally on screen). Stay on this step’s topic. " +
    "\n\nDECISIONS: " +
    "(A) Put fieldUpdates when the user’s words map clearly to allowed radio/checkbox values (exact strings from the form reference). Prefer filling **missingSchemaKeys** when you can infer them — you may fill several fields in one turn (e.g. lights out → workType light/electrical, electrical light out, and a short brief). " +
    "(B) If something important is still missing or vague for THIS step — especially the written brief when it’s thin — set followUpQuestion to ONE short, natural question they can answer by voice (e.g. what exactly happens, what they think needs fixing, access). Do NOT ask about urgency — that is handled separately. " +
    "(C) If fieldUpdates are enough for the moment, followUpQuestion can be null OR a brief warm check-in. " +
    "\n\nTONE: followUpQuestion must sound like a real person texting — not like a form label. NEVER paste or closely paraphrase long on-screen question titles from visibleLabeledFields. Do not use ALL CAPS boilerplate. Ask one clear question they can answer. " +
    "followUpQuestion must be plain sentences only: no markdown asterisks, no bullet characters, no numbered lists—this text is read aloud (ElevenLabs). " +
    "\n\nSCOPE: On page 2 do NOT ask for phone, email, or contact for maintenance (that is page 4). On page 1 output **only** emergency in fieldUpdates (yes/no) if inferable — never workType or branch fields on page 1. If emergency is life-safety yes, only emergency in fieldUpdates; do not advance other fields in the same JSON. " +
    "\n\nOutput JSON only: { \"fieldUpdates\": { }, \"followUpQuestion\": string | null }. " +
    "Use exact option values from the form reference for radios/checkboxes. Omit keys you are unsure about.";

  try {
    var res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + key,
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        temperature: 0.4,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: system + "\n\n=== Form value reference ===\n" + context },
          {
            role: "user",
            content: JSON.stringify(userPayload),
          },
        ],
      }),
    });
    if (!res.ok) {
      return null;
    }
    var data = await res.json();
    var content = data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
    if (!content) return null;
    var parsed = JSON.parse(content);
    var updates = parsed.fieldUpdates || parsed.field_updates || parsed.fields || {};
    if (!updates || typeof updates !== "object") updates = {};
    var fq = parsed.followUpQuestion != null ? String(parsed.followUpQuestion).trim() : "";
    var fqSafe = sanitizeFollowUpQuestionForStage(payload.page, fq || null);
    return {
      fieldUpdates: updates,
      followUpQuestion: fqSafe,
    };
  } catch (e) {
    return null;
  }
}

/** Regex fallback when API is off or fails */
function normalizeLocationFallback(kind, raw) {
  var t = String(raw || "").trim();
  if (!t) return t;
  var k = kind;
  if (k === "building") {
    var m = t.match(/(?:dorm|building|hall|is|at|in)\s+([A-Za-z][A-Za-z\s'-]{1,48})/i);
    if (m) return m[1].replace(/\s+/g, " ").trim();
    var words = t.replace(/[^\w\s'-]/g, " ").trim().split(/\s+/).filter(Boolean);
    if (words.length) return words.slice(-3).join(" ");
    return t;
  }
  if (k === "floor") {
    var f1 = t.match(/\b(\d{1,2})(?:st|nd|rd|th)?\s*floor\b/i);
    if (f1) return f1[1];
    var f2 = t.match(/\bfloor\s*#?\s*(\d+)\b/i);
    if (f2) return f2[1];
    var f3 = t.match(/\b(\d{1,2})\b/);
    if (f3) return f3[1];
    return t;
  }
  if (k === "room") {
    var r1 = t.match(/\b(\d{3,5}[A-Za-z]?)\b/);
    if (r1) return r1[1];
    var r2 = t.match(/room\s*#?\s*([A-Za-z0-9-]+)/i);
    if (r2) return r2[1];
    var digits = t.replace(/\D/g, "");
    if (digits.length >= 2) return digits.slice(0, 6);
    return t;
  }
  return t;
}

/**
 * Strip filler ("my dorm is…", "3rd floor") for Select2 search.
 * @param {"building"|"floor"|"room"} kind
 * @param {string} raw
 * @returns {Promise<{ value: string }>}
 */
async function normalizeLocationUtterance(kind, raw) {
  var text = String(raw || "").trim();
  if (!text) return { value: "" };
  var key = getOpenAIApiKey();
  if (!key) {
    return { value: normalizeLocationFallback(kind, text) };
  }
  try {
    var res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + key,
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        temperature: 0.1,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content:
              'Extract a short string for a housing form dropdown search. Output JSON: { "value": string }. ' +
                "building: ONLY the building name (e.g. Stambaugh from 'my dorm is Stambaugh'). " +
                "floor: Prefer a single digit or small number if they said '3rd floor' → '3'. Otherwise a short label like 'Third Floor'. " +
                "room: ONLY room number or code (e.g. 4102 from 'room 4102'). " +
                "No quotes, no extra words.",
          },
          { role: "user", content: JSON.stringify({ kind: kind, raw: text }) },
        ],
      }),
    });
    if (!res.ok) {
      return { value: normalizeLocationFallback(kind, text) };
    }
    var data = await res.json();
    var content = data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
    if (!content) return { value: normalizeLocationFallback(kind, text) };
    var parsed = JSON.parse(content);
    var v = parsed.value != null ? String(parsed.value).trim() : "";
    if (!v) return { value: normalizeLocationFallback(kind, text) };
    return { value: v };
  } catch (_e) {
    return { value: normalizeLocationFallback(kind, text) };
  }
}

/**
 * Guess name/email from free-text issue for review autofill (no extra prompts).
 */
async function extractReviewNameEmail(issueText) {
  var key = getOpenAIApiKey();
  var text = String(issueText || "").trim();
  if (!key || !text) {
    return { contactName: null, contactEmail: null };
  }
  try {
    var res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + key,
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        temperature: 0.1,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content:
              'From the user\'s maintenance issue text, extract JSON only: { "contactName": string|null, "contactEmail": string|null }. ' +
                "Only include a name if clearly stated. Only include email if it looks like an email. Otherwise null.",
          },
          { role: "user", content: text.slice(0, 800) },
        ],
      }),
    });
    if (!res.ok) return { contactName: null, contactEmail: null };
    var data = await res.json();
    var content = data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
    if (!content) return { contactName: null, contactEmail: null };
    var parsed = JSON.parse(content);
    return {
      contactName: parsed.contactName != null ? String(parsed.contactName).trim() || null : null,
      contactEmail: parsed.contactEmail != null ? String(parsed.contactEmail).trim() || null : null,
    };
  } catch (_e) {
    return { contactName: null, contactEmail: null };
  }
}

/**
 * One-shot intake from the initial issue line (before the user answers step-by-step).
 * Fills fieldUpdates using the same value reference as the main extract path.
 */
async function residentialOpenAIIntakeBootstrap(issueText) {
  var key = getOpenAIApiKey();
  if (!key) return null;
  var profile = typeof RESIDENTIAL_HALL_ROOM_MAINTENANCE !== "undefined" ? RESIDENTIAL_HALL_ROOM_MAINTENANCE : null;
  if (!profile) return null;
  var text = String(issueText || "").trim();
  if (!text) return null;
  var context = residentialBuildLLMContext(profile, {});
  var system =
    "You extract structured intake fields for a Vanderbilt Residential Hall maintenance request from the user's FIRST message only (the issue description). " +
    'Output JSON only: { "fieldUpdates": { } } using EXACT radio/checkbox strings from the form reference. ' +
    "Infer emergency=no unless they clearly describe fire, serious flooding, or complete loss of power (then yes). " +
    "Infer workType from keywords (e.g. lights, outlet, breaker → light/electrical). Fill branch radios when the issue clearly matches one option. " +
    "Put a concise summary in brief when it helps maintenance understand the request. " +
    "Do NOT invent building, floor, room, or phone number — omit those keys. " +
    "Omit any key you cannot justify from this message alone.";

  try {
    var res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + key,
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        temperature: 0.25,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: system + "\n\n=== Form value reference ===\n" + context },
          { role: "user", content: text.slice(0, 3500) },
        ],
      }),
    });
    if (!res.ok) return null;
    var data = await res.json();
    var content = data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
    if (!content) return null;
    var parsed = JSON.parse(content);
    var updates = parsed.fieldUpdates || parsed.field_updates || {};
    if (!updates || typeof updates !== "object") updates = {};
    return { fieldUpdates: updates };
  } catch (_e) {
    return null;
  }
}

async function generateVariedQuestion(baseQuestion, issueText, opts) {
  var apiKey = getOpenAIApiKey();
  if (!apiKey) return baseQuestion;
  var noUrgency = opts && opts.noUrgency;
  try {
    var res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": "Bearer " + apiKey,
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        temperature: 1.1,
        max_tokens: 60,
        messages: [
          {
            role: "system",
            content:
              "You are a friendly help desk agent on the phone helping a student submit a maintenance request. " +
              "Rephrase the given question naturally in one sentence. Vary your wording each time — don't repeat the same phrasing. " +
              "Keep the exact same meaning and required information. " +
              (noUrgency ? "Do NOT ask about urgency, priority, or how soon the issue needs to be addressed. " : "") +
              "Return only the rephrased question with no quotes or extra text.",
          },
          {
            role: "user",
            content: 'Issue: "' + (issueText || "").slice(0, 200) + '"\nRephrase: "' + baseQuestion + '"',
          },
        ],
      }),
    });
    if (!res.ok) return baseQuestion;
    var data = await res.json();
    var content =
      data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
    return (content && content.trim()) || baseQuestion;
  } catch (_e) {
    return baseQuestion;
  }
}

if (typeof self !== "undefined") {
  self.residentialOpenAIExtract = residentialOpenAIExtract;
  self.residentialOpenAIIntakeBootstrap = residentialOpenAIIntakeBootstrap;
  self.normalizeLocationUtterance = normalizeLocationUtterance;
  self.extractReviewNameEmail = extractReviewNameEmail;
  self.generateVariedQuestion = generateVariedQuestion;
}
