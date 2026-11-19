/**
 * Module « Sensibilisations » : preuve des sensibilisations communautaires.
 *
 *   • Relais communautaire (saisie:true) : enregistre chaque séance avec la date, le thème, le lieu, la liste
 *     des effectifs sensibilisés (adultes et enfants, par sexe — sans les noms) et la ou les photos de la séance. L'envoi est
 *     possible sans réseau (file d'attente de hors-ligne.js). Il consulte aussi son historique.
 *   • ASCQ, PF, RCSE, Département, National (saisie:false) : consultent les sensibilisations des RC de leur
 *     hiérarchie (filtres, totaux hommes/femmes, photos, répartition des effectifs, export CSV).
 *
 *
 * Approbation : une sensibilisation enregistrée par un RC est « En attente » ; elle ne remonte aux niveaux
 * supérieurs à l'ASCQ (PF, RCSE, Département, National) qu'une fois « Approuvée » par l'ASCQ, qui peut aussi la
 * « Rejeter » avec un motif (le RC est prévenu). Le compte National peut désactiver cette étape (paramètre).
 *
 * Dépend de api.js (Api, toast, escHtml).
 * initSensibilisations({ containerId, user, saisie })
 */
(function () {
  const esc = v => escHtml(v == null ? '' : v);
  const jsonArr = v => { try { const a = JSON.parse(v || '[]'); return Array.isArray(a) ? a : []; } catch (e) { return []; } };
  const THEMES = ['Définition de cas des maladies à potentiel épidémique', 'Rage : morsures et vaccination des animaux', 'Mpox', 'Choléra et hygiène de l\'eau', 'Lavage des mains', 'Fièvre jaune', 'Méningite', 'Rougeole', 'Paludisme', 'Notification des alertes et décès au relais communautaire', 'Autre'];
  const MAX_PHOTOS = 5;

  function aujourdhui() { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
  function dFr(iso) { iso = String(iso || '').slice(0, 10); return iso.length === 10 ? iso.slice(8, 10) + '/' + iso.slice(5, 7) + '/' + iso.slice(0, 4) : '—'; }

  // Les photos stockées dans Google Drive ont une URL « page de visionnage » : on utilise la miniature directe.
  function miniature(u) {
    const m = /drive\.google\.com\/file\/d\/([^/?#]+)/.exec(u || '');
    return m ? 'https://drive.google.com/thumbnail?id=' + m[1] + '&sz=w800' : u;
  }

  function lireDataUrl(file) {
    return new Promise((resolve, reject) => { const r = new FileReader(); r.onload = e => resolve(e.target.result); r.onerror = () => reject(new Error('Lecture du fichier impossible.')); r.readAsDataURL(file); });
  }
  async function redimensionner(file, maxDim) {
    const dessiner = (img, w0, h0) => {
      let w = w0, h = h0;
      if (w > maxDim || h > maxDim) { const k = Math.min(maxDim / w, maxDim / h); w = Math.round(w * k); h = Math.round(h * k); }
      const c = document.createElement('canvas'); c.width = w; c.height = h;
      c.getContext('2d').drawImage(img, 0, 0, w, h);
      return c.toDataURL('image/jpeg', 0.72);
    };
    if (window.createImageBitmap) {
      try { const bmp = await createImageBitmap(file); const out = dessiner(bmp, bmp.width, bmp.height); if (bmp.close) bmp.close(); return out; } catch (e) { /* repli */ }
    }
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file), img = new Image();
      img.onload = () => { try { resolve(dessiner(img, img.naturalWidth, img.naturalHeight)); } catch (e) { reject(e); } URL.revokeObjectURL(url); };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Format de photo non pris en charge (utilisez JPEG ou PNG).')); };
      img.src = url;
    });
  }

  function csv(lignes) { return '\ufeff' + lignes.map(l => l.map(x => '"' + String(x == null ? '' : x).replace(/"/g, '""') + '"').join(';')).join('\r\n'); }
  function telecharger(nom, contenu) {
    const url = URL.createObjectURL(new Blob([contenu], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a'); a.href = url; a.download = nom; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  let ctx = null;

  window.initSensibilisations = async function (opts) {
    ctx = opts;
    const el = document.getElementById(opts.containerId);
    if (opts.saisie) {
      el.innerHTML = `<div class="sub-tabs"><button type="button" class="active" data-sens-sub="nouvelle">➕ Nouvelle sensibilisation</button><button type="button" data-sens-sub="liste">📋 Mes sensibilisations</button></div>
        <div id="sensNouvelle"></div><div id="sensListe" style="display:none"></div>`;
      el.querySelectorAll('[data-sens-sub]').forEach(b => b.addEventListener('click', () => {
        el.querySelectorAll('[data-sens-sub]').forEach(x => x.classList.toggle('active', x === b));
        document.getElementById('sensNouvelle').style.display = b.dataset.sensSub === 'nouvelle' ? 'block' : 'none';
        document.getElementById('sensListe').style.display = b.dataset.sensSub === 'liste' ? 'block' : 'none';
        if (b.dataset.sensSub === 'liste') chargerListe('sensListe', true);
      }));
      dessinerFormulaire();
    } else {
      el.innerHTML = '<div id="sensListe"></div>';
      chargerListe('sensListe', false);
    }
  };

  // ---------------------------------------------------------------------
  // Formulaire du relais communautaire
  // ---------------------------------------------------------------------
  function dessinerFormulaire() {
    const zone = document.getElementById('sensNouvelle');
    const auj = aujourdhui();
    const photos = []; // data URLs redimensionnées
    zone.innerHTML = `<form id="formSens">
      <p class="petit" style="margin:0 0 12px">Chaque sensibilisation communautaire que vous réalisez doit être prouvée ici : indiquez <strong>combien de personnes</strong> ont été sensibilisées (adultes et enfants, par sexe — pas besoin des noms) et joignez la <strong>photo de la séance</strong>. Votre <strong>ASCQ</strong> la voit immédiatement et doit l'<strong>approuver</strong> avant qu'elle soit transmise aux autres niveaux (point focal, coordination…).</p>
      <div class="grid grid-2">
        <div class="field"><label>Date de la sensibilisation</label><input type="date" name="date" value="${auj}" max="${auj}" required></div>
        <div class="field"><label>Thème</label><input name="theme" list="sensThemes" required maxlength="160" placeholder="Ex : Rage : morsures et vaccination des animaux"><datalist id="sensThemes">${THEMES.map(t => `<option value="${esc(t)}">`).join('')}</datalist></div>
        <div class="field"><label>Lieu (facultatif)</label><input name="lieu" maxlength="120" placeholder="Marché, école, place du village, domicile…"></div>
        <div class="field"><label>Commentaire (facultatif)</label><input name="commentaires" maxlength="1000" placeholder="Remarques sur la séance"></div>
      </div>
      <h4 class="sous-titre">Personnes sensibilisées (statistiques)</h4>
      <div class="petit" style="margin-bottom:8px">Adulte : 18 ans et plus · Enfant : moins de 18 ans. Laissez 0 quand il n'y en a pas.</div>
      <div class="table-wrap"><table class="sens-table"><thead><tr><th></th><th>Hommes / Garçons</th><th>Femmes / Filles</th></tr></thead><tbody>
        <tr><th style="text-align:left">Adultes</th><td><input type="number" name="adultesHommes" min="0" max="5000" step="1" inputmode="numeric" value="0" class="sens-eff"></td><td><input type="number" name="adultesFemmes" min="0" max="5000" step="1" inputmode="numeric" value="0" class="sens-eff"></td></tr>
        <tr><th style="text-align:left">Enfants</th><td><input type="number" name="enfantsGarcons" min="0" max="5000" step="1" inputmode="numeric" value="0" class="sens-eff"></td><td><input type="number" name="enfantsFilles" min="0" max="5000" step="1" inputmode="numeric" value="0" class="sens-eff"></td></tr>
      </tbody></table></div>
      <div id="sensCompteurs" class="petit" style="margin:6px 0 10px"></div>
      <h4 class="sous-titre" style="margin-top:14px">Photo(s) de la sensibilisation (preuve)</h4>
      <div class="photo-actions">
        <label class="btn-secondary btn-photo">📷 Prendre une photo<input type="file" id="sensPhotoCamera" accept="image/*" capture="environment" hidden></label>
        <label class="btn-secondary btn-photo">🖼️ Choisir dans la galerie<input type="file" id="sensPhotoInput" accept="image/*" multiple hidden></label>
      </div>
      <div id="sensPhotos" class="fiche-photos" style="margin-top:8px"></div>
      <div class="petit">« Prendre une photo » ouvre l'appareil photo du téléphone. Au moins une photo, ${MAX_PHOTOS} au maximum. Les photos sont réduites automatiquement.</div>
      <button type="submit" class="btn-block" style="margin-top:14px">Envoyer la preuve de sensibilisation</button>
    </form>`;
    const form = zone.querySelector('#formSens');
    const lire = n => { const v = form.querySelector('[name=' + n + ']').value; return v === '' ? 0 : Number(v); };
    function majCompteurs() {
      const adH = lire('adultesHommes'), adF = lire('adultesFemmes'), enG = lire('enfantsGarcons'), enF = lire('enfantsFilles');
      zone.querySelector('#sensCompteurs').innerHTML = `Total : <strong>${adH + adF + enG + enF}</strong> personne(s) · ${adH + adF} adulte(s) · ${enG + enF} enfant(s) · ${adH + enG} homme(s)/garçon(s) · ${adF + enF} femme(s)/fille(s)`;
    }
    form.querySelectorAll('.sens-eff').forEach(i => { i.addEventListener('input', majCompteurs); i.addEventListener('focus', () => { if (i.value === '0') i.select(); }); });
    majCompteurs();

    function dessinerPhotos() {
      zone.querySelector('#sensPhotos').innerHTML = photos.map((u, i) => `<div style="position:relative"><img src="${u}" alt="Photo ${i + 1}"><button type="button" class="btn-danger btn-mini" data-ph="${i}" style="position:absolute;top:4px;right:4px">✕</button></div>`).join('');
    }
    zone.querySelector('#sensPhotos').addEventListener('click', e => { const b = e.target.closest('[data-ph]'); if (b) { photos.splice(Number(b.dataset.ph), 1); dessinerPhotos(); } });
    const surPhotos = async e => {
      const fichiers = Array.from(e.target.files || []); e.target.value = '';
      for (const f of fichiers) {
        if (photos.length >= MAX_PHOTOS) { toast('Maximum ' + MAX_PHOTOS + ' photos.', true); break; }
        try { photos.push(await redimensionner(f, 1280)); } catch (err) { toast(err.message, true); }
      }
      dessinerPhotos();
    };
    zone.querySelector('#sensPhotoInput').addEventListener('change', surPhotos);
    zone.querySelector('#sensPhotoCamera').addEventListener('change', surPhotos);

    form.addEventListener('submit', async e => {
      e.preventDefault();
      const vals = ['adultesHommes', 'adultesFemmes', 'enfantsGarcons', 'enfantsFilles'].map(lire);
      if (vals.some(v => !isFinite(v) || v < 0 || Math.floor(v) !== v)) { toast('Les effectifs doivent être des nombres entiers positifs ou nuls.', true); return; }
      if (vals.reduce((a, b) => a + b, 0) < 1) { toast('Indiquez le nombre de personnes sensibilisées (adultes et enfants, par sexe).', true); return; }
      if (!photos.length) { toast('Ajoutez au moins une photo de la sensibilisation.', true); return; }
      const fd = new FormData(form), btn = form.querySelector('button[type=submit]'); btn.disabled = true;
      try {
        const r = await Api.call('submitSensibilisation', {
          date: fd.get('date'), theme: fd.get('theme'), lieu: fd.get('lieu'), commentaires: fd.get('commentaires'),
          adultesHommes: vals[0], adultesFemmes: vals[1], enfantsGarcons: vals[2], enfantsFilles: vals[3], photos: photos.slice()
        });
        toast(r.queued ? 'Pas de réseau : la preuve est gardée sur ce téléphone et sera envoyée automatiquement.' : (r.sensibilisation && r.sensibilisation.Statut === 'En attente' ? 'Preuve enregistrée. Elle sera visible des autres niveaux après approbation de votre ASCQ.' : 'Preuve de sensibilisation enregistrée. Merci !'));
        dessinerFormulaire();
      } catch (err) { toast(err.message, true); btn.disabled = false; }
    });
  }

  // ---------------------------------------------------------------------
  // Liste (historique du RC, ou lecture par les niveaux supérieurs)
  // ---------------------------------------------------------------------
  var BADGES = { 'En attente': '<span class="badge badge-late">⏳ En attente d\'approbation</span>', 'Approuvée': '<span class="badge badge-done">✔ Approuvée</span>', 'Rejetée': '<span class="badge badge-cancel">✖ Rejetée</span>' };
  function badgeStatut(s) { return BADGES[s.Statut] || ''; }

  // Paramètre national : validation par l'ASCQ avant que les travaux des RC (alertes, décès, sensibilisations)
  // remontent aux niveaux supérieurs. Bloc réutilisable (aussi affiché sur le tableau de bord du National).
  function blocParametre(el, actif) {
    var ancien = el.querySelector('#blocParamValidation'); if (ancien) ancien.remove();
    var z = document.createElement('div'); z.className = 'card'; z.id = 'blocParamValidation'; z.style.marginBottom = '12px';
    z.innerHTML = '<label style="display:flex;gap:8px;align-items:flex-start;font-weight:600"><input type="checkbox" id="sensParamApprobation" style="width:auto;margin-top:3px"' + (actif ? ' checked' : '') + '> <span>Exiger la validation de l\'ASCQ avant que les travaux des relais communautaires remontent aux autres niveaux<br><span class="petit" style="font-weight:400">Activé : alertes, décès et sensibilisations notifiés par un RC ne sont visibles (ni notifiés) du point focal, de la coordination, du département et du national qu\'<strong>après validation par l\'ASCQ</strong>. Les activités et tâches demandées par un niveau supérieur ne sont pas concernées. Désactivé : tout remonte immédiatement.</span></span></label>';
    el.insertBefore(z, el.firstChild);
    z.querySelector('input').addEventListener('change', async function (e) {
      try { await Api.call('setParametre', { cle: 'validationAscq', valeur: e.target.checked }); toast(e.target.checked ? 'Validation par l\'ASCQ activée.' : 'Validation par l\'ASCQ désactivée : les nouvelles notifications remontent directement.'); }
      catch (err) { e.target.checked = !e.target.checked; toast(err.message, true); }
    });
  }
  window.blocParametreValidation = blocParametre;

  async function decider(s, decision, apres) {
    var motif = '';
    if (decision === 'rejeter') { motif = (window.prompt('Motif du rejet (le relais communautaire le verra) :') || '').trim(); if (motif.length < 3) { toast('Le motif du rejet est obligatoire.', true); return; } }
    else if (!window.confirm('Approuver cette sensibilisation ? Elle sera alors visible des niveaux supérieurs.')) return;
    try { await Api.call('decideSensibilisation', { id: s.ID, decision: decision, motif: motif }); toast(decision === 'rejeter' ? 'Sensibilisation rejetée. Le relais communautaire est prévenu.' : 'Sensibilisation approuvée et transmise aux niveaux supérieurs.'); apres(); }
    catch (err) { toast(err.message, true); }
  }

  async function chargerListe(zoneId, estRc) {
    const el = document.getElementById(zoneId);
    el.innerHTML = 'Chargement…';
    let r;
    try { r = await Api.call('listSensibilisations', {}); } catch (e) { el.innerHTML = '<div class="empty-state">Erreur de chargement : ' + esc(e.message) + '</div>'; return; }
    const role = (ctx && ctx.user && ctx.user.Role) || '', estAscq = role === 'ASCQ', estNat = role === 'NATIONAL', avecStatut = estRc || estAscq;
    const rows = r.sensibilisations;
    const rechargeur = () => chargerListe(zoneId, estRc);
    if (!rows.length) {
      el.innerHTML = '<div class="empty-state">' + (estRc ? 'Vous n\'avez encore enregistré aucune sensibilisation.' : 'Aucune sensibilisation ' + (estAscq ? '' : 'approuvée ') + 'pour le moment dans votre périmètre.') + '</div>';
      if (estNat) await blocParametre(el, r.approbationActive);
      return;
    }
    el.innerHTML = `${estAscq && r.nbEnAttente ? `<div class="card" style="border-left:5px solid #C2410C;margin-bottom:12px"><strong>⏳ ${r.nbEnAttente} sensibilisation(s) en attente de votre approbation.</strong> Elles ne sont visibles des niveaux supérieurs qu'après votre approbation.</div>` : ''}
      ${estRc ? '<div class="petit" style="margin-bottom:8px">Une sensibilisation « En attente » est visible de votre ASCQ ; elle est transmise aux autres niveaux une fois approuvée.</div>' : ''}
      <div class="grid grid-4" id="sensStats" style="margin-bottom:12px"></div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:10px">
        <input id="sensRech" placeholder="${estRc ? 'Rechercher (thème, lieu)' : 'Rechercher (RC, village, thème)'}" style="flex:1;min-width:180px">
        ${avecStatut ? `<select id="sensStatut"><option value="">Tous les statuts</option><option value="En attente">En attente</option><option value="Approuvée">Approuvées</option><option value="Rejetée">Rejetées</option></select>` : ''}
        <label class="petit">Du <input type="date" id="sensDu"></label><label class="petit">au <input type="date" id="sensAu"></label>
        <button type="button" class="btn-secondary btn-mini" id="sensExport">⬇ Statistiques (CSV)</button></div>
      <div class="table-wrap"><table><thead><tr><th>Date</th>${estRc ? '' : '<th>Relais communautaire</th><th>Village</th>'}<th>Thème</th><th>Personnes</th><th>Preuves</th>${avecStatut ? '<th>Statut</th>' : ''}<th></th></tr></thead><tbody id="sensCorps"></tbody></table></div>`;
    if (estAscq && r.nbEnAttente) el.querySelector('#sensStatut').value = 'En attente';
    const corps = el.querySelector('#sensCorps');
    function filtrer() {
      const t = el.querySelector('#sensRech').value.trim().toLowerCase(), du = el.querySelector('#sensDu').value, au = el.querySelector('#sensAu').value;
      const st = avecStatut ? el.querySelector('#sensStatut').value : '';
      return rows.filter(s => (!du || s.Date >= du) && (!au || s.Date <= au) && (!st || s.Statut === st) && (!t || (s.Theme + ' ' + s.Lieu + ' ' + s.RcNom + ' ' + s.VillageNom).toLowerCase().includes(t)));
    }
    function montrer() {
      const v = filtrer();
      // Chiffres réels : le total = somme des totaux enregistrés ; le détail adultes/enfants ne compte que les séances dont
      // le détail est cohérent (DetailOk). Une valeur impossible n'est jamais affichée.
      const nombre = x => { const n = Number(x); return isFinite(n) && n >= 0 && n <= 20000 ? n : 0; };
      const avecDetail = v.filter(s => s.DetailOk !== false);
      const som = k => avecDetail.reduce((a, s) => a + nombre(s[k]), 0);
      const adH = som('NbAdultesH'), adF = som('NbAdultesF'), enG = som('NbEnfantsG'), enF = som('NbEnfantsF');
      const total = v.reduce((a, s) => a + nombre(s.NbParticipants), 0);
      const sansDetail = v.length - avecDetail.length;
      const noteDetail = sansDetail ? '<div class="petit">détail connu pour ' + avecDetail.length + ' séance(s) sur ' + v.length + '</div>' : '';
      el.querySelector('#sensStats').innerHTML = [[v.length, 'Séances', ''], [total, 'Personnes sensibilisées', ''], [adH + adF, 'Adultes (' + adH + ' H · ' + adF + ' F)', noteDetail], [enG + enF, 'Enfants (' + enG + ' G · ' + enF + ' F)', noteDetail]].map(x => `<div class="stat-card"><div class="n">${x[0]}</div><div class="l">${x[1]}</div>${x[2]}</div>`).join('');
      corps.innerHTML = v.length ? v.map(s => {
        const ph = jsonArr(s.PhotosUrls);
        const decisions = estAscq && s.Statut !== 'Approuvée' ? `<div style="display:flex;gap:4px;margin-top:4px;flex-wrap:wrap"><button type="button" class="btn-mini" data-appr="${esc(s.ID)}">✔ Approuver</button>${s.Statut === 'En attente' ? `<button type="button" class="btn-danger btn-mini" data-rej="${esc(s.ID)}">✖ Rejeter</button>` : ''}</div>` : '';
        return `<tr><td>${dFr(s.Date)}${s.HorsLigne ? '<div class="petit">hors connexion</div>' : ''}</td>${estRc ? '' : `<td>${esc(s.RcNom)}</td><td>${esc(s.VillageNom)}</td>`}<td><strong>${esc(s.Theme)}</strong>${s.Lieu ? '<div class="petit">' + esc(s.Lieu) + '</div>' : ''}</td>
          <td>${esc(s.NbParticipants)}${s.DetailOk === false ? '<div class="petit">détail par sexe/âge non disponible</div>' : `<div class="petit">Adultes ${esc(s.NbAdultesH)} H · ${esc(s.NbAdultesF)} F<br>Enfants ${esc(s.NbEnfantsG)} G · ${esc(s.NbEnfantsF)} F</div>`}</td>
          <td>${ph.length ? `<a href="${esc(ph[0])}" target="_blank" rel="noopener"><img class="sens-mini" src="${esc(miniature(ph[0]))}" alt="Photo" loading="lazy"></a>${ph.length > 1 ? '<div class="petit">+' + (ph.length - 1) + ' photo(s)</div>' : ''}` : '—'}</td>
          ${avecStatut ? `<td>${badgeStatut(s)}${s.Statut === 'Rejetée' && s.MotifRejet ? '<div class="petit">Motif : ' + esc(s.MotifRejet) + '</div>' : ''}${decisions}</td>` : ''}
          <td><button type="button" class="btn-secondary btn-mini" data-sens="${esc(s.ID)}">Détail</button></td></tr>`;
      }).join('') : `<tr><td colspan="${(estRc ? 5 : 7) + (avecStatut ? 1 : 0)}" class="petit">Aucune sensibilisation ne correspond.</td></tr>`;
    }
    ['#sensRech', '#sensDu', '#sensAu', '#sensStatut'].forEach(sel => { const n = el.querySelector(sel); if (n) { n.addEventListener('input', montrer); n.addEventListener('change', montrer); } });
    corps.addEventListener('click', e => {
      const b = e.target.closest('[data-sens]'); if (b) { detail(rows.find(x => x.ID === b.dataset.sens), estRc, estAscq, rechargeur); return; }
      const ap = e.target.closest('[data-appr]'); if (ap) { decider(rows.find(x => x.ID === ap.dataset.appr), 'approuver', rechargeur); return; }
      const rj = e.target.closest('[data-rej]'); if (rj) decider(rows.find(x => x.ID === rj.dataset.rej), 'rejeter', rechargeur);
    });
    el.querySelector('#sensExport').onclick = () => {
      const l = [['Date', 'Relais communautaire', 'Village', 'Thème', 'Lieu', 'Adultes hommes', 'Adultes femmes', 'Enfants garçons', 'Enfants filles', 'Total', 'Statut']];
      filtrer().forEach(s => l.push([s.Date, s.RcNom, s.VillageNom, s.Theme, s.Lieu, s.DetailOk === false ? '' : s.NbAdultesH, s.DetailOk === false ? '' : s.NbAdultesF, s.DetailOk === false ? '' : s.NbEnfantsG, s.DetailOk === false ? '' : s.NbEnfantsF, s.NbParticipants, s.Statut]));
      telecharger('sensibilisations_statistiques.csv', csv(l));
    };
    montrer();
    if (estNat) await blocParametre(el, r.approbationActive);
  }

  function detail(s, estRc, estAscq, apres) {
    const ph = jsonArr(s.PhotosUrls), pers = jsonArr(s.Participants); // pers : anciennes saisies nominatives, le cas échéant
    const ov = document.createElement('div'); ov.className = 'modal-overlay';
    ov.innerHTML = `<div class="modal-box" style="width:760px;max-height:92vh;overflow:auto">
      <h3 style="margin-top:0">📣 ${esc(s.Theme)}</h3>
      <div class="petit" style="margin-bottom:10px">${dFr(s.Date)}${s.Lieu ? ' · ' + esc(s.Lieu) : ''}${estRc ? '' : ' · ' + esc(s.RcNom) + (s.VillageNom ? ' (' + esc(s.VillageNom) + ')' : '')} · ${esc(s.NbParticipants)} personne(s) sensibilisée(s)</div>
      ${(estRc || estAscq) ? `<div style="margin-bottom:8px">${badgeStatut(s)}${s.Statut === 'Rejetée' && s.MotifRejet ? ' <span class="petit">Motif : ' + esc(s.MotifRejet) + '</span>' : ''}${s.ApprouveParNom && estAscq ? ' <span class="petit">· décision de ' + esc(s.ApprouveParNom) + '</span>' : ''}</div>` : ''}
      ${s.Commentaires ? `<p style="margin:0 0 10px">${esc(s.Commentaires)}</p>` : ''}
      <div class="fiche-photos">${ph.map((u, i) => `<a href="${esc(u)}" target="_blank" rel="noopener"><img src="${esc(miniature(u))}" alt="Photo ${i + 1}"></a>`).join('') || '<span class="petit">Aucune photo.</span>'}</div>
      <h4 class="sous-titre">Personnes sensibilisées</h4>
      ${s.DetailOk === false ? `<p class="petit">Le détail par sexe et par âge n'est pas disponible pour cette séance. Total enregistré : <strong>${esc(s.NbParticipants)}</strong> personne(s).</p>` : `<div class="table-wrap"><table><thead><tr><th></th><th>Hommes / Garçons</th><th>Femmes / Filles</th><th>Total</th></tr></thead><tbody>
        <tr><th style="text-align:left">Adultes</th><td>${esc(s.NbAdultesH)}</td><td>${esc(s.NbAdultesF)}</td><td>${Number(s.NbAdultesH || 0) + Number(s.NbAdultesF || 0)}</td></tr>
        <tr><th style="text-align:left">Enfants</th><td>${esc(s.NbEnfantsG)}</td><td>${esc(s.NbEnfantsF)}</td><td>${Number(s.NbEnfantsG || 0) + Number(s.NbEnfantsF || 0)}</td></tr>
        <tr><th style="text-align:left">Total</th><td>${Number(s.NbAdultesH || 0) + Number(s.NbEnfantsG || 0)}</td><td>${Number(s.NbAdultesF || 0) + Number(s.NbEnfantsF || 0)}</td><td><strong>${esc(s.NbParticipants)}</strong></td></tr></tbody></table></div>`}
      ${pers.length ? `<h4 class="sous-titre">Liste nominative (ancienne saisie)</h4><div class="petit">${pers.map(p => esc(p.nom) + ' (' + (p.sexe === 'F' ? 'F' : 'M') + ', ' + esc(p.age) + ' ans)').join(' · ')}</div>` : ''}
      <div style="margin-top:14px;display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap">${estAscq && s.Statut !== 'Approuvée' ? `<button type="button" id="sensApprouver">✔ Approuver</button>${s.Statut === 'En attente' ? '<button type="button" class="btn-danger" id="sensRejeter">✖ Rejeter</button>' : ''}` : ''}<button type="button" class="btn-secondary" id="sensFerme">Fermer</button></div></div>`;
    document.body.appendChild(ov);
    const fermer = () => ov.remove();
    ov.querySelector('#sensFerme').onclick = fermer;
    const ba = ov.querySelector('#sensApprouver'), br = ov.querySelector('#sensRejeter');
    if (ba) ba.onclick = () => decider(s, 'approuver', () => { fermer(); apres(); });
    if (br) br.onclick = () => decider(s, 'rejeter', () => { fermer(); apres(); });
    ov.addEventListener('click', e => { if (e.target === ov) fermer(); });
  }
})();
