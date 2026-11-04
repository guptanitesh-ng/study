"use strict";

const CACHE_VERSION = "__BUILD_VERSION__";
const CACHE_NAME = `study-notes-${CACHE_VERSION}`;
const APP_SHELL = [
  "./",
  "index.html",
  "styles.css",
  "app.js",
  "manifest.webmanifest",
  "notes-manifest.json",
  "icons/icon.svg",
  "icons/icon-192.png",
  "icons/icon-512.png",
  "vendor/marked.min.js",
  "vendor/purify.min.js"
];

self.addEventListener("install", event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await cache.addAll(APP_SHELL);
    try {
      const response = await fetch("notes-manifest.json", { cache: "no-store" });
      const manifest = await response.json();
      await Promise.allSettled((manifest.notes || []).map(note => cache.add(note.path)));
    } catch (error) {
      console.warn("Notes could not be precached", error);
    }
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(key => key.startsWith("study-notes-") && key !== CACHE_NAME).map(key => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", event => {
  if (event.request.method !== "GET") {
    return;
  }
  const requestUrl = new URL(event.request.url);
  if (requestUrl.origin !== self.location.origin) {
    return;
  }

  event.respondWith((async () => {
    const cached = await caches.match(event.request, { ignoreSearch: event.request.mode === "navigate" });
    const network = fetch(event.request)
      .then(async response => {
        if (response.ok) {
          const cache = await caches.open(CACHE_NAME);
          cache.put(event.request, response.clone());
        }
        return response;
      })
      .catch(error => {
        if (cached) {
          return cached;
        }
        throw error;
      });

    if (event.request.mode === "navigate") {
      try {
        return await network;
      } catch {
        return cached || caches.match("index.html");
      }
    }

    return cached || network;
  })());
});
