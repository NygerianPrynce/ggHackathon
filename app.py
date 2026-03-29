"""
Voice-to-Form Maintenance Reporter — Backend
Flask server + AppleScript/JS automation for Vanderbilt ReADY system.

Uses macOS AppleScript to open a new TAB in the user's existing Chrome
and injects <script> tags that run in the page's JS context (giving
access to jQuery/Meteor/Select2) to fill out the multi-step form.

ONE-TIME SETUP:
  In Chrome → View → Developer → ✓ Allow JavaScript from Apple Events
"""

import json
import time
import threading
import subprocess
from flask import Flask, render_template, request, jsonify

app = Flask(__name__)

# ─────────────────────────────────────────────
#  Configuration
# ─────────────────────────────────────────────
READY_URL = "https://ready.app.vanderbilt.edu/ready"

# Map keywords in user speech → ReADY template card IDs
# These IDs come from the actual ReADY page DOM
CATEGORY_KEYWORDS = {
    "DqBtyxFmaj4FNJNFZ": {
        "name": "Temperature/HVAC",
        "keywords": ["temperature", "hvac", "hot", "cold", "heat", "ac", "air conditioning",
                     "thermostat", "air filter", "filter", "vent", "ventilation", "cool",
                     "warm", "freezing", "boiling"]
    },
    "zqmrxp5aZxTf6jbem": {
        "name": "Leaks/Gas Leaks",
        "keywords": ["leak", "leaking", "water leak", "gas leak", "drip", "dripping",
                     "flooding", "flood", "water damage", "pipe"]
    },
    "phf3HbLdpD6eDhYko": {
        "name": "Plumbing Fixtures",
        "keywords": ["plumbing", "toilet", "sink", "faucet", "drain", "clog", "clogged",
                     "shower", "bathtub", "water fountain", "fountain", "water pressure"]
    },
    "LatFPA6SkypytJAKY": {
        "name": "Electrical",
        "keywords": ["electrical", "electric", "outlet", "light", "lights", "power",
                     "switch", "wiring", "circuit", "breaker", "lamp", "bulb"]
    },
    "ou4Zow2YbimZytRSr": {
        "name": "Elevator",
        "keywords": ["elevator", "lift", "escalator"]
    },
    "Gabh7SriB59jdscgA": {
        "name": "Grounds",
        "keywords": ["grounds", "landscaping", "tree", "grass", "sidewalk", "parking",
                     "snow", "ice", "pothole"]
    },
    "yZu5BcaGKbGTLDMei": {
        "name": "Pest Control",
        "keywords": ["pest", "bug", "bugs", "roach", "roaches", "mouse", "mice", "rat",
                     "ant", "ants", "spider", "insect", "rodent", "exterminator"]
    },
    "KPPNddEbj7PDHD5vr": {
        "name": "Dispensers",
        "keywords": ["dispenser", "soap", "paper towel", "hand sanitizer", "toilet paper"]
    },
    "cknuy2X6r6MzpPTCd": {
        "name": "Accessibility",
        "keywords": ["accessibility", "accessible", "ada", "ramp", "wheelchair", "handicap",
                     "door opener"]
    },
    "AbBqKfD42693wkgkn": {
        "name": "Card Reader",
        "keywords": ["card reader", "card swipe", "door lock", "access", "badge", "key card",
                     "commodore card"]
    },
    "nCNEaYerZReeEF9WK": {
        "name": "Residential Hall Room Maintenance Issue",
        "keywords": ["dorm", "residence", "residential", "room maintenance", "room issue"]
    },
    "aKTFsEXAznE83ruhx": {
        "name": "Greek House Room Maintenance Issue",
        "keywords": ["greek", "fraternity", "sorority", "greek house"]
    },
}

# ─────────────────────────────────────────────
#  Session State — tracks the active bot session
# ─────────────────────────────────────────────
bot_session = {
    "active": False,
    "tab_open": False,
    "step": None,           # "waiting_for_info" | "filling_form" | "done" | "error"
    "pending_question": None,
    "issue_text": "",
    "category_id": None,
    "category_name": None,
    "building": None,
    "floor": None,
    "room": None,
    "error_message": None,
}


def reset_session():
    bot_session.update({
        "active": False,
        "tab_open": False,
        "step": None,
        "pending_question": None,
        "issue_text": "",
        "category_id": None,
        "category_name": None,
        "building": None,
        "floor": None,
        "room": None,
        "error_message": None,
    })


# ─────────────────────────────────────────────
#  Routes
# ─────────────────────────────────────────────
@app.route("/")
def index():
    """Serve the mobile-friendly voice UI."""
    return render_template("index.html")


@app.route("/run-bot", methods=["POST"])
def run_bot():
    """
    Receive the transcribed issue text from the frontend.
    If the bot has a pending question, treat this as the answer.
    Otherwise, start a new request.
    """
    data = request.get_json(force=True)
    issue_text = data.get("issue", "").strip()

    if not issue_text:
        return jsonify({"status": "error", "message": "No issue text received."}), 400

    # If there's a pending question, this is the answer
    if bot_session["step"] == "waiting_for_info":
        question_type = bot_session["pending_question"]
        bot_session["pending_question"] = None
        bot_session["step"] = "filling_form"

        if question_type == "building":
            bot_session["building"] = issue_text
        elif question_type == "floor":
            bot_session["floor"] = issue_text
        elif question_type == "room":
            bot_session["room"] = issue_text

        # Continue filling the form in background
        thread = threading.Thread(
            target=run_with_error_handling, args=(continue_form_fill,), daemon=True
        )
        thread.start()
        return jsonify({
            "status": "ok",
            "message": f"Got it! Filling in: {issue_text}"
        })

    # New request — parse and start
    reset_session()
    bot_session["active"] = True
    bot_session["issue_text"] = issue_text

    # Match category
    category_id, category_name = match_category(issue_text)
    bot_session["category_id"] = category_id
    bot_session["category_name"] = category_name

    # Try to extract building from text
    building = extract_building(issue_text)
    bot_session["building"] = building

    # Start (or ask for missing info)
    thread = threading.Thread(target=run_with_error_handling, args=(fill_ready_form,), daemon=True)
    thread.start()

    return jsonify({
        "status": "ok",
        "message": f"Starting ReADY bot — Category: {category_name}"
    })


@app.route("/bot-status", methods=["GET"])
def get_bot_status():
    """
    Frontend polls this to check if the bot needs more info.
    Returns pending questions for the user to answer via voice.
    """
    if bot_session["step"] == "waiting_for_info" and bot_session["pending_question"]:
        question_map = {
            "building": "🏢 Answer this: What BUILDING is this issue in? (e.g., 'Stevenson Center', 'Rand Hall')",
            "floor": "📐 Answer this: What FLOOR is the issue on? (e.g., 'First Floor', 'Basement')",
            "room": "🚪 Answer this: What ROOM NUMBER? (e.g., '101', '2B'). Say 'skip' if you don't know.",
        }
        return jsonify({
            "status": "waiting",
            "question": question_map.get(bot_session["pending_question"], "Please provide more details."),
            "question_type": bot_session["pending_question"],
        })

    if bot_session["step"] == "error":
        return jsonify({
            "status": "error",
            "message": bot_session.get("error_message", "An unknown error occurred.")
        })

    return jsonify({
        "status": bot_session["step"] or "idle",
        "question": None,
    })


# ─────────────────────────────────────────────
#  Thread Error Handler
# ─────────────────────────────────────────────
def run_with_error_handling(func, *args, **kwargs):
    """Run a function and catch any exceptions to surface them to the UI."""
    try:
        func(*args, **kwargs)
    except Exception as e:
        print(f"\n   ❌ Bot crashed: {e}")
        bot_session["step"] = "error"
        bot_session["error_message"] = str(e)



# ─────────────────────────────────────────────
#  Text Analysis — Category + Building extraction
# ─────────────────────────────────────────────
def match_category(issue_text: str):
    """Match the user's issue text to a ReADY template category."""
    text_lower = issue_text.lower()
    
    # EXACT OVERRIDE for Residential Room issues:
    if "my room" in text_lower or "in my room" in text_lower:
        return ("nCNEaYerZReeEF9WK", "Residential Hall Room Maintenance Issue")

    best_match = None
    best_score = 0

    for cat_id, cat_info in CATEGORY_KEYWORDS.items():
        score = sum(1 for kw in cat_info["keywords"] if kw in text_lower)
        if score > best_score:
            best_score = score
            best_match = (cat_id, cat_info["name"])

    # Default to Temperature/HVAC if no match
    if best_match is None:
        best_match = ("DqBtyxFmaj4FNJNFZ", "Temperature/HVAC")

    return best_match


def extract_building(issue_text: str):
    """Try to extract a building name from the issue text."""
    text_lower = issue_text.lower()
    # Common VU building names
    buildings = [
        "Stevenson", "Rand", "Kirkland", "Sarratt", "Light Hall",
        "Wilson", "Blair", "Peabody", "Engineering", "Featheringill",
        "Jacobs", "Buttrick", "Furman", "Garland", "Calhoun",
        "Alumni", "Commons", "Hank Ingram", "Murray", "Branscomb",
        "Kissam", "Zeppos", "E. Bronson Ingram", "Rothschild", "McGill",
        "Highland", "Lewis", "Tolman", "Memorial", "Wyatt",
        "McGugin", "Recreation", "Student Rec", "Vanderbilt"
    ]
    for bldg in buildings:
        if bldg.lower() in text_lower:
            return bldg
    return None


# ─────────────────────────────────────────────
#  AppleScript Helpers
# ─────────────────────────────────────────────
def run_applescript(script: str) -> str:
    """Execute an AppleScript and return its stdout."""
    result = subprocess.run(
        ["osascript", "-e", script],
        capture_output=True, text=True, timeout=30,
    )
    if result.returncode != 0 and result.stderr.strip():
        err = result.stderr.strip()
        print(f"   ⚠ AppleScript error: {err}")
        if "Executing JavaScript through AppleScript is turned off" in err:
            raise RuntimeError("Chrome requires setup: View > Developer > Allow JavaScript from Apple Events")
    return result.stdout.strip()


def inject_page_script(js_code: str) -> str:
    """
    Inject a <script> tag into the page so it runs in the PAGE'S
    JavaScript context (with access to jQuery, Meteor, Select2).
    Writes result to an invisible div that we read back.
    """
    # Wrap the user's code in a script tag injection
    wrapper = f'''(function() {{
    var prev = document.getElementById("__readybot_result");
    if (prev) prev.remove();
    var s = document.createElement("script");
    s.textContent = {json.dumps(js_code)};
    document.head.appendChild(s);
    return "injected";
}})();'''

    with open("/tmp/readybot_inject.js", "w") as f:
        f.write(wrapper)

    return run_applescript('''set jsCode to (do shell script "cat /tmp/readybot_inject.js")
tell application "Google Chrome"
    tell active tab of front window
        execute javascript jsCode
    end tell
end tell''')


def read_page_result(timeout_secs: int = 10) -> dict:
    """Read the result div written by an injected script."""
    for _ in range(timeout_secs * 2):
        time.sleep(0.5)
        raw = run_applescript('''tell application "Google Chrome"
    tell active tab of front window
        execute javascript "var el = document.getElementById(\\"__readybot_result\\"); el ? el.textContent : \\"__NOT_READY__\\";"
    end tell
end tell''')
        if raw and raw != "__NOT_READY__":
            try:
                return json.loads(raw)
            except json.JSONDecodeError:
                return {"raw": raw}
    return {"error": "timeout"}


def _click_next():
    """Click the Next button on the form."""
    print("\n➜  Clicking Next …")
    inject_page_script('''
        (function() {
            var btn = document.getElementById("requestScreenNext");
            if (btn) {
                btn.style.outline = "3px solid #CFAE70";
                setTimeout(function() { btn.click(); }, 500);
            }
        })();
    ''')
    time.sleep(3)
    print("   ✓  Advanced to next page.\n")


def _set_select2_value(element_id: str, search_term: str):
    """Open a Select2 dropdown, search, and click the first result."""
    safe_id = json.dumps(element_id)
    safe_term = json.dumps(search_term)

    inject_page_script(f'''
        (function() {{
            var $ = jQuery;
            var sel = $(document.getElementById({safe_id}));
            if (!sel.length) return;

            // Open the Select2 dropdown
            sel.select2("open");

            // Type the search term
            setTimeout(function() {{
                var sf = $(".select2-search__field");
                if (sf.length) {{
                    sf.val({safe_term}).trigger("input");
                }}
            }}, 500);

            // Click the first result
            setTimeout(function() {{
                var results = $(".select2-results__option");
                // Skip "No results" or loading
                var found = false;
                results.each(function() {{
                    var txt = $(this).text().trim().toLowerCase();
                    if (txt !== "no results found" && txt !== "searching…" && txt !== "loading…" && !found) {{
                        $(this).trigger("mouseup");
                        found = true;
                    }}
                }});
                // Write result
                var el = document.createElement("div");
                el.id = "__readybot_result";
                el.style.display = "none";
                el.textContent = JSON.stringify({{found: found, count: results.length}});
                document.body.appendChild(el);
            }}, 2500);
        }})();
    ''')

    result = read_page_result(5)
    if result.get("found"):
        print(f"   ✓  Select2 [{element_id}] → matched.")
        return True
    else:
        print(f"   ⚠  Select2 [{element_id}] → no match for '{search_term}'.")
        return False


# ─────────────────────────────────────────────
#  Form Mapping Logic — Core Flow
# ─────────────────────────────────────────────
def fill_ready_form(issue_text=None):
    """
    Core flow engine:
    1. Opens browser and navigates to ReADY
    2. Selects the template category
    3. Routes to the specific Template Strategy
    """
    issue = issue_text or bot_session["issue_text"]

    print(f"\n{'='*60}")
    print(f"  🤖  Starting ReADY bot")
    print(f"  📝  Issue: \"{issue}\"")
    print(f"  📂  Category: {bot_session['category_name']}")
    print(f"{'='*60}\n")

    # 1. Open new tab
    print("➜  Opening new tab in Chrome …")
    run_applescript(f'''tell application "Google Chrome"
    activate
    if (count of windows) = 0 then
        make new window
    end if
    tell front window
        make new tab with properties {{URL:"{READY_URL}"}}
    end tell
end tell''')
    bot_session["tab_open"] = True
    print("✓  Tab opened.\n")

    # 2. Wait for page load
    print("➜  Waiting for ReADY to load …")
    time.sleep(5)

    current_url = run_applescript('''tell application "Google Chrome"
    tell active tab of front window
        return URL
    end tell
end tell''')

    if "login" in current_url.lower() or "cas" in current_url.lower():
        print("   ⚠  Login page detected — waiting for manual login (90s) …")
        for i in range(90):
            time.sleep(1)
            url = run_applescript('''tell application "Google Chrome"
    tell active tab of front window
        return URL
    end tell
end tell''')
            if "login" not in url.lower() and "cas" not in url.lower():
                print(f"   ✓  Logged in after {i+1}s.\n")
                time.sleep(3)
                break
        else:
            print("   ⚠  Timed out. Aborting.\n")
            return
    else:
        print("   ✓  Already authenticated.\n")

    time.sleep(2)

    # 3. Click Template card
    cat_id = bot_session["category_id"]
    cat_name = bot_session["category_name"]
    print(f"➜  Selecting template: {cat_name} …")

    inject_page_script(f'''
        (function() {{
            var btn = document.getElementById("{cat_id}");
            if (btn) {{
                btn.scrollIntoView({{behavior: "smooth", block: "center"}});
                btn.style.outline = "3px solid #CFAE70";
                setTimeout(function() {{ btn.click(); }}, 600);
            }}
        }})();
    ''')
    time.sleep(3)
    print(f"   ✓  Clicked {cat_name}.\n")

    # Route to specific Template Strategy
    if cat_id == "nCNEaYerZReeEF9WK":
        _fill_residential_form()
    else:
        _fill_standard_form()


def continue_form_fill():
    """Resume form filling after user answers a question."""
    time.sleep(1)
    
    # Route resumption back to the proper Strategy
    if bot_session["category_id"] == "nCNEaYerZReeEF9WK":
        _resume_residential_location()
    else:
        _resume_standard_location()


# ─────────────────────────────────────────────
#  STRATEGY: Standard Forms (e.g. Temperature/HVAC)
# ─────────────────────────────────────────────
def _fill_standard_form():
    """
    Page 1: Location (Acknowledge, Contact, Building, Floor, Room) -> Next
    Page 2: Work Details
    """
    print("➜  Filling Page 1 — Location Details …")

    # Acknowledgment
    inject_page_script('''
        (function() {
            var ack = document.querySelector("input[name=aknowledge]");
            if (ack && !ack.checked) { ack.click(); }
        })();
    ''')
    time.sleep(0.5)

    # Contact preference
    inject_page_script('''
        (function() {
            var radios = document.querySelectorAll("input[name=alternateContactYN]");
            if (radios.length > 0) radios[0].click();
        })();
    ''')
    time.sleep(0.5)

    # Location Setup
    _handle_location_setup(callback=_finish_standard_form)


def _resume_standard_location():
    """Resume standard location page after answering question."""
    _handle_location_setup(callback=_finish_standard_form)


def _finish_standard_form():
    """Proceed to Page 2 of Standard Form and fill work details."""
    _click_next()

    issue = bot_session["issue_text"]
    print("➜  Filling Page 2 — Work Details …")

    safe_issue = json.dumps(issue.lower())
    inject_page_script(f'''
        (function() {{
            var text = {safe_issue};
            var checkboxes = document.querySelectorAll("input[name=problem]");
            checkboxes.forEach(function(cb) {{
                var label = cb.parentElement ? cb.parentElement.textContent.trim().toLowerCase() : "";
                if ((text.indexOf("hot") !== -1 || text.indexOf("warm") !== -1 || text.indexOf("heat") !== -1) && label.indexOf("too hot") !== -1) cb.click();
                if ((text.indexOf("cold") !== -1 || text.indexOf("freez") !== -1 || text.indexOf("cool") !== -1) && label.indexOf("too cold") !== -1) cb.click();
                if (text.indexOf("leak") !== -1 && label.indexOf("leak") !== -1) cb.click();
                if (text.indexOf("thermostat") !== -1 && label.indexOf("thermostat") !== -1) cb.click();
                if (text.indexOf("noise") !== -1 && label.indexOf("noise") !== -1) cb.click();
                if ((text.indexOf("exhaust") !== -1 || text.indexOf("fan") !== -1) && label.indexOf("exhaust") !== -1) cb.click();
                if ((text.indexOf("filter") !== -1 || text.indexOf("vent") !== -1) && label.indexOf("exhaust") !== -1) cb.click();
            }});
        }})();
    ''')
    time.sleep(1)

    _type_brief("comments", issue)
    _finish_automation()


# ─────────────────────────────────────────────
#  STRATEGY: Residential Hall Room
# ─────────────────────────────────────────────
def _fill_residential_form():
    """
    Page 1: Emergency -> Next
    Page 2: Work Details (`workType`, `heatAir` etc, `brief`) -> Next
    Page 3: Location (Acknowledge, Building, Floor, Room) -> Next
    """
    print("➜  Filling Page 1 — Emergency Check …")
    inject_page_script('''
        (function() {
            var radios = document.querySelectorAll("input[name=emergency]");
            if (radios.length > 1) { radios[1].click(); } // Click "No"
        })();
    ''')
    time.sleep(0.5)
    _click_next()

    print("➜  Filling Page 2 — Work Details …")
    issue = bot_session["issue_text"]
    safe_issue = json.dumps(issue.lower())
    
    # 1. Select the top-level workType based on keywords
    # 2. Select the secondary radio if it appears
    inject_page_script(f'''
        (function() {{
            var text = {safe_issue};
            var radios = document.querySelectorAll("input[name=workType]");
            
            // Basic matching logic
            let idx = 0; // default (Doors/Windows)
            if (text.includes("heat") || text.includes("air") || text.includes("filter") || text.includes("cold") || text.includes("hot") || text.includes("temperature")) idx = 4; // Heat/Air
            else if (text.includes("light") || text.includes("electri") || text.includes("power")) idx = 6; // Light/Electrical
            else if (text.includes("pest") || text.includes("bug") || text.includes("roach")) idx = 7; // Pests
            else if (text.includes("plumb") || text.includes("water") || text.includes("sink") || text.includes("toilet") || text.includes("leak")) idx = 8; // Plumbing/Water
            
            if (radios.length > idx) radios[idx].click();
        }})();
    ''')
    time.sleep(1)

    # Secondary radio mapping (e.g. name=heatAir)
    inject_page_script(f'''
        (function() {{
            var text = {safe_issue};
            // e.g. heatAir
            var heatRadios = document.querySelectorAll("input[name=heatAir]");
            if (heatRadios.length > 0) {{
                if (text.includes("hot") || text.includes("warm")) heatRadios[0].click();
                else if (text.includes("cold") || text.includes("freez")) heatRadios[1].click();
                else heatRadios[3].click(); // default to Noise or other
            }}
            // e.g. plumbingWater
            var pwRadios = document.querySelectorAll("input[name=plumbingWater]");
            if (pwRadios.length > 0) {{
                if (text.includes("toilet")) pwRadios[0].click();
                else if (text.includes("sink")) pwRadios[1].click();
                else if (text.includes("shower")) pwRadios[2].click();
                else pwRadios[0].click();
            }}
        }})();
    ''')
    time.sleep(1)

    # Comments
    _type_brief("brief", issue)
    
    _click_next()

    print("➜  Filling Page 3 — Location Details …")
    inject_page_script('''
        (function() {
            var ack = document.querySelector("input[name=acknowledge]");
            if (ack && !ack.checked) { ack.click(); }
        })();
    ''')
    time.sleep(0.5)

    _handle_location_setup(callback=_finish_residential_form)


def _resume_residential_location():
    """Resume residential location page after answering question."""
    _handle_location_setup(callback=_finish_residential_form)


def _finish_residential_form():
    """Proceed to final review page."""
    _click_next()
    _finish_automation()


# ─────────────────────────────────────────────
#  Shared Location Conversational Flow
# ─────────────────────────────────────────────
def _handle_location_setup(callback):
    """
    Manages building -> floor -> room data fetching.
    If missing, sets question state and returns (suspends thread).
    If complete, calls the callback function (proceeding to next step).
    """
    building = bot_session.get("building")
    floor = bot_session.get("floor")
    room = bot_session.get("room")

    if not building:
        print("   ❓ Building not specified — asking user …")
        bot_session["step"] = "waiting_for_info"
        bot_session["pending_question"] = "building"
        return

    if not bot_session.get("_building_set"):
        success = _set_select2_value("locationPropertybldg", building)
        if success:
            bot_session["_building_set"] = True
            time.sleep(2)
            print(f"   ✓  Building set: {building}")
        else:
            print(f"   ⚠  Could not find building '{building}'. Re-asking.")
            bot_session["building"] = None
            bot_session["step"] = "waiting_for_info"
            bot_session["pending_question"] = "building"
            return

    if not floor:
        print("   ❓ Floor not specified — asking user …")
        bot_session["step"] = "waiting_for_info"
        bot_session["pending_question"] = "floor"
        return

    if not bot_session.get("_floor_set"):
        success = _set_select2_value("locationFloorflrId", floor)
        if success:
            bot_session["_floor_set"] = True
            time.sleep(2)
            print(f"   ✓  Floor set: {floor}")
        else:
            print(f"   ⚠  Could not find floor '{floor}'. Re-asking.")
            bot_session["floor"] = None
            bot_session["step"] = "waiting_for_info"
            bot_session["pending_question"] = "floor"
            return

    if not room:
        print("   ❓ Room not specified — asking user …")
        bot_session["step"] = "waiting_for_info"
        bot_session["pending_question"] = "room"
        return

    if not bot_session.get("_room_set"):
        if room.lower() != "skip":
            success = _set_select2_value("locationLocationlocId", room)
            if success:
                bot_session["_room_set"] = True
                time.sleep(1)
                print(f"   ✓  Room set: {room}")
            else:
                print(f"   ⚠  Could not find room '{room}'. Re-asking.")
                bot_session["room"] = None
                bot_session["step"] = "waiting_for_info"
                bot_session["pending_question"] = "room"
                return
        else:
            bot_session["_room_set"] = True
            print("   ⏭  Room skipped.")

    # If we reached here, Location is fully complete.
    callback()


def _type_brief(element_id: str, text: str):
    """Visual character-by-character typing effect for textareas."""
    safe_text = json.dumps(text)
    inject_page_script(f'''
        (function() {{
            var ta = document.getElementById("{element_id}");
            if (!ta) return;
            ta.scrollIntoView({{behavior: "smooth", block: "center"}});
            ta.style.outline = "3px solid #CFAE70";
            ta.style.outlineOffset = "2px";
            ta.focus();
            ta.value = "";
            var text = {safe_text};
            var i = 0;
            var interval = setInterval(function() {{
                ta.value = text.substring(0, i + 1);
                // Fire React events
                Object.keys(ta).forEach(k => {{if (k.startsWith("__react")) ta[k].onChange({{target: ta}})}});
                ta.dispatchEvent(new Event("input", {{bubbles: true}}));
                i++;
                if (i >= text.length) {{
                    clearInterval(interval);
                    ta.dispatchEvent(new Event("change", {{bubbles: true}}));
                    var el = document.createElement("div");
                    el.id = "__readybot_result";
                    el.style.display = "none";
                    el.textContent = JSON.stringify({{filled: true}});
                    document.body.appendChild(el);
                }}
            }}, 40);
        }})();
    ''')

    result = read_page_result(15)
    if result.get("filled"):
        print(f'   ✓  Description filled: "{text[:60]}…"')
    else:
        print("   ⚠  Description fill may not have completed.")


def _finish_automation():
    print("\n" + "="*60)
    print("  🛑  SAFETY: NOT clicking Submit.")
    print("  ✅  Form is filled — review in Chrome and submit manually.")
    print("  📌  Tab stays open for your review.")
    print("="*60 + "\n")

    bot_session["step"] = "done"
    bot_session["active"] = False


if __name__ == "__main__":
    print("\n🎤  Voice-to-Form Maintenance Reporter")
    print("   Open http://127.0.0.1:5001 on your phone or browser.")
    print()
    print("   ⚠  ONE-TIME SETUP:")
    print("   In Chrome → View → Developer → ✓ Allow JavaScript from Apple Events")
    print()
    app.run(host="0.0.0.0", port=5001, debug=True)
