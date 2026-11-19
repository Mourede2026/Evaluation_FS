/**
 * Export PDF de la fiche officielle « 1_BJ_FORMULAIRE GENERIQUE DE NOTIFICATION DES MALADIES SOUS SURVEILLANCE ».
 * Une fiche = UNE page A4, avec le canevas imprimé en noir et les informations saisies en BLEU, en écriture
 * « à la main » (Helvetica italique légèrement irrégulière, cases cochées d'une croix tracée au stylo).
 * La partie « Pour le Laboratoire » reste vierge ; « Fiche saisie », « Numéro EPID » et « Signature » aussi
 * (réservés au RCSE / signés à la main).
 * Fonctionne hors connexion (dépend uniquement de pdf-mini.js).
 *
 *   FicheNotifPdf.construire([donnees, …], { titre })  -> PdfMini (une page par fiche)
 *   FicheNotifPdf.telecharger([donnees, …], 'nom.pdf')
 * `donnees` = objet de la fiche (même structure que le champ Donnees enregistré par fiche-notification.js).
 */
(function (global) {
  'use strict';
  var BLEU = '#1B3FBF', NOIR = '#000000', GRIS = '#E3E3E3', TRAIT = '#444444';
  var MALADIES = ['Rougeole', 'Fièvre Jaune', 'Choléra', 'Shigellose', 'Méningite', 'Intoxication', 'Hépatites', 'F Typhoïde', 'Syphilis End.',
    'Noma', 'Dracunculose', 'Lèpre', 'Peste', 'Ulcère Buruli', 'Pian', 'Zika', 'Anthrax', 'Grippe HP'];
  var SIGNES = ['Fièvre', 'Eruption cutanée', 'Diarrhée aqueuse', 'Vomissement', 'Selles sanguinolente',
    'Céphalée', 'Hémorragie', 'Raideur nuque', 'Altération conscience', 'Bombement fontanelle',
    'Photophobie', 'Hydrophobie', 'Convulsions', 'Ictère', 'Fatigue intense',
    'Nausée', 'Maux de gorge', 'Toux', 'Douleurs abdominales', 'Anorexie',
    'Gonflement des ganglions', 'Crachats teintés de sang', 'Lésions cutanées', 'Difficultés respiratoires'];
  var CLASSIF = ['Suspect', 'Probable', 'Confirmé par le laboratoire', 'Confirmé par lien épidémiologique', 'Confirmé cliniquement'];
  var LEG_PROF = ['Salarié=1', 'Cultivateur=2', 'Eleveur/Chasseur=3', 'Commerçant=4', 'Artisan=5', 'Elève/Etudiant=6', 'Professionnel de santé=7', 'Ménagère=8', 'Aucun=9', 'NA=10', 'Autre=11 :'];
  var LEG_MATRI = ['Marié=1', 'Célibataire=2', 'Veuf=3', 'Divorcé=4', 'NA=5'];
  var LEG_NIVEAU = ['Non scolarisé=1', 'Alphabétisé=2', 'Primaire=3', 'Secondaire=4', 'Université=5', 'NA=6'];
  var LEG_NAT = ['Béninoise=1', 'Autre nationalité=2'];

  function largeur(s, t, gras) { return global.PdfMini.largeurTexte(s, t, !!gras); }
  function hash(s) { var h = 2166136261; for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
  function prng(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; var t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
  function envelopper(items, max, t) {
    var lignes = [], cur = '';
    items.forEach(function (it) { var tent = cur ? cur + ' ; ' + it : it; if (cur && largeur(tent, t) > max) { lignes.push(cur); cur = it; } else cur = tent; });
    if (cur) lignes.push(cur); return lignes;
  }
  function eclaterDate(v) { var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(v || '')); return m ? [m[3], m[2], m[1]] : [String(v || ''), '', '']; }
  function eclaterHeure(v) { var m = /^(\d{1,2}):(\d{2})/.exec(String(v || '')); return m ? [m[1], m[2]] : [String(v || ''), '']; }
  var texte = function (v) { return v === undefined || v === null ? '' : String(v); };

  function dessinerFiche(doc, d) {
    d = d || {};
    var p = doc.page(), M = 24, W = p.l - 2 * M, R = M + W, T = 7.2, ROW = 15.6;
    var rnd = prng(hash(JSON.stringify(d, function (k, v) { return (k === '__sigImg' || k === '__signature') ? undefined : v; })));
    var x = M, y = 0;

    // --- étiquettes imprimées (noir) ---
    function lab(s, o) { o = o || {}; var w = p.texte(x, y, s, { taille: o.taille || T, gras: o.gras, couleur: NOIR }); x += w + (o.apres === undefined ? 2.5 : o.apres); }
    // --- écriture manuscrite (bleu) ---
    function main(x0, y0, s, max, taille, centre) {
      s = texte(s); if (!s) return;
      var t = taille || 9; while (t > 5.4 && largeur(s, t) > max) t -= 0.3;
      while (s.length > 1 && largeur(s, t) > max) s = s.slice(0, -2) + '\u2026';
      var w = largeur(s, t), xx = centre ? x0 + (max - w) / 2 : x0;
      p.texte(xx, y0 + (rnd() - 0.5) * 0.9, s, { taille: t, oblique: true, couleur: BLEU, angle: (rnd() - 0.5) * 1.8 });
    }
    function fld(w, val, o) {
      o = o || {};
      p.ligne(x, y + 1.7, x + w, y + 1.7, { couleur: TRAIT, epaisseur: 0.4 });
      main(x + 1.5, y - 0.3, val, w - 3, o.taille);
      x += w + (o.apres === undefined ? 6 : o.apres);
    }
    // Notificateur = le compte qui notifie (enregistré dans l'application) ; à défaut, l'auteur de la fiche.
    var notif = { nom: texte(d.notifNom || d.__creePar), qualif: texte(d.notifQualif), tel: texte(d.notifTel) };
    // Signature : l'IMAGE de la signature enregistrée dans « Mon compte » du notificateur (placée au-dessus du trait).
    // Sans signature enregistrée, l'emplacement reste vide pour une signature à la main.
    function signer(x0, w) {
      var im = d.__sigImg; if (!im || !im.rgb) return;
      var hMax = 25, wMax = Math.max(20, w - 6), k = Math.min(hMax / im.h, wMax / im.l), lw = im.l * k, lh = im.h * k;
      p.image(im, x0 + 3, y + 1.2 - lh, lw, lh);
    }
    function croix(bx, by, s) {
      var j = function () { return (rnd() - 0.5) * 0.9; };
      p.ligne(bx - 0.9 + j(), by - 0.6 + j(), bx + s + 1 + j(), by + s + 0.9 + j(), { couleur: BLEU, epaisseur: 1.05, arrondi: true });
      p.ligne(bx + s + 0.7 + j(), by - 0.8 + j(), bx - 0.7 + j(), by + s + 0.7 + j(), { couleur: BLEU, epaisseur: 0.95, arrondi: true });
    }
    function cb(ok, libelle, o) {
      o = o || {}; var s = 6.4, by = y - s + 0.6;
      p.rect(x, by, s, s, { trait: NOIR, epaisseur: 0.5 });
      if (ok) croix(x, by, s);
      x += s + 2.4;
      if (libelle) x += p.texte(x, y, libelle, { taille: o.taille || T, couleur: NOIR });
      x += o.apres === undefined ? 8 : o.apres;
    }
    // /____/____/______/ avec valeurs manuscrites centrées dans chaque case
    function slots(vals, widths, o) {
      o = o || {};
      lab('/', { apres: 1 });
      widths.forEach(function (w, i) {
        p.ligne(x, y + 1.7, x + w, y + 1.7, { couleur: TRAIT, epaisseur: 0.4 });
        main(x, y - 0.3, vals[i], w, 9, true);
        x += w; lab('/', { apres: i === widths.length - 1 ? (o.apres === undefined ? 6 : o.apres) : 1 });
      });
    }
    var dateC = function (etiq, iso, o) { lab(etiq); slots(eclaterDate(iso), [14, 14, 28], o); };
    var heureC = function (etiq, h, o) { lab(etiq); slots(eclaterHeure(h), [14, 14], o); };
    function verifier() { if (global.__FN_DEBUG && x > R + 1) console.warn('Débordement : y=' + y.toFixed(1) + ' x=' + x.toFixed(1)); }
    function suite(h) { verifier(); x = M; y += h === undefined ? ROW : h; }
    function bandeau(titre) { p.rect(M, y - 8, W, 11, { fond: GRIS }); p.texte(M + 3, y, titre, { taille: 7.6, gras: true, couleur: NOIR }); x = M; y += ROW; }

    // ===== En-tête =====
    y = 32;
    p.texte(M, y, 'Ministère de la Santé', { taille: 8, gras: true });
    p.texte(R, y, 'République du Bénin', { taille: 8, gras: true, align: 'right' });
    y += 16;
    p.texte(p.l / 2, y, '1_BJ_FORMULAIRE GENERIQUE DE NOTIFICATION DES MALADIES SOUS SURVEILLANCE', { taille: 9.6, gras: true, align: 'center' });
    y += 8;
    p.ligne(M, y, R, y, { epaisseur: 1 });
    y += 14;

    // ===== Formation sanitaire =====
    lab('Département :'); fld(100, d.departement); lab('Zone Sanitaire :'); fld(135, d.zoneSanitaire); lab('Commune :'); fld(R - x, d.commune, { apres: 0 }); suite();
    lab('Formation Sanitaire :'); fld(250, d.formationSanitaire); lab('Fiche saisie :'); cb(false, 'Oui'); cb(false, 'Non'); suite(ROW + 1);

    // ===== Maladie =====
    var cw = W / 9;
    for (var r = 0; r < 2; r++) {
      for (var c = 0; c < 9; c++) { x = M + c * cw; var nom = MALADIES[r * 9 + c]; cb(d.maladie === nom, nom, { taille: 6.7, apres: 0 }); }
      x = M; y += ROW - 2;
    }
    cb(d.maladie === 'Autre', 'Autre à préciser :', { apres: 3 }); fld(300, d.maladie === 'Autre' ? d.maladieAutre : ''); suite(ROW + 1);

    // ===== Notification =====
    lab('Année de notification'); slots([texte(d.annee)], [34]);
    lab('Semaine épidémiologique :'); slots([texte(d.semaine)], [20], { apres: 12 });
    lab('Statut épidémiologique :'); cb(d.statutEpi === 'En routine', 'En routine'); cb(d.statutEpi === 'En épidémie', 'En épidémie', { apres: 0 }); suite();
    lab('Numéro EPID (Réservé au RCSE) : BEN'); var xe = x;
    slots([], [26, 26, 20, 20], { apres: 14 });
    var xe2 = x; lab('Reçu le :'); slots([], [14, 14, 28], { apres: 0 });
    p.texte(xe + 4, y + 7, 'Pays', { taille: 4.8, couleur: '#555' }); p.texte(xe + 34, y + 7, 'Départ  Com', { taille: 4.8, couleur: '#555' });
    p.texte(xe + 87, y + 7, 'Année', { taille: 4.8, couleur: '#555' }); p.texte(xe + 112, y + 7, 'Num du cas', { taille: 4.8, couleur: '#555' });
    suite(ROW + 3);

    // ===== Résidence et identification du cas =====
    bandeau('RESIDENCE ET IDENTIFICATION DU CAS');
    lab('Pays'); fld(60, d.pays); lab('Département :'); fld(90, d.depResidence); lab('Commune :'); fld(95, d.comResidence); lab('Arrondissement :'); fld(R - x, d.arrondissement, { apres: 0 }); suite();
    lab('Ville / Village :'); fld(100, d.village); lab('Quartier :'); fld(88, d.quartier); lab('Adresse :'); fld(94, d.adresse);
    lab('Urbaine/Rurale'); cb(d.zoneType === 'U', 'U', { apres: 5 }); cb(d.zoneType === 'R', 'R', { apres: 0 }); suite();
    lab('Nom du patient :'); fld(170, d.nomPatient); lab('Père/Mère :'); fld(120, d.parent); lab('Téléphone :'); fld(R - x, d.telephone, { apres: 0 }); suite();
    lab('Adresse des parents/tuteurs :'); fld(R - x, d.adresseParents, { apres: 0 }); suite();
    lab('Date de naissance :'); slots(eclaterDate(d.dateNaissance), [14, 14, 28], { apres: 8 });
    lab('ou Age :'); fld(22, d.ageAns, { apres: 1 }); lab('ans'); fld(22, d.ageMois, { apres: 1 }); lab('mois'); fld(22, d.ageJours, { apres: 1 }); lab('jour', { apres: 12 });
    lab('Sexe :'); cb(d.sexe === 'F', 'F', { apres: 5 }); cb(d.sexe === 'M', 'M', { apres: 0 }); suite(ROW - 1);

    // --- Profession / statut matrimonial / niveau scolaire / nationalité ---
    var colonnes = [
      { t: 'Profession', k: 'profession', leg: LEG_PROF, w: 168, autre: ['Autre=11 :', d.professionAutre] },
      { t: 'Statut matrimonial', k: 'matrimonial', leg: LEG_MATRI, w: 105 },
      { t: 'Niveau scolaire', k: 'niveau', leg: LEG_NIVEAU, w: 105 },
      { t: 'Nationalité', k: 'nationalite', leg: LEG_NAT, w: W - 168 - 105 - 105, autre: ['Préciser autre nationalité :', d.nationaliteAutre] }
    ];
    var hLeg = 0;
    colonnes.forEach(function (cl) { cl.lignes = envelopper(cl.leg.filter(function (z) { return z !== 'Autre=11 :'; }), cl.w - 6, 5.8); if (cl.k === 'profession') cl.lignes.push('Autre=11 :'); hLeg = Math.max(hLeg, cl.lignes.length); });
    var hCase = 18 + hLeg * 7 + 12, yTop = y - 8, xc = M;
    colonnes.forEach(function (cl) {
      p.rect(xc, yTop, cl.w, hCase, { trait: NOIR, epaisseur: 0.5 });
      var sx = x, sy = y; x = xc + 3; y = yTop + 11;
      lab(cl.t + ' /', { apres: 1 }); var xs = x;
      p.ligne(x, y + 1.7, x + 15, y + 1.7, { couleur: TRAIT, epaisseur: 0.4 }); main(x, y - 0.3, d[cl.k], 15, 9, true); x += 15; lab('/', { apres: 0 });
      cl.lignes.forEach(function (ln, i) { p.texte(xc + 3, yTop + 21 + i * 7, ln, { taille: 5.8, couleur: NOIR }); });
      if (cl.autre) { var ya = yTop + hCase - 4, xa = xc + 3, wa = largeur(cl.autre[0], 5.8); if (cl.k === 'profession') { /* « Autre=11 : » est déjà imprimé dans la légende */ xa = xc + 3 + largeur('Autre=11 :', 5.8) + 3; wa = 0; var lg = cl.lignes.length; ya = yTop + 21 + (lg - 1) * 7; p.ligne(xa, ya + 1.2, xc + cl.w - 4, ya + 1.2, { couleur: TRAIT, epaisseur: 0.4 }); y = ya; main(xa + 1, ya - 0.3, cl.autre[1], xc + cl.w - 4 - xa - 2, 8); }
        else { p.texte(xc + 3, ya, cl.autre[0], { taille: 5.8, couleur: NOIR }); p.ligne(xc + 3 + wa + 2, ya + 1.2, xc + cl.w - 4, ya + 1.2, { couleur: TRAIT, epaisseur: 0.4 }); y = ya; main(xc + 3 + wa + 3, ya - 0.3, cl.autre[1], xc + cl.w - 4 - (xc + 3 + wa + 3) - 2, 8); } }
      x = sx; y = sy; xc += cl.w;
    });
    y = yTop + hCase + 12; x = M;
    lab('Coordonnées GPS : Longitude :'); fld(130, d.gpsLon); lab('Latitude :'); fld(130, d.gpsLat); suite(ROW + 2);

    // ===== Histoire de la maladie =====
    bandeau('HISTOIRE DE LA MALADIE');
    dateC('Date de début des symptômes :', d.dateDebut, { apres: 10 }); dateC('Date de consultation :', d.dateConsultation, { apres: 10 }); dateC('Date Notification :', d.dateNotification, { apres: 0 }); suite(ROW + 1);
    var sw = W / 5, yS = y;
    for (var i = 0; i < 25; i++) {
      var col = i % 5, lig = Math.floor(i / 5); x = M + col * sw; y = yS + lig * 12.4;
      if (i < 24) cb((d.signes || []).indexOf(SIGNES[i]) !== -1, SIGNES[i], { taille: 6.7, apres: 0 });
      else { cb(!!d.signesAutres, 'Autres à préciser :', { taille: 6.7, apres: 2 }); fld(M + (col + 1) * sw - x - 3, d.signesAutres, { apres: 0 }); }
    }
    y = yS + 5 * 12.4 + 3; x = M;
    p.ligne(M, yS - 9, R, yS - 9, { couleur: '#999', epaisseur: 0.3 });
    lab('Type de consultation :'); cb(d.consultation === 'Externe', 'Externe'); cb(d.consultation === 'Hospitalisé', 'Hospitalisé', { apres: 30 });
    lab('Evolution :'); cb(d.evolution === 'Vivant', 'Vivant'); cb(d.evolution === 'Décédé', 'Décédé'); cb(d.evolution === 'Inconnu', 'Inconnu', { apres: 0 }); suite();
    lab('Statut vaccinal :'); cb(d.vaccinal === 'Vacciné', 'Vacciné'); cb(d.vaccinal === 'Non vacciné', 'Non vacciné', { apres: 14 });
    lab('Si oui , nombre de doses'); slots([texte(d.nbDoses)], [20], { apres: 12 }); dateC('Date dernière dose :', d.dateDerniereDose, { apres: 0 }); suite();
    lab('Classification Finale :', { apres: 5 }); CLASSIF.forEach(function (cl, i) { cb(d.classification === cl, cl, { apres: i === CLASSIF.length - 1 ? 0 : 6, taille: 6.9 }); }); suite(ROW + 9);
    lab('Nom du Notificateur :'); fld(118, notif.nom); lab('Tél :'); fld(66, notif.tel); lab('Qualification :'); fld(62, notif.qualif); lab('Signature :'); var xsig = x; fld(R - x, '', { apres: 0 }); signer(xsig, R - xsig); suite(ROW + 1);

    // ===== Prélèvement =====
    var prel = d.prelevements || [];
    lab('Type de prélèvement :'); cb(prel.indexOf('Sang') !== -1, 'Sang'); cb(prel.indexOf('Selles') !== -1, 'Selles'); cb(prel.indexOf('LCR') !== -1, 'LCR', { apres: 20 });
    lab('Aspect LCR :'); fld(R - x, d.aspectLcr, { apres: 0 }); suite();
    cb(!!d.prelGorge, 'Prélèvement de gorge', { apres: 16 }); lab('Autre à préciser :'); fld(150, d.prelAutre, { apres: 12 }); dateC('Date de prélèvement :', d.datePrelevement, { apres: 0 }); suite();
    heureC('Heure de prélèvement :', d.heurePrelevement, { apres: 16 }); dateC('Date d\u2019envoi du prélèvement :', d.dateEnvoi, { apres: 16 }); heureC('Heure d\u2019envoi :', d.heureEnvoi, { apres: 0 }); suite(ROW + 3);

    // ===== Partie laboratoire (laissée vierge) =====
    var yL = y - 9;
    p.rect(M, yL, W, 12, { fond: GRIS, trait: NOIR, epaisseur: 0.5 });
    p.texte(M + 3, yL + 8.6, 'Pour le Laboratoire : Remplir cette section et retourner la fiche à l\u2019équipe du district et au clinicien', { taille: 7, gras: true });
    y = yL + 12 + 11; x = M;
    dateC('Date de réception au laboratoire :', '', { apres: 14 }); heureC('Heure de réception :', '', { apres: 0 }); suite();
    lab('Echantillon :'); cb(false, 'Adéquat'); cb(false, 'Non adéquat', { apres: 16 }); dateC('Date d\u2019envoi des résultats vers la ZS :', '', { apres: 0 }); suite(ROW - 4);

    var G = [
      [['Choléra', 'Culture'], ['', 'Examen Direct'], ['Méningite', 'NB : méthode d\u2019examen direct', true], ['N. meningitidis', 'Culture/PCR'], ['S. pneumonia', 'Culture/PCR'], ['H. influenza', 'Culture/PCR'], ['N. meningitidis', 'Latex'], ['\u2026\u2026\u2026\u2026\u2026\u2026', '\u2026\u2026\u2026\u2026\u2026\u2026']],
      [['Fièvre jaune', 'IgM'], ['Rougeole', 'IgM'], ['Rubéole', 'IgM'], ['S. pneumonia', 'Latex'], ['H. influenza', 'Latex'], ['Shigella dysenteriae', 'Culture SD type 1'], ['Peste', 'Culture'], ['', 'IFA>1:64']]
    ];
    var cwM = 92, cwT = 82, cwR = W / 2 - cwM - cwT, rh = 11.2, yT = y - 8;
    ['Maladie/Affection', 'Type de test', 'Résultats (P=en attente)'].forEach(function (t, k) { /* en-têtes répétés à gauche puis à droite */ });
    [0, 1].forEach(function (m) {
      var x0 = M + m * (W / 2), yy = yT;
      [['Maladie/Affection', cwM], ['Type de test', cwT], ['Résultats (P=en attente)', cwR]].reduce(function (xx, h) {
        p.rect(xx, yy, h[1], rh, { fond: '#F1F1F1', trait: NOIR, epaisseur: 0.4 }); p.texte(xx + 2, yy + 7.6, h[0], { taille: 5.8, gras: true }); return xx + h[1]; }, x0);
      G[m].forEach(function (ln, i) {
        var y0 = yy + rh * (i + 1);
        p.rect(x0, y0, cwM, rh, { trait: NOIR, epaisseur: 0.4 }); p.rect(x0 + cwM, y0, cwT, rh, { trait: NOIR, epaisseur: 0.4 }); p.rect(x0 + cwM + cwT, y0, cwR, rh, { trait: NOIR, epaisseur: 0.4 });
        p.texte(x0 + 2, y0 + 7.6, ln[0], { taille: 6.2 });
        p.texte(x0 + cwM + 2, y0 + 7.6, ln[1], { taille: ln[2] ? 5.2 : 6.2 });
        if (!ln[2] && ln[0] + ln[1] !== '\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026\u2026') p.texte(x0 + cwM + cwT + cwR / 2, y0 + 7.6, '+      -      P', { taille: 6.4, align: 'center' });
      });
    });
    y = yT + rh * 9 + 12; x = M;
    lab('Autres résultats :'); fld(R - x, '', { apres: 0 }); suite();
    dateC('Date de réception des résultats à la ZS :', '', { apres: 20 }); dateC('Date d\u2019envoi des résultats au clinicien par la ZS :', '', { apres: 0 });
    verifier();
    if (global.__FN_DEBUG) console.log('Bas de fiche : y=' + y.toFixed(1) + ' / ' + p.h);
    return p;
  }


  // =====================================================================================================
  // Fiches décès (3_BJ maternel, 4_BJ néonatal, 02_BJ autres décès) : dessinées à partir du schéma (fiche-schemas.js),
  // sur UNE page A4, avec le même rendu que la fiche générique (canevas noir, saisie bleue manuscrite).
  // =====================================================================================================
  function dessinerSchema(doc, d) {
    var S = global.FicheSchemas.get(d.typeFiche);
    var p = doc.page(), M = 24, W = p.l - 2 * M, R = M + W, T = 7.0, ROW = S.compact ? 12.9 : 14.6;
    var rnd = prng(hash(JSON.stringify(d, function (k, v) { return (k === '__sigImg' || k === '__signature') ? undefined : v; })));
    var x = M, y = 0;
    function lab(s, o) { o = o || {}; var w = p.texte(x, y, s, { taille: o.taille || T, gras: o.gras, couleur: NOIR }); x += w + (o.apres === undefined ? 2.5 : o.apres); return w; }
    function main(x0, y0, s, max, taille, centre) {
      s = texte(s); if (!s) return;
      var t = taille || 9; while (t > 5.4 && largeur(s, t) > max) t -= 0.3;
      while (s.length > 1 && largeur(s, t) > max) s = s.slice(0, -2) + '\u2026';
      var w = largeur(s, t), xx = centre ? x0 + (max - w) / 2 : x0;
      p.texte(xx, y0 + (rnd() - 0.5) * 0.9, s, { taille: t, oblique: true, couleur: BLEU, angle: (rnd() - 0.5) * 1.8 });
    }
    function fld(w, val, o) { o = o || {}; p.ligne(x, y + 1.7, x + w, y + 1.7, { couleur: TRAIT, epaisseur: 0.4 }); main(x + 1.5, y - 0.3, val, w - 3, o.taille); x += w + (o.apres === undefined ? 6 : o.apres); }
    function croix(bx, by, s) {
      var j = function () { return (rnd() - 0.5) * 0.9; };
      p.ligne(bx - 0.9 + j(), by - 0.6 + j(), bx + s + 1 + j(), by + s + 0.9 + j(), { couleur: BLEU, epaisseur: 1.05, arrondi: true });
      p.ligne(bx + s + 0.7 + j(), by - 0.8 + j(), bx - 0.7 + j(), by + s + 0.7 + j(), { couleur: BLEU, epaisseur: 0.95, arrondi: true });
    }
    function cb(ok, libelle, o) {
      o = o || {}; var s = 6.4, by = y - s + 0.6;
      p.rect(x, by, s, s, { trait: NOIR, epaisseur: 0.5 }); if (ok) croix(x, by, s);
      x += s + 2.4; if (libelle) x += p.texte(x, y, libelle, { taille: o.taille || T, couleur: NOIR });
      x += o.apres === undefined ? 8 : o.apres;
    }
    function slots(vals, widths, o) {
      o = o || {}; lab('/', { apres: 1 });
      widths.forEach(function (w, i) {
        p.ligne(x, y + 1.7, x + w, y + 1.7, { couleur: TRAIT, epaisseur: 0.4 }); main(x, y - 0.3, vals[i], w, 9, true);
        x += w; lab('/', { apres: i === widths.length - 1 ? (o.apres === undefined ? 6 : o.apres) : 1 });
      });
    }
    // Notificateur = le compte qui notifie ; signature stylisée à partir de son nom (voir la fiche générique).
    var notif = { nom: texte(d.notifNom || d.__creePar), qualif: texte(d.notifQualif), tel: texte(d.notifTel) };
    function signer(x0, w) {
      var im = d.__sigImg; if (!im || !im.rgb) return;
      var hMax = 25, wMax = Math.max(20, w - 6), k = Math.min(hMax / im.h, wMax / im.l), lw = im.l * k, lh = im.h * k;
      p.image(im, x0 + 3, y + 1.2 - lh, lw, lh);
    }
    var largSlots = function (n, w) { return 2 + w.reduce(function (a, b) { return a + b; }, 0) + n * 3.4; };
    function suite(h) { x = M; y += h === undefined ? ROW : h; }
    function bandeau(titre) { p.rect(M, y - 8, W, 11, { fond: GRIS }); p.texte(M + 3, y, titre, { taille: 7.6, gras: true, couleur: NOIR }); x = M; y += ROW; }
    var legende = function (fd) { return (fd.opts || []).map(function (o) { return o[0] + '-' + o[1]; }).join('  '); };
    var etiq = function (fd) { return fd.l + (/[?:]$/.test(fd.l) ? '' : ' :'); };
    var val = function (fd) { return fd.t === 'arr' ? d.arrondissement : d[fd.k]; };

    // ---- un champ dans une ligne « libre » ----
    function largeurChamp(fd) {
      var lw = largeur(etiq(fd), T) + 3;
      switch (fd.t) {
        case 'date': return lw + largSlots(3, [14, 14, 28]) + 6;
        case 'heure': return lw + largSlots(2, [14, 14]) + 6;
        case 'num': return lw + largSlots(1, [24]) + 6;
        case 'code': if (fd.box) return lw + 22 + largeur(legende(fd), 5.2) / 2 + 10;
          return lw + (fd.box === false ? fd.opts.reduce(function (a, o) { return a + 18 + largeur(o[1], T); }, 0) : largeur(legende(fd), 6.0) + largSlots(1, [24]) + 4) + 6;
        case 'multi': return fd.opts.reduce(function (a, o) { return a + 18 + largeur(o, T); }, lw) + 6;
        case 'note': return largeur(fd.l, 7.2, true) + 6;
        default: return lw + (fd.w || 0) + 6;
      }
    }
    function dessinerChamp(fd, wFlex) {
      var v = val(fd);
      switch (fd.t) {
        case 'date': lab(etiq(fd)); slots(eclaterDate(v), [14, 14, 28]); break;
        case 'heure': lab(etiq(fd)); slots(eclaterHeure(v), [14, 14]); break;
        case 'num': lab(etiq(fd)); slots([texte(v)], [24]); break;
        case 'code':
          if (fd.box) {
            lab(fd.l, { gras: true, apres: 4 }); var by = y - 9;
            p.rect(x, by, 20, 12, { trait: NOIR, epaisseur: 0.9 }); main(x, y - 0.6, v, 20, 10, true); if (v === 1 || String(v) === '1' || String(v) === '2') { /* le code écrit à la main suffit */ }
            x += 24; p.texte(x, y - 3.6, '1-Oui', { taille: 5.2, gras: true, oblique: false }); p.texte(x, y + 2.4, '2-Non', { taille: 5.2, gras: true }); x += 26;
          } else if (fd.box === false) { lab(etiq(fd)); fd.opts.forEach(function (o) { cb(String(v) === String(o[0]), o[1], { apres: 6 }); }); }
          else { lab(etiq(fd)); x += p.texte(x, y, legende(fd), { taille: 6.0, couleur: NOIR }) + 4; slots([texte(v)], [24]); }
          break;
        case 'multi': lab(etiq(fd)); fd.opts.forEach(function (o) { cb((d[fd.k] || []).indexOf(o) !== -1, o, { apres: 7 }); }); break;
        case 'note': x += p.texte(x, y, fd.l, { taille: 7.2, gras: true }) + 6; break;
        default: lab(etiq(fd)); fld(wFlex !== undefined ? wFlex : (fd.w || 80), v);
      }
    }
    function ligneLibre(row) {
      x = M;
      var fixes = 0, flex = [];
      row.forEach(function (fd) { fixes += largeurChamp(fd); if ((fd.t === 'txt' || fd.t === 'arr') && !fd.w) flex.push(fd); });
      var reste = Math.max(40, W - fixes - 4), parFlex = flex.length ? reste / flex.length : 0;
      row.forEach(function (fd) {
        var wf = ((fd.t === 'txt' || fd.t === 'arr') && !fd.w) ? parFlex : undefined;
        if (fd.t === 'arr') { lab(etiq(fd)); fld(wf !== undefined ? wf : (fd.w || 80), d.arrondissement, { apres: 0 }); }
        else dessinerChamp(fd, wf);
      });
      suite();
    }

    // ---- tableau « INFORMATION SUR … » : libellé + légende à gauche, saisie dans la cellule de droite ----
    function tableau(sec) {
      var avec = {}; sec.rows.forEach(function (r) { if (r[0].avec) avec[r[0].avec] = true; });
      sec.rows.map(function (r) { return r[0]; }).filter(function (fd) { return !avec[fd.k]; }).forEach(function (fd) {
        var sousFd = fd.avec ? sec.rows.map(function (r) { return r[0]; }).filter(function (z) { return z.k === fd.avec; })[0] : null;
        var wR = fd.t === 'txt' ? 175 : 86, avail = W - wR - 8, leg = legende(fd), L = etiq(fd).replace(/ :$/, ''), deux = false, tg = 6.0;
        var wl = largeur(L + (leg ? ' : ' : ''), T), wg = largeur(leg, tg);
        if (wl + wg > avail) { tg = 5.4; wg = largeur(leg, tg); if (wl + wg > avail) deux = true; }
        if (fd.t === 'txt' && largeur(L, T) > avail) { /* libellé long : réduit */ }
        var rh = (deux || sousFd) ? 19 : 11.6, top = y - 8.4;
        p.rect(M, top, W, rh, { trait: NOIR, epaisseur: 0.5 }); p.ligne(R - wR, top, R - wR, top + rh, { epaisseur: 0.5 });
        var ty = deux || sousFd ? top + 8 : top + 8.2, tz = T; if (fd.t === 'txt') { while (tz > 5.4 && largeur(L, tz) > avail) tz -= 0.2; }
        var ox = x, oy = y;
        x = M + 2; y = ty; lab(L + (leg ? ' : ' : ''), { taille: tz, apres: 0 });
        if (leg) { if (deux) { x = M + 2; y = ty + 8; } p.texte(x, y, leg, { taille: tg, couleur: NOIR }); }
        var cx = R - wR, cy = sousFd ? top + 8 : ty, v = val(fd);
        x = cx + 3; y = cy;
        if (fd.t === 'date') { var tw = largSlots(3, [14, 14, 28]) + 4; x = cx + (wR - tw) / 2; slots(eclaterDate(v), [14, 14, 28], { apres: 0 }); }
        else if (fd.t === 'heure') { var tw2 = largSlots(2, [14, 14]) + 4; x = cx + (wR - tw2) / 2; slots(eclaterHeure(v), [14, 14], { apres: 0 }); }
        else if (fd.t === 'txt') { main(cx + 3, y - 0.2, v, wR - 6, 8.6); }
        else { var tw3 = largSlots(1, [24]) + 2; x = cx + (wR - tw3) / 2; slots([texte(v)], [24], { apres: 0 }); }
        if (sousFd) { y = top + 17.2; p.ligne(cx + 6, y + 1, R - 6, y + 1, { couleur: TRAIT, epaisseur: 0.4 }); main(cx + 8, y - 0.4, d[sousFd.k], wR - 16, 8); }
        x = ox; y = oy + rh;
      });
      y += 3;
    }

    // ---- grille de cases à cocher bordée (antécédents médico-chirurgicaux) ----
    function grilleCases(fd) {
      var cols = fd.cols || 7, cw = W / cols, rh = 17.5, n = fd.opts.length, rows = Math.ceil(n / cols), top = y - 8.6;
      for (var i = 0; i < rows * cols; i++) {
        var c = i % cols, r = Math.floor(i / cols), cx = M + c * cw, cy = top + r * rh;
        p.rect(cx, cy, cw, rh, { trait: NOIR, epaisseur: 0.4 });
        if (i >= n) continue;
        var o = fd.opts[i]; x = cx + 3; y = cy + 7.2;
        cb((d[fd.k] || []).indexOf(o) !== -1, null, {}); var tz = 6.0, w = cw - 17;
        var lines = [o]; if (largeur(o, tz) > w) { var mots = o.split(' '), a = '', b = ''; mots.forEach(function (m2) { if (!b && largeur((a + ' ' + m2).trim(), tz) <= w) a = (a + ' ' + m2).trim(); else b = (b + ' ' + m2).trim(); }); lines = [a, b]; }
        p.texte(x, y, lines[0], { taille: tz }); if (lines[1]) p.texte(x, y + 6.6, lines[1], { taille: tz });
        if (fd.autreK && o === 'Autre à préciser') { y = cy + 15.4; main(x - 1, y - 0.2, d[fd.autreK], cw - 6, 7.5); }
      }
      y = top + rows * rh + 12; x = M;
    }

    // ---- boîtes de codes (profession / statut matrimonial… ; issu de la grossesse…) ----
    function boitesCodes(sec) {
      var tot = sec.cols.reduce(function (a, c) { return a + c.w; }, 0), sc = W / tot, xc = M, top = y - 8, hLeg = 0;
      sec.cols.forEach(function (c) { c.lignes = envelopper(c.opts.map(function (o) { return o[1] + '=' + o[0]; }), c.w * sc - 6, 5.8); hLeg = Math.max(hLeg, c.lignes.length); });
      var h = 17 + hLeg * 7 + (sec.cols.some(function (c) { return c.autre; }) ? 11 : 3);
      sec.cols.forEach(function (c) {
        var w = c.w * sc; p.rect(xc, top, w, h, { trait: NOIR, epaisseur: 0.5 });
        x = xc + 3; y = top + 10; lab(c.l + ' /', { apres: 1, gras: true }); p.ligne(x, y + 1.7, x + 15, y + 1.7, { couleur: TRAIT, epaisseur: 0.4 }); main(x, y - 0.3, d[c.k], 15, 9, true); x += 15; lab('/', { apres: 0 });
        c.lignes.forEach(function (ln, i) { p.texte(xc + 3, top + 19 + i * 7, ln, { taille: 5.8 }); });
        if (c.autre) { var ya = top + h - 3.4, wa = largeur(c.autre.l + ' :', 5.8); p.texte(xc + 3, ya, c.autre.l + ' :', { taille: 5.8 }); p.ligne(xc + 5 + wa, ya + 1.2, xc + w - 4, ya + 1.2, { couleur: TRAIT, epaisseur: 0.4 }); y = ya; main(xc + 6 + wa, ya - 0.3, d[c.autre.k], w - wa - 12, 7.6); }
        xc += w;
      });
      y = top + h + 12; x = M;
    }

    // ---- statut vaccinal (3_BJ) ----
    function vaccinal(sec) {
      var F = {}; sec.champs.forEach(function (c) { F[c.k] = c; });
      var wq = 200, wr = 50, top = y - 8.4, rh = 11.6;
      var cell = function (cx, cy, w, h, fond) { p.rect(cx, cy, w, h, { trait: NOIR, epaisseur: 0.5, fond: fond }); };
      cell(M, top, wq, rh, '#F1F1F1'); cell(M + wq, top, wr, rh, '#F1F1F1'); cell(M + wq + wr, top, W - wq - wr, rh, '#F1F1F1');
      p.texte(M + 2, top + 8, 'Questions', { taille: 7, gras: true }); p.texte(M + wq + 4, top + 8, 'Réponses', { taille: 7, gras: true }); p.texte(M + wq + wr + 4, top + 8, 'Dates vaccination', { taille: 7, gras: true });
      var qs = ['vaccTd', 'carteVue', 'nbDosesTd', 'vaccAvant'];
      var dates = [[['1ère', 'dTd1'], ['4ème', 'dTd4']], [['2ème', 'dTd2'], ['5ème', 'dTd5']], [['3ème', 'dTd3'], ['Si>5, dernière dose', 'dTdDerniere']], null];
      qs.forEach(function (k, i) {
        var cy = top + rh * (i + 1);
        cell(M, cy, wq, rh); cell(M + wq, cy, wr, rh); cell(M + wq + wr, cy, W - wq - wr, rh);
        p.texte(M + 2, cy + 8, F[k].l, { taille: 6.8 });
        x = M + wq; y = cy + 8; var tw = largSlots(1, [24]) + 2; x = M + wq + (wr - tw) / 2; slots([texte(d[k])], [24], { apres: 0 });
        var dl = dates[i], xr = M + wq + wr + 4;
        if (dl) dl.forEach(function (z, j) { x = xr + j * ((W - wq - wr) / 2); y = cy + 8; lab(z[0], { taille: 6.6, apres: 2 }); slots(eclaterDate(d[z[1]]), [13, 13, 24]); });
        else p.texte(xr, cy + 8, '**1= à jour, 2=pas à jour 99=inconnu', { taille: 6.2 });
      });
      y = top + rh * 5 + 12; x = M;
    }

    // ---- enfants 1 à 4 (3_BJ) ----
    function enfants(sec) {
      var wl = 262, cw = (W - wl) / 4, top = y - 8.4, rh = 11.6;
      p.rect(M, top, wl, rh, { trait: NOIR, epaisseur: 0.5, fond: '#F1F1F1' }); p.texte(M + 2, top + 8, 'Variables', { taille: 7, gras: true });
      for (var i = 0; i < 4; i++) { p.rect(M + wl + i * cw, top, cw, rh, { trait: NOIR, epaisseur: 0.5, fond: '#F1F1F1' }); p.texte(M + wl + i * cw + cw / 2, top + 8, 'Enfant ' + (i + 1), { taille: 7, gras: true, align: 'center' }); }
      sec.vars.forEach(function (v, r) {
        var cy = top + rh * (r + 1); p.rect(M, cy, wl, rh, { trait: NOIR, epaisseur: 0.5 });
        var leg = v.opts ? v.opts.map(function (o) { return o[0] + '-' + o[1]; }).join(' ') : '', tg = 6.0; while (tg > 5 && largeur(v.l + ' : ' + leg, tg) > wl - 4) tg -= 0.2;
        p.texte(M + 2, cy + 8, v.l + (leg ? ' : ' + leg : ''), { taille: tg });
        for (var i2 = 0; i2 < 4; i2++) { p.rect(M + wl + i2 * cw, cy, cw, rh, { trait: NOIR, epaisseur: 0.5 }); y = cy + 8; main(M + wl + i2 * cw, y - 0.2, d[v.k + (i2 + 1)], cw, 9, true); }
      });
      y = top + rh * 4 + 12; x = M;
    }

    // ===== en-tête =====
    y = 32;
    p.texte(M, y, 'Ministère de la Santé', { taille: 8, gras: true }); p.texte(R, y, 'République du Bénin', { taille: 8, gras: true, align: 'right' });
    y += 15;
    (S.titreLignes || [S.code + '_' + S.titre]).forEach(function (tl, i) { p.texte(p.l / 2, y + i * 11, tl, { taille: 9.4, gras: true, align: 'center' }); });
    y += (S.titreLignes ? 11 : 0) + 7; p.ligne(M, y, R, y, { epaisseur: 1 }); y += 14;
    lab('Année de notification'); slots([texte(d.annee)], [34]); lab('Semaine épidémiologique :'); slots([texte(d.semaine)], [20], { apres: 40 });
    lab('Fiche saisie :'); cb(false, 'Oui'); cb(false, 'Non', { apres: 0 }); suite();
    lab('Numéro EPID (Réservé au RCSE) : BEN', { gras: true }); var xe = x; slots([], [26, 26, 20, 20], { apres: 14 }); lab('Reçu le :', { gras: true }); slots([], [14, 14, 28], { apres: 0 });
    ['Pays', 'Départ', 'Commune', 'Année', 'N°. du cas'].forEach(function (z, i) { p.texte(xe + 2 + [0, 33, 62, 94, 118][i], y + 7, z, { taille: 4.8, couleur: '#555' }); });
    suite(ROW + 3); p.ligne(M, y - 10, R, y - 10, { epaisseur: 0.8 });

    // ===== sections =====
    S.sections.forEach(function (sec) {
      if (sec.titre) bandeau(sec.titre); else if (sec.style !== 'enquete') y += 2;
      if (sec.style === 'table') tableau(sec);
      else if (sec.style === 'boites') boitesCodes(sec);
      else if (sec.style === 'vacc') vaccinal(sec);
      else if (sec.style === 'enfants') enfants(sec);
      else if (sec.style === 'multi') sec.rows.forEach(function (r) { grilleCases(r[0]); });
      else sec.rows.forEach(function (r) { ligneLibre(r); });
      if (sec.style === 'enquete') { y += 1; }
    });
    // ===== pied de fiche : notificateur (nom, qualification, téléphone) et signature, remplis depuis le compte =====
    y += 10; x = M; lab(S.signature, { apres: 5 }); fld(R - x, notif.nom + (notif.qualif ? ' \u2014 ' + notif.qualif : ''), { apres: 0 }); suite(ROW + 10);
    lab('Téléphone :'); fld(130, notif.tel, { apres: 14 }); lab('Signature :'); var xsg = x; fld(R - x, '', { apres: 0 }); signer(xsg, R - xsg);
    if (global.__FN_DEBUG) console.log(S.code + ' : bas de fiche y=' + y.toFixed(1) + ' / ' + p.h);
    return p;
  }

  function dessiner(doc, d) { return (d && d.typeFiche && d.typeFiche !== 'maladie' && global.FicheSchemas && global.FicheSchemas.get(d.typeFiche)) ? dessinerSchema(doc, d) : dessinerFiche(doc, d); }

  // Décode la signature (PNG enregistré dans « Mon compte ») de chaque fiche en image RGB sur fond blanc, pour le PDF.
  var __sigCache = {};
  function decoderSignature(url) {
    if (!url || typeof document === 'undefined') return Promise.resolve(null);
    if (__sigCache[url]) return __sigCache[url];
    return (__sigCache[url] = new Promise(function (res) {
      var im = new Image();
      im.onload = function () {
        try {
          var sc = Math.min(1, 520 / im.width), w = Math.max(1, Math.round(im.width * sc)), h = Math.max(1, Math.round(im.height * sc));
          var c = document.createElement('canvas'); c.width = w; c.height = h; var g = c.getContext('2d');
          g.fillStyle = '#fff'; g.fillRect(0, 0, w, h); g.drawImage(im, 0, 0, w, h);
          var px = g.getImageData(0, 0, w, h).data, rgb = new Uint8Array(w * h * 3);
          for (var i = 0, j = 0; i < px.length; i += 4, j += 3) { rgb[j] = px[i]; rgb[j + 1] = px[i + 1]; rgb[j + 2] = px[i + 2]; }
          res({ l: w, h: h, rgb: rgb });
        } catch (e) { res(null); }
      };
      im.onerror = function () { res(null); };
      im.src = url;
    }));
  }
  function preparer(liste) {
    return Promise.all((liste || []).map(function (d) { return decoderSignature(d && d.__signature).then(function (img) { if (d) d.__sigImg = img; }); }));
  }

  function construire(liste, opts) {
    var doc = new global.PdfMini({ titre: (opts && opts.titre) || 'Fiche de notification' });
    (liste || []).forEach(function (d) { dessiner(doc, d); });
    return doc;
  }
  function telecharger(liste, nom) { construire(liste, { titre: nom }).telecharger(nom || 'Fiche_de_notification.pdf'); }

  // ---- Aperçu à l'écran : rejoue les opérations de dessin de la page PDF sur un <canvas> (identique au PDF) ----
  var CP = { 0x80: '\u20AC', 0x85: '\u2026', 0x91: '\u2018', 0x92: '\u2019', 0x93: '\u201C', 0x94: '\u201D', 0x95: '\u2022', 0x96: '\u2013', 0x97: '\u2014', 0x8C: '\u0152', 0x9C: '\u0153' };
  function decoder(str) {
    return str.replace(/\\([()\\])|\\([0-7]{3})/g, function (m, a, o) { if (a) return a; var k = parseInt(o, 8); return CP[k] || String.fromCharCode(k); });
  }
  function rvb(v) { var n = v.trim().split(/\s+/).map(function (z) { return Math.round(parseFloat(z) * 255); }); return 'rgb(' + n.join(',') + ')'; }
  function canvasPage(page, largeurCss, dprFixe) {
    var dpr = dprFixe || Math.min(3, Math.max(1, (global.devicePixelRatio || 1))), px = largeurCss * dpr, k = px / page.l;
    var cv = document.createElement('canvas'); cv.width = Math.round(px); cv.height = Math.round(page.h * k);
    cv.style.cssText = 'width:100%;height:auto;display:block;background:#fff';
    var g = cv.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, cv.width, cv.height); g.lineCap = 'butt';
    page.ops.forEach(function (op) {
      var m;
      if (op.indexOf('BT ') === 0) {
        m = /^BT \/(F\d) ([\d.]+) Tf ([\d. ]+) rg (-?[\d.]+) (-?[\d.]+) (-?[\d.]+) (-?[\d.]+) (-?[\d.]+) (-?[\d.]+) Tm \(([\s\S]*)\) Tj ET$/.exec(op);
        if (!m) return;
        var ang = Math.atan2(parseFloat(m[5]), parseFloat(m[4]));
        g.save(); g.translate(parseFloat(m[8]) * k, (page.h - parseFloat(m[9])) * k); g.rotate(-ang);
        g.font = (m[1] === 'F3' ? 'italic ' : '') + (m[1] === 'F2' ? 'bold ' : '') + (parseFloat(m[2]) * k) + 'px Helvetica, Arial, sans-serif';
        g.fillStyle = rvb(m[3]); g.textBaseline = 'alphabetic'; g.fillText(decoder(m[10]), 0, 0); g.restore();
      } else if (/^q [\d.]+ 0 0 [\d.]+ -?[\d.]+ -?[\d.]+ cm \/Im\d+ Do Q$/.test(op)) {
        m = /^q ([\d.]+) 0 0 ([\d.]+) (-?[\d.]+) (-?[\d.]+) cm \/Im(\d+) Do Q$/.exec(op);
        var img = page.images[parseInt(m[5], 10) - 1]; if (!img || !img.rgb) return;
        if (!img._cv) { var t = document.createElement('canvas'); t.width = img.l; t.height = img.h; var tg = t.getContext('2d'), id = tg.createImageData(img.l, img.h);
          for (var i = 0, j = 0; j < img.rgb.length; i += 4, j += 3) { id.data[i] = img.rgb[j]; id.data[i + 1] = img.rgb[j + 1]; id.data[i + 2] = img.rgb[j + 2]; id.data[i + 3] = 255; }
          tg.putImageData(id, 0, 0); img._cv = t; }
        g.drawImage(img._cv, parseFloat(m[3]) * k, (page.h - parseFloat(m[4]) - parseFloat(m[2])) * k, parseFloat(m[1]) * k, parseFloat(m[2]) * k);
      } else if (/ re (f|S|B)$/.test(op)) {
        var fond = /([\d.]+ [\d.]+ [\d.]+) rg/.exec(op), trait = /([\d.]+ [\d.]+ [\d.]+) RG ([\d.]+) w/.exec(op), r = /(-?[\d.]+) (-?[\d.]+) (-?[\d.]+) (-?[\d.]+) re/.exec(op);
        if (!r) return;
        var rx = parseFloat(r[1]) * k, ry = (page.h - parseFloat(r[2]) - parseFloat(r[4])) * k, rw = parseFloat(r[3]) * k, rh = parseFloat(r[4]) * k;
        if (fond) { g.fillStyle = rvb(fond[1]); g.fillRect(rx, ry, rw, rh); }
        if (trait) { g.strokeStyle = rvb(trait[1]); g.lineWidth = parseFloat(trait[2]) * k; g.strokeRect(rx, ry, rw, rh); }
      } else if (/ m .* l S$/.test(op)) {
        m = /^(1 J 1 j )?([\d. ]+) RG ([\d.]+) w (-?[\d.]+) (-?[\d.]+) m (-?[\d.]+) (-?[\d.]+) l S$/.exec(op);
        if (!m) return;
        g.strokeStyle = rvb(m[2]); g.lineWidth = parseFloat(m[3]) * k; g.lineCap = m[1] ? 'round' : 'butt';
        g.beginPath(); g.moveTo(parseFloat(m[4]) * k, (page.h - parseFloat(m[5])) * k); g.lineTo(parseFloat(m[6]) * k, (page.h - parseFloat(m[7])) * k); g.stroke();
      }
    });
    return cv;
  }
  function canvases(liste, largeurCss, dprFixe) { return construire(liste).pages.map(function (pg) { return canvasPage(pg, largeurCss || 800, dprFixe); }); }

  global.FicheNotifPdf = { construire: construire, telecharger: telecharger, canvases: canvases, preparer: preparer };
  if (typeof module !== 'undefined' && module.exports) module.exports = global.FicheNotifPdf;
})(typeof window !== 'undefined' ? window : globalThis);
