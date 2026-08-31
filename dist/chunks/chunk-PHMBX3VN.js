// src/ui/panel-keys.ts
import { matchesKey } from "@earendil-works/pi-tui";
function configuredSaveKeys(keybindings) {
  const explicit = keybindings?.getUserBindings?.()["mcp.panel.save"];
  if (explicit !== void 0) return { keys: Array.isArray(explicit) ? explicit : [explicit], configured: true };
  return { keys: [], configured: false };
}
function createPanelKeys(keybindings) {
  const saveBinding = configuredSaveKeys(keybindings);
  if (keybindings) {
    return {
      selectUp: (data) => keybindings.matches(data, "tui.select.up"),
      selectDown: (data) => keybindings.matches(data, "tui.select.down"),
      selectConfirm: (data) => keybindings.matches(data, "tui.select.confirm"),
      save: (data) => saveBinding.keys.length > 0 ? saveBinding.keys.some((key) => matchesKey(data, key)) : !saveBinding.configured && matchesKey(data, "ctrl+s"),
      saveLabel: () => saveBinding.keys[0] ?? (saveBinding.configured ? null : "ctrl+s")
    };
  }
  return {
    selectUp: (data) => matchesKey(data, "up"),
    selectDown: (data) => matchesKey(data, "down"),
    selectConfirm: (data) => matchesKey(data, "return"),
    save: (data) => matchesKey(data, "ctrl+s"),
    saveLabel: () => "ctrl+s"
  };
}

export {
  createPanelKeys
};
