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

console.log("[BOOT] renderer.js loaded, readyState:", document.readyState);

async function bootstrap() {
  console.log("[BOOT] bootstrap() starting...");
  try {
    await init();
    console.log("[BOOT] init() completed successfully");
  } catch (error) {
    console.error("[BOOT] init() FAILED:", error);
    try {
      console.log("[BOOT] attempting emergency render...");
      if (typeof refresh === "function") refresh();
      if (typeof view === "function") view("library");
      console.log("[BOOT] emergency render done. cards:", state?.cards?.length);
    } catch (e2) {
      console.error("[BOOT] emergency render also failed:", e2);
    }
    if (typeof toast === "function") {
      toast("Application init error. Cards: " + (state?.cards?.length || 0) + ". See console (Ctrl+Shift+I).");
    }
  }
}

if (document.readyState === "loading") {
  console.log("[BOOT] DOM still loading, waiting for DOMContentLoaded");
  document.addEventListener("DOMContentLoaded", function() {
    console.log("[BOOT] DOMContentLoaded fired, calling bootstrap");
    bootstrap();
  });
} else {
  console.log("[BOOT] DOM already ready, calling bootstrap immediately");
  bootstrap();
}