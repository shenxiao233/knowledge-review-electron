/**
 * renderer.js — Application bootstrap entry point
 *
 * Load order in index.html (all shared global scope, no bundler):
 *   idb-store -> kr-core -> kr-state -> kr-cards -> kr-documents ->
 *   kr-review -> kr-market -> kr-profile -> kr-settings -> kr-ui -> THIS FILE
 *
 * init() is defined in kr-settings.js. This file is the LAST script loaded,
 * so all dependencies are available when init() runs.
 */

async function bootstrap() {
  try {
    await init();
  } catch (error) {
    console.error("[BOOT] init() FAILED:", error);
    try {
      if (typeof refresh === "function") refresh();
      if (typeof view === "function") view("library");
    } catch (e2) {
      console.error("[BOOT] emergency render also failed:", e2);
    }
    if (typeof toast === "function") {
      toast("Application init error. Cards: " + (state?.cards?.length || 0) + ". See console (Ctrl+Shift+I).");
    }
  }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", function() {
    bootstrap();
  });
} else {
  bootstrap();
}