// Fully offline Whisper speech-to-text worker.
// Uses @xenova/transformers v2 — designed for classic browser workers with importScripts.
// All files (model + ONNX WASM runtime) are served locally — zero network requests.
importScripts("./transformers.min.js");

const { pipeline, env } = self.transformers;

env.allowLocalModels  = true;
env.allowRemoteModels = false;
env.localModelPath    = "./models/";
env.useBrowserCache   = false;
env.backends.onnx.wasm.wasmPaths  = "./";
env.backends.onnx.wasm.numThreads = 1;

const MODEL = "Xenova/whisper-tiny.en";

let pipe = null;
let busy = false;

self.onmessage = async ({ data }) => {
  const { type } = data;

  if (type === "load") {
    if (busy || pipe) return;
    busy = true;
    try {
      self.postMessage({ type: "status", msg: "Loading voice model…" });
      pipe = await pipeline("automatic-speech-recognition", MODEL, {
        progress_callback(p) {
          if (p.status === "progress")
            self.postMessage({ type: "status", msg: `Loading… ${Math.round(p.progress ?? 0)}%` });
        },
      });
      busy = false;
      self.postMessage({ type: "ready" });
    } catch (err) {
      busy = false;
      self.postMessage({ type: "error", msg: err.message });
    }
    return;
  }

  if (type === "transcribe") {
    if (!pipe) { self.postMessage({ type: "error", msg: "Model not loaded." }); return; }
    if (busy)  { self.postMessage({ type: "error", msg: "Already transcribing, please wait." }); return; }
    busy = true;
    try {
      const out = await pipe(data.audio, { language: "en", task: "transcribe" });
      busy = false;
      self.postMessage({ type: "result", text: out.text.trim() });
    } catch (err) {
      busy = false;
      self.postMessage({ type: "error", msg: err.message });
    }
  }
};
