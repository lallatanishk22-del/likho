const { contextBridge, ipcRenderer } = require("electron");

// Minimal, explicit bridge — the renderer gets exactly two capabilities:
// run the zbill flow, and be told when to reset its UI. No core logic here.
contextBridge.exposeInMainWorld("likho", {
  runZbill: () => ipcRenderer.invoke("run-zbill"),
  hide: () => ipcRenderer.send("hide-popup"),
  onReset: (callback) => ipcRenderer.on("reset", callback),
});
