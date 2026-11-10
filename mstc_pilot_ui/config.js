// ---- MST-C pilot configuration ---------------------------------------------
// Edit these before a run. Everything else lives in app.js / session.js / trials.json.
window.STUDY_CONFIG = {
  studyName: "MST-C heatmap legibility (pilot)",
  appVersion: "pilot-1.0",

  // ---- session design ----
  nMain: 20,             // distinct pairs per person -> 40 heatmap images shown in the main task
  nRepeats: 0,           // off: repeatLag below needs far more main trials than 20 to have room to place a repeat
  repeatLag: [30, 60],   // repeat comes this many main trials after its original (unused while nRepeats is 0)
  attentionChecks: 10,   // hidden checks: real Grad-CAM vs pixel-shuffled copy -- the main quality signal now
  breakAt: null,         // e.g. 0.5 for a break halfway
  showPhoto: true,       // original photo above the two heatmaps -- on now that all 24 images have input.png
  overlay: false,        // heatmaps alpha-blended on the photo instead of plain maps
  overlayOpacity: 0.6,
  advanceDelayMs: 250,   // how long the clicked card stays highlighted
  secondsPerTrial: 7,    // only for the "about N minutes" text
  mentionQualityChecks: true, // instructions say "a few quality checks are included" (doesn't say what they are)
  minViewportWidth: 900, // narrower screens get a "please use a laptop/desktop" warning (recorded)

  // ---- questionnaires ----
  askBackground: true,   // expertise questions before the task
  askDebrief: true,      // cues / strategy / fatigue questions after the task

  // ---- saving ----
  // Data is autosaved in the browser after every click (a reload resumes). At the end it is
  //  (1) uploaded, if an endpoint is set below, and (2) offered as downloads (.json + 2 x .csv).
  upload: {
    datapipeExperimentId: "", // DataPipe (pipe.jspsych.org) experiment ID -> files land in your OSF project
    url: "https://mstc-pilot-default-rtdb.europe-west1.firebasedatabase.app/submissions.json", // Firebase Realtime DB (test mode)
  },
  autoDownload: true,         // pilot: start the 3 downloads automatically on the end screen when nothing was uploaded
                              // (never for Prolific participants; the buttons are always there as a fallback)

  // ---- Prolific (used only when the URL carries PROLIFIC_PID) ----
  // Study URL on Prolific:  https://<you>.github.io/MST-C-User-Study/mstc_pilot_ui/?PROLIFIC_PID={{%PROLIFIC_PID%}}&STUDY_ID={{%STUDY_ID%}}&SESSION_ID={{%SESSION_ID%}}
  prolific: {
    completionUrl: "https://app.prolific.com/submissions/complete?cc=C4ANU3V8",
    completionCode: "C4ANU3V8", // shown as a fallback on the end screen
    failedChecksUrl: "https://app.prolific.com/submissions/complete?cc=C19PM77J", // sessions failing >= failThreshold checks
    failedChecksCode: "C19PM77J", // fallback code shown for THAT path -- must not fall back to completionCode
    failThreshold: 2,
    redirectDelayMs: 4000,
  },
};
