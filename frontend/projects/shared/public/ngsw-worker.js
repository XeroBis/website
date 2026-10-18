// Safety worker, served as /ngsw-worker.js by the apps whose old repo had an
// Angular service worker (cards, workout). A browser that still runs the old
// worker fetches this script when checking for an update, installs it, and
// it then deletes the old caches, unregisters itself and reloads the open
// tabs, which then load the current app from the network. Adapted from
// @angular/service-worker's safety-worker.js (plus the reload). See
// documentation/decisions.md "Safety worker for the old apps' service workers".

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      await self.clients.claim(); // only controlled tabs can be reloaded
      const names = await caches.keys();
      await Promise.all(names.filter((name) => name.startsWith('ngsw:')).map((name) => caches.delete(name)));
      await self.registration.unregister();
      const tabs = await self.clients.matchAll({ type: 'window' });
      await Promise.all(tabs.map((tab) => tab.navigate(tab.url)));
    })(),
  );
});
