# ReADY Bot

ReADY Bot is a voice-assisted helper for submitting Vanderbilt ReADY maintenance requests faster and with less manual form work.

## What This Project Is

This project includes:

- A Chrome extension in `extension/` (primary app)
- An optional Flask app (`app.py`) with a simple web UI in `templates/`

The extension opens and guides the ReADY workflow, asks conversational follow-up questions, and fills form fields in the browser.

## What It Does

At a high level, ReADY Bot:

1. Takes a user's issue description (typed or voice transcript).
2. Starts with an emergency check.
3. Collects required details for the Residential Hall maintenance template.
4. Maps natural language answers to form schema values.
5. Fills the live ReADY form (including radios, checkboxes, text, and Select2 location fields).
6. Continues asking only for missing information until submission is ready.

The goal is to reduce repetitive back-and-forth and make submission fast and natural.

## How It Works

### Core Extension Files

- `extension/background.js`  
  Main orchestration logic (state machine, step progression, messaging, and DOM action calls).

- `extension/ready-main-world.js`  
  MAIN-world page helpers used to interact with ReADY DOM controls safely.

- `extension/residential-conversation.js`  
  Profile-driven conversation and parsing helpers (prompts, answer parsing, branch handling).

- `extension/form-profiles/residential-hall-room-maintenance.js`  
  Structured schema/profile for the Residential Hall Room Maintenance form.

- `extension/openai-residential.js`  
  Optional OpenAI extraction/normalization helpers for mapping natural language to valid form values.

- `extension/sidepanel.html` + `extension/sidepanel.js`  
  Side panel UI and user interaction layer.

### Runtime Flow

1. User starts a request in the side panel.
2. Extension opens ReADY and selects the proper template.
3. The bot asks emergency first, then non-emergency workflow questions.
4. Work type and branch-specific fields are gathered from the profile and current page context.
5. As answers are confirmed, values are committed directly into the form.
6. Location and contact info are finalized.
7. Request reaches review/submit state.

## AI and Voice Notes

- OpenAI is used for structured extraction and normalization when keys are provided.
- Fallback parsing still supports core field mapping without AI.
- ElevenLabs is used for TTS prompts (optional, based on local key configuration).

## Security / Key Handling

- Do **not** commit real keys.
- Local secrets belong in `extension/openai-secrets.js` (gitignored).
- Use `extension/openai-secrets.example.js` as the template.

## Running the Project

### Chrome Extension

1. Open `chrome://extensions`
2. Enable Developer Mode
3. Load unpacked extension from `extension/`
4. Add local keys to `extension/openai-secrets.js` (optional but recommended)

### Optional Flask App

1. Create/activate a Python environment
2. Install dependencies from `requirements.txt`
3. Run `python app.py`

## Current Scope

This repository is trimmed to the runtime package needed for extension-based operation and optional Flask support. Development artifacts and duplicate extension copies were removed to keep the repo clean for upload.
