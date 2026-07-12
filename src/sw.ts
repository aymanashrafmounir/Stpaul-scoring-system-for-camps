/// <reference lib="webworker" />

const worker = self as unknown as ServiceWorkerGlobalScope
const cacheName = 'saint-paul-shell-v2'
const precacheManifest = (self as unknown as ServiceWorkerGlobalScope & { __WB_MANIFEST: Array<{ url: string; revision?: string }> }).__WB_MANIFEST
const assets = precacheManifest.map((entry) => entry.url)

worker.addEventListener('install', (event) => {
  event.waitUntil(caches.open(cacheName).then((cache) => cache.addAll(assets)).then(() => worker.skipWaiting()))
})

worker.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== cacheName).map((key) => caches.delete(key)))).then(() => worker.clients.claim()))
})

worker.addEventListener('fetch', (event) => {
  const request = event.request
  const url = new URL(request.url)
  if (request.method !== 'GET' || url.origin !== worker.location.origin) return
  if (request.mode === 'navigate') {
    if (/^\/nfc\/[^/]+$/.test(url.pathname)) {
      event.respondWith(fetch(request, { cache: 'no-store', redirect: 'error' }))
      return
    }
    event.respondWith(fetch(request).catch(() => caches.match('/index.html').then((response) => response ?? Response.error())))
    return
  }
  event.respondWith(fetch(request).catch(() => caches.match(request).then((cached) => cached ?? Response.error())))
})
