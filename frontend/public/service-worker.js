// Chrome's PWA install prompt requires a registered service worker with
// a fetch handler (see the goal 0068 research note in main.tsx) -- this
// is that requirement and nothing else. It never caches: Mill's own
// thesis is what-you-see-is-what-I-see over live server-mode data, so a
// service worker that served stale responses while "offline" would
// actively lie about run/approval state, the one thing this app can
// never do. Every request just passes straight through to the network.
self.addEventListener('fetch', (event) => {
  event.respondWith(fetch(event.request))
})
