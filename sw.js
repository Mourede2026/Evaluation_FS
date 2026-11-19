/* SIVEC — service worker : l'application s'ouvre et fonctionne SANS connexion.
 *
 *  - Au premier chargement avec réseau, toute l'interface (pages, scripts, styles, icônes) est copiée sur l'appareil.
 *  - Ensuite, chaque page s'ouvre hors connexion, quel que soit le profil (RC, ASCQ, PF, RCSE, Département, National).
 *  - Avec réseau : la version la plus récente est servie (délai court : si le réseau est lent, la copie locale
 *    prend le relais pendant que la mise à jour se termine en arrière-plan).
 *  - Les DONNÉES (Google Apps Script) ne passent jamais par ici : elles sont gérées par assets/hors-ligne.js
 *    (dernière copie lue + file d'attente d'envoi, synchronisation légère dès que le réseau revient).
 *
 * Pour publier une nouvelle version de l'interface, il suffit de remplacer les fichiers : le service worker
 * récupère automatiquement les nouveaux fichiers. Incrémenter VERSION force un renouvellement complet du cache.
 */
const VERSION = 'sivec-v4';
const CACHE = VERSION + '-shell';
const DELAI_RESEAU_MS = 4000;
const A_METTRE_EN_CACHE = [
  "./",
  "admin.html",
  "ascq.html",
  "departement.html",
  "index.html",
  "manifest.json",
  "national.html",
  "pf.html",
  "rc.html",
  "rcse.html",
  "assets/activites.js",
  "assets/admin.js",
  "assets/alerte-sonore.js",
  "assets/alertes-validees.js",
  "assets/api.js",
  "assets/briefing-data.js",
  "assets/briefing-scenes.js",
  "assets/briefing-video-export.js",
  "assets/briefing-video.css",
  "assets/briefing-video.js",
  "assets/briefing-videos-data.js",
  "assets/briefing-videos.js",
  "assets/briefing.css",
  "assets/briefing.js",
  "assets/bulk-import.js",
  "assets/calendrier-pdf.js",
  "assets/collecte.js",
  "assets/conditions.js",
  "assets/couverture.js",
  "assets/dashboard-detail.js",
  "assets/deces-confirmation.js",
  "assets/export-excel.js",
  "assets/fiche-notification-pdf.js",
  "assets/fiche-schemas.js",
  "assets/fiche-form.js",
  "assets/fiche-notification.js",
  "assets/forms.js",
  "assets/geo-benin-data.js",
  "assets/geo-utils.js",
  "assets/guide-data.js",
  "assets/guide.js",
  "assets/hors-ligne.js",
  "assets/liste-presence.js",
  "assets/mon-compte.js",
  "assets/nettoyage.js",
  "assets/notification-rc.js",
  "assets/notifications-liste.js",
  "assets/pdf-mini.js",
  "assets/profil-menu.js",
  "assets/pwa-register.js",
  "assets/rapport-seance.js",
  "assets/rapport.js",
  "assets/sensibilisations.js",
  "assets/sivec-intro.js",
  "assets/sivec-logo.png",
  "assets/sivec-mark.svg",
  "assets/style.css",
  "assets/suivi-groupe-ascq.js",
  "assets/suivi-groupe-lecture.js",
  "assets/taches.js",
  "assets/tendances.js",
  "assets/user-admin.js",
  "assets/icons/apple-touch-icon.png",
  "assets/icons/favicon-16.png",
  "assets/icons/favicon-32.png",
  "assets/icons/favicon.ico",
  "assets/icons/icon-192.png",
  "assets/icons/icon-512.png",
  "assets/icons/icon-maskable-512.png",
  "assets/icons/logo_master.png",
  "assets/icons/sivec-logo-horizontal.png",
  "assets/icons/ancien/apple-touch-icon.png",
  "assets/icons/ancien/favicon-16.png",
  "assets/icons/ancien/favicon-32.png",
  "assets/icons/ancien/favicon.ico",
  "assets/icons/ancien/icon-192.png",
  "assets/icons/ancien/icon-512.png",
  "assets/icons/ancien/icon-maskable-512.png",
  "assets/icons/ancien/logo_master.png"
];

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    // Un fichier manquant ne doit pas empêcher l'installation : on copie ce qu'on peut.
    await Promise.allSettled(A_METTRE_EN_CACHE.map(async url => {
      const rep = await fetch(new Request(url, { cache: 'reload' }));
      if (rep && rep.ok) await cache.put(new URL(url, self.registration.scope).href, rep);
    }));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const noms = await caches.keys();
    await Promise.all(noms.filter(n => n !== CACHE).map(n => caches.delete(n)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', event => { if (event.data === 'SKIP_WAITING') self.skipWaiting(); });

function estImageOuPolice(req) { return /\.(png|jpe?g|gif|webp|svg|ico|woff2?|ttf)(\?|$)/i.test(new URL(req.url).pathname); }

async function depuisCache(req) {
  const cache = await caches.open(CACHE);
  return (await cache.match(req, { ignoreSearch: true })) || null;
}

// Réseau d'abord (avec délai), copie locale en secours ; met toujours le cache à jour en arrière-plan.
function reseauPuisCache(event) {
  const req = event.request;
  const frais = fetch(req).then(async rep => {
    if (rep && rep.ok && rep.type === 'basic') { const c = await caches.open(CACHE); await c.put(req, rep.clone()); }
    return rep;
  });
  event.waitUntil(frais.catch(() => {}));
  const delai = new Promise(res => setTimeout(() => res(null), DELAI_RESEAU_MS));
  return Promise.race([frais.catch(() => null), delai]).then(async rep => {
    if (rep) return rep;
    const copie = await depuisCache(req);
    if (copie) return copie;
    try { return await frais; } catch (e) { return null; }
  });
}

// Copie locale d'abord (images, icônes), rafraîchie en arrière-plan.
async function cachePuisReseau(event) {
  const copie = await depuisCache(event.request);
  const maj = fetch(event.request).then(async rep => {
    if (rep && rep.ok && rep.type === 'basic') { const c = await caches.open(CACHE); await c.put(event.request, rep.clone()); }
    return rep;
  });
  if (copie) { event.waitUntil(maj.catch(() => {})); return copie; }
  return maj;
}

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;                                    // les envois (POST) vont directement à l'API
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;                     // API Google Apps Script, etc. : jamais interceptée
  if (url.pathname.endsWith('/sw.js') || req.headers.has('range')) return; // audio/vidéo : laissé au navigateur
  if (req.mode === 'navigate') {
    event.respondWith((async () => {
      const rep = await reseauPuisCache(event);
      if (rep) return rep;
      return (await depuisCache(new Request(new URL('index.html', self.registration.scope).href))) ||
        new Response('<meta charset="utf-8"><title>SIVEC</title><body style="font-family:sans-serif;padding:24px"><h2>Hors connexion</h2><p>Cette page n\'a pas encore été chargée sur cet appareil. Ouvrez SIVEC une première fois avec une connexion internet.</p>', { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
    })());
    return;
  }
  event.respondWith((async () => {
    const rep = estImageOuPolice(req) ? await cachePuisReseau(event).catch(() => null) : await reseauPuisCache(event);
    return rep || new Response('', { status: 504, statusText: 'Hors connexion' });
  })());
});
