// ---- Study configuration -------------------------------------------------
// Edit these before deploying. Everything else lives in app.js / trials.json.
window.STUDY_CONFIG = {
  studyName: "MST-C heatmap comparison (mock)",

  // Pairs per participant, drawn (balanced) from the pool in trials.json.
  // null = show every trial in the pool.
  nTrials: 39,

  // Hidden attention checks (catch trials: real Grad-CAM vs. pixel-scrambled copy).
  // They look like normal trials; nothing tells participants they exist.
  // 39 pairs + 3 checks = 42 screens.
  attentionChecks: 3,

  // Show a short break screen after this fraction of trials (null = no break).
  breakAt: 0.5,

  // Show the original photo above the two heatmaps (context). false = heatmaps only.
  showPhoto: true,

  // How long the clicked heatmap stays highlighted before the next pair (ms).
  advanceDelayMs: 250,

  // Draw heatmaps on top of the photo (alpha blend) instead of plain heatmaps.
  // Keep fixed for a real run; you can flip it live in demo mode.
  overlay: false,
  overlayOpacity: 0.6,

  // Prolific. Leave completionCode empty in the mock.
  completionCode: "",            // e.g. "C1A2B3C4"
  prolificReturnUrl: "",         // e.g. "https://app.prolific.com/submissions/complete?cc=C1A2B3C4"

  // Optional: POST the full response JSON here at the end (e.g. a DataPipe /
  // Google Apps Script / own server endpoint). Empty = no upload, local download only.
  submitUrl: "",

  // Show "download responses" buttons on the end screen (always shown in demo mode).
  showDownloads: true,

  // Rough time per trial, only for the "about N minutes" text.
  secondsPerTrial: 6,
};
