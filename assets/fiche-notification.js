/**
 * Module « Fiche de notification » (niveaux RCSE et ASCQ) : fiche officielle
 * « 1_BJ_FORMULAIRE GENERIQUE DE NOTIFICATION DES MALADIES SOUS SURVEILLANCE ».
 *   • Page de remplissage indépendante (cases à cocher + champs) ;
 *   • à chaque enregistrement, la liste de tous les cas remplis s'affiche avec leurs informations ;
 *   • chaque cas peut être imprimé sur la fiche officielle (cases cochées, champs remplis), modifié ou supprimé ;
 *   • l'ASCQ notifie pour son/ses arrondissement(s) ; ses fiches remontent automatiquement chez le RCSE ;
 *   • côté RCSE : la liste regroupe ses fiches + celles de ses ASCQ, et une synthèse par arrondissement s'affiche en bas.
 * Dépend de api.js (Api, toast, fmtDate, escHtml).
 *
 * initFicheNotification({ containerId, user })
 */
(function () {
  const MALADIES = ['Rougeole', 'Fièvre Jaune', 'Choléra', 'Shigellose', 'Méningite', 'Intoxication', 'Hépatites', 'F Typhoïde', 'Syphilis End.',
    'Noma', 'Dracunculose', 'Lèpre', 'Peste', 'Ulcère Buruli', 'Pian', 'Zika', 'Anthrax', 'Grippe HP'];
  const SIGNES = ['Fièvre', 'Eruption cutanée', 'Diarrhée aqueuse', 'Vomissement', 'Selles sanguinolente',
    'Céphalée', 'Hémorragie', 'Raideur nuque', 'Altération conscience', 'Bombement fontanelle',
    'Photophobie', 'Hydrophobie', 'Convulsions', 'Ictère', 'Fatigue intense',
    'Nausée', 'Maux de gorge', 'Toux', 'Douleurs abdominales', 'Anorexie',
    'Gonflement des ganglions', 'Crachats teintés de sang', 'Lésions cutanées', 'Difficultés respiratoires'];
  const PROFESSIONS = [['1', 'Salarié'], ['2', 'Cultivateur'], ['3', 'Eleveur/Chasseur'], ['4', 'Commerçant'], ['5', 'Artisan'], ['6', 'Elève/Etudiant'],
    ['7', 'Professionnel de santé'], ['8', 'Ménagère'], ['9', 'Aucun'], ['10', 'NA'], ['11', 'Autre']];
  const MATRIMONIAL = [['1', 'Marié'], ['2', 'Célibataire'], ['3', 'Veuf'], ['4', 'Divorcé'], ['5', 'NA']];
  const NIVEAUX = [['1', 'Non scolarisé'], ['2', 'Alphabétisé'], ['3', 'Primaire'], ['4', 'Secondaire'], ['5', 'Université'], ['6', 'NA']];
  const NATIONALITES = [['1', 'Béninoise'], ['2', 'Autre nationalité']];
  const CLASSIF = ['Suspect', 'Probable', 'Confirmé par le laboratoire', 'Confirmé par lien épidémiologique', 'Confirmé cliniquement'];
  const PRELEV = ['Sang', 'Selles', 'LCR'];

  let ctx = null, fiches = [], enAttente = [], editId = null, semaineCourante = null;
  // Type de fiche affiché : maladie (fiche générique 1_BJ) ou l'une des fiches décès (3_BJ, 4_BJ, 02_BJ).
  // `validation` : fiche demandée à l'ASCQ pour VALIDER une alerte / confirmer un décès du relais communautaire.
  let typeCourant = 'maladie', formS = null, validation = null;
  let signatures = {};   // signature (PNG de « Mon compte ») de chaque notificateur, pour le PDF
  const TYPES_LIB = { maladie: 'Maladie sous surveillance (fiche générique 1_BJ)', deces_maternel: 'Décès maternel (fiche 3_BJ)', deces_neonatal: 'Décès néonatal (fiche 4_BJ)', autres_deces: 'Autres décès (fiche 02_BJ)' };
  let mesArrs = [], mesVillages = [], anneeSynthese = '';  // arrondissements / villages du périmètre du compte

  // ---------------- utilitaires ----------------
  const E = escHtml;
  const nomSigne = i => 'sg' + i;
  const clientId = () => 'fn-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
  function lireDonnees(f) { try { const d = JSON.parse(f.Donnees || '{}'); const o = d && typeof d === 'object' ? d : {}; o.typeFiche = o.typeFiche || f.TypeFiche || 'maladie'; o.__creePar = f.CreeParNom || '';
    // Signature de CELUI QUI A NOTIFIÉ (jamais celle du compte qui consulte ou corrige) ; fiche en attente d'envoi = compte courant.
    o.__signature = signatures[f.CreeParId] || ((!f.CreeParId || f.CreeParId === ctx.user.ID) ? (ctx.user.Signature || '') : '');
    return o; } catch (e) { return { typeFiche: f.TypeFiche || 'maladie' }; } }
  const coche = v => v ? '☒' : '☐';

  // ---------------- champs du formulaire ----------------
  const txt = (name, label, extra) => `<div class="field"><label>${label}</label><input name="${name}" ${extra || ''}></div>`;
  const dat = (name, label) => `<div class="field"><label>${label}</label><input type="date" name="${name}"></div>`;
  const radios = (name, liste) => liste.map(o => { const [v, l] = Array.isArray(o) ? o : [o, o];
    return `<label class="fn-opt"><input type="radio" name="${name}" value="${E(v)}"> ${E(Array.isArray(o) ? v + ' — ' + l : l)}</label>`; }).join('');

  function optionsArrondissements() {
    if (!mesArrs.length) return '<option value="">Aucun arrondissement disponible (connexion requise)</option>';
    return '<option value="">— Choisir —</option>' + mesArrs.map(a => `<option value="${E(a.ID)}">${E(a.Nom)}${a.CommuneNom ? ' (' + E(a.CommuneNom) + ')' : ''}</option>`).join('');
  }

  // Met à jour commune / département (déduits de l'arrondissement) et les villages proposés.
  function majGeoFormulaire(ecraser) {
    const f = document.getElementById('fnForm'), sel = f.elements['arrondissementId'], a = mesArrs.find(x => x.ID === sel.value);
    if (ecraser) {
      f.elements['comResidence'].value = a ? (a.CommuneNom || '') : '';
      f.elements['depResidence'].value = a ? (a.DepartementNom || '') : '';
    }
    document.getElementById('fnVillages').innerHTML = a ? mesVillages.filter(v => v.ArrondissementId === a.ID).map(v => `<option value="${E(v.Nom)}"></option>`).join('') : '';
  }

  function barreType() {
    return `<div id="fnValidBandeau" class="fn-bloc" style="display:none;background:#F2FAF7;border-color:var(--teal-700)"></div>
      <div class="fn-bloc" id="fnTypeBar"><div class="field" style="margin:0"><label>Type de fiche à remplir</label>
        <select id="fnType">${Object.keys(TYPES_LIB).map(k => `<option value="${k}">${E(TYPES_LIB[k])}</option>`).join('')}</select></div>
        <p class="petit" style="margin:8px 0 0">Toutes les rubriques sont <strong>obligatoires</strong> (écrivez <strong>NA</strong> quand l'information est inconnue ou sans objet), sauf celles qui dépendent d'un choix (« Autre à préciser », dates de vaccination…).</p></div>`;
  }

  function formulaireHtml() {
    return `<form id="fnForm" autocomplete="off">
      <div class="fn-bloc"><h3>Localisation de la formation sanitaire</h3>
        <div class="grid grid-2">${txt('departement', 'Département')}${txt('zoneSanitaire', 'Zone sanitaire')}${txt('commune', 'Commune')}${txt('formationSanitaire', 'Formation sanitaire')}</div>
      </div>

      <div class="fn-bloc"><h3>Maladie notifiée <span class="petit">(cochez une seule maladie)</span></h3>
        <div class="fn-grille">${radios('maladie', MALADIES)}
          <label class="fn-opt"><input type="radio" name="maladie" value="Autre"> Autre à préciser :</label></div>
        <div class="field" style="margin-top:8px"><input name="maladieAutre" placeholder="Précisez la maladie si « Autre »"></div>
      </div>

      <div class="fn-bloc"><h3>Notification</h3>
        <div class="grid grid-2">${txt('annee', 'Année de notification', 'inputmode="numeric" maxlength="4"')}${txt('semaine', 'Semaine épidémiologique', 'inputmode="numeric" maxlength="2"')}</div>
        <div class="field"><label>Statut épidémiologique</label><div class="fn-ligne">${radios('statutEpi', ['En routine', 'En épidémie'])}</div></div>
      </div>

      <div class="fn-bloc"><h3>Résidence et identification du cas</h3>
        <div class="grid grid-2">${txt('pays', 'Pays')}
          <div class="field"><label>Arrondissement de résidence *</label><select name="arrondissementId" id="fnArr" required>${optionsArrondissements()}</select></div>
          ${txt('comResidence', 'Commune', 'readonly')}${txt('depResidence', 'Département', 'readonly')}
          <div class="field"><label>Ville / Village</label><input name="village" id="fnVillage" list="fnVillages" placeholder="Choisissez dans la liste ou saisissez"><datalist id="fnVillages"></datalist></div>
          ${txt('quartier', 'Quartier')}${txt('adresse', 'Adresse')}</div>
        <div class="field"><label>Urbaine / Rurale</label><div class="fn-ligne">${radios('zoneType', [['U', 'Urbaine'], ['R', 'Rurale']])}</div></div>
        <div class="grid grid-2">${txt('nomPatient', 'Nom du patient *', 'required')}${txt('parent', 'Père / Mère')}${txt('telephone', 'Téléphone')}${txt('adresseParents', 'Adresse des parents / tuteurs')}</div>
        <div class="grid grid-2">${dat('dateNaissance', 'Date de naissance')}
          <div class="field"><label>… ou âge</label><div class="fn-age"><input name="ageAns" inputmode="numeric" placeholder="ans"><input name="ageMois" inputmode="numeric" placeholder="mois"><input name="ageJours" inputmode="numeric" placeholder="jours"></div></div></div>
        <div class="field"><label>Sexe</label><div class="fn-ligne">${radios('sexe', [['F', 'Féminin'], ['M', 'Masculin']])}</div></div>
        <div class="grid grid-2">
          <div class="field"><label>Profession</label><div class="fn-col">${radios('profession', PROFESSIONS)}</div><input name="professionAutre" placeholder="Si autre, précisez" style="margin-top:6px"></div>
          <div class="field"><label>Statut matrimonial</label><div class="fn-col">${radios('matrimonial', MATRIMONIAL)}</div></div>
          <div class="field"><label>Niveau scolaire</label><div class="fn-col">${radios('niveau', NIVEAUX)}</div></div>
          <div class="field"><label>Nationalité</label><div class="fn-col">${radios('nationalite', NATIONALITES)}</div><input name="nationaliteAutre" placeholder="Si autre nationalité, précisez" style="margin-top:6px"></div>
        </div>
        <div class="grid grid-2">${txt('gpsLon', 'Coordonnées GPS — Longitude')}${txt('gpsLat', 'Coordonnées GPS — Latitude')}</div>
        <button type="button" class="btn-secondary" id="fnGps" style="font-size:.8rem;padding:6px 12px">📍 Utiliser ma position actuelle</button>
      </div>

      <div class="fn-bloc"><h3>Histoire de la maladie</h3>
        <div class="grid grid-3">${dat('dateDebut', 'Date de début des symptômes')}${dat('dateConsultation', 'Date de consultation')}${dat('dateNotification', 'Date de notification')}</div>
        <div class="field"><label>Signes et symptômes</label><div class="fn-grille">${SIGNES.map((s, i) => `<label class="fn-opt"><input type="checkbox" name="${nomSigne(i)}"> ${E(s)}</label>`).join('')}</div>
          <input name="signesAutres" placeholder="Autres signes à préciser" style="margin-top:8px"></div>
        <div class="field"><label>Type de consultation</label><div class="fn-ligne">${radios('consultation', ['Externe', 'Hospitalisé'])}</div></div>
        <div class="field"><label>Évolution</label><div class="fn-ligne">${radios('evolution', ['Vivant', 'Décédé', 'Inconnu'])}</div></div>
        <div class="field"><label>Statut vaccinal</label><div class="fn-ligne">${radios('vaccinal', ['Vacciné', 'Non vacciné'])}</div></div>
        <div class="grid grid-2">${txt('nbDoses', 'Si vacciné — nombre de doses', 'inputmode="numeric"')}${dat('dateDerniereDose', 'Date de la dernière dose')}</div>
        <div class="field"><label>Classification finale</label><div class="fn-ligne">${radios('classification', CLASSIF)}</div></div>
      </div>

      <div class="fn-bloc"><h3>Notificateur</h3>
        <div class="grid grid-2">${txt('notifNom', 'Nom du notificateur')}${txt('notifTel', 'Téléphone')}${txt('notifQualif', 'Qualification')}</div>
        <p class="petit">La signature se fait à la main sur la fiche imprimée.</p>
      </div>

      <div class="fn-bloc"><h3>Prélèvement</h3>
        <div class="field"><label>Type de prélèvement</label><div class="fn-ligne">${PRELEV.map((s, i) => `<label class="fn-opt"><input type="checkbox" name="prel${i}"> ${s}</label>`).join('')}
          <label class="fn-opt"><input type="checkbox" name="prelGorge"> Prélèvement de gorge</label></div></div>
        <div class="grid grid-2">${txt('aspectLcr', 'Aspect du LCR')}${txt('prelAutre', 'Autre prélèvement à préciser')}${dat('datePrelevement', 'Date de prélèvement')}${txt('heurePrelevement', 'Heure de prélèvement', 'type="time"')}
          ${dat('dateEnvoi', "Date d'envoi du prélèvement")}${txt('heureEnvoi', "Heure d'envoi", 'type="time"')}</div>
      </div>

      <div class="fn-actions"><button type="submit" id="fnSave">💾 Enregistrer la fiche</button>
        <button type="button" class="btn-secondary" id="fnReset">Vider le formulaire</button>
        <span id="fnEditInfo" class="petit"></span></div>
    </form>`;
  }

  // ---------------- lecture / écriture du formulaire ----------------
  function lireFormulaire() {
    const f = document.getElementById('fnForm'), d = {};
    f.querySelectorAll('input, select').forEach(el => {
      if (!el.name) return;
      if (el.type === 'radio') { if (el.checked) d[el.name] = el.value; }
      else if (el.type === 'checkbox') { d[el.name] = el.checked; }
      else d[el.name] = el.value.trim();
    });
    d.signes = SIGNES.filter((s, i) => d[nomSigne(i)]);
    SIGNES.forEach((s, i) => delete d[nomSigne(i)]);
    d.prelevements = PRELEV.filter((s, i) => d['prel' + i]);
    PRELEV.forEach((s, i) => delete d['prel' + i]);
    d.prelGorge = !!d.prelGorge;
    return d;
  }

  function remplirFormulaire(d) {
    const f = document.getElementById('fnForm');
    f.reset();
    f.querySelectorAll('input, select').forEach(el => {
      if (!el.name) return;
      if (el.type === 'radio') el.checked = d[el.name] === el.value;
      else if (el.type === 'checkbox') {
        let m = /^sg(\d+)$/.exec(el.name), p = /^prel(\d+)$/.exec(el.name);
        if (m) el.checked = (d.signes || []).indexOf(SIGNES[+m[1]]) !== -1;
        else if (p) el.checked = (d.prelevements || []).indexOf(PRELEV[+p[1]]) !== -1;
        else el.checked = !!d[el.name];
      } else el.value = d[el.name] !== undefined ? d[el.name] : '';
    });
    majGeoFormulaire(false);
  }

  // Valeurs par défaut tirées du compte RCSE (zone sanitaire, notificateur) et de la semaine en cours.
  function valeursParDefaut() {
    const u = ctx.user, auj = new Date().toISOString().slice(0, 10);
    return {
      departement: u.DepartementNom || '', zoneSanitaire: u.ZoneSanitaireNom || '', commune: u.Role === 'ASCQ' ? (u.CommuneNom || '') : '', pays: 'Bénin',
      notifQualif: u.Role === 'ASCQ' ? 'ASCQ' : (u.Role === 'RCSE' ? 'RCSE' : ''),
      arrondissementId: mesArrs.length === 1 ? mesArrs[0].ID : '',
      annee: semaineCourante ? String(semaineCourante.Annee) : String(new Date().getFullYear()),
      semaine: semaineCourante ? String(semaineCourante.SemaineEpi) : '',
      dateNotification: auj, notifNom: ((u.Prenom || '') + ' ' + (u.Nom || '')).trim(), notifTel: u.Telephone || ''
    };
  }

  // Valeurs par défaut des fiches décès (compte, zone sanitaire, notificateur, semaine en cours).
  function valeursParDefautSchema() {
    const u = ctx.user, v = valeursParDefaut();
    return Object.assign({}, v, { depResidence: '', comResidence: '', depNotif: u.DepartementNom || '', zsNotif: u.ZoneSanitaireNom || '', comNotif: u.Role === 'ASCQ' ? (u.CommuneNom || '') : '',
      dateEnquete: v.dateNotification, arrondissementId: mesArrs.length === 1 ? mesArrs[0].ID : '' });
  }
  function monterSchema(type, valeurs) {
    formS = FicheForm.monter(document.getElementById('fnFormS'), type, { arrs: mesArrs, valeurs: valeurs, onSubmit: d => enregistrer(type, d), onReset: () => { if (confirm('Vider le formulaire ?')) nouvelleFiche(); } });
    formS.fixerBouton(validation ? '✅ Valider l\u2019alerte et envoyer la fiche' : (editId ? '💾 Enregistrer les modifications' : '💾 Enregistrer la fiche'));
  }
  // Affiche le formulaire du type demandé (générique ou fiche décès), vide ou pré-rempli.
  function afficherType(type, valeurs) {
    typeCourant = type;
    const sel = document.getElementById('fnType'); if (sel) sel.value = type;
    const generique = type === 'maladie';
    document.getElementById('fnForm').style.display = generique ? '' : 'none';
    document.getElementById('fnFormS').style.display = generique ? 'none' : '';
    if (generique) {
      remplirFormulaire(Object.assign(valeursParDefaut(), valeurs || {}));
      majGeoFormulaire(!(valeurs && valeurs.arrondissementId));
      document.getElementById('fnSave').textContent = validation ? '✅ Valider l\u2019alerte et envoyer la fiche' : (editId ? '💾 Enregistrer les modifications' : '💾 Enregistrer la fiche');
    } else monterSchema(type, Object.assign(valeursParDefautSchema(), valeurs || {}));
  }

  function nouvelleFiche() {
    editId = null;
    afficherType(typeCourant, null);
    document.getElementById('fnEditInfo').textContent = '';
  }

  function modifierFiche(id) {
    const f = fiches.find(x => x.ID === id); if (!f) return;
    editId = id;
    const d = lireDonnees(f);
    // Le notificateur reste celui qui a notifié (jamais le compte qui corrige) : à défaut, l'auteur enregistré de la fiche.
    if (!d.notifNom) d.notifNom = f.CreeParNom || '';
    if (!d.notifQualif && f.CreeParRole) d.notifQualif = f.CreeParRole;
    const info = '✏️ Modification de la fiche de ' + (f.NomPatient || '') + (estMienne(f) ? '' : ' (saisie par ' + (f.CreeParNom || 'un ASCQ') + ')');
    afficherType(d.typeFiche, d);
    if (d.typeFiche === 'maladie') document.getElementById('fnEditInfo').textContent = info; else formS.fixerInfo(info);
    document.getElementById('fnTypeBar').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  // ---------------- fiche imprimable (reprend la mise en page de la fiche officielle) ----------------
  const CSS_IMPR = `
    @page { size: A4 portrait; margin: 10mm; }
    * { box-sizing: border-box; }
    body { font-family: Arial, Helvetica, sans-serif; font-size: 9.5pt; color: #000; margin: 0; }
    .fiche { page-break-after: always; break-after: page; padding: 2mm; }
    .fiche:last-child { page-break-after: auto; break-after: auto; }
    .top { display: flex; justify-content: space-between; font-weight: 700; font-size: 9pt; }
    h1 { text-align: center; font-size: 12pt; margin: 3mm 0 2mm; }
    .l { display: flex; flex-wrap: wrap; gap: 2mm 8mm; margin: 1.6mm 0; align-items: baseline; }
    .l b { font-weight: 700; } .v { border-bottom: 1px solid #000; min-width: 28mm; padding: 0 1mm; display: inline-block; min-height: 4.5mm; }
    .v.g { min-width: 60mm; } .v.p { min-width: 14mm; text-align: center; }
    .sec { border-top: 1.5px solid #000; margin-top: 2mm; padding-top: 1mm; font-weight: 700; text-transform: uppercase; }
    table { border-collapse: collapse; width: 100%; margin: 1.5mm 0; }
    td, th { border: 1px solid #000; padding: 1mm 1.5mm; vertical-align: top; font-size: 8.8pt; }
    th { text-align: left; font-weight: 700; }
    .mal td { text-align: left; white-space: nowrap; }
    .cb { font-size: 11pt; line-height: 1; }
    .sig { height: 11mm; }
    .nb { font-size: 8pt; }
  `;

  function ficheImprimable(f) {
    const d = lireDonnees(f);
    const v = (k, cls) => `<span class="v ${cls || ''}">${E(d[k] || '')}</span>`;
    const cb = (ok, lib) => `<span><span class="cb">${coche(ok)}</span> ${E(lib)}</span>`;
    const choix = (name, liste) => liste.map(o => { const [val, lib] = Array.isArray(o) ? o : [o, o]; return cb(d[name] === val, lib); }).join('&nbsp;&nbsp; ');
    const code = (name, liste, autre) => liste.map(([val, lib]) => `<div>${coche(d[name] === val)} ${E(val)} — ${E(lib)}${autre && val === autre.code && d[autre.champ] ? ' : <u>' + E(d[autre.champ]) + '</u>' : ''}</div>`).join('');
    const sg = SIGNES.map(s => cb((d.signes || []).indexOf(s) !== -1, s));
    const lignesSignes = [];
    for (let i = 0; i < sg.length; i += 5) lignesSignes.push(sg.slice(i, i + 5));
    const dernier = lignesSignes[lignesSignes.length - 1] || [];
    // La dernière cellule de la grille reprend « Autres à préciser » comme sur la fiche papier.
    const autres = `<span>${E(d.signesAutres ? '☒' : '☐')} Autres à préciser : <u>${E(d.signesAutres || '')}</u></span>`;
    dernier.push(autres);
    const mal = MALADIES.map(m => cb(d.maladie === m, m));
    const lignesMal = [];
    for (let i = 0; i < mal.length; i += 9) lignesMal.push(mal.slice(i, i + 9));
    const dn = d.dateNaissance ? fmtDate(d.dateNaissance) : '';
    const dt = k => d[k] ? fmtDate(d[k]) : '';
    return `<div class="fiche">
      <div class="top"><span>Ministère de la Santé</span><span>République du Bénin</span></div>
      <h1>1_BJ_FORMULAIRE GENERIQUE DE NOTIFICATION DES MALADIES SOUS SURVEILLANCE</h1>
      <div class="l"><span><b>Département :</b> ${v('departement')}</span><span><b>Zone Sanitaire :</b> ${v('zoneSanitaire')}</span><span><b>Commune :</b> ${v('commune')}</span></div>
      <div class="l"><span><b>Formation Sanitaire :</b> ${v('formationSanitaire', 'g')}</span></div>
      <table class="mal">${lignesMal.map(r => '<tr>' + r.map(c => '<td>' + c + '</td>').join('') + '</tr>').join('')}
        <tr><td colspan="9">${cb(d.maladie === 'Autre', 'Autre à préciser :')} <u>${E(d.maladie === 'Autre' ? (d.maladieAutre || '') : '')}</u></td></tr></table>
      <div class="l"><span><b>Année de notification :</b> ${v('annee', 'p')}</span><span><b>Semaine épidémiologique :</b> ${v('semaine', 'p')}</span>
        <span><b>Statut épidémiologique :</b> ${choix('statutEpi', ['En routine', 'En épidémie'])}</span></div>
      <div class="sec">Résidence et identification du cas</div>
      <div class="l"><span><b>Pays</b> ${v('pays')}</span><span><b>Département :</b> ${v('depResidence')}</span><span><b>Commune :</b> ${v('comResidence')}</span><span><b>Arrondissement :</b> ${v('arrondissement')}</span></div>
      <div class="l"><span><b>Ville / Village :</b> ${v('village')}</span><span><b>Quartier :</b> ${v('quartier')}</span><span><b>Adresse :</b> ${v('adresse')}</span>
        <span><b>Urbaine/Rurale</b> ${cb(d.zoneType === 'U', 'U')} ${cb(d.zoneType === 'R', 'R')}</span></div>
      <div class="l"><span><b>Nom du patient :</b> ${v('nomPatient', 'g')}</span><span><b>Père/Mère :</b> ${v('parent')}</span><span><b>Téléphone :</b> ${v('telephone')}</span></div>
      <div class="l"><span><b>Adresse des parents/tuteurs :</b> ${v('adresseParents', 'g')}</span></div>
      <div class="l"><span><b>Date de naissance :</b> <span class="v">${E(dn)}</span></span><span><b>ou Age :</b> ${v('ageAns', 'p')} ans ${v('ageMois', 'p')} mois ${v('ageJours', 'p')} jour</span>
        <span><b>Sexe :</b> ${cb(d.sexe === 'F', 'F')} ${cb(d.sexe === 'M', 'M')}</span></div>
      <table><tr><th>Profession</th><th>Statut matrimonial</th><th>Niveau scolaire</th><th>Nationalité</th></tr>
        <tr class="nb"><td class="nb">${code('profession', PROFESSIONS, { code: '11', champ: 'professionAutre' })}</td><td class="nb">${code('matrimonial', MATRIMONIAL)}</td>
          <td class="nb">${code('niveau', NIVEAUX)}</td><td class="nb">${code('nationalite', NATIONALITES, { code: '2', champ: 'nationaliteAutre' })}</td></tr></table>
      <div class="l"><span><b>Coordonnées GPS : Longitude :</b> ${v('gpsLon')}</span><span><b>Latitude :</b> ${v('gpsLat')}</span></div>
      <div class="sec">Histoire de la maladie</div>
      <div class="l"><span>Date de début des symptômes : <span class="v">${E(dt('dateDebut'))}</span></span><span>Date de consultation : <span class="v">${E(dt('dateConsultation'))}</span></span><span>Date Notification : <span class="v">${E(dt('dateNotification'))}</span></span></div>
      <table>${lignesSignes.map(r => '<tr>' + r.map(c => '<td>' + c + '</td>').join('') + '</tr>').join('')}</table>
      <div class="l"><span><b>Type de consultation :</b> ${choix('consultation', ['Externe', 'Hospitalisé'])}</span><span><b>Evolution :</b> ${choix('evolution', ['Vivant', 'Décédé', 'Inconnu'])}</span></div>
      <div class="l"><span><b>Statut vaccinal :</b> ${choix('vaccinal', ['Vacciné', 'Non vacciné'])}</span><span>Si oui, nombre de doses ${v('nbDoses', 'p')}</span><span>Date dernière dose : <span class="v">${E(dt('dateDerniereDose'))}</span></span></div>
      <div class="l"><span><b>Classification Finale :</b></span>${choix('classification', CLASSIF)}</div>
      <div class="l"><span><b>Nom du Notificateur :</b> ${v('notifNom')}</span><span><b>Tél :</b> ${v('notifTel')}</span><span><b>Qualification :</b> ${v('notifQualif')}</span><span><b>Signature :</b> <span class="v sig g"></span></span></div>
      <div class="l"><span>Type de prélèvement : ${PRELEV.map(p => cb((d.prelevements || []).indexOf(p) !== -1, p)).join('&nbsp;&nbsp; ')}</span><span>Aspect LCR : ${v('aspectLcr', 'g')}</span></div>
      <div class="l"><span>${cb(d.prelGorge, 'Prélèvement de gorge')}</span><span>Autre à préciser : ${v('prelAutre', 'g')}</span><span>Date de prélèvement : <span class="v">${E(dt('datePrelevement'))}</span></span></div>
      <div class="l"><span>Heure de prélèvement : ${v('heurePrelevement', 'p')}</span><span>Date d'envoi du prélèvement : <span class="v">${E(dt('dateEnvoi'))}</span></span><span>Heure d'envoi : ${v('heureEnvoi', 'p')}</span></div>
    </div>`;
  }

  // Téléchargement PDF : une page A4 par fiche, canevas officiel rempli en bleu (écriture manuscrite), partie laboratoire vierge.
  async function telechargerPdf(liste) {
    if (!liste.length) { toast('Aucune fiche à exporter.', true); return; }
    if (!window.FicheNotifPdf) { toast('Export PDF indisponible : rechargez la page.', true); return; }
    try {
      const donnees = liste.map(f => Object.assign({}, lireDonnees(f)));
      const nettoyer = t => String(t || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^A-Za-z0-9]+/g, '_').replace(/^_|_$/g, '');
      const nom = liste.length === 1
        ? 'Fiche_notification_' + [nettoyer(donnees[0].maladie === 'Autre' ? donnees[0].maladieAutre : donnees[0].maladie), nettoyer(donnees[0].nomPatient), donnees[0].semaine ? 'S' + donnees[0].semaine + '-' + (donnees[0].annee || '') : ''].filter(Boolean).join('_') + '.pdf'
        : 'Fiches_notification_' + liste.length + '_cas.pdf';
      await window.FicheNotifPdf.preparer(donnees);
      window.FicheNotifPdf.telecharger(donnees, nom);
    } catch (e) { toast('Export PDF impossible : ' + e.message, true); }
  }

  // Aperçu écran du PDF (même rendu que le fichier téléchargé) avec Télécharger / Imprimer.
  async function pagesCanvas(liste, largeur, dpr) { const donnees = liste.map(f => lireDonnees(f)); await window.FicheNotifPdf.preparer(donnees); return window.FicheNotifPdf.canvases(donnees, largeur, dpr); }

  async function apercuPdf(liste) {
    if (!liste.length) { toast('Aucune fiche à afficher.', true); return; }
    if (!window.FicheNotifPdf) { toast('Aperçu PDF indisponible : rechargez la page.', true); return; }
    const ov = document.createElement('div');
    ov.className = 'modal-overlay';
    ov.innerHTML = `<div class="modal-box" style="width:min(900px,96vw);max-height:94vh;overflow:auto;background:#fff;color:#000">
      <div style="display:flex;gap:8px;flex-wrap:wrap;justify-content:space-between;align-items:center;position:sticky;top:0;background:#fff;padding:6px 0;z-index:2">
        <strong>📄 Aperçu PDF${liste.length > 1 ? ' (' + liste.length + ' fiches)' : ''}</strong>
        <span style="display:flex;gap:6px;flex-wrap:wrap"><button type="button" id="fnPvDl">⬇️ Télécharger le PDF</button><button type="button" class="btn-secondary" id="fnPvPr">🖨️ Imprimer</button><button type="button" class="btn-secondary" id="fnPvX">Fermer</button></span></div>
      <div id="fnPvPages"></div></div>`;
    document.body.appendChild(ov);
    const zone = ov.querySelector('#fnPvPages');
    try { (await pagesCanvas(liste, liste.length > 3 ? 700 : 860, liste.length > 3 ? 1 : 0)).forEach(c => { c.style.border = '1px solid #ccc'; c.style.marginTop = '10px'; zone.appendChild(c); }); }
    catch (e) { zone.textContent = 'Aperçu impossible : ' + e.message; }
    ov.querySelector('#fnPvDl').onclick = () => telechargerPdf(liste);
    ov.querySelector('#fnPvPr').onclick = () => imprimerPages(liste);
    ov.querySelector('#fnPvX').onclick = () => ov.remove();
    ov.addEventListener('click', e => { if (e.target === ov) ov.remove(); });
  }

  // Impression directe de la fiche remplie (même rendu que le PDF) : pages image insérées dans la page puis window.print().
  async function imprimerPages(liste) {
    if (!liste.length) { toast('Aucune fiche à imprimer.', true); return; }
    if (!window.FicheNotifPdf) { toast('Impression indisponible : rechargez la page.', true); return; }
    if (!document.getElementById('fnPrintCss')) {
      const st = document.createElement('style'); st.id = 'fnPrintCss';
      st.textContent = '#fnPrintZone{display:none}@media print{@page{size:A4 portrait;margin:0}body>*:not(#fnPrintZone){display:none!important}#fnPrintZone{display:block!important}#fnPrintZone img{display:block;width:210mm;height:296mm;page-break-after:always;break-after:page}}';
      document.head.appendChild(st);
    }
    const ancien = document.getElementById('fnPrintZone'); if (ancien) ancien.remove();
    const z = document.createElement('div'); z.id = 'fnPrintZone';
    try { (await pagesCanvas(liste, 1240, 1)).forEach(c => { const im = new Image(); im.src = c.toDataURL('image/png'); z.appendChild(im); }); }
    catch (e) { toast('Impression impossible : ' + e.message, true); return; }
    document.body.appendChild(z);
    const fin = () => { z.remove(); window.removeEventListener('afterprint', fin); };
    window.addEventListener('afterprint', fin);
    Promise.all(Array.from(z.querySelectorAll('img')).map(i => i.decode ? i.decode().catch(() => {}) : Promise.resolve())).then(() => setTimeout(() => { try { window.print(); } catch (e) { toast('Impression impossible sur cet appareil : utilisez « Télécharger le PDF ».', true); fin(); } }, 60));
  }

  // Impression via un iframe caché (évite les blocages de fenêtres surgissantes, notamment sur smartphone).
  function imprimer(liste) {
    if (!liste.length) { toast('Aucune fiche à imprimer.', true); return; }
    const html = `<!DOCTYPE html><html lang="fr"><head><meta charset="utf-8"><title>Fiche de notification</title><style>${CSS_IMPR}</style></head><body>${liste.map(ficheImprimable).join('')}</body></html>`;
    let fr = document.getElementById('fnPrintFrame');
    if (fr) fr.remove();
    fr = document.createElement('iframe');
    fr.id = 'fnPrintFrame';
    fr.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0';
    document.body.appendChild(fr);
    fr.onload = () => { try { fr.contentWindow.focus(); fr.contentWindow.print(); } catch (e) { toast("Impression impossible sur cet appareil.", true); } };
    fr.srcdoc = html;
  }

  // ---------------- liste des cas remplis ----------------
  // Fiches saisies sans connexion : gardées sur l'appareil, envoyées automatiquement au retour du réseau.
  async function chargerEnAttente() {
    try {
      const file = await window.HorsLigne.enAttente();
      enAttente = file.filter(i => i.action === 'saveFicheNotif' && i.payload && i.payload.donnees).map(i => {
        const d = i.payload.donnees, age = [d.ageAns ? d.ageAns + ' an(s)' : '', d.ageMois ? d.ageMois + ' mois' : '', d.ageJours ? d.ageJours + ' j' : ''].filter(Boolean).join(' ');
        const dt = new Date(i.creeLe), p2 = n => String(n).padStart(2, '0');
        return { ID: 'att:' + i.id, _attente: true, _refus: i.statut === 'erreur' ? i.erreur : '', _modif: !!i.payload.id, _itemId: i.id, Donnees: JSON.stringify(d),
          Maladie: d.maladie === 'Autre' ? (d.maladieAutre || 'Autre') : (d.maladie || ''), NomPatient: d.nomPatient || '', Sexe: d.sexe || '', Age: age, Village: d.village || '', ArrondissementNom: d.arrondissement || '',
          SemaineEpi: d.semaine || '', Annee: d.annee || '', Evolution: d.evolution || '', Classification: d.classification || '',
          DateSaisie: dt.getFullYear() + '-' + p2(dt.getMonth() + 1) + '-' + p2(dt.getDate()) + ' ' + p2(dt.getHours()) + ':' + p2(dt.getMinutes()) + ':00' };
      });
    } catch (e) { enAttente = []; }
  }
  const toutes = () => enAttente.concat(fiches);

  const estMienne = f => !f.CreeParId || f.CreeParId === ctx.user.ID;
  // Le RCSE peut modifier / supprimer TOUTES les fiches de sa liste (les siennes et celles de ses ASCQ) ; le serveur revérifie.
  const peutGerer = f => estMienne(f) || ctx.user.Role === 'RCSE';
  const lieuCell = f => E(f.ArrondissementNom || '—') + (f.Village ? '<div class="petit">' + E(f.Village) + '</div>' : '');
  const parQui = f => estMienne(f) ? '' : '<div class="petit">👤 ' + E(f.CreeParNom || '') + ' · ' + E(f.CreeParRole || '') + '</div>';

  function dessinerListe() {
    const z = document.getElementById('fnListe');
    const total = toutes();
    document.getElementById('fnCompteur').textContent = total.length ? '(' + total.length + ')' : '';
    if (!total.length) { z.innerHTML = '<div class="empty-state">Aucune fiche remplie pour le moment.</div>'; return; }
    let h = `<div class="no-print" style="margin-bottom:10px"><button type="button" class="btn-secondary" id="fnImprTout" style="font-size:.8rem;padding:6px 12px">🖨️ Imprimer toutes les fiches (${total.length})</button>
      <button type="button" id="fnPdfTout" style="font-size:.8rem;padding:6px 12px;margin-left:6px">📄 PDF de toutes les fiches (${total.length})</button></div>
      <div style="overflow-x:auto"><table><thead><tr><th>Date</th><th>Maladie</th><th>Patient</th><th>Sexe / Âge</th><th>Lieu</th><th>Sem.</th><th>Évolution</th><th>Classification</th><th></th></tr></thead><tbody>`;
    total.forEach(f => {
      if (f._attente) {
        h += `<tr style="background:var(--tint-2)"><td>${E(fmtDate(f.DateSaisie))}<div class="petit">${f._refus ? '⚠ refusée : ' + E(f._refus) : '⏳ en attente d\'envoi' + (f._modif ? ' (modification)' : '')}</div></td><td><strong>${E(f.Maladie)}</strong></td><td>${E(f.NomPatient)}</td><td>${E(f.Sexe)}${f.Age ? ' · ' + E(f.Age) : ''}</td>
        <td>${lieuCell(f)}</td><td>${E(f.SemaineEpi)}/${E(f.Annee)}</td><td>${E(f.Evolution)}</td><td>${E(f.Classification)}</td>
        <td style="white-space:nowrap"><button type="button" class="btn-secondary" data-fn="voir" data-id="${E(f.ID)}" style="font-size:.78rem;padding:5px 9px">👁️ Voir</button>
          <button type="button" class="btn-secondary" data-fn="imprimer" data-id="${E(f.ID)}" style="font-size:.78rem;padding:5px 9px">🖨️ Imprimer</button>
          <button type="button" data-fn="pdf" data-id="${E(f.ID)}" style="font-size:.78rem;padding:5px 9px">📄 PDF</button>
          <button type="button" class="btn-danger" data-fn="retirer" data-id="${E(f.ID)}" style="font-size:.78rem;padding:5px 9px" title="Retirer de la file d'envoi">✖</button></td></tr>`;
        return;
      }
      const btnVoir = `<button type="button" class="btn-secondary" data-fn="voir" data-id="${E(f.ID)}" style="font-size:.78rem;padding:5px 9px">👁️ Voir</button>
          <button type="button" class="btn-secondary" data-fn="imprimer" data-id="${E(f.ID)}" style="font-size:.78rem;padding:5px 9px">🖨️ Imprimer</button>
          <button type="button" data-fn="pdf" data-id="${E(f.ID)}" style="font-size:.78rem;padding:5px 9px">📄 PDF</button>`;
      const btnGerer = peutGerer(f) ? `
          <button type="button" class="btn-secondary" data-fn="modifier" data-id="${E(f.ID)}" style="font-size:.78rem;padding:5px 9px">✏️</button>
          <button type="button" class="btn-danger" data-fn="supprimer" data-id="${E(f.ID)}" style="font-size:.78rem;padding:5px 9px">🗑️</button>` : '';
      h += `<tr><td>${E(fmtDate(f.DateSaisie))}${parQui(f)}</td><td><strong>${E(f.Maladie)}</strong></td><td>${E(f.NomPatient)}</td><td>${E(f.Sexe)}${f.Age ? ' · ' + E(f.Age) : ''}</td>
        <td>${lieuCell(f)}</td><td>${E(f.SemaineEpi)}/${E(f.Annee)}</td><td>${E(f.Evolution)}</td><td>${E(f.Classification)}</td>
        <td style="white-space:nowrap">${btnVoir}${btnGerer}</td></tr>`;
    });
    z.innerHTML = h + '</tbody></table></div>';
    document.getElementById('fnImprTout').onclick = () => imprimerPages(toutes());
    document.getElementById('fnPdfTout').onclick = () => apercuPdf(toutes());
    z.querySelectorAll('[data-fn]').forEach(b => b.addEventListener('click', () => actionLigne(b.dataset.fn, b.dataset.id)));
  }

  async function actionLigne(action, id) {
    const f = toutes().find(x => x.ID === id); if (!f) return;
    if (action === 'retirer') {
      if (!confirm('Retirer cette fiche de la file d\'envoi ? Elle ne sera PAS transmise au serveur.')) return;
      await window.HorsLigne._Stock.fileSupprimer(f._itemId); window.HorsLigne.majBandeau(); await charger(); return;
    }
    if (action === 'pdf') apercuPdf([f]);
    else if (action === 'imprimer') imprimerPages([f]);
    else if (action === 'modifier') { if (!peutGerer(f)) { toast('Cette fiche a été saisie par un autre compte : modification impossible.', true); return; } modifierFiche(id); }
    else if (action === 'voir') apercuPdf([f]);
    else if (action === 'supprimer') {
      if (!peutGerer(f)) { toast('Cette fiche a été saisie par un autre compte : suppression impossible.', true); return; }
      if (!confirm('Supprimer définitivement la fiche de « ' + (f.NomPatient || '') + ' » ?')) return;
      try { await Api.call('deleteFicheNotif', { id }); toast('Fiche supprimée.'); if (editId === id) nouvelleFiche(); await charger(); }
      catch (e) { toast(e.message, true); }
    }
  }

  function apercu(f) {
    const ov = document.createElement('div');
    ov.className = 'modal-overlay';
    ov.innerHTML = `<div class="modal-box" style="width:860px;max-height:90vh;overflow:auto;background:#fff;color:#000">
      <style>${CSS_IMPR.replace(/@page[^}]*}/, '').replace(/body\s*{[^}]*}/, '').replace(/\.fiche\s*{[^}]*}/, '.fiche{padding:0}')}</style>
      ${ficheImprimable(f)}
      <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:12px">
        <button type="button" id="fnApImpr">🖨️ Imprimer</button><button type="button" id="fnApPdf">📄 PDF</button><button type="button" class="btn-secondary" id="fnApFerm">Fermer</button></div></div>`;
    document.body.appendChild(ov);
    ov.querySelector('#fnApFerm').onclick = () => ov.remove();
    ov.querySelector('#fnApImpr').onclick = () => imprimer([f]);
    ov.querySelector('#fnApPdf').onclick = () => telechargerPdf([f]);
    ov.addEventListener('click', e => { if (e.target === ov) ov.remove(); });
  }

  async function charger() {
    await chargerEnAttente();
    try { const r = await Api.call('listFichesNotif', {}); fiches = r.fiches || []; signatures = r.signatures || {}; }
    catch (e) { fiches = []; if (!enAttente.length) { document.getElementById('fnListe').innerHTML = '<div class="empty-state">' + E(e.horsLigne ? 'Hors connexion : la liste des fiches déjà envoyées sera disponible après une ouverture avec connexion. Vous pouvez néanmoins saisir de nouvelles fiches.' : 'Erreur de chargement : ' + e.message) + '</div>'; return; } }
    dessinerListe();
    dessinerSynthese();
  }

  // ---------------- synthèse par arrondissement (RCSE) ----------------
  // Agrège toutes les fiches visibles du RCSE (les siennes + celles de ses ASCQ), arrondissement par arrondissement.
  const estRcse = () => ctx && ctx.user && ctx.user.Role === 'RCSE';

  function dessinerSynthese() {
    const z = document.getElementById('fnSynthese'); if (!z) return;
    const annees = Array.from(new Set(fiches.map(f => String(f.Annee || '')).filter(Boolean))).sort().reverse();
    const courante = String(new Date().getFullYear());
    if (anneeSynthese === '' && annees.length) anneeSynthese = annees.indexOf(courante) !== -1 ? courante : annees[0];
    const lignes = fiches.filter(f => !anneeSynthese || anneeSynthese === '*' || String(f.Annee || '') === anneeSynthese);
    const grp = {};
    lignes.forEach(f => {
      const nom = f.ArrondissementNom || 'Non précisé', cle = (f.ArrondissementId || '') + '|' + nom;
      const g = grp[cle] || (grp[cle] = { nom, commune: f.CommuneNom || '', total: 0, deces: 0, confirmes: 0, suspects: 0, ascq: 0, rcse: 0, maladies: {}, dernier: '' });
      g.total++;
      if (f.Evolution === 'Décédé') g.deces++;
      if (/^Confirm/.test(f.Classification || '')) g.confirmes++;
      else if (f.Classification === 'Suspect' || f.Classification === 'Probable') g.suspects++;
      if (f.CreeParRole === 'ASCQ') g.ascq++; else g.rcse++;
      g.maladies[f.Maladie || 'Non précisée'] = (g.maladies[f.Maladie || 'Non précisée'] || 0) + 1;
      if (String(f.DateSaisie || '') > g.dernier) g.dernier = String(f.DateSaisie || '');
    });
    const liste = Object.keys(grp).map(k => grp[k]).sort((a, b) => b.total - a.total || a.nom.localeCompare(b.nom));
    const T = liste.reduce((t, g) => ({ total: t.total + g.total, deces: t.deces + g.deces, confirmes: t.confirmes + g.confirmes, suspects: t.suspects + g.suspects, ascq: t.ascq + g.ascq, rcse: t.rcse + g.rcse }), { total: 0, deces: 0, confirmes: 0, suspects: 0, ascq: 0, rcse: 0 });
    const sel = `<label class="petit" style="display:inline-flex;gap:6px;align-items:center">Année <select id="fnSynAnnee" style="width:auto">
      <option value="*"${anneeSynthese === '*' ? ' selected' : ''}>Toutes</option>${annees.map(a => `<option value="${E(a)}"${a === anneeSynthese ? ' selected' : ''}>${E(a)}</option>`).join('')}</select></label>`;
    let h = `<div style="margin-bottom:10px">${sel}</div>`;
    if (!liste.length) { z.innerHTML = h + '<div class="empty-state">Aucune fiche pour cette période.</div>'; brancherSynthese(); return; }
    h += `<div class="grid grid-4" style="margin-bottom:12px">
        <div class="stat-card"><div class="n">${T.total}</div><div class="l">Cas notifiés</div></div>
        <div class="stat-card"><div class="n">${T.deces}</div><div class="l">Décédés</div></div>
        <div class="stat-card"><div class="n">${T.confirmes}</div><div class="l">Cas confirmés</div></div>
        <div class="stat-card"><div class="n">${liste.length}</div><div class="l">Arrondissements touchés</div></div></div>
      <div style="overflow-x:auto"><table><thead><tr><th>Arrondissement</th><th>Cas</th><th>Décès</th><th>Confirmés</th><th>Suspects / probables</th><th>Maladies notifiées</th><th>Source (RCSE / ASCQ)</th><th>Dernière saisie</th></tr></thead><tbody>`;
    liste.forEach(g => {
      const mal = Object.keys(g.maladies).sort((a, b) => g.maladies[b] - g.maladies[a]).map(m => E(m) + ' (' + g.maladies[m] + ')').join(', ');
      h += `<tr><td><strong>${E(g.nom)}</strong>${g.commune ? '<div class="petit">' + E(g.commune) + '</div>' : ''}</td><td><strong>${g.total}</strong></td><td>${g.deces}</td><td>${g.confirmes}</td><td>${g.suspects}</td><td>${mal}</td><td>${g.rcse} / ${g.ascq}</td><td>${E(g.dernier ? fmtDate(g.dernier) : '')}</td></tr>`;
    });
    h += `<tr style="font-weight:700;background:var(--tint-2)"><td>Total zone sanitaire</td><td>${T.total}</td><td>${T.deces}</td><td>${T.confirmes}</td><td>${T.suspects}</td><td></td><td>${T.rcse} / ${T.ascq}</td><td></td></tr></tbody></table></div>`;
    z.innerHTML = h; brancherSynthese();
  }
  function brancherSynthese() {
    const s = document.getElementById('fnSynAnnee');
    if (s) s.onchange = () => { anneeSynthese = s.value; dessinerSynthese(); };
  }

  // Arrondissements / villages du périmètre : ASCQ = ses arrondissements ; RCSE = ceux des communes de sa zone sanitaire.
  async function chargerPerimetre() {
    try {
      const [{ perimetres }, { geo }] = await Promise.all([Api.call('listPerimetres', {}), Api.call('listGeo', {})]);
      let ids;
      if (ctx.user.Role === 'ASCQ') ids = new Set(perimetres.filter(p => p.TypeCible === 'Arrondissement').map(p => p.CibleId));
      else {
        const coms = new Set(perimetres.filter(p => p.TypeCible === 'Commune').map(p => p.CibleId));
        ids = new Set(geo.arrondissements.filter(a => coms.has(a.CommuneId)).map(a => a.ID));
      }
      const depDe = {}; (geo.communes || []).forEach(c => { depDe[c.ID] = c.DepartementNom || ''; });
      mesArrs = geo.arrondissements.filter(a => ids.has(a.ID)).map(a => Object.assign({}, a, { DepartementNom: depDe[a.CommuneId] || '' }))
        .sort((a, b) => String(a.Nom).localeCompare(String(b.Nom)));
      mesVillages = geo.villages.filter(v => ids.has(v.ArrondissementId));
    } catch (e) { mesArrs = []; mesVillages = []; }
  }

  // ---------------- contrôle des rubriques obligatoires ----------------
  function marquerObligatoires() {
    const form = document.getElementById('fnForm'); if (!form) return;
    FicheSchemas.champs(FicheSchemas.get('maladie')).forEach(c => {
      if (c.opt || c.unDe || (c.siTous && c.siTous.length) || c.t === 'multi') return;
      const el = form.elements[c.k]; const e0 = el && el.length !== undefined && !el.tagName ? el[0] : el; if (!e0) return;
      const lab = e0.closest('.field') && e0.closest('.field').querySelector('label'); if (lab && lab.textContent.indexOf('*') === -1) lab.insertAdjacentHTML('beforeend', ' <span class="fn-req">*</span>');
    });
  }
  function marquerManquants(type, manq) {
    if (type !== 'maladie') { if (formS) formS.marquer(manq); return; }
    const form = document.getElementById('fnForm'); form.querySelectorAll('.fn-err').forEach(z => z.classList.remove('fn-err'));
    let premier = null;
    manq.forEach(m => {
      const ks = m.k === 'signes' ? ['sg0'] : (m.ks || [m.k]);
      ks.forEach(k => { const el = form.elements[k]; const e0 = el && el.length !== undefined && !el.tagName ? el[0] : el; if (!e0) return;
        const z = e0.closest('.field') || e0.closest('.fn-bloc'); if (z) { z.classList.add('fn-err'); if (!premier) premier = z; } });
    });
    if (premier) premier.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  // Enregistre une fiche (tous types). En mode « validation », la fiche est envoyée AVEC la validation de l'alerte / du décès.
  async function enregistrer(type, d) {
    d.typeFiche = type;
    if (type === 'maladie') {
      const arr = mesArrs.find(a => a.ID === d.arrondissementId);
      if (arr) { d.arrondissement = arr.Nom; d.comResidence = arr.CommuneNom || d.comResidence || ''; d.depResidence = arr.DepartementNom || d.depResidence || ''; }
      FicheSchemas.champs(FicheSchemas.get('maladie')).forEach(c => { if (c.siTous && c.siTous.length && !FicheSchemas.cond(c.siTous, d)) delete d[c.k]; });
    }
    const manq = FicheSchemas.manquantsDetail(type, d);
    if (manq.length) {
      marquerManquants(type, manq);
      const noms = manq.map(m => m.l).filter((x, i, t) => t.indexOf(x) === i);
      toast('Rubriques obligatoires à compléter (' + noms.length + ') : ' + noms.slice(0, 4).join(', ') + (noms.length > 4 ? '…' : '') + '. Écrivez NA si sans objet.', true);
      return;
    }
    const btn = type === 'maladie' ? document.getElementById('fnSave') : null; if (btn) btn.disabled = true; if (formS && type !== 'maladie') formS.bloquer(true);
    try {
      if (validation) {
        const v = validation;
        await v.finaliser({ type: type, donnees: d });
        validation = null; majBandeauValidation(); nouvelleFiche();
        toast(v.messageSucces || 'Alerte validée : la fiche de notification est envoyée.');
        await charger();
        if (v.apres) v.apres();
        return;
      }
      const r = await Api.call('saveFicheNotif', { id: editId || '', clientId: editId ? '' : clientId(), type: type, donnees: d });
      toast(r.queued ? 'Pas de réseau : la fiche est gardée sur cet appareil et sera envoyée automatiquement (elle apparaît dans la liste, en attente).' : (editId ? 'Fiche modifiée.' : 'Fiche enregistrée.'));
      nouvelleFiche();
      await charger();
      document.getElementById('fnListe').scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (err) { toast(err.message, true); }
    if (btn) btn.disabled = false; if (formS && type !== 'maladie') formS.bloquer(false);
  }

  // ---------------- validation d'une alerte / d'un décès : fiche obligatoire ----------------
  function majBandeauValidation() {
    const b = document.getElementById('fnValidBandeau'), sel = document.getElementById('fnType'); if (!b) return;
    if (!validation) { b.style.display = 'none'; b.innerHTML = ''; if (sel) sel.disabled = false; return; }
    b.style.display = '';
    b.innerHTML = '<strong>✅ ' + E(validation.titre || 'Validation en cours') + '</strong><p class="petit" style="margin:4px 0 8px">Remplissez la fiche officielle ci-dessous. <strong>La validation n\'est prise en compte, et rien ne remonte à la plateforme, qu\'une fois la fiche complète envoyée.</strong></p>' +
      '<button type="button" class="btn-secondary" id="fnValidAnnuler" style="font-size:.8rem;padding:6px 12px">Annuler la validation</button>';
    if (sel) sel.disabled = true;
    document.getElementById('fnValidAnnuler').onclick = () => {
      if (!confirm('Annuler la validation ? Rien ne sera envoyé.')) return;
      const v = validation; validation = null; majBandeauValidation(); nouvelleFiche(); if (v.annuler) v.annuler();
    };
  }
  function appliquerValidation() {
    majBandeauValidation(); editId = null;
    afficherType(validation.type, typeof validation.prefill === 'function' ? validation.prefill() : (validation.prefill || {}));
    document.getElementById('fnTypeBar').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  const isoDate = v => { const m = /^(\d{4}-\d{2}-\d{2})/.exec(String(v || '')); return m ? m[1] : ''; };
  const norm = t => String(t || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
  const sansVides = o => { Object.keys(o).forEach(k => { if (o[k] === '' || o[k] === undefined || o[k] === null) delete o[k]; }); return o; };
  const arrDuCas = l => mesArrs.some(a => a.ID === l.ArrondissementId) ? l.ArrondissementId : '';

  // Pré-remplissage de la fiche générique à partir de l'alerte notifiée par le relais communautaire.
  function prefillAlerte(l) {
    l = l || {};
    const brut = String(l.AutrePreciser || l.TypeAlerte || '').replace(/^\d+\.\s*/, '').trim(), nb = norm(brut);
    const mal = nb ? MALADIES.find(m => norm(m) === nb || (nb.length > 3 && (nb.indexOf(norm(m)) !== -1 || norm(m).indexOf(nb) !== -1))) : '';
    const sb = String(l.Signes || '').split('|').map(x => x.trim()).filter(Boolean);
    return sansVides({ nomPatient: l.Nom, telephone: l.Telephone, adresse: l.Adresse, village: l.VillageNom, dateNaissance: isoDate(l.DateNaissance), dateDebut: isoDate(l.DateDebutMaladie),
      signes: SIGNES.filter(x => sb.some(b => norm(b) === norm(x))), signesAutres: sb.filter(b => !SIGNES.some(x => norm(x) === norm(b))).join(', '),
      maladie: mal || (brut ? 'Autre' : ''), maladieAutre: mal ? '' : brut, sexe: (l.Sexe === 'F' || l.Sexe === 'M') ? l.Sexe : '', arrondissementId: arrDuCas(l),
      gpsLon: l.GPSLon, gpsLat: l.GPSLat });
  }
  // Pré-remplissage de la fiche décès (type selon le décès notifié par le RC : maternel, néonatal, autre).
  function prefillDeces(l) {
    l = l || {};
    const type = FicheSchemas.typeDeDeces(l.TypeDeces), sexe = (l.Sexe === 'M' || l.Sexe === 'F') ? l.Sexe : '';
    const LIEU_RC = { 1: '6', 2: '6', 3: '8', 4: '7', 5: '8', 6: '8' };   // lieux du relais → codes de la fiche officielle
    const o = { village: l.VillageNom, adresseParent: l.Adresse, dateNaissance: isoDate(l.DateNaissance), dateDeces: isoDate(l.DateDeces), lieuDeces: LIEU_RC[l.LieuDeces] || '', arrondissementId: arrDuCas(l) };
    if (type === 'deces_neonatal') Object.assign(o, { nomEnfant: l.Nom, nomMere: l.NomParent, tel: l.TelephoneParent, ageJours: l.AgeJours, sexeEnfant: sexe === 'M' ? '1' : sexe === 'F' ? '2' : '' });
    else if (type === 'deces_maternel') Object.assign(o, { nomDefunte: l.Nom, tel: l.TelephoneParent, ageAns: l.AgeAnnees });
    else Object.assign(o, { nomDefunt: l.Nom, nomProche: l.NomParent, telProche: l.TelephoneParent, sexe: sexe, ageAns: l.AgeAnnees, causePrincipale: l.CauseProbable });
    return { type: type, valeurs: sansVides(o) };
  }
  window.FicheNotif = {
    // opts : { type, titre, prefill (objet ou fonction), finaliser(fiche) → Promise, apres(), annuler(), messageSucces }
    demarrerValidation: function (opts) { validation = opts; const lien = document.querySelector('[data-tab="fichenotif"]'); if (lien) lien.click(); },
    prefillAlerte: prefillAlerte, prefillDeces: prefillDeces, enCours: () => !!validation
  };

  // ---------------- point d'entrée ----------------
  window.initFicheNotification = async function (opts) {
    ctx = opts; anneeSynthese = '';
    const el = document.getElementById(opts.containerId);
    el.innerHTML = '<div class="empty-state">Chargement…</div>';
    await chargerPerimetre();
    if (!document.getElementById('fnStyle')) {
      const st = document.createElement('style'); st.id = 'fnStyle';
      st.textContent = `.fn-bloc{border:1px solid var(--line);border-radius:10px;padding:14px;margin-bottom:14px}
        .fn-bloc h3{margin:0 0 10px;font-size:.92rem;color:var(--teal-900)}
        .fn-grille{display:grid;grid-template-columns:repeat(auto-fill,minmax(190px,1fr));gap:6px 12px}
        .fn-ligne{display:flex;flex-wrap:wrap;gap:6px 18px}.fn-col{display:flex;flex-direction:column;gap:4px}
        .fn-opt{display:flex;align-items:center;gap:6px;font-weight:400;font-size:.85rem;margin:0;cursor:pointer}
        .fn-opt input{width:auto;margin:0}.fn-age{display:flex;gap:6px}.fn-age input{width:90px}
        .fn-actions{display:flex;gap:10px;align-items:center;flex-wrap:wrap}
        .fn-req{color:#c0392b;font-weight:700}.fn-err{outline:2px solid #c0392b;outline-offset:2px;border-radius:6px;background:#FDF3F2}
        .fn-enfant{border:1px dashed var(--line);border-radius:8px;margin:8px 0;padding:8px}.fn-enfant legend{font-size:.82rem;font-weight:700;padding:0 6px}
        .grid-3{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:12px}`;
      document.head.appendChild(st);
    }
    const rcse = estRcse();
    el.innerHTML = `<p class="petit" style="margin:0 0 12px">Remplissez la fiche officielle de notification (cases à cocher et champs). Chaque fiche enregistrée apparaît dans la liste en bas de page, d'où vous pouvez l'imprimer sur la fiche officielle, la modifier ou la supprimer.${rcse
        ? ' <strong>Les fiches notifiées par vos ASCQ s\'ajoutent automatiquement à cette liste</strong> (consultation et impression uniquement) et sont comptées dans la synthèse par arrondissement.'
        : ' Vos fiches remontent automatiquement chez votre RCSE.'}</p>
      ${barreType()}
      ${formulaireHtml()}
      <div id="fnFormS" style="display:none"></div>
      <div class="card" style="margin:22px 0 0"><h2>📋 Cas remplis <span id="fnCompteur" class="petit"></span></h2><div id="fnListe">Chargement…</div></div>
      ${rcse ? '<div class="card" style="margin:22px 0 0"><h2>📍 Synthèse de la situation par arrondissement</h2><p class="petit" style="margin:0 0 8px">Tous les cas notifiés dans votre zone sanitaire (vos fiches et celles de vos ASCQ), regroupés par arrondissement de résidence du cas.</p><div id="fnSynthese">Chargement…</div></div>' : ''}`;
    document.getElementById('fnArr').addEventListener('change', () => majGeoFormulaire(true));
    // Semaine épidémiologique en cours (calendrier importé par le National), pour pré-remplir année et semaine.
    try {
      const cal = await Api.call('listCalendrier', {});
      const auj = new Date();
      semaineCourante = (cal.calendrier || []).find(r => debutJournee_(r.DateDebut) <= auj && auj <= finJournee_(r.DateFin)) || null;
    } catch (e) { semaineCourante = null; }
    nouvelleFiche();
    document.getElementById('fnReset').onclick = () => { if (confirm('Vider le formulaire ?')) nouvelleFiche(); };
    document.getElementById('fnGps').onclick = () => {
      if (!navigator.geolocation) { toast('La géolocalisation n\'est pas disponible sur cet appareil.', true); return; }
      navigator.geolocation.getCurrentPosition(p => {
        const f = document.getElementById('fnForm');
        f.gpsLon.value = p.coords.longitude.toFixed(6); f.gpsLat.value = p.coords.latitude.toFixed(6);
      }, () => toast('Position introuvable : autorisez la localisation ou saisissez les coordonnées.', true), { enableHighAccuracy: true, timeout: 10000 });
    };
    document.getElementById('fnForm').addEventListener('submit', (e) => { e.preventDefault(); enregistrer('maladie', lireFormulaire()); });
    document.getElementById('fnForm').addEventListener('change', e => { const z = e.target.closest('.fn-err'); if (z) z.classList.remove('fn-err'); });
    document.getElementById('fnType').onchange = e => { editId = null; typeCourant = e.target.value; afficherType(typeCourant, null); document.getElementById('fnEditInfo').textContent = ''; };
    marquerObligatoires();
    if (validation) appliquerValidation();
    charger();
    if (!window.__fnEcoute) { window.__fnEcoute = true; ['sivec:sync', 'sivec:file'].forEach(ev => window.addEventListener(ev, () => { if (document.getElementById('fnListe')) charger(); })); }
  };
})();
