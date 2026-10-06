// The window's only way out: window.ct.call(method, params, onEvent) asks the app (main.mjs), which checks it. onEvent
// gets the steps of a long command (sign-in, connecting agents, sending) as they happen. onUpdate hears of the app's own
// updates (src/main/updater.mjs).
const { contextBridge, ipcRenderer } = require('electron');

const listeners = new Map();
let next = 0;
ipcRenderer.on('ct:event', (_event, { token, data }) => listeners.get(token)?.(data));
const updateListeners = new Set();
ipcRenderer.on('ct:update', (_event, state) => updateListeners.forEach((cb) => cb(state)));

contextBridge.exposeInMainWorld('ct', {
    call(method, params = {}, onEvent = null) {
        const token = ++next;
        if (onEvent) listeners.set(token, onEvent);

        return ipcRenderer.invoke('ct', { method, params, token }).finally(() => listeners.delete(token));
    },
    onUpdate(cb) {
        updateListeners.add(cb);
    },
});
