// ---- MST-C pilot configuration ---------------------------------------------
// Edit these before a run. Everything else lives in app.js / session.js / trials.json.
window.STUDY_CONFIG = {
  studyName: "MST-C heatmap legibility (pilot)",
  appVersion: "pilot-1.0",

  // ---- session design (fatigue pilot) ----
  nMain: 150,            // distinct pairs per person (multiple of 3; 5 per model x method-pair cell)
  nRepeats: 12,          // pairs shown a 2nd time with sides swapped -> self-consistency vs. position
  repeatLag: [30, 60],   // repeat comes this many main trials after its original
  attentionChecks: 10,   // hidden checks: real Grad-CAM vs pixel-shuffled copy (one per tenth of the session)
  probeEvery: 43,        // "how focused are you?" check-in after every N screens (null = off); one more at the end
  breakAt: null,         // e.g. 0.5 for a break halfway. OFF by default: a break resets fatigue and blurs the curve
  showPhoto: true,       // original photo above the two heatmaps
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
    url: "",                  // OR any endpoint that accepts POST {filename, data} JSON per file
  },
  autoDownload: true,         // pilot: start the 3 downloads automatically on the end screen when nothing was uploaded
                              // (never for Prolific participants; the buttons are always there as a fallback)

  // ---- Prolific (used only when the URL carries PROLIFIC_PID) ----
  // Study URL on Prolific:  https://<you>.github.io/MST-C-User-Study/mstc_pilot_ui/?PROLIFIC_PID={{%PROLIFIC_PID%}}&STUDY_ID={{%STUDY_ID%}}&SESSION_ID={{%SESSION_ID%}}
  prolific: {
    completionUrl: "",       // e.g. "https://app.prolific.com/submissions/complete?cc=C1A2B3C4"
    completionCode: "",      // shown as a fallback on the end screen
    failedChecksUrl: "",     // optional 2nd completion path for sessions failing >= failThreshold checks
    failThreshold: 2,
    redirectDelayMs: 4000,
  },
};
