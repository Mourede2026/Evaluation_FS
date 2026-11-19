// Enregistre le service worker (sw.js) : l'application est installable sur téléphone (PWA) et TOUTES les pages
// s'ouvrent hors connexion. Les données hors connexion sont gérées par assets/hors-ligne.js.
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).then(reg => {
      // Cherche une nouvelle version de l'interface à chaque retour au premier plan (silencieux, léger).
      document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && navigator.onLine !== false) reg.update().catch(() => {}); });
    }).catch(() => {});
    // Demande au navigateur de ne pas effacer les données hors connexion (IndexedDB) quand le téléphone manque de place.
    if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
  });
}
