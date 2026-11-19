/**
 * Schémas des fiches officielles de notification (Bénin) — source UNIQUE pour :
 *   - le formulaire à l'écran (fiche-form.js),
 *   - le PDF d'une page calqué sur la fiche officielle (fiche-notification-pdf.js),
 *   - le contrôle des rubriques obligatoires, côté application ET côté serveur (Code.gs embarque ce fichier).
 *
 * Types : maladie (1_BJ générique) · deces_maternel (3_BJ) · deces_neonatal (4_BJ) · autres_deces (02_BJ).
 *
 * Règle : TOUTES les rubriques sont obligatoires, sauf
 *   - les rubriques conditionnelles (`si`) qui ne s'appliquent pas (ex. « Autre à préciser » si « Autre » n'est pas choisi),
 *   - les listes de cases à cocher « antécédents » (case non cochée = non),
 *   - quelques rubriques facultatives par nature (`opt`) : commentaire, cause secondaire, rang de jumeau, enfants 2 à 4.
 * Pour une information inconnue ou sans objet, écrire « NA » (champs texte) ou utiliser le code « Inconnu » proposé.
 *
 * Ce fichier est « pur » (aucun accès au navigateur) : il est aussi exécuté par Google Apps Script.
 */
var FicheSchemas = (function () {
  'use strict';
  var LIEUX = [[1, 'CS public'], [2, 'CS privé'], [3, 'HZ'], [4, 'CHD'], [5, 'CHU'], [6, 'Domicile'], [7, 'En cours de route'], [8, 'Inconnu']];
  var OUI_NON = [[1, 'Oui'], [2, 'Non']];
  var OUI_NON_INC = [[1, 'Oui'], [2, 'Non'], [99, 'Inconnu']];
  var LOCALITE = [[1, 'Urbain'], [2, 'Rural']];
  var PROFESSIONS = [[1, 'Salarié'], [2, 'Cultivateur'], [3, 'Eleveur/Chasseur'], [4, 'Commerçant'], [5, 'Artisan'], [6, 'Elève/Etudiant'], [7, 'Professionnel de santé'], [8, 'Ménagère'], [9, 'Aucun'], [10, 'NA'], [11, 'Autre']];
  var MATRIMONIAL = [[1, 'Marié'], [2, 'Célibataire'], [3, 'Veuf'], [4, 'Divorcé'], [5, 'NA']];
  var NIVEAUX = [[1, 'Non scolarisé'], [2, 'Alphabétisé'], [3, 'Primaire'], [4, 'Secondaire'], [5, 'Université'], [6, 'NA']];
  var NATIONALITES = [[1, 'Béninoise'], [2, 'Autre nationalité']];
  var SEXE_MF = [['M', 'Masculin'], ['F', 'Féminin']];

  // ---- constructeurs de rubriques ----
  function f(t, k, l, o) { var r = { t: t, k: k, l: l }; if (o) for (var i in o) r[i] = o[i]; return r; }
  var txt = function (k, l, o) { return f('txt', k, l, o); };
  var dat = function (k, l, o) { return f('date', k, l, o); };
  var heu = function (k, l, o) { return f('heure', k, l, o); };
  var num = function (k, l, o) { return f('num', k, l, o); };
  var cod = function (k, l, opts, o) { var r = f('code', k, l, o); r.opts = opts; return r; };
  var mul = function (k, l, opts, o) { var r = f('multi', k, l, o); r.opts = opts; return r; };
  var arr = function (o) { return f('arr', 'arrondissementId', 'Arrondissement', o); };

  // ---- blocs communs ----
  function blocResidence(titre, extra) {
    return { titre: titre, rows: [
      [txt('pays', 'Pays', { w: 50 }), txt('depResidence', 'Département', { w: 95, auto: true }), txt('zoneSanitaire', 'Zone sanitaire', { w: 125 }), txt('comResidence', 'Commune', { auto: true })],
      [arr({ w: 175 }), txt('village', 'Village/Quartier')]
    ].concat(extra) };
  }
  function blocNotification(avecZs) {
    return { titre: 'NOTIFICATION/ENQUETE', rows: [
      [txt('notifNom', 'Nom prénom du notificateur', { w: 150 }), txt('notifQualif', 'Qualification', { w: 110 }), txt('notifTel', 'Téléphone')],
      avecZs ? [txt('depNotif', 'Département de notification', { w: 130 }), txt('zsNotif', 'Zone sanitaire', { w: 120 }), txt('comNotif', 'Commune')]
             : [txt('depNotif', 'Département de notification', { w: 150 }), txt('comNotif', 'Commune de notification', { w: 130 }), txt('fs', 'FS')],
      avecZs ? [txt('fs', 'FS', { w: 150 }), dat('dateNotification', 'Date de notification'), dat('dateEnquete', 'Date de l\u2019enquête')]
             : [dat('dateNotification', 'Date de notification'), dat('dateEnquete', 'Date de l\u2019enquête')]
    ] };
  }
  var SI_AUDIT = { k: 'decesAudite', eq: 1 };
  function blocEnquete(libs) {
    return { titre: '', style: 'enquete', rows: [
      [txt('commentaire', 'Commentaire', { opt: true })],
      [cod('decesConfirme', libs[0], OUI_NON, { box: true }), cod(libs[2], libs[1], OUI_NON, { box: true }), cod('decesAudite', 'Décès audité', OUI_NON, { box: true })],
      [dat('dateAudit', 'Date de l\u2019audit', { si: SI_AUDIT })],
      [txt('auditNom', 'Nom prénom', { w: 250, si: SI_AUDIT }), txt('auditTitre', 'Titre', { si: SI_AUDIT })],
      [txt('auditStructure', 'Structure', { w: 250, si: SI_AUDIT }), txt('auditTel', 'Téléphone', { si: SI_AUDIT })]
    ] };
  }
  function tableInfos(titre, rows, si) { return { titre: titre, style: 'table', si: si, rows: rows.map(function (r) { return [r]; }) }; }
  var CAUSE_PREC = function (k, siIn) { return txt(k, 'Autre à préciser', { si: { k: 'causePrincipale', 'in': siIn } }); };

  // ---------------- 4_BJ — décès néonataux ----------------
  var NEO = { id: 'deces_neonatal', code: '4_BJ', court: 'Décès néonatal', titre: 'FORMULAIRE DE NOTIFICATION DES DECES NEONATAUX', signature: 'Signature, nom prénom et cachet du notificateur :',
    resume: { nom: ['nomEnfant', 'nomMere'], sexe: { k: 'sexeEnfant', map: { 1: 'M', 2: 'F' } }, age: { k: 'ageJours', suffixe: ' j' }, village: 'village' },
    sections: [
      blocResidence('RESIDENCE ET IDENTIFICATION', [
        [txt('adresseParent', 'Adresse parent (hameau et Maison)', { w: 270 }), txt('tel', 'Tel')],
        [txt('nomMere', 'Nom & prénoms de la mère', { w: 240 }), txt('nomEnfant', 'Nom de l\u2019enfant')],
        [dat('dateNaissance', 'Date de naissance'), num('ageJours', 'Age au jour du décès (en jours)')]
      ]),
      blocNotification(true),
      tableInfos('INFORMATION SUR L\u2019ACCOUCHEMENT', [
        dat('dateAccouchement', 'Date de l\u2019accouchement'), heu('heureAccouchement', 'Heure de l\u2019accouchement'),
        cod('lieuAccouchement', 'Lieu d\u2019accouchement', LIEUX), cod('modeAccouchement', 'Mode d\u2019accouchement', [[1, 'Voie basse nature'], [2, 'Voie basse instrumentale'], [3, 'Césarienne']]),
        cod('mereReferee', 'Mère référée', OUI_NON_INC), num('dureeTravail', 'Durée du travail en heure'),
        cod('etatNaissance', 'Etat de l\u2019enfant à la naissance', [[1, 'Crie'], [2, 'reanimé']]), cod('sexeEnfant', 'Sexe de l\u2019enfant', [[1, 'Masculin'], [2, 'Féminin'], [3, 'Indéterminé']]),
        num('poidsEnfant', 'Poids de l\u2019enfant en g')
      ]),
      tableInfos('INFORMATION SUR LE DECES', [
        dat('dateDeces', 'Date de décès'), heu('heureDeces', 'Heure de décès'), cod('localite', 'Localité', LOCALITE), cod('lieuDeces', 'Lieu du décès', LIEUX),
        cod('causePrincipale', 'Cause principale du décès', [[1, 'Asphyxie'], [2, 'Infection'], [3, 'Prématurité'], [4, 'Hypotrophie'], [5, 'Ictère'], [6, 'Malformation congénitale'], [7, 'Autre à préciser'], [8, 'Inconnu'], [9, 'Autre à préciser']], { avec: 'causePrecision' }),
        CAUSE_PREC('causePrecision', [7, 9]),
        txt('causeSecondaire', 'Cause secondaire du décès à préciser', { opt: true }),
        cod('momentDeces', 'Moment du décès', [[1, 'J0_J3'], [2, 'J4_J7'], [3, 'J8_J28']]),
        num('rangGemellaire', 'Si grossesse gémellaire, préciser le rang de l\u2019enfant', { opt: true })
      ]),
      blocEnquete(['Décès confirmé', 'Enquête sociale faite', 'enqueteSociale'])
    ] };

  // ---------------- 3_BJ — décès maternels ----------------
  var SI_ACC = { k: 'issu', 'in': [3, 4, 5] };
  var enfantVars = [
    { k: 'etat', l: 'Etat de l\u2019enfant', opts: [[1, 'Vivant'], [2, 'reanimé en vain'], [3, 'Mort-né frais'], [4, 'Mort-né macéré']] },
    { k: 'sexe', l: 'Sexe de l\u2019enfant', opts: [[1, 'Masculin'], [2, 'Féminin'], [3, 'Indéterminé']] },
    { k: 'poids', l: 'Poids de l\u2019enfant en g', num: true }
  ];
  var MAT = { id: 'deces_maternel', code: '3_BJ', court: 'Décès maternel', titre: 'FORMULAIRE DE NOTIFICATION DES DECES MATERNELS', signature: 'Signature, du notificateur :', compact: true,
    resume: { nom: ['nomDefunte'], sexeFixe: 'F', age: { k: 'ageAns', suffixe: ' an(s)' }, village: 'village' },
    unDe: [{ ks: ['dateNaissance', 'ageAns'], l: 'Date de naissance ou âge au moment du décès' }],
    sections: [
      blocResidence('RESIDENCE ET IDENTIFICATION DE LA DEFUNTE', [
        [txt('adresseParent', 'Adresse parent (hameau et Maison)', { w: 270 }), txt('tel', 'Tel')],
        [txt('nomDefunte', 'Nom(s) & prénoms de la décédée', { w: 270 }), dat('dateNaissance', 'Date de naissance', { unDe: true })],
        [num('ageAns', 'Ou âge au moment du décès (en année)', { unDe: true }), txt('profession', 'Profession')],
        [txt('gpsLon', 'Coordonnée GPS du domicile : longitude', { w: 150 }), txt('gpsLat', 'latitude')]
      ]),
      blocNotification(true),
      { titre: 'ANTECEDENTS MEDICO-OBSTETRICAUX DE LA FEMME', style: 'libre', rows: [
        [mul('antecedents', 'Antécédents', ['Paludisme confirmé', 'HTA', 'Anémie', 'Diabète', 'Autre à préciser'], { opt: true, ligne: true }), txt('antecedentsAutre', 'Autre à préciser', { si: { k: 'antecedents', inclut: 'Autre à préciser' } })],
        [num('nbGrossesse', 'Nombre de grossesse'), num('nbCesarienne', 'Nombre de césarienne'), num('nbAccouchement', 'Nombre d\u2019accouchement')],
        [num('nbGemellaire', 'Nombre d\u2019accouchement gémellaire'), num('nbAvortement', 'Nombre d\u2019avortement'), { t: 'note', l: 'NB : mettre 99 si inconnu' }]
      ] },
      { titre: 'HISTOIRE DE LA GROSSESSE', style: 'libre', rows: [
        [num('nbCpn', 'Combien de CPN la femme a reçu'), cod('tpi', 'Statut TPI', OUI_NON, { inline: true }), num('tpiPrises', 'Si Oui nombre de prises', { si: { k: 'tpi', eq: 1 } })],
        [txt('structureSuivi', 'Nom dernière structure de suivi de la grossesse', { w: 300 })]
      ] },
      { titre: '', style: 'boites', cols: [
        { k: 'issu', l: 'Issu de la grossesse', w: 150, opts: [[1, 'Avortement'], [2, 'GU'], [3, 'Accouchement prématuré'], [4, 'Accouchement à terme'], [5, 'Autre à préciser']], autre: { k: 'issuAutre', l: 'Autre à préciser', si: { k: 'issu', eq: 5 } } },
        { k: 'typeAvortement', l: 'Si avortement', w: 110, opts: [[1, 'Spontané'], [2, 'Provoqué'], [3, 'Sécurisé'], [4, 'Inconnu']], si: { k: 'issu', eq: 1 } },
        { k: 'momentDeces', l: 'Moment du décès', w: 150, opts: [[1, 'Durant la grossesse'], [2, 'Durant l\u2019accouchement'], [3, 'Durant post-partum']] },
        { k: 'modeAccouchement', l: 'Mode d\u2019accouchement', w: 137, opts: [[1, 'Voie basse nature'], [2, 'Voie basse instrumentale'], [3, 'Césarienne']], si: { k: 'issu', 'in': [3, 4] } }
      ] },
      { titre: 'STATUT VACCINAL', style: 'vacc', rows: [], champs: [
        cod('vaccTd', 'Mère vaccinée avec le vaccin Td (VAT)?', OUI_NON_INC), cod('carteVue', 'Carte de vaccination vue?', OUI_NON),
        num('nbDosesTd', 'Nombre de dose reçue?', { si: { k: 'vaccTd', eq: 1 } }), cod('vaccAvant', 'Vaccin reçu avant l\u2019accouchement ?', [[1, 'à jour'], [2, 'pas à jour'], [99, 'inconnu']]),
        dat('dTd1', '1ère dose', { si: { k: 'nbDosesTd', gte: 1 } }), dat('dTd2', '2ème dose', { si: { k: 'nbDosesTd', gte: 2 } }), dat('dTd3', '3ème dose', { si: { k: 'nbDosesTd', gte: 3 } }),
        dat('dTd4', '4ème dose', { si: { k: 'nbDosesTd', gte: 4 } }), dat('dTd5', '5ème dose', { si: { k: 'nbDosesTd', gte: 5 } }), dat('dTdDerniere', 'Dernière dose (si > 5)', { si: { k: 'nbDosesTd', gt: 5 } })
      ] },
      tableInfos('INFORMATION SUR L\u2019ACCOUCHEMENT', [
        dat('dateAccouchement', 'Date de l\u2019accouchement'), heu('heureAccouchement', 'Heure de l\u2019accouchement'), cod('lieuAccouchement', 'Lieu d\u2019accouchement', LIEUX),
        cod('femmeReferee', 'Femme référée', OUI_NON_INC), num('dureeTravail', 'Durée du travail (en heure)')
      ], SI_ACC),
      { titre: '', style: 'enfants', si: SI_ACC, vars: enfantVars },
      tableInfos('INFORMATION SUR LE DECES', [
        dat('dateDeces', 'Date de décès'), heu('heureDeces', 'Heure de décès'), cod('localite', 'Localité', LOCALITE), cod('lieuDeces', 'Lieu du décès', LIEUX),
        cod('causePrincipale', 'Cause principale du décès', [[1, 'Hémorragie'], [2, 'Infection'], [3, 'HTA et complication'], [4, 'Anémie'], [5, 'Paludisme'], [6, 'SIDA'], [7, 'Dystocie'], [8, 'Inconnu'], [9, 'Autre à préciser']], { avec: 'causePrecision' }),
        CAUSE_PREC('causePrecision', [9]),
        txt('causeSecondaire', 'Cause secondaire du décès à préciser', { opt: true })
      ]),
      blocEnquete(['Décès confirmé', 'Enquête sociale', 'enqueteSociale'])
    ] };
  // Enquête maternelle : titre « Enquête, Décès confirmé » ; champs d'audit limités à date / nom / titre / téléphone
  (function () {
    var enq = MAT.sections[MAT.sections.length - 1];
    enq.rows = [enq.rows[0], enq.rows[1], enq.rows[2], [txt('auditNom', 'Nom prénom', { w: 250, si: SI_AUDIT }), txt('auditTitre', 'Titre', { si: SI_AUDIT })], [txt('auditTel', 'Téléphone', { w: 200, si: SI_AUDIT })]];
  })();

  // ---------------- 02_BJ — autres décès ----------------
  var ANT = ['Paludisme', 'HTA', 'Asthme', 'Diabète', 'Drépanocytose', 'Tumeur bénigne', 'Cancer', 'IST/VIH/SIDA', 'Affection du foie', 'Affection rénale', 'Affection pulmonaire', 'Affection cardiaque',
    'Infection urinaire', 'Thrombose', 'Tuberculose', 'Opéré d\u2019hernie', 'Opéré pour appendicite', 'Césarienne', 'Amputation', 'Chirurgicale lourde', 'Autre à préciser'];
  var AUT = { id: 'autres_deces', code: '02_BJ', court: 'Autre décès', titre: 'FORMULAIRE DE NOTIFICATION DES AUTRES DECES (TOUT DECES EN DEHORS DES DECES MATERNELS ET NEONATALS)', titreLignes: ['02_BJ_FORMULAIRE DE NOTIFICATION DES AUTRES DECES (TOUT DECES EN DEHORS', 'DES DECES MATERNELS ET NEONATALS)'],
    signature: 'Signature, nom prénom et cachet du notificateur :',
    resume: { nom: ['nomDefunt'], sexe: { k: 'sexe', map: { M: 'M', F: 'F' } }, age: { k: 'ageAns', suffixe: ' an(s)' }, village: 'village' },
    unDe: [{ ks: ['dateNaissance', 'ageAns'], l: 'Date de naissance ou âge au moment du décès' }],
    sections: [
      blocResidence('RESIDENCE ET IDENTIFICATION DU DEFUNT(E)', [
        [txt('adresseParent', 'Adresse parent (hameau et Maison)')],
        [txt('nomDefunt', 'Nom(s) & prénoms du défunt(e)', { w: 230 }), txt('nomProche', 'Nom d\u2019un parent ou proche')],
        [txt('telProche', 'Numéro tél d\u2019un parent ou proche', { w: 170 }), dat('dateNaissance', 'Date de naissance', { unDe: true })],
        [num('ageAns', 'Ou âge au moment du décès (en année)', { unDe: true }), cod('sexe', 'Sexe', SEXE_MF, { inline: true, box: false })],
        [txt('gpsLon', 'Coordonnée GPS du domicile : longitude', { w: 150 }), txt('gpsLat', 'latitude')]
      ]),
      { titre: '', style: 'boites', cols: [
        { k: 'profession', l: 'Profession', w: 168, opts: PROFESSIONS, autre: { k: 'professionAutre', l: 'Autre', si: { k: 'profession', eq: 11 } } },
        { k: 'matrimonial', l: 'Statut matrimonial', w: 105, opts: MATRIMONIAL },
        { k: 'niveau', l: 'Niveau scolaire', w: 105, opts: NIVEAUX },
        { k: 'nationalite', l: 'Nationalité', w: 169, opts: NATIONALITES, autre: { k: 'nationaliteAutre', l: 'Préciser autre nationalité', si: { k: 'nationalite', eq: 2 } } }
      ] },
      blocNotification(false),
      { titre: 'ANTECEDENTS MEDICO-CHIRURGICAUX DU DEFUNT (E)', style: 'multi', rows: [
        [mul('antecedents', 'Antécédents', ANT, { opt: true, cols: 7, bordure: true, autreK: 'antecedentsAutre', autreSi: { k: 'antecedents', inclut: 'Autre à préciser' } })]
      ] },
      { titre: 'AUTRES ANTECEDENTS', style: 'libre', rows: [
        [mul('autresAnt', 'Autres antécédents', ['Tabagisme', 'Alcoolisme', 'Allergie', 'Traitement chronique', 'Autre'], { opt: true, ligne: true }), txt('autresAntPrecise', 'Préciser autre', { si: { k: 'autresAnt', inclut: 'Autre' } })]
      ] },
      { titre: 'INFORMATION SUR LA MALADIE', style: 'libre', rows: [
        [dat('dateConsultation', 'Date de consultation'), dat('dateDebutMaladie', 'Date de début de la maladie')],
        [cod('lieuSoins', 'Lieu des soins', [[1, 'CS public'], [2, 'CS privé'], [3, 'HZ'], [4, 'CHD'], [5, 'CHU'], [6, 'Domicile'], [7, 'Guériseur'], [8, 'autres'], [9, 'NA']], { inline: true }),
          txt('lieuSoinsAutre', 'Préciser autres', { si: { k: 'lieuSoins', eq: 8 } })],
        [cod('refereSoins', 'Référé pour les soins', OUI_NON, { inline: true })]
      ] },
      tableInfos('INFORMATION SUR LE DECES', [
        dat('dateDeces', 'Date de décès'), heu('heureDeces', 'Heure de décès'), cod('localite', 'Localité', LOCALITE), cod('lieuDeces', 'Lieu du décès', LIEUX),
        txt('causePrincipale', 'Principale cause du décès (utiliser la Classification Internationale des Maladies, CIM11)'),
        txt('causeSecondaire', 'Cause secondaire du décès (utiliser la Classification Internationale des Maladies, CIM11)', { opt: true })
      ]),
      blocEnquete(['Décès confirmé', 'Autopsie verbale réalisée', 'autopsieVerbale'])
    ] };

  var SCHEMAS = { deces_neonatal: NEO, deces_maternel: MAT, autres_deces: AUT };

  // ---------------- 1_BJ — fiche générique (maladies) : règles seulement (le formulaire écran est dans fiche-notification.js) ----------------
  var PREL_ANY = { anyNonVide: ['prelevements', 'prelGorge', 'prelAutre'] };
  var rad = function (k, l, vals, o) { var r = f('rad', k, l, o); r.opts = vals.map(function (v) { return Array.isArray(v) ? v : [v, v]; }); return r; };
  var MALADIES = ['Rougeole', 'Fièvre Jaune', 'Choléra', 'Shigellose', 'Méningite', 'Intoxication', 'Hépatites', 'F Typhoïde', 'Syphilis End.', 'Noma', 'Dracunculose', 'Lèpre', 'Peste', 'Ulcère Buruli', 'Pian', 'Zika', 'Anthrax', 'Grippe HP', 'Autre'];
  var GEN = { id: 'maladie', code: '1_BJ', court: 'Maladie sous surveillance', titre: 'FORMULAIRE GENERIQUE DE NOTIFICATION DES MALADIES SOUS SURVEILLANCE',
    unDe: [{ ks: ['dateNaissance', 'ageAns', 'ageMois', 'ageJours'], l: 'Date de naissance ou âge' }],
    sections: [{ titre: '', rows: [
      [txt('departement', 'Département'), txt('zoneSanitaire', 'Zone sanitaire'), txt('commune', 'Commune'), txt('formationSanitaire', 'Formation sanitaire')],
      [rad('maladie', 'Maladie notifiée', MALADIES), txt('maladieAutre', 'Maladie (Autre à préciser)', { si: { k: 'maladie', eq: 'Autre' } })],
      [txt('annee', 'Année de notification'), txt('semaine', 'Semaine épidémiologique'), rad('statutEpi', 'Statut épidémiologique', ['En routine', 'En épidémie'])],
      [txt('pays', 'Pays'), arr(), txt('village', 'Ville / Village'), txt('quartier', 'Quartier'), txt('adresse', 'Adresse'), rad('zoneType', 'Urbaine / Rurale', ['U', 'R'])],
      [txt('nomPatient', 'Nom du patient'), txt('parent', 'Père / Mère'), txt('telephone', 'Téléphone'), txt('adresseParents', 'Adresse des parents / tuteurs')],
      [dat('dateNaissance', 'Date de naissance', { unDe: true }), txt('ageAns', 'Âge (ans)', { unDe: true, opt: true }), rad('sexe', 'Sexe', ['F', 'M'])],
      [rad('profession', 'Profession', PROFESSIONS.map(function (o) { return [String(o[0]), o[1]]; })), txt('professionAutre', 'Profession (Autre à préciser)', { si: { k: 'profession', eq: '11' } }),
        rad('matrimonial', 'Statut matrimonial', MATRIMONIAL.map(function (o) { return [String(o[0]), o[1]]; })), rad('niveau', 'Niveau scolaire', NIVEAUX.map(function (o) { return [String(o[0]), o[1]]; })),
        rad('nationalite', 'Nationalité', NATIONALITES.map(function (o) { return [String(o[0]), o[1]]; })), txt('nationaliteAutre', 'Nationalité (Autre à préciser)', { si: { k: 'nationalite', eq: '2' } })],
      [txt('gpsLon', 'Coordonnées GPS — Longitude'), txt('gpsLat', 'Coordonnées GPS — Latitude')],
      [dat('dateDebut', 'Date de début des symptômes'), dat('dateConsultation', 'Date de consultation'), dat('dateNotification', 'Date de notification')],
      [mul('signes', 'Signes et symptômes (au moins un)', []), rad('consultation', 'Type de consultation', ['Externe', 'Hospitalisé']), rad('evolution', 'Évolution', ['Vivant', 'Décédé', 'Inconnu']),
        rad('vaccinal', 'Statut vaccinal', ['Vacciné', 'Non vacciné']), num('nbDoses', 'Nombre de doses', { si: { k: 'vaccinal', eq: 'Vacciné' } }), dat('dateDerniereDose', 'Date de la dernière dose', { si: { k: 'vaccinal', eq: 'Vacciné' } }),
        rad('classification', 'Classification finale', ['Suspect', 'Probable', 'Confirmé par le laboratoire', 'Confirmé par lien épidémiologique', 'Confirmé cliniquement'])],
      [txt('notifNom', 'Nom du notificateur'), txt('notifTel', 'Téléphone du notificateur'), txt('notifQualif', 'Qualification')],
      [txt('aspectLcr', 'Aspect du LCR', { si: { k: 'prelevements', inclut: 'LCR' } }), dat('datePrelevement', 'Date de prélèvement', { si: PREL_ANY }), heu('heurePrelevement', 'Heure de prélèvement', { si: PREL_ANY }),
        dat('dateEnvoi', 'Date d\u2019envoi du prélèvement', { si: PREL_ANY }), heu('heureEnvoi', 'Heure d\u2019envoi', { si: PREL_ANY })]
    ] }] };
  SCHEMAS.maladie = GEN;

  // ---------------- moteur de contrôle ----------------
  function nonVide(v) { return Array.isArray(v) ? v.length > 0 : (v !== undefined && v !== null && String(v).trim() !== ''); }
  function cond(si, d) {
    if (!si) return true;
    if (Array.isArray(si)) return si.every(function (s) { return cond(s, d); });
    if (si.anyNonVide) return si.anyNonVide.some(function (k) { return nonVide(d[k]) && d[k] !== false; });
    var v = d[si.k];
    if ('eq' in si) return String(v) === String(si.eq);
    if (si['in']) return si['in'].map(String).indexOf(String(v)) !== -1;
    if ('gte' in si) return nonVide(v) && Number(v) >= si.gte;
    if ('gt' in si) return nonVide(v) && Number(v) > si.gt;
    if ('inclut' in si) return Array.isArray(v) && v.indexOf(si.inclut) !== -1;
    if (si.nonVide) return nonVide(v);
    return true;
  }
  // Liste à plat de toutes les rubriques d'un schéma (avec condition d'application héritée de la section).
  function champs(S) {
    var out = [];
    function ajoute(fd, siSection) {
      var c = {}; for (var i in fd) c[i] = fd[i];
      c.siTous = [siSection, fd.si].filter(Boolean);
      out.push(c);
    }
    S.sections.forEach(function (sec) {
      (sec.rows || []).forEach(function (row) { row.forEach(function (fd) {
        if (fd.t === 'note') return;
        ajoute(fd, sec.si);
        if (fd.t === 'multi' && fd.autreK) ajoute(txt(fd.autreK, 'Autre à préciser', { si: fd.autreSi }), sec.si);
      }); });
      (sec.cols || []).forEach(function (c) {
        ajoute({ t: 'code', k: c.k, l: c.l, opts: c.opts, si: c.si }, sec.si);
        if (c.autre) ajoute(txt(c.autre.k, c.autre.l, { si: c.autre.si }), sec.si);
      });
      (sec.champs || []).forEach(function (fd) { ajoute(fd, sec.si); });
      (sec.vars || []).forEach(function (v) { for (var i = 1; i <= 4; i++) ajoute(v.num ? num(v.k + i, v.l + ' (enfant ' + i + ')', { opt: i > 1 }) : cod(v.k + i, v.l + ' (enfant ' + i + ')', v.opts, { opt: i > 1 }), sec.si); });
    });
    return out;
  }
  var VALEURS = function (fd) { return (fd.opts || []).map(function (o) { return String(o[0]); }); };
  function manquantsDetail(type, d) {
    var S = SCHEMAS[type]; d = d || {};
    if (!S) return [{ k: '', l: 'type de fiche inconnu' }];
    var m = [];
    champs(S).forEach(function (fd) {
      if (fd.opt || fd.unDe) return;
      if (!cond(fd.siTous, d)) return;
      var v = d[fd.k], ok;
      switch (fd.t) {
        case 'arr': ok = nonVide(d.arrondissementId); break;
        case 'date': ok = /^\d{4}-\d{2}-\d{2}$/.test(String(v || '')); break;
        case 'heure': ok = /^\d{1,2}:\d{2}/.test(String(v || '')); break;
        case 'num': ok = nonVide(v) && isFinite(Number(v)) && Number(v) >= 0; break;
        case 'code': case 'rad': ok = nonVide(v) && VALEURS(fd).indexOf(String(v)) !== -1; break;
        case 'multi': ok = nonVide(v); break;
        default: ok = nonVide(v);
      }
      if (!ok) m.push({ k: fd.t === 'arr' ? 'arrondissementId' : fd.k, l: fd.l });
    });
    (S.unDe || []).forEach(function (u) { if (!u.ks.some(function (k) { return nonVide(d[k]); })) m.push({ k: u.ks[0], l: u.l, ks: u.ks }); });
    return m;
  }
  function manquants(type, d) {
    var l = manquantsDetail(type, d).map(function (x) { return x.l; });
    return l.filter(function (x, i) { return l.indexOf(x) === i; });
  }

  return { SCHEMAS: SCHEMAS, get: function (t) { return SCHEMAS[t] || null; }, types: ['maladie', 'deces_maternel', 'deces_neonatal', 'autres_deces'],
    champs: champs, cond: cond, manquants: manquants, manquantsDetail: manquantsDetail, nonVide: nonVide,
    typeDeDeces: function (typeDeces) { var t = Number(typeDeces); return t === 1 ? 'deces_maternel' : t === 2 ? 'deces_neonatal' : 'autres_deces'; },
    LISTES: { LIEUX: LIEUX, PROFESSIONS: PROFESSIONS, MATRIMONIAL: MATRIMONIAL, NIVEAUX: NIVEAUX, NATIONALITES: NATIONALITES } };
})();
if (typeof module !== 'undefined' && module.exports) module.exports = FicheSchemas;
if (typeof window !== 'undefined') window.FicheSchemas = FicheSchemas;
