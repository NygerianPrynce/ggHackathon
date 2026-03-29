/**
 * DOM → PNG screenshots (paste in DevTools Console on ready.app.vanderbilt.edu)
 *
 * 1) Paste this whole file → Enter
 * 2) Wait for "html2canvas ready"
 * 3) Each time you want a capture:
 *      captureReADY("page1-emergency-no")
 *      captureReADY("page2-worktype-heat-air")
 *
 * Files download as ready-{label}-{time}.png
 *
 * Notes:
 * - If the PNG is blank or errors, use the browser’s own screenshot (macOS: Cmd+Shift+4)
 *   or Snipping Tool — still fine to upload those.
 * - Cross-origin images inside the page may be omitted or taint the canvas; that’s a browser limit.
 */
(function () {
  const CANVAS_LIB = "https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js";

  function loadScript(url) {
    return new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = url;
      s.onload = () => resolve();
      s.onerror = () => reject(new Error("Failed to load " + url));
      document.head.appendChild(s);
    });
  }

  async function ensureHtml2Canvas() {
    if (typeof html2canvas === "function") return;
    await loadScript(CANVAS_LIB);
    if (typeof html2canvas !== "function") {
      throw new Error("html2canvas not available after load");
    }
  }

  /**
   * Screenshot a node (default: the main request form area).
   * @param {string} label - becomes part of the filename (use a,b,c or descriptive path names)
   * @param {HTMLElement|null} target - element to capture (default: #requestScreenForm or main)
   */
  window.captureReADY = async function (label, target) {
    await ensureHtml2Canvas();
    const el =
      target ||
      document.getElementById("requestScreenForm") ||
      document.querySelector("main") ||
      document.body;

    const safe = String(label || "shot").replace(/[^\w\-]+/g, "_").slice(0, 80);
    const t = Date.now();

    const canvas = await html2canvas(el, {
      scale: window.devicePixelRatio > 1 ? 2 : 1,
      useCORS: true,
      allowTaint: true,
      logging: false,
      scrollX: 0,
      scrollY: -window.scrollY,
      windowWidth: document.documentElement.offsetWidth,
      windowHeight: document.documentElement.offsetHeight,
    });

    await new Promise((resolve, reject) => {
      canvas.toBlob(
        (blob) => {
          if (!blob) {
            reject(new Error("toBlob failed"));
            return;
          }
          const a = document.createElement("a");
          a.href = URL.createObjectURL(blob);
          a.download = "ready-" + safe + "-" + t + ".png";
          a.click();
          URL.revokeObjectURL(a.href);
          resolve();
        },
        "image/png",
        0.92
      );
    });

    console.log("[captureReADY] Saved ready-" + safe + "-" + t + ".png");
  };

  /** Whole visible tab (may be huge). */
  window.captureReADYFullPage = async function (label) {
    return window.captureReADY(label, document.documentElement);
  };

  console.log(
    "%c[captureReADY] Ready. Run: captureReADY(\"your-label\")",
    "color:#0a0;font-weight:bold"
  );
})();
