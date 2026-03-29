/**
 * Pipeline tracing — toggle with PIPELINE_DEBUG.
 * Where to open DevTools:
 * - Service worker: chrome://extensions → ReADY Bot → "Service worker" (Inspect)
 * - Side panel: right-click inside the panel → Inspect
 * - Page / DOM (jQuery): DevTools on the ReADY tab → Console, filter "ReADY Bot"
 */
var PIPELINE_DEBUG = true;

function pipelineLog(step, message, payload) {
  if (typeof PIPELINE_DEBUG !== "undefined" && !PIPELINE_DEBUG) return;
  const label = "[ReADY Bot] " + step;
  if (payload !== undefined) {
    console.log("%c" + label, "color:#CFAE70;font-weight:600", message, payload);
  } else {
    console.log("%c" + label, "color:#CFAE70;font-weight:600", message);
  }
}

function pipelineGroup(step, title) {
  if (typeof PIPELINE_DEBUG !== "undefined" && !PIPELINE_DEBUG) return;
  console.groupCollapsed("%c[ReADY Bot] " + step + " · " + title, "color:#CFAE70;font-weight:600");
}

function pipelineGroupEnd() {
  if (typeof PIPELINE_DEBUG !== "undefined" && !PIPELINE_DEBUG) return;
  console.groupEnd();
}
