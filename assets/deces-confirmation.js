/**
 * Espace ASCQ — « Décès à confirmer ».
 * Un décès notifié par un RC doit être CONFIRMÉ (avéré) ou NON CONFIRMÉ (motif obligatoire) par
 * l'ASCQ. Seuls les décès confirmés sont comptés dans le rapport hebdomadaire. La décision est
 * définitive (verrouillée). Dépend de api.js (Api, toast, fmtDate, escHtml).
 */
(function () {
  const TYPES = { 1: 'Décès maternel', 2: 'Décès de bébé (0-28 jours)', 3: 'Décès d\'enfant de 1 mois à 1 an', 4: 'Décès d\'enfant de 1 à 5 ans', 5: 'Décès de personne de plus de 5 ans' };
  const LIEUX = { 1: 'Domicile', 2: 'Accoucheuse', 3: 'Lieu de culte', 4: 'Au cours du transport', 5: 'À l\'étranger', 6: 'Autre' };
  const CIRC = { 1: 'Grossesse / avortement / accouchement / suites de couches', 2: 'Maladie', 3: 'Accident de route', 4: 'Accident domestique', 5: 'Mort subite', 6: 'Violence', 7: 'Autre' };
  const lib = (m, v) => m[String(v)] || (v === '' || v === undefined ? '' : String(v));
  const champ = (k, v) => (v === '' || v === undefined || v === null) ? '' : `<div class="deces-champ"><span>${k}</span>${escHtml(v)}</div>`;

  function age(d) {
    const p = [];
    if (d.AgeAnnees !== '' && d.AgeAnnees !== undefined) p.push(d.AgeAnnees + ' an(s)');
    if (d.AgeMois) p.push(d.AgeMois + ' mois');
    if (d.AgeJours) p.push(d.AgeJours + ' jour(s)');
    return p.join(' ');
  }

  function carte(d, actions) {
    const statut = d.Statut === 'Confirmé' ? '<span class="badge badge-done">✔ Confirmé</span>' : d.Statut === 'Non confirmé' ? '<span class="badge badge-cancel">✖ Non confirmé</span>' : '<span class="badge badge-new">À confirmer</span>';
    const decision = d.Statut !== 'Nouveau' ? `<div class="verrou">🔒 ${escHtml(d.Statut)} par ${escHtml(d.ConfirmeParNom || '')} le ${fmtDate(d.DateConfirmation)}${d.CommentaireConfirmation ? ' — ' + escHtml(d.CommentaireConfirmation) : ''}. Décision définitive.</div>` : '';
    const plus = window.NotifRc ? `<details class="nrc-details"><summary>📋 Toutes les données collectées par le RC</summary>${NotifRc.donneesHtml('DECES', d)}</details>` : '';
    const gestion = window.NotifRc ? `<div class="nrc-gestion">${d.Statut === 'Nouveau' ? `<button class="btn-secondary btn-mini" data-dec="modifier" data-id="${escHtml(d.ID)}">✏️ Modifier les données</button>` : '<span class="petit">🔒 Décision prise : données non modifiables</span>'}<button class="btn-secondary btn-mini nrc-suppr" data-dec="supprimer" data-id="${escHtml(d.ID)}">🗑️ Supprimer la notification</button></div>` : '';
    return `<div class="card deces-card">
      <div style="display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap;align-items:center"><strong>${escHtml(d.Nom || 'Personne non nommée')}</strong>${statut}</div>
      <div class="deces-grille">
        ${champ('Type de décès', lib(TYPES, d.TypeDeces))}${champ('Date du décès', fmtDate(d.DateDeces))}${champ('Âge', age(d))}${champ('Sexe', d.Sexe)}
        ${champ('Village', d.VillageNom)}${champ('Lieu du décès', lib(LIEUX, d.LieuDeces))}${champ('Circonstances', lib(CIRC, d.Circonstances))}${champ('Cause probable', d.CauseProbable)}
        ${champ('Parent / proche', d.NomParent)}${champ('Téléphone du proche', d.TelephoneParent)}${champ('Notifié par (RC)', d.NotificateurNom)}${champ('Notifié le', fmtDate(d.DateSaisie))}
      </div>${plus}${decision}${actions || ''}${gestion}</div>`;
  }

  window.loadDecesAConfirmer = async function () {
    const el = document.getElementById('decesAConfirmerZone');
    el.innerHTML = 'Chargement…';
    try {
      const { deces } = await Api.call('listDeces', {});
      window.__decesParId = {}; deces.forEach(x => { window.__decesParId[x.ID] = x; });
      const aTraiter = deces.filter(d => d.Statut === 'Nouveau').sort((a, b) => String(a.DateSaisie).localeCompare(String(b.DateSaisie)));
      const traites = deces.filter(d => d.Statut !== 'Nouveau').sort((a, b) => String(b.DateConfirmation).localeCompare(String(a.DateConfirmation)));
      let html = `<h3 class="sous-titre">⏳ À confirmer (${aTraiter.length})</h3>`;
      html += aTraiter.length ? aTraiter.map(d => carte(d, `<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px">
          <button data-dec="confirmer" data-id="${escHtml(d.ID)}">✔ Confirmer ce décès</button>
          <button class="btn-secondary" data-dec="rejeter" data-id="${escHtml(d.ID)}">✖ Ne pas confirmer…</button></div>`)).join('') : '<div class="empty-state">Aucun décès en attente de confirmation. 👍</div>';
      html += `<h3 class="sous-titre" style="margin-top:22px">📁 Décès traités (${traites.length})</h3>` + (traites.length ? traites.map(d => carte(d)).join('') : '<div class="empty-state">Aucun décès traité pour le moment.</div>');
      el.innerHTML = html;
    } catch (e) { el.innerHTML = '<div class="empty-state">Erreur de chargement : ' + escHtml(e.message) + '</div>'; }
  };

  document.addEventListener('click', async e => {
    const b = e.target.closest('button[data-dec]'); if (!b) return;
    const id = b.dataset.id, decision = b.dataset.dec;
    if (decision === 'modifier' || decision === 'supprimer') {
      const ligne = (window.__decesParId || {})[id]; if (!ligne || !window.NotifRc) return;
      const rafraichir = () => { window.loadDecesAConfirmer(); if (typeof loadDashboard === 'function') loadDashboard(); };
      if (decision === 'modifier') NotifRc.modifier('DECES', ligne, rafraichir); else NotifRc.supprimer('DECES', ligne, rafraichir);
      return;
    }
    let commentaire = '';
    if (decision === 'confirmer') {
      const ligne = (window.__decesParId || {})[id];
      if (!window.FicheNotif || !ligne) { toast('Fiche de notification indisponible : rechargez la page.', true); return; }
      if (!confirm('Confirmer ce décès ?\n\nVous allez remplir la fiche de notification correspondante (décès maternel, néonatal ou autre décès). Le décès n\'est confirmé — et compté dans le rapport hebdomadaire — qu\'une fois la fiche envoyée. Cette décision est définitive.')) return;
      const pre = FicheNotif.prefillDeces(ligne);
      FicheNotif.demarrerValidation({
        type: pre.type, titre: 'Confirmation du décès de ' + (ligne.Nom || 'la personne notifiée') + ' — fiche de notification à remplir', prefill: pre.valeurs,
        finaliser: (fiche) => Api.call('confirmerDeces', { id, decision: 'confirmer', commentaire: '', fiche }),
        messageSucces: 'Décès confirmé : la fiche de notification est envoyée et le décès sera compté dans le rapport hebdomadaire.',
        apres: () => { window.loadDecesAConfirmer(); if (typeof loadDashboard === 'function') loadDashboard(); }
      });
      return;
    } else {
      commentaire = (prompt('Motif de la non-confirmation (obligatoire) — ex. information erronée, doublon, personne toujours en vie :') || '').trim();
      if (!commentaire) { toast('Le motif est obligatoire pour ne pas confirmer un décès.', true); return; }
    }
    b.disabled = true;
    try {
      await Api.call('confirmerDeces', { id, decision, commentaire });
      toast(decision === 'confirmer' ? 'Décès confirmé : il sera compté dans le rapport hebdomadaire.' : 'Décès non confirmé (motif enregistré).');
      window.loadDecesAConfirmer();
      if (typeof loadDashboard === 'function') loadDashboard();
    } catch (err) { toast(err.message, true); b.disabled = false; }
  });
})();
