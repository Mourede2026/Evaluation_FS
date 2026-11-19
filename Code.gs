/**
 * PLATEFORME DE SURVEILLANCE A BASE COMMUNAUTAIRE - BENIN
 * Backend Google Apps Script.
 * Sert d'API JSON pour le frontend (hebergé sur GitHub Pages) et
 * enregistre toutes les données dans ce classeur Google Sheets.
 *
 * INSTALLATION : voir README.md à la racine du projet.
 *
 * HIÉRARCHIE DES COMPTES (du plus haut au plus bas) :
 *   NATIONAL  → RCSE  → PF_CNLS_TP  → ASCQ  → RC
 *
 * HIÉRARCHIE GÉOGRAPHIQUE STANDARD, importée UNE FOIS par le compte NATIONAL (du plus
 * large au plus fin) :
 *   Département → Commune → Arrondissement → Village
 * Les Grappes (sous-unité de village) ne font PAS partie de cette liste nationale : elles
 * sont créées localement par les ASCQ au moment où ils enregistrent leurs RC.
 *
 * NIVEAU GÉOGRAPHIQUE DE CHAQUE COMPTE — chaque niveau administratif est rattaché à un
 * regroupement de positions du niveau immédiatement inférieur (jamais un niveau unique
 * imposé), assigné DÈS LA CRÉATION du compte par son supérieur direct, afin qu'il puisse
 * immédiatement voir et utiliser la géographie déjà importée pour paramétrer ses propres
 * subalternes (aucune étape d'assignation séparée requise avant de pouvoir travailler) :
 *   - RCSE      : une "Zone Sanitaire" = un ou plusieurs COMMUNES (pas forcément dans le
 *                 même département — les zones sanitaires du Bénin peuvent regrouper des
 *                 communes de départements différents), choisies par le NATIONAL.
 *   - PF_CNLS_TP: UNE SEULE commune, choisie par le RCSE parmi les communes de sa zone.
 *   - ASCQ      : un ou plusieurs arrondissements, choisis par le PF parmi ceux de sa commune.
 *   - RC        : UN SEUL village (choisi par l'ASCQ parmi les villages de son/ses
 *                 arrondissement(s)) et, dans ce village, une grappe principale identifiée par un
 *                 numéro de 1 à 20 (nom facultatif). Optionnellement, d'autres grappes peuvent lui
 *                 être assignées ensuite (autre grappe du même village, autre village ou autre
 *                 arrondissement de la commune de son ASCQ).
 * Le modèle de périmètre (feuille Perimetres) reste générique : TypeCible peut être
 * 'Commune' | 'Arrondissement' | 'Grappe'. Seul le PF reste limité à UNE SEULE commune ;
 * tous les autres niveaux acceptent plusieurs périmètres pour un même compte.
 */

// ============================================================
// CONFIGURATION
// ============================================================

const SHEETS = {
  USERS: 'Utilisateurs',
  DEPARTEMENTS: 'Departements',
  COMMUNES: 'Communes',
  ARRONDISSEMENTS: 'Arrondissements',
  VILLAGES: 'Villages',
  GRAPPES: 'Grappes',
  PERIMETRES: 'Perimetres',
  ALERTES: 'Alertes',
  DECES: 'Deces',
  INVESTIGATIONS: 'Investigations',
  RAPPORTS: 'RapportsHebdo',
  CALENDRIER: 'CalendrierEpi',
  NOTIFICATIONS: 'Notifications',
  SESSIONS: 'Sessions',
  JOURNAL: 'JournalAssignations',
  JOURNAL_MODIFS: 'JournalModifications',
  SUIVIS: 'SuivisGroupes',
  PLANNINGS: 'PlanningsSuivis',
  ACTIVITES: 'Activites',
  ACTIVITES_SUIVI: 'ActivitesSuivi',
  TACHES_CAS: 'TachesCas',
  TACHES_SUIVIS: 'TachesSuivis',
  SENSIBILISATIONS: 'Sensibilisations',
  PARAMETRES: 'Parametres',
  REALISATIONS: 'ActivitesRealisations',
  FICHES_NOTIF: 'FichesNotification',
  COLLECTES: 'CollecteReponses',
  COLLECTE_ANALYSES: 'CollecteAnalyses'
};

const ROLES = {
  RC: 'RC',             // Relais Communautaire (niveau : Grappe / Village)
  ASCQ: 'ASCQ',          // Agent de Santé Communautaire Qualifié (niveau : Arrondissement)
  PF: 'PF_CNLS_TP',      // Point Focal CNLS-TP (niveau : Commune)
  RCSE: 'RCSE',          // Coordination de zone sanitaire (niveau : Zone sanitaire = un groupe de communes)
  DEPARTEMENT: 'DEPARTEMENT', // Coordination départementale (niveau : Département) — chapeaute les RCSE de son département
  NATIONAL: 'NATIONAL'   // Compte national — coiffe tout, dessert les départements, gère la géographie standard
};

// Niveau géographique "typique" de chaque rôle — sert de repère pour l'UI et les
// contrôles de cohérence, mais le modèle de périmètre reste générique (voir en-tête).
const GEO_TYPIQUE = {
  [ROLES.NATIONAL]: null,
  [ROLES.RCSE]: 'Commune',       // "Zone Sanitaire" = un regroupement de communes
  [ROLES.PF]: 'Commune',
  [ROLES.ASCQ]: 'Arrondissement',
  [ROLES.RC]: 'Grappe'
};

// Qui a le droit de créer quel rôle (hiérarchie stricte à un seul niveau en dessous)
const CAN_CREATE = {
  [ROLES.NATIONAL]: [ROLES.DEPARTEMENT],
  [ROLES.DEPARTEMENT]: [ROLES.RCSE],
  [ROLES.RCSE]: [ROLES.PF],
  [ROLES.PF]: [ROLES.ASCQ],
  [ROLES.ASCQ]: [ROLES.RC]
};

const SESSION_DURATION_MS = 12 * 60 * 60 * 1000; // 12h

// Colonnes de chaque feuille (ordre = ordre des colonnes dans le Sheet)
const COLS = {
  Utilisateurs: ['ID','Nom','Prenom','Telephone','MotDePasse','Role','ResponsableId',
    'DepartementId','CommuneId','ArrondissementId','VillageId','GrappeId',
    'DepartementNom','CommuneNom','ArrondissementNom','VillageNom','GrappeNom',
    'ZoneSanitaireNom','Actif','DateCreation','CreePar','Photo','Couleur','Signature'],
  Communes: ['ID','Nom','DepartementId','DepartementNom'],
  Arrondissements: ['ID','Nom','CommuneId','CommuneNom'],
  Villages: ['ID','Nom','ArrondissementId','ArrondissementNom'],
  Grappes: ['ID','Nom','VillageId','VillageNom','Numero','NomPerso'],
  Perimetres: ['ID','UserId','TypeCible','CibleId','AssignePar','Date'],
  Alertes: ['ID','Annee','SemaineEpi','Mois','NPI','NAlerte','Departement','ZoneSanitaire',
    'CommuneId','ArrondissementId','VillageId','NGrappe','Adresse','Nom','Sexe','Telephone',
    'DateNaissance','Age','GPSLon','GPSLat','TypeAlerte','AutrePreciser','DateDebutMaladie',
    'DateNotification','Signes','PersonnesTouchees','PersonnesMortes','AnimauxMalades',
    'AnimauxMorts','EnCours','NotificateurId','NotificateurNom','Titre','CentreSante',
    'DateSaisie','Statut','InvestigationId','ClientId','HorsLigne','SynchroniseLe','ModifieParAscq','DateModification'],
  Deces: ['ID','Annee','SemaineEpi','Mois','NPI','NDeces','Departement','ZoneSanitaire',
    'CommuneId','ArrondissementId','VillageId','NGrappe','Adresse','Nom','NomParent',
    'TelephoneParent','DateNaissance','AgeAnnees','AgeMois','AgeJours','Sexe','GPSLon','GPSLat',
    'TypeDeces','DateDeces','DateNotification','LieuDeces','Circonstances','CauseProbable',
    'NotificateurId','NotificateurNom','Titre','CentreSante','DateSaisie','Statut','InvestigationId',
    'ConfirmePar','ConfirmeParNom','DateConfirmation','CommentaireConfirmation','ClientId','HorsLigne','SynchroniseLe','ModifieParAscq','DateModification'],
  Investigations: ['ID','RefType','RefId','ASCQId','Departement','ZoneSanitaire','CommuneId',
    'ArrondissementId','VillageId','Relais','TelRelais','ASCQNom','TelASCQ','GPSLon','GPSLat',
    'EvenementAvere','Source','Maladie','Description','Circonstances','DateSurvenue',
    'DateNotification','DateInvestigation','CasParCategorie','DecesParCategorie','Actions','DateSaisie'],
  RapportsHebdo: ['ID','Annee','SemaineEpi','Niveau','CompteId','CommuneId','ArrondissementId',
    'VillageId','NbAlertesDetectees','NbPersonnesTouchees','NbPersonnesDecedees',
    'NbAlertesVerifiees24_48h','NbAlertesAverees','DecesMaternel','DecesNeonatal',
    'DecesInfantile','DecesInfantoJuvenile','Deces5ansPlus','ActionsMenees','GenereLe'],
  CalendrierEpi: ['Annee','SemaineEpi','DateDebut','DateFin'],
  Notifications: ['ID','DestinataireId','Type','RefId','Message','Lu','DateCreation'],
  Sessions: ['Token','UserId','Expire'],
  JournalAssignations: ['ID','Type','CibleId','AssigneA','AssignePar','Date'],
  JournalModifications: ['ID','Date','Action','RefType','RefId','AuteurId','AuteurNom','Motif','Avant','Apres'],
  SuivisGroupes: ['ID','AscqId','AscqNom','ArrondissementId','ArrondissementNom','Date','Themes',
    'RcPresentsIds','RcPresentsNoms','NbPresents','PhotosUrls','Commentaires','DateCreation',
    'VillageIds','VillageNoms','DocumentsUrls','PlanningId','Lieu','RcConviesNoms','RcAbsentsNoms',
    'AutresPresentsIds','AutresPresentsNoms','AutresActeurs'],
  // Planning des suivis groupés (créé par l'ASCQ, visible par toute sa hiérarchie : PF, RCSE,
  // Département, National). Statut : Planifié -> Réalisé (lié au suivi enregistré) ou Annulé.
  PlanningsSuivis: ['ID','AscqId','AscqNom','ArrondissementId','ArrondissementNom','DatePrevue','Heure',
    'VillageIds','VillageNoms','Lieu','Themes','RcConviesIds','RcConviesNoms','Objectif','Statut',
    'SuiviId','DateCreation'],
  // Activités (collecte de données, formation, test...) : un niveau supérieur publie un lien pour les
  // niveaux inférieurs de SA hiérarchie. Un niveau bas ne peut jamais en demander à un niveau haut.
  Activites: ['ID','Type','Titre','Description','Lien','DateLimite','CreeParId','CreeParNom','CreeParRole',
    'CibleRoles','Statut','Commentaires','DateCreation','DateModification','Questionnaire','EnContinu','CibleCommunes','CibleArrondissements','CibleGeoLibelle'],
  ActivitesSuivi: ['ID','ActiviteId','UserId','UserNom','Statut','Date'],
  // Tâches « recensement et suivi » (activité de type tâche) : chaque cas recensé par un RC est suivi
  // pendant N jours avec un questionnaire de suivi défini par le niveau supérieur, directement dans la plateforme.
  TachesCas: ['ID','ActiviteId','RcId','RcNom','ArrondissementId','VillageId','VillageNom','Reponses',
    'DateEnregistrement','DateFinSuivi','Statut','Issue','DateCloture','DateCreation','ClientId','HorsLigne'],
  TachesSuivis: ['ID','CasId','ActiviteId','RcId','Jour','Reponses','DateSaisie','ClientId','Seance','Latitude','Longitude','Precision','DateGps'],
  // Preuves de sensibilisation communautaire envoyées par les RC (photo + liste nominative sexe/âge).
  Sensibilisations: ['ID','RcId','RcNom','ArrondissementId','VillageId','VillageNom','GrappeNom','Date','Theme','Lieu',
    'Participants','NbParticipants','NbHommes','NbFemmes','NbAdultesH','NbAdultesF','NbEnfantsG','NbEnfantsF','PhotosUrls','Commentaires','DateSaisie','ClientId','HorsLigne','SynchroniseLe',
    'Statut','ApprouveParId','ApprouveParNom','DateDecision','MotifRejet'],
  // Activités « en continu » : le destinataire les renseigne autant de fois que nécessaire (une ligne par réalisation).
  ActivitesRealisations: ['ID','ActiviteId','UserId','UserNom','Date','Nombre','Note','DateSaisie','ClientId'],
  // Réponses au questionnaire simple d'une activité « Collecte de données » (une ligne par questionnaire rempli).
  CollecteAnalyses: ['ID','ActiviteId','Genre','Titre','Config','Ordre','CreeParId','DateCreation','DateModif'],
  CollecteReponses: ['ID','ActiviteId','UserId','UserNom','Role','CommuneId','ArrondissementId','VillageNom','Lieu','Reponses','DateSaisie','ClientId','HorsLigne'],
  // Fiche générique de notification des maladies sous surveillance (« 1_BJ_FORMULAIRE GENERIQUE... »),
  // remplie par le RCSE et par l'ASCQ (les fiches de l'ASCQ remontent au RCSE dont il dépend). Donnees = JSON complet de la fiche (cases cochées + champs) ;
  // les autres colonnes sont un résumé pour la liste des cas.
  FichesNotification: ['ID','CreeParId','CreeParNom','ZoneSanitaire','Annee','SemaineEpi','Maladie','NomPatient',
    'Sexe','Age','Village','Evolution','Classification','Donnees','DateSaisie','DateModification','ClientId',
    'CreeParRole','CommuneId','CommuneNom','ArrondissementId','ArrondissementNom','TypeFiche','RefType','RefId'],
  // Paramètres de l'application (clé = ID) : ex. validationAscq = 1 / 0.
  Parametres: ['ID','Valeur','ModifieLe','ModifiePar']
};

// ============================================================
// ENTREE API
// ============================================================

function doGet(e) {
  return json_({ ok: true, message: 'API Surveillance Communautaire - opérationnelle' });
}

function doPost(e) {
  try {
    reinitialiserCacheFeuilles_(); // une exécution = un cache neuf, jamais partagé entre requêtes
    const body = JSON.parse(e.postData.contents || '{}');
    const action = body.action;
    const payload = body.payload || {};
    const token = body.token;

    ensureSchema_(); // crée les feuilles/entêtes manquants au besoin

    const PUBLIC_ACTIONS = ['login', 'ping'];
    let user = null;
    if (!PUBLIC_ACTIONS.includes(action)) {
      user = getUserByToken_(token);
      if (!user) return json_({ ok: false, error: 'Session invalide ou expirée. Reconnectez-vous.' });
    }

    const handlers = {
      ping: () => ({ ok: true }),
      login: () => login_(payload),
      logout: () => { deleteSession_(token); return { ok: true }; },
      getMe: () => ({ ok: true, user: Object.assign({}, user, { MotDePasse: undefined }) }),
      setPhoto: () => setPhoto_(user, payload),
      setSignature: () => setSignature_(user, payload),
      getTendances: () => getTendances_(user, payload),
      apercuNettoyage: () => apercuNettoyage_(user),
      nettoyerDonnees: () => nettoyerDonnees_(user, payload),

      createUser: () => createUser_(user, payload),
      updateUser: () => updateUser_(user, payload),
      deleteUser: () => deleteUser_(user, payload),
      listUsers: () => ({ ok: true, users: listUsers_(user) }),
      setUserActive: () => setUserActive_(user, payload),

      createCommune: () => createGeo_(user, 'Communes', payload, [ROLES.DEPARTEMENT, ROLES.RCSE, ROLES.NATIONAL]),
      createArrondissement: () => createGeo_(user, 'Arrondissements', payload, [ROLES.DEPARTEMENT, ROLES.RCSE, ROLES.NATIONAL]),
      createVillage: () => createGeo_(user, 'Villages', payload, [ROLES.DEPARTEMENT, ROLES.RCSE, ROLES.NATIONAL]),
      createGrappe: () => createGrappe_(user, payload),
      listGeo: () => ({ ok: true, geo: listGeo_() }),
      importGeoBulk: () => importGeoBulk_(user, payload),

      assignPerimetre: () => assignPerimetre_(user, payload),
      assignCommuneRcse: () => assignCommuneRcse_(user, payload),
      listPerimetres: () => ({ ok: true, perimetres: listPerimetres_(user) }),
      assignArrondissementAscq: () => assignArrondissementAscq_(user, payload),
      listArrondissementsAscq: () => ({ ok: true, perimetres: listArrondissementsDesAscq_(user) }),
      assignGrappeRc: () => assignGrappeRc_(user, payload),
      retirerGrappeRc: () => retirerGrappeRc_(user, payload),
      listGrappesDuRc: () => ({ ok: true, grappes: listGrappesDuRc_(user, payload) }),
      listGrappesRc: () => ({ ok: true, perimetres: listGrappesDesRc_(user) }),
      importActeursBulk: () => importActeursBulk_(user, payload),

      submitAlerte: () => avecVerrou_(() => submitAlerte_(user, payload)),
      submitDeces: () => avecVerrou_(() => submitDeces_(user, payload)),
      modifierNotificationRc: () => avecVerrou_(() => modifierNotificationRc_(user, payload)),
      supprimerNotificationRc: () => avecVerrou_(() => supprimerNotificationRc_(user, payload)),
      submitInvestigation: () => submitInvestigation_(user, payload),
      confirmerDeces: () => confirmerDeces_(user, payload),
      submitSuiviGroupe: () => submitSuiviGroupe_(user, payload),
      listSuivisGroupes: () => ({ ok: true, suivis: listSuivisGroupes_(user) }),
      getListePresence: () => getListePresence_(user, payload),
      listSuperviseurs: () => listSuperviseurs_(user),
      listAlertesValidees: () => listAlertesValidees_(user),
      createActivite: () => createActivite_(user, payload),
      updateActivite: () => updateActivite_(user, payload),
      commenterActivite: () => commenterActivite_(user, payload),
      deleteActivite: () => deleteActivite_(user, payload),
      listActivites: () => listActivites_(user),
      getActiviteDetail: () => getActiviteDetail_(user, payload),
      marquerActivite: () => marquerActivite_(user, payload),
      renseignerActivite: () => avecVerrou_(() => renseignerActivite_(user, payload)),
      listRealisations: () => listRealisations_(user, payload),
      supprimerRealisations: () => avecVerrou_(() => supprimerRealisations_(user, payload)),
      tacheEnregistrerCas: () => avecVerrou_(() => tacheEnregistrerCas_(user, payload)),
      tacheSaisirSuivi: () => avecVerrou_(() => tacheSaisirSuivi_(user, payload)),
      listTacheCas: () => listTacheCas_(user, payload),
      tacheSupprimerCas: () => avecVerrou_(() => tacheSupprimerCas_(user, payload)),
      submitSensibilisation: () => avecVerrou_(() => submitSensibilisation_(user, payload)),
      listSensibilisations: () => listSensibilisations_(user, payload),
      decideSensibilisation: () => decideSensibilisation_(user, payload),
      submitCollecte: () => avecVerrou_(() => submitCollecte_(user, payload)),
      listCollectes: () => listCollectes_(user, payload),
      supprimerCollectes: () => avecVerrou_(() => supprimerCollectes_(user, payload)),
      saveCollecteAnalyse: () => avecVerrou_(() => saveCollecteAnalyse_(user, payload)),
      supprimerCollecteAnalyse: () => avecVerrou_(() => supprimerCollecteAnalyse_(user, payload)),
      tacheSupprimerSuivis: () => avecVerrou_(() => tacheSupprimerSuivis_(user, payload)),
      saveFicheNotif: () => avecVerrou_(() => saveFicheNotif_(user, payload)),
      listFichesNotif: () => listFichesNotif_(user),
      deleteFicheNotif: () => avecVerrou_(() => deleteFicheNotif_(user, payload)),
      getParametres: () => getParametres_(user),
      setParametre: () => setParametre_(user, payload),
      submitPlanningSuivi: () => submitPlanningSuivi_(user, payload),
      updatePlanningSuivi: () => updatePlanningSuivi_(user, payload),
      listPlanningsSuivis: () => ({ ok: true, plannings: listPlanningsSuivis_(user) }),

      listAlertes: () => ({ ok: true, alertes: avecNomVillage_(listScoped_(SHEETS.ALERTES, user)) }),
      listDeces: () => ({ ok: true, deces: avecNomVillage_(listScoped_(SHEETS.DECES, user)) }),
      listInvestigations: () => ({ ok: true, investigations: listScoped_(SHEETS.INVESTIGATIONS, user) }),
      listRapports: () => ({ ok: true, rapports: listRapports_(user) }),
      listPerimetreRapport: () => ({ ok: true, perimetre: listPerimetreRapport_(user) }),
      listRapportDetail: () => Object.assign({ ok: true }, listRapportDetail_(user, payload)),

      importCalendrier: () => importCalendrier_(user, payload),
      clearCalendrier: () => clearCalendrier_(user, payload),
      listCalendrier: () => ({ ok: true, calendrier: readSheet_(SHEETS.CALENDRIER) }),

      listNotifications: () => ({ ok: true, notifications: listNotifications_(user) }),
      markNotificationRead: () => markNotificationRead_(user, payload),
      marquerToutesNotificationsLues: () => ({ ok: true, ...marquerToutesNotificationsLues_(user) }),

      getDashboard: () => ({ ok: true, dashboard: getDashboard_(user) }),
      getDashboardDetail: () => ({ ok: true, ...getDashboardDetail_(user) }),
      listCouverture: () => ({ ok: true, couverture: listCouverture_(user) }),
      genererRapportHebdo: () => genererRapportHebdo_(user, payload)
    };

    if (!handlers[action]) return json_({ ok: false, error: 'Action inconnue: ' + action });
    const result = handlers[action]();
    return json_(Object.assign({ ok: true }, result));
  } catch (err) {
    return json_({ ok: false, error: String(err && err.message ? err.message : err) });
  }
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

// ============================================================
// SCHEMA / UTILITAIRES FEUILLES
// ============================================================

function ss_() { return SpreadsheetApp.getActiveSpreadsheet(); }

// Bornes d'une journée calendaire (00h00 / 23h59:59.999) — à utiliser chaque fois qu'on compare
// une date à un intervalle [DateDebut, DateFin] (ex. semaine épidémiologique en cours) : sans
// ça, la borne de fin enregistrée à 00h00 ferait "disparaître" le dernier jour de l'intervalle
// (ex. le dimanche d'une semaine) dès qu'on dépasse minuit ce jour-là.
function debutJournee_(date) { const d = new Date(date); d.setHours(0, 0, 0, 0); return d; }
function finJournee_(date) { const d = new Date(date); d.setHours(23, 59, 59, 999); return d; }

function ensureSchema_() {
  const ss = ss_();
  Object.keys(COLS).forEach(name => {
    let sh = ss.getSheetByName(name);
    if (!sh) {
      sh = ss.insertSheet(name);
      sh.appendRow(COLS[name]);
      sh.setFrozenRows(1);
      return;
    }
    if (sh.getLastRow() === 0) {
      sh.appendRow(COLS[name]);
      sh.setFrozenRows(1);
      return;
    }
    // La feuille existe déjà et contient des données : on complète les colonnes manquantes SANS
    // toucher à ce qui existe (ni réordonner les colonnes présentes, ni effacer de données) — ça
    // "retabule" automatiquement une feuille créée avant l'ajout de certaines colonnes (ex.
    // DepartementId, GrappeId, ou une feuille entière comme SuivisGroupes) à chaque requête,
    // sans jamais rien devoir modifier à la main dans le Google Sheet.
    const largeur = sh.getLastColumn();
    const enTetesActuels = largeur > 0 ? sh.getRange(1, 1, 1, largeur).getValues()[0] : [];
    const manquantes = COLS[name].filter(c => enTetesActuels.indexOf(c) === -1);
    if (manquantes.length) {
      sh.getRange(1, largeur + 1, 1, manquantes.length).setValues([manquantes]);
      sh.setFrozenRows(1);
    }
  });
  // Compte NATIONAL racine par défaut si aucun utilisateur n'existe
  const usersSh = ss.getSheetByName(SHEETS.USERS);
  if (usersSh.getLastRow() <= 1) {
    appendRow_(SHEETS.USERS, {
      ID: 'U-NAT-0001', Nom: 'Admin', Prenom: 'National', Telephone: '61790075',
      MotDePasse: 'national2026', Role: ROLES.NATIONAL, ResponsableId: '',
      Actif: true, DateCreation: nowStr_(), CreePar: 'SYSTEME'
    });
  }
}

// Cache des feuilles lues, valable pour UNE SEULE exécution du script (une requête = une
// exécution Apps Script). Sans lui, une même feuille (ex. Utilisateurs, Alertes) pouvait être
// relue intégralement des dizaines de fois au sein d'une seule requête — en particulier lors de
// la génération des rapports hebdomadaires manquants (une semaine = plusieurs lectures
// complètes ; plusieurs semaines manquantes = ce nombre multiplié d'autant), ce qui rendait
// l'actualisation des données très lente. Réinitialisé en tête de doGet_/doPost_ (jamais réutilisé
// d'une requête à l'autre, pour ne jamais servir de données obsolètes après une écriture).
let __sheetCache_ = {};
function reinitialiserCacheFeuilles_() { __sheetCache_ = {}; __entetes_ = {}; }

function readSheet_(name) {
  if (__sheetCache_[name]) return __sheetCache_[name];
  const sh = ss_().getSheetByName(name);
  const values = sh.getDataRange().getValues();
  const headers = values.shift();
  const rows = values.filter(r => r.join('') !== '').map(row => {
    const obj = {};
    headers.forEach((h, i) => obj[h] = row[i]);
    return obj;
  });
  __sheetCache_[name] = rows;
  return rows;
}

// Invalide le cache d'une feuille après une écriture, pour qu'une relecture ultérieure DANS LA
// MÊME requête voie bien les données à jour (rare, mais certaines actions lisent puis écrivent
// plusieurs fois de suite sur la même feuille).
function invaliderCacheFeuille_(name) { delete __sheetCache_[name]; }

// Ordre réel des colonnes d'une feuille (ligne 1). ensureSchema_ AJOUTE les colonnes manquantes à la FIN d'une feuille
// existante sans réordonner : l'ordre réel peut donc différer de COLS. Écrire dans l'ordre de COLS décalerait alors
// les valeurs (ex. une date dans une colonne d'effectif). On écrit toujours selon les en-têtes réels.
let __entetes_ = {};
function entetesReels_(sheetName, sh) {
  if (__entetes_[sheetName]) return __entetes_[sheetName];
  const largeur = sh.getLastColumn();
  const h = largeur > 0 ? sh.getRange(1, 1, 1, largeur).getValues()[0].map(String) : [];
  const ok = COLS[sheetName].every(c => h.indexOf(c) !== -1);
  __entetes_[sheetName] = ok ? h : COLS[sheetName];
  return __entetes_[sheetName];
}

function appendRow_(sheetName, obj) {
  const sh = ss_().getSheetByName(sheetName);
  const headers = entetesReels_(sheetName, sh);
  const row = headers.map(h => (obj[h] !== undefined ? obj[h] : ''));
  sh.appendRow(row);
  invaliderCacheFeuille_(sheetName);
  return obj;
}

function updateRowById_(sheetName, id, changes, idField) {
  idField = idField || 'ID';
  const sh = ss_().getSheetByName(sheetName);
  const values = sh.getDataRange().getValues();
  const headers = values[0];
  const idCol = headers.indexOf(idField);
  for (let r = 1; r < values.length; r++) {
    if (String(values[r][idCol]) === String(id)) {
      // Une seule écriture pour toute la ligne (setValues sur la plage entière) plutôt qu'un
      // setValue() par champ modifié — chaque setValue() est un aller-retour à part avec
      // Google Sheets ; les regrouper accélère nettement les mises à jour (fiches
      // d'investigation, comptes utilisateurs, statuts...).
      const ligne = values[r].slice();
      headers.forEach((h, c) => { if (changes[h] !== undefined) ligne[c] = changes[h]; });
      sh.getRange(r + 1, 1, 1, headers.length).setValues([ligne]);
      invaliderCacheFeuille_(sheetName);
      return true;
    }
  }
  return false;
}

function newId_(prefix) {
  return prefix + '-' + Utilities.formatDate(new Date(), 'Africa/Porto-Novo', 'yyyyMMddHHmmss') + '-' + Math.floor(Math.random() * 900 + 100);
}

function nowStr_() {
  return Utilities.formatDate(new Date(), 'Africa/Porto-Novo', 'yyyy-MM-dd HH:mm:ss');
}

// Identifiants déterministes pour la géographie (même logique que geo-utils.js côté frontend :
// fonction slugGeo). Garantit que les IDs calculés côté client correspondent à ceux stockés ici.
function slug_(str) {
  return String(str || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function geoIds_(depNom, comNom, arrNom, vilNom, grpNom) {
  const depId = 'DEP-' + slug_(depNom);
  const comId = depId + '__COM-' + slug_(comNom);
  const arrId = comId + '__ARR-' + slug_(arrNom);
  const vilId = vilNom !== undefined ? arrId + '__VIL-' + slug_(vilNom) : undefined;
  const grpId = (vilId !== undefined && grpNom !== undefined) ? vilId + '__GRP-' + slug_(grpNom) : undefined;
  return { depId, comId, arrId, vilId, grpId };
}

// ============================================================
// AUTHENTIFICATION
// ============================================================

function login_(payload) {
  const users = readSheet_(SHEETS.USERS);
  const u = users.find(x => String(x.Telephone) === String(payload.telephone) && x.Actif !== false && x.Actif !== 'FALSE');
  if (!u) return { ok: false, error: 'Numéro de téléphone inconnu ou compte désactivé.' };
  if (String(u.MotDePasse) !== String(payload.motDePasse)) return { ok: false, error: 'Mot de passe incorrect.' };

  const token = Utilities.getUuid();
  appendRow_(SHEETS.SESSIONS, { Token: token, UserId: u.ID, Expire: Date.now() + SESSION_DURATION_MS });
  delete u.MotDePasse;
  return { ok: true, token: token, user: Object.assign({}, u, { MotDePasse: undefined }) };
}

function deleteSession_(token) {
  const sh = ss_().getSheetByName(SHEETS.SESSIONS);
  const values = sh.getDataRange().getValues();
  for (let r = values.length - 1; r >= 1; r--) {
    if (values[r][0] === token) sh.deleteRow(r + 1);
  }
}

function getUserByToken_(token) {
  if (!token) return null;
  const sessions = readSheet_(SHEETS.SESSIONS);
  const s = sessions.find(x => x.Token === token);
  if (!s || Number(s.Expire) < Date.now()) return null;
  const users = readSheet_(SHEETS.USERS);
  const u = users.find(x => x.ID === s.UserId);
  if (!u) return null;
  delete u.MotDePasse;
  return u;
}

// ============================================================
// GESTION DES UTILISATEURS (hiérarchie: NATIONAL > RCSE > PF > ASCQ > RC)
// ============================================================

function createUser_(actor, p) {
  const allowed = CAN_CREATE[actor.Role] || [];
  if (!allowed.includes(p.role)) {
    return { ok: false, error: `Un compte ${actor.Role} ne peut pas créer de compte ${p.role}.` };
  }
  if (!p.telephone || !p.motDePasse || !p.nom || !p.prenom) {
    return { ok: false, error: 'Nom, prénom, téléphone et mot de passe sont obligatoires.' };
  }
  if (p.role === ROLES.DEPARTEMENT && !p.departementId) {
    return { ok: false, error: 'Sélectionnez le département pris en charge par ce compte.' };
  }
  if (p.role === ROLES.RCSE && (!Array.isArray(p.communeIds) || !p.communeIds.length)) {
    return { ok: false, error: 'Sélectionnez au moins une commune pour composer la zone sanitaire de ce RCSE.' };
  }
  // Un compte DEPARTEMENT ne peut créer des RCSE qu'à l'intérieur de SON département : toutes
  // les communes choisies pour la zone sanitaire doivent appartenir à ce département.
  if (p.role === ROLES.RCSE && actor.Role === ROLES.DEPARTEMENT) {
    const communesSheet = readSheet_(SHEETS.COMMUNES);
    const horsDepartement = p.communeIds.some(id => {
      const c = communesSheet.find(x => x.ID === id);
      return !c || c.DepartementId !== actor.DepartementId;
    });
    if (horsDepartement) return { ok: false, error: 'Toutes les communes de la zone sanitaire doivent appartenir à votre département.' };
  }
  // Un RC n'a qu'UN SEUL village, qui doit appartenir à l'arrondissement de l'ASCQ qui le crée ; il
  // reçoit dans ce village une grappe principale (numéro de 1 à 20, nom facultatif).
  let villageRc = null, grappeRc = null;
  if (p.role === ROLES.RC) {
    if (!p.villageId) return { ok: false, error: 'Sélectionnez le village de ce relais communautaire (un seul village par RC).' };
    villageRc = readSheet_(SHEETS.VILLAGES).find(v => v.ID === p.villageId);
    if (!villageRc) return { ok: false, error: 'Village introuvable.' };
    if (!arrondissementsOfAscq_(actor.ID).includes(villageRc.ArrondissementId)) {
      return { ok: false, error: 'Le village d\'un RC doit appartenir à l\'arrondissement de l\'ASCQ qui crée son compte.' };
    }
    const grappesToutes = readSheet_(SHEETS.GRAPPES);
    let numeroRc = numeroDepuisPayload_(p);
    if (!numeroRc && !p.grappeNumero && p.grappeId) {
      numeroRc = numeroGrappe_(grappesToutes.find(g => g.ID === p.grappeId && g.VillageId === villageRc.ID));
    }
    if (!numeroRc) return { ok: false, error: 'Indiquez le numéro de la grappe de ce RC : ' + MSG_NUM_GRAPPE };
    grappeRc = trouverOuPreparerGrappe_(grappesToutes, villageRc, numeroRc, p.grappeNomPerso);
  }
  const users = readSheet_(SHEETS.USERS);
  if (users.some(u => String(u.Telephone) === String(p.telephone))) {
    return { ok: false, error: 'Ce numéro de téléphone est déjà utilisé.' };
  }
  // Le département d'un RCSE (et donc de tout ce qui est créé sous lui) vient TOUJOURS du compte
  // DEPARTEMENT qui le crée — une seule source de vérité, plutôt que d'être recalculé à partir
  // des communes choisies (ce qui pouvait produire des incohérences, ex. département affiché =
  // nom d'une commune, sur les formulaires d'alerte/décès en aval).
  const departementId = (p.role === ROLES.RCSE && actor.Role === ROLES.DEPARTEMENT) ? actor.DepartementId : (p.departementId || '');
  const departementNom = (p.role === ROLES.RCSE && actor.Role === ROLES.DEPARTEMENT) ? actor.DepartementNom : (p.departementNom || '');
  const newUser = {
    ID: newId_('U'), Nom: p.nom, Prenom: p.prenom, Telephone: p.telephone,
    MotDePasse: p.motDePasse, Role: p.role, ResponsableId: actor.ID,
    DepartementId: departementId, CommuneId: p.communeId || '',
    ArrondissementId: p.arrondissementId || '', VillageId: p.villageId || '', GrappeId: p.grappeId || '',
    DepartementNom: departementNom, CommuneNom: p.communeNom || '',
    ArrondissementNom: p.arrondissementNom || '', VillageNom: p.villageNom || '', GrappeNom: p.grappeNom || '',
    ZoneSanitaireNom: p.zoneSanitaireNom || '',
    Actif: true, DateCreation: nowStr_(), CreePar: actor.ID
  };
  if (p.role === ROLES.RC) {
    // Géographie du RC issue des enregistrements (pas du formulaire) : village unique + grappe principale.
    const grappe = enregistrerGrappe_(grappeRc);
    newUser.VillageId = villageRc.ID; newUser.VillageNom = villageRc.Nom;
    newUser.ArrondissementId = villageRc.ArrondissementId; newUser.ArrondissementNom = villageRc.ArrondissementNom;
    newUser.CommuneId = actor.CommuneId || newUser.CommuneId; newUser.CommuneNom = actor.CommuneNom || newUser.CommuneNom;
    newUser.DepartementId = actor.DepartementId || newUser.DepartementId; newUser.DepartementNom = actor.DepartementNom || newUser.DepartementNom;
    newUser.GrappeId = grappe.ID; newUser.GrappeNom = grappe.Nom;
  }
  appendRow_(SHEETS.USERS, newUser);

  // Le "poste" choisi à la création est enregistré comme un périmètre au même titre que ceux
  // qui pourront être assignés ensuite (un compte peut couvrir plusieurs positions du même
  // niveau — voir assignCommuneRcse_ / assignArrondissementAscq_ / assignGrappeRc_ — à
  // l'exception du PF CNLS-TP qui reste rattaché à une seule commune, et du DEPARTEMENT qui reste
  // rattaché à un seul département). La zone sanitaire d'un RCSE est immédiatement fonctionnelle
  // dès la création : aucune étape d'assignation séparée n'est nécessaire avant qu'il puisse voir
  // sa géographie et paramétrer ses PF.
  if (newUser.Role === ROLES.RCSE) {
    const perimRows = p.communeIds.map(comId => [newId_('PER'), newUser.ID, 'Commune', comId, actor.ID, nowStr_()]);
    appendRowsBulk_(SHEETS.PERIMETRES, perimRows);
  } else if (newUser.Role === ROLES.ASCQ && newUser.ArrondissementId) {
    appendRow_(SHEETS.PERIMETRES, {
      ID: newId_('PER'), UserId: newUser.ID, TypeCible: 'Arrondissement', CibleId: newUser.ArrondissementId,
      AssignePar: actor.ID, Date: nowStr_()
    });
  } else if (newUser.Role === ROLES.RC && newUser.GrappeId) {
    appendRow_(SHEETS.PERIMETRES, {
      ID: newId_('PER'), UserId: newUser.ID, TypeCible: 'Grappe', CibleId: newUser.GrappeId,
      AssignePar: actor.ID, Date: nowStr_()
    });
  }
  delete newUser.MotDePasse;
  return { ok: true, user: newUser };
}

// ============================================================
// IMPORT EN MASSE D'ACTEURS (RCSE, PF CNLS-TP, ASCQ, RC) PAR SITE D'INTERVENTION
// ============================================================
// Même règle de hiérarchie que createUser_ (CAN_CREATE) : NATIONAL importe des RCSE, un RCSE
// importe des PF, un PF importe des ASCQ, un ASCQ importe des RC. Chaque ligne ne fournit que
// le(s) niveau(x) géographique(s) non déjà connu(s) de l'acteur qui importe — les niveaux plus
// hauts de sa hiérarchie sont hérités automatiquement de son propre compte, exactement comme
// pour la création unitaire :
//  - NATIONAL -> RCSE  : zoneSanitaireNom + communesNoms (communes séparées par " ; ", qui
//    composent la zone sanitaire de ce RCSE — restreintes aux communes déjà importées)
//  - RCSE     -> PF    : communeNom (site = commune ; restreinte aux communes de la zone du RCSE)
//  - PF       -> ASCQ  : arrondissementNom (site = arrondissement ; département/commune = ceux du PF)
//  - ASCQ     -> RC    : villageNom (+ arrondissementNom optionnel pour désambiguïser si l'ASCQ couvre
//    plusieurs arrondissements et qu'un même nom de village existe dans plusieurs d'entre eux).
//    L'assignation d'une grappe précise à un RC importé en masse se fait ensuite via
//    assignGrappeRc_ (formulaire dédié), pour garder cet import simple.
// Les doublons (numéro de téléphone déjà utilisé — dans le Sheet ou dans le même import) sont
// ignorés et remontés dans "skipped" au lieu de faire échouer tout l'import.
function importActeursBulk_(actor, p) {
  const role = p.role;
  const allowed = CAN_CREATE[actor.Role] || [];
  if (!allowed.includes(role)) {
    return { ok: false, error: `Un compte ${actor.Role} ne peut pas importer de compte ${role}.` };
  }
  const rows = Array.isArray(p.rows) ? p.rows : [];
  if (!rows.length) return { ok: false, error: 'Aucune ligne à importer.' };

  const users = readSheet_(SHEETS.USERS);
  const existingPhones = {};
  users.forEach(u => { existingPhones[String(u.Telephone).trim()] = true; });

  let toutesCommunes = null, communesScope = null, arrsScope = null, vilsScope = null;
  if (role === ROLES.RCSE) {
    toutesCommunes = readSheet_(SHEETS.COMMUNES);
    // Un compte DEPARTEMENT ne peut importer de RCSE que dans SON département.
    if (actor.Role === ROLES.DEPARTEMENT) toutesCommunes = toutesCommunes.filter(c => c.DepartementId === actor.DepartementId);
  }
  if (role === ROLES.PF) {
    const mesCom = new Set(communesOfRcse_(actor.ID));
    communesScope = readSheet_(SHEETS.COMMUNES).filter(c => mesCom.has(c.ID));
  }
  if (role === ROLES.ASCQ) arrsScope = readSheet_(SHEETS.ARRONDISSEMENTS).filter(a => a.CommuneId === actor.CommuneId);
  if (role === ROLES.RC) {
    const mesArr = arrondissementsOfAscq_(actor.ID);
    vilsScope = readSheet_(SHEETS.VILLAGES).filter(v => mesArr.includes(v.ArrondissementId));
  }

  // Import RC : colonnes facultatives grappeNumero (1 à 20) et grappeNom (nom facultatif). Si la
  // colonne grappeNumero est présente, elle est obligatoire pour chaque ligne.
  const grappesCache = role === ROLES.RC ? readSheet_(SHEETS.GRAPPES).slice() : [];
  const nouvellesGrappes = [], majGrappes = [];
  const newUserRows = [];
  const newPerimetreRows = [];
  const skipped = [];
  const seenPhones = {};
  let created = 0;

  rows.forEach((row, idx) => {
    const line = idx + 1;
    const nom = String(row.nom || '').trim();
    const prenom = String(row.prenom || '').trim();
    const telephone = String(row.telephone || '').trim();
    const motDePasse = String(row.motDePasse || '').trim();
    if (!nom || !prenom || !telephone || !motDePasse) {
      skipped.push({ line, raison: 'Nom, prénom, téléphone ou mot de passe manquant.' }); return;
    }
    if (existingPhones[telephone] || seenPhones[telephone]) {
      skipped.push({ line, raison: `Téléphone ${telephone} déjà utilisé (doublon).` }); return;
    }

    let dep = { id: '', nom: '' }, com = { id: '', nom: '' }, arr = { id: '', nom: '' }, vil = { id: '', nom: '' };
    let zoneSanitaireNom = '', communeIdsRcse = [];
    let grappeImport = null;

    if (role === ROLES.RCSE) {
      zoneSanitaireNom = String(row.zoneSanitaireNom || '').trim();
      const communesNoms = String(row.communesNoms || '').split(';').map(s => s.trim()).filter(Boolean);
      if (!zoneSanitaireNom || !communesNoms.length) { skipped.push({ line, raison: 'Nom de la zone sanitaire et au moins une commune requis (communes séparées par ";").' }); return; }
      const introuvables = [];
      communesNoms.forEach(cn => {
        const c = toutesCommunes.find(x => x.Nom.toLowerCase() === cn.toLowerCase());
        if (c) communeIdsRcse.push(c.ID); else introuvables.push(cn);
      });
      if (introuvables.length) { skipped.push({ line, raison: `Commune(s) introuvable(s) (ou hors de votre département) : ${introuvables.join(', ')}.` }); return; }
      // Le département d'un RCSE vient toujours du compte DEPARTEMENT qui l'importe (une seule
      // source de vérité — voir createUser_).
      if (actor.Role === ROLES.DEPARTEMENT) dep = { id: actor.DepartementId, nom: actor.DepartementNom };
    } else if (role === ROLES.PF) {
      const comNom = String(row.communeNom || '').trim();
      if (!comNom) { skipped.push({ line, raison: 'Commune requise.' }); return; }
      const c = communesScope.find(x => x.Nom.toLowerCase() === comNom.toLowerCase());
      if (!c) { skipped.push({ line, raison: `Commune "${comNom}" introuvable dans votre/vos département(s).` }); return; }
      dep = { id: c.DepartementId, nom: c.DepartementNom }; com = { id: c.ID, nom: c.Nom };
    } else if (role === ROLES.ASCQ) {
      const arrNom = String(row.arrondissementNom || '').trim();
      if (!arrNom) { skipped.push({ line, raison: 'Arrondissement requis.' }); return; }
      const a = arrsScope.find(x => x.Nom.toLowerCase() === arrNom.toLowerCase());
      if (!a) { skipped.push({ line, raison: `Arrondissement "${arrNom}" introuvable dans votre commune.` }); return; }
      dep = { id: actor.DepartementId, nom: actor.DepartementNom }; com = { id: actor.CommuneId, nom: actor.CommuneNom };
      arr = { id: a.ID, nom: a.Nom };
    } else if (role === ROLES.RC) {
      const vilNom = String(row.villageNom || '').trim();
      const arrHint = String(row.arrondissementNom || '').trim();
      if (!vilNom) { skipped.push({ line, raison: 'Village requis.' }); return; }
      let matches = vilsScope.filter(x => x.Nom.toLowerCase() === vilNom.toLowerCase());
      if (matches.length > 1 && arrHint) matches = matches.filter(x => x.ArrondissementNom.toLowerCase() === arrHint.toLowerCase());
      if (!matches.length) { skipped.push({ line, raison: `Village "${vilNom}" introuvable dans votre/vos arrondissement(s).` }); return; }
      if (matches.length > 1) { skipped.push({ line, raison: `Village "${vilNom}" ambigu (plusieurs arrondissements) — précisez la colonne Arrondissement.` }); return; }
      const v = matches[0];
      dep = { id: actor.DepartementId, nom: actor.DepartementNom }; com = { id: actor.CommuneId, nom: actor.CommuneNom };
      arr = { id: v.ArrondissementId, nom: v.ArrondissementNom }; vil = { id: v.ID, nom: v.Nom };
      if (row.grappeNumero !== undefined) {
        const numero = lireNumeroGrappe_(row.grappeNumero);
        if (!numero) { skipped.push({ line, raison: MSG_NUM_GRAPPE }); return; }
        const res = trouverOuPreparerGrappe_(grappesCache, v, numero, row.grappeNom);
        grappeImport = res.grappe;
        if (res.nouvelle) { nouvellesGrappes.push(res.grappe); grappesCache.push(res.grappe); }
        else if (res.modifiee) { Object.assign(res.grappe, res.modifiee); majGrappes.push({ id: res.grappe.ID, changes: res.modifiee }); }
      }
    }

    const newUser = {
      ID: newId_('U') + '-' + idx, Nom: nom, Prenom: prenom, Telephone: telephone, MotDePasse: motDePasse,
      Role: role, ResponsableId: actor.ID,
      DepartementId: dep.id, CommuneId: com.id, ArrondissementId: arr.id, VillageId: vil.id, GrappeId: grappeImport ? grappeImport.ID : '',
      DepartementNom: dep.nom, CommuneNom: com.nom, ArrondissementNom: arr.nom, VillageNom: vil.nom, GrappeNom: grappeImport ? grappeImport.Nom : '',
      ZoneSanitaireNom: zoneSanitaireNom,
      Actif: true, DateCreation: nowStr_(), CreePar: actor.ID
    };
    newUserRows.push(COLS.Utilisateurs.map(h => (newUser[h] !== undefined ? newUser[h] : '')));
    if (role === ROLES.RCSE && communeIdsRcse.length) {
      communeIdsRcse.forEach(comId => {
        const perimetre = { ID: newId_('PER') + '-' + idx + '-' + comId, UserId: newUser.ID, TypeCible: 'Commune', CibleId: comId, AssignePar: actor.ID, Date: nowStr_() };
        newPerimetreRows.push(COLS.Perimetres.map(h => (perimetre[h] !== undefined ? perimetre[h] : '')));
      });
    } else if (role === ROLES.ASCQ && arr.id) {
      const perimetre = { ID: newId_('PER') + '-' + idx, UserId: newUser.ID, TypeCible: 'Arrondissement', CibleId: arr.id, AssignePar: actor.ID, Date: nowStr_() };
      newPerimetreRows.push(COLS.Perimetres.map(h => (perimetre[h] !== undefined ? perimetre[h] : '')));
    } else if (role === ROLES.RC && grappeImport) {
      const perimetre = { ID: newId_('PER') + '-' + idx, UserId: newUser.ID, TypeCible: 'Grappe', CibleId: grappeImport.ID, AssignePar: actor.ID, Date: nowStr_() };
      newPerimetreRows.push(COLS.Perimetres.map(h => (perimetre[h] !== undefined ? perimetre[h] : '')));
    }
    seenPhones[telephone] = true;
    created++;
  });

  if (nouvellesGrappes.length) appendRowsBulk_(SHEETS.GRAPPES, nouvellesGrappes.map(g => COLS.Grappes.map(h => (g[h] !== undefined ? g[h] : ''))));
  majGrappes.forEach(m => updateRowById_(SHEETS.GRAPPES, m.id, m.changes));
  if (newUserRows.length) appendRowsBulk_(SHEETS.USERS, newUserRows);
  if (newPerimetreRows.length) appendRowsBulk_(SHEETS.PERIMETRES, newPerimetreRows);

  return { ok: true, created, skipped };
}

// Modifier ou supprimer un compte est réservé à celui qui l'a créé LUI-MÊME (CreePar) — pas à
// tout superviseur indirect — ainsi qu'au compte NATIONAL qui gère l'ensemble de la plateforme.
// C'est plus restrictif que isSupervisorOf_ (qui autorise toute la chaîne au-dessus), utilisé
// lui pour la simple activation/désactivation et pour la visibilité en lecture.
function canManageUser_(actor, target) {
  return actor.Role === ROLES.NATIONAL || target.CreePar === actor.ID;
}

function updateUser_(actor, p) {
  const users = readSheet_(SHEETS.USERS);
  const target = users.find(u => u.ID === p.id);
  if (!target) return { ok: false, error: 'Utilisateur introuvable.' };
  // Modifier (corriger nom/téléphone/géo/mot de passe) est autorisé pour TOUT superviseur, direct
  // ou indirect (ex. un RCSE peut corriger un ASCQ ou un RC de sa zone, pas seulement les comptes
  // qu'il a personnellement créés) — contrairement à la suppression, qui reste réservée au
  // créateur direct (canManageUser_), plus destructrice.
  if (!isSupervisorOf_(actor, target) && actor.ID !== target.ID) {
    return { ok: false, error: 'Non autorisé à modifier ce compte : il ne dépend pas de vous.' };
  }
  const changes = {};
  ['Nom', 'Prenom', 'Telephone'].forEach(f => { if (p[f] !== undefined) changes[f] = p[f]; });
  // Couleur du thème : préférence strictement personnelle (chacun ne modifie que la sienne).
  if (p.Couleur !== undefined && actor.ID === target.ID) {
    const couleur = String(p.Couleur || '').trim();
    if (!/^[A-Za-z0-9#_-]{0,24}$/.test(couleur)) return { ok: false, error: 'Couleur de thème invalide.' };
    changes.Couleur = couleur;
  }
  // Les champs géographiques arrivent en camelCase (departementId, communeNom...) — même
  // convention que createUser_ — et non en PascalCase comme les colonnes du Sheet ; on les
  // fait donc correspondre explicitement plutôt que de comparer les noms tels quels.
  const champsGeo = {
    departementId: 'DepartementId', departementNom: 'DepartementNom',
    communeId: 'CommuneId', communeNom: 'CommuneNom',
    arrondissementId: 'ArrondissementId', arrondissementNom: 'ArrondissementNom',
    villageId: 'VillageId', villageNom: 'VillageNom',
    grappeId: 'GrappeId', grappeNom: 'GrappeNom'
  };
  Object.keys(champsGeo).forEach(f => { if (p[f] !== undefined) changes[champsGeo[f]] = p[f]; });
  if (p.motDePasse) changes.MotDePasse = p.motDePasse;

  // Règles propres au RC : un SEUL village (dans l'arrondissement de son ASCQ) et une grappe
  // principale dans ce village (numéro 1 à 20, nom facultatif). Changer de village impose d'indiquer
  // le numéro de la grappe principale dans le nouveau village ; les grappes supplémentaires
  // (optionnelles) se gèrent à part (assignGrappeRc_ / retirerGrappeRc_).
  if (target.Role === ROLES.RC) {
    const villageDemande = p.villageId ? String(p.villageId) : '';
    const villageChange = !!villageDemande && villageDemande !== target.VillageId;
    // Un RC garde toujours un village : un village vide dans le formulaire n'efface rien.
    if (!villageDemande) { delete changes.VillageId; delete changes.VillageNom; delete changes.ArrondissementId; delete changes.ArrondissementNom; }
    const numeroSaisi = p.grappeNumero !== undefined && String(p.grappeNumero).trim() !== '';
    const numeroDemande = numeroSaisi ? lireNumeroGrappe_(p.grappeNumero) : null;
    if (numeroSaisi && !numeroDemande) return { ok: false, error: MSG_NUM_GRAPPE };
    if (villageChange || numeroDemande) {
      const village = readSheet_(SHEETS.VILLAGES).find(v => v.ID === (villageDemande || target.VillageId));
      if (!village) return { ok: false, error: 'Village introuvable.' };
      if (villageChange) {
        const arrAscq = target.ResponsableId ? arrondissementsOfAscq_(target.ResponsableId) : [];
        if (arrAscq.length && !arrAscq.includes(village.ArrondissementId)) {
          return { ok: false, error: 'Le village d\'un RC doit appartenir à l\'arrondissement de son ASCQ.' };
        }
      }
      const grappes = readSheet_(SHEETS.GRAPPES);
      const ancienne = target.GrappeId ? grappes.find(g => g.ID === target.GrappeId) : null;
      if (!numeroDemande && ancienne && ancienne.VillageId !== village.ID) {
        return { ok: false, error: 'Ce RC change de village : indiquez le numéro (1 à 20) de sa grappe principale dans le nouveau village.' };
      }
      if (numeroDemande) {
        const grappe = enregistrerGrappe_(trouverOuPreparerGrappe_(grappes, village, numeroDemande, p.grappeNomPerso));
        if (grappe.ID !== target.GrappeId) {
          const perims = readSheet_(SHEETS.PERIMETRES);
          if (target.GrappeId) {
            const ancien = perims.find(x => x.UserId === target.ID && x.TypeCible === 'Grappe' && x.CibleId === target.GrappeId);
            if (ancien) deleteRowById_(SHEETS.PERIMETRES, ancien.ID);
          }
          if (!perims.some(x => x.UserId === target.ID && x.TypeCible === 'Grappe' && x.CibleId === grappe.ID)) {
            appendRow_(SHEETS.PERIMETRES, { ID: newId_('PER'), UserId: target.ID, TypeCible: 'Grappe', CibleId: grappe.ID, AssignePar: actor.ID, Date: nowStr_() });
          }
        }
        changes.GrappeId = grappe.ID; changes.GrappeNom = grappe.Nom;
      }
      changes.VillageId = village.ID; changes.VillageNom = village.Nom;
      changes.ArrondissementId = village.ArrondissementId; changes.ArrondissementNom = village.ArrondissementNom;
    }
  }
  updateRowById_(SHEETS.USERS, p.id, changes);
  return { ok: true };
}

// Supprime définitivement un compte que l'acteur a lui-même créé (ou n'importe quel compte pour
// le NATIONAL). Refusé si ce compte a lui-même créé des comptes en dessous (il faut d'abord les
// supprimer ou les réattribuer, pour ne jamais casser la chaîne hiérarchique de notification).
// Supprime aussi ses sessions actives (déconnexion immédiate) et ses périmètres assignés ; les
// alertes/décès/investigations déjà notifiés par ce compte restent dans l'historique tels quels.
function deleteUser_(actor, p) {
  const users = readSheet_(SHEETS.USERS);
  const target = users.find(u => u.ID === p.id);
  if (!target) return { ok: false, error: 'Utilisateur introuvable.' };
  if (target.ID === actor.ID) return { ok: false, error: 'Vous ne pouvez pas supprimer votre propre compte.' };
  if (target.Role === ROLES.NATIONAL) return { ok: false, error: 'Un compte national ne peut pas être supprimé.' };
  // Tout compte SUPÉRIEUR (direct ou non) peut supprimer un compte de sa descendance ; le national peut tout supprimer.
  if (!isSupervisorOf_(actor, target)) return { ok: false, error: 'Non autorisé : ce compte ne fait pas partie de votre hiérarchie.' };

  // Comptes en dessous de la cible (toute la descendance)
  const aSupprimer = [target];
  for (let k = 0; k < aSupprimer.length; k++) {
    users.filter(u => u.ResponsableId === aSupprimer[k].ID && !aSupprimer.includes(u)).forEach(u => aSupprimer.push(u));
  }
  const subordonnes = aSupprimer.slice(1);
  // Aperçu (sans rien supprimer) : sert à demander une confirmation éclairée côté interface.
  if (p.apercu) return { ok: true, nbSubordonnes: subordonnes.length, subordonnes: subordonnes.map(u => `${u.Prenom} ${u.Nom} (${u.Role})`) };
  if (subordonnes.length && !p.cascade) {
    return { ok: false, error: `Ce compte a ${subordonnes.length} compte(s) en dessous de lui : confirmez la suppression de l'ensemble pour continuer.` };
  }

  const ids = new Set(aSupprimer.map(u => u.ID));
  // Une seule passe par feuille (rapide, même pour beaucoup de comptes) — les lignes sont réellement
  // supprimées du classeur, pas seulement masquées.
  deleteRowsWhereIn_(SHEETS.USERS, 'ID', ids);
  deleteRowsWhereIn_(SHEETS.SESSIONS, 'UserId', ids);
  deleteRowsWhereIn_(SHEETS.PERIMETRES, 'UserId', ids);
  deleteRowsWhereIn_(SHEETS.NOTIFICATIONS, 'DestinataireId', ids);
  return { ok: true, supprimes: aSupprimer.length };
}
// Supprime toutes les lignes d'une feuille dont la colonne `field` est dans l'ensemble `valeurs`.
function deleteRowsWhereIn_(sheetName, field, valeurs) {
  const sh = ss_().getSheetByName(sheetName);
  const values = sh.getDataRange().getValues();
  const col = values[0].indexOf(field);
  if (col < 0) return;
  for (let r = values.length - 1; r >= 1; r--) {
    if (valeurs.has(String(values[r][col]))) sh.deleteRow(r + 1);
  }
  invaliderCacheFeuille_(sheetName);
}

// Supprime la première ligne dont idField correspond à id. Retourne true si une ligne a été supprimée.
function deleteRowById_(sheetName, id, idField) {
  idField = idField || 'ID';
  const sh = ss_().getSheetByName(sheetName);
  const values = sh.getDataRange().getValues();
  const headers = values[0];
  const idCol = headers.indexOf(idField);
  for (let r = 1; r < values.length; r++) {
    if (String(values[r][idCol]) === String(id)) { sh.deleteRow(r + 1); invaliderCacheFeuille_(sheetName); return true; }
  }
  return false;
}

// Supprime TOUTES les lignes dont la colonne field correspond à value.
function deleteRowsWhere_(sheetName, field, value) {
  const sh = ss_().getSheetByName(sheetName);
  const values = sh.getDataRange().getValues();
  const headers = values[0];
  const col = headers.indexOf(field);
  if (col < 0) return;
  for (let r = values.length - 1; r >= 1; r--) {
    if (String(values[r][col]) === String(value)) sh.deleteRow(r + 1);
  }
  invaliderCacheFeuille_(sheetName);
}

// Active ou désactive un compte. Autorisé pour tout superviseur (direct ou indirect) du compte
// cible, à n'importe quel niveau de la hiérarchie (NATIONAL peut désactiver n'importe qui, un
// RCSE peut désactiver ses PF et leur descendance, un PF ses ASCQ et leurs RC, etc.)
function setUserActive_(actor, p) {
  const users = readSheet_(SHEETS.USERS);
  const target = users.find(u => u.ID === p.id);
  if (!target) return { ok: false, error: 'Utilisateur introuvable.' };
  if (target.ID === actor.ID) return { ok: false, error: 'Vous ne pouvez pas désactiver votre propre compte.' };
  if (!isSupervisorOf_(actor, target)) return { ok: false, error: 'Non autorisé : ce compte ne dépend pas de vous.' };
  updateRowById_(SHEETS.USERS, p.id, { Actif: !!p.active });
  return { ok: true };
}

// actor est-il au-dessus de target dans la hiérarchie (direct ou indirect) ?
function isSupervisorOf_(actor, target) {
  const users = readSheet_(SHEETS.USERS);
  let cur = target;
  let guard = 0;
  while (cur && cur.ResponsableId && guard < 10) {
    if (cur.ResponsableId === actor.ID) return true;
    cur = users.find(u => u.ID === cur.ResponsableId);
    guard++;
  }
  return actor.Role === ROLES.NATIONAL; // NATIONAL voit/gère tout
}

// Liste des utilisateurs visibles pour actor (lui + toute sa descendance hiérarchique)
function listUsers_(actor) {
  const users = readSheet_(SHEETS.USERS);
  users.forEach(u => { delete u.MotDePasse; delete u.Photo; delete u.Signature; });
  if (actor.Role === ROLES.NATIONAL) return users;
  return users.filter(u => u.ID === actor.ID || isSupervisorOf_(actor, u));
}

// Remonte la chaîne hiérarchique complète d'un utilisateur (superviseur direct, puis le sien, etc.)
function chainAbove_(user) {
  const users = readSheet_(SHEETS.USERS);
  const chain = [];
  let cur = user;
  let guard = 0;
  while (cur && cur.ResponsableId && guard < 10) {
    const sup = users.find(u => u.ID === cur.ResponsableId);
    if (!sup) break;
    chain.push(sup);
    cur = sup;
    guard++;
  }
  return chain;
}

// ============================================================
// GEOGRAPHIE : Départements / Communes / Arrondissements / Villages / Grappes
// ============================================================
// Les départements n'ont pas de feuille dédiée (ils n'existent, historiquement, qu'implicitement
// via Communes.DepartementId/DepartementNom) : listDepartements_ en extrait la liste distincte.

function listDepartements_() {
  const communes = readSheet_(SHEETS.COMMUNES);
  const seen = {};
  const out = [];
  communes.forEach(c => {
    if (!seen[c.DepartementId]) { seen[c.DepartementId] = true; out.push({ id: c.DepartementId, nom: c.DepartementNom }); }
  });
  return out;
}

function createGeo_(actor, sheetName, p, allowedRoles) {
  if (!allowedRoles.includes(actor.Role)) return { ok: false, error: 'Non autorisé.' };
  let obj;
  if (sheetName === 'Communes') {
    const { depId, comId } = geoIds_(p.departementNom, p.nom);
    obj = { ID: comId, Nom: p.nom, DepartementId: depId, DepartementNom: p.departementNom };
  } else if (sheetName === 'Arrondissements') {
    obj = { ID: p.communeId + '__ARR-' + slug_(p.nom), Nom: p.nom, CommuneId: p.communeId, CommuneNom: p.communeNom || '' };
  } else if (sheetName === 'Villages') {
    obj = { ID: p.arrondissementId + '__VIL-' + slug_(p.nom), Nom: p.nom, ArrondissementId: p.arrondissementId, ArrondissementNom: p.arrondissementNom || '' };
  } else {
    return { ok: false, error: 'Type de géographie non géré ici (les grappes passent par createGrappe_).' };
  }
  const existing = readSheet_(sheetName);
  if (existing.some(x => x.ID === obj.ID)) return { ok: false, error: 'Cet élément existe déjà.' };
  appendRow_(sheetName, obj);
  return { ok: true, item: obj };
}

// Import en masse de toute la structure administrative (Département > Commune > Arrondissement >
// Village) depuis le fichier national, en une seule écriture par feuille (rapide, même pour
// plusieurs milliers de villages). Réservé au compte NATIONAL, qui "coiffe" toute la géographie
// standard du pays. Les doublons (même ID déterministe) sont ignorés.
function importGeoBulk_(actor, p) {
  if (actor.Role !== ROLES.NATIONAL) return { ok: false, error: 'Seul le compte national peut importer la structure administrative.' };
  const departements = p.departements || [];

  const existingCommunes = readSheet_(SHEETS.COMMUNES);
  const existingArrs = readSheet_(SHEETS.ARRONDISSEMENTS);
  const existingVillages = readSheet_(SHEETS.VILLAGES);
  const seenCom = new Set(existingCommunes.map(x => x.ID));
  const seenArr = new Set(existingArrs.map(x => x.ID));
  const seenVil = new Set(existingVillages.map(x => x.ID));

  const newCommunes = [], newArrs = [], newVillages = [];

  departements.forEach(dep => {
    const depId = 'DEP-' + slug_(dep.nom);
    (dep.communes || []).forEach(com => {
      const comId = depId + '__COM-' + slug_(com.nom);
      if (!seenCom.has(comId)) { seenCom.add(comId); newCommunes.push([comId, com.nom, depId, dep.nom]); }
      (com.arrondissements || []).forEach(arr => {
        const arrId = comId + '__ARR-' + slug_(arr.nom);
        if (!seenArr.has(arrId)) { seenArr.add(arrId); newArrs.push([arrId, arr.nom, comId, com.nom]); }
        (arr.villages || []).forEach(vilNom => {
          const vilId = arrId + '__VIL-' + slug_(vilNom);
          if (!seenVil.has(vilId)) { seenVil.add(vilId); newVillages.push([vilId, vilNom, arrId, arr.nom]); }
        });
      });
    });
  });

  appendRowsBulk_(SHEETS.COMMUNES, newCommunes);
  appendRowsBulk_(SHEETS.ARRONDISSEMENTS, newArrs);
  appendRowsBulk_(SHEETS.VILLAGES, newVillages);

  return { ok: true, communes: newCommunes.length, arrondissements: newArrs.length, villages: newVillages.length };
}

// Ecriture en masse (beaucoup plus rapide que plusieurs appendRow_ successifs)
function appendRowsBulk_(sheetName, rows) {
  if (!rows.length) return;
  const sh = ss_().getSheetByName(sheetName);
  const startRow = sh.getLastRow() + 1;
  sh.getRange(startRow, 1, rows.length, rows[0].length).setValues(rows);
  invaliderCacheFeuille_(sheetName);
}

function listGeo_() {
  return {
    departements: listDepartements_(),
    communes: readSheet_(SHEETS.COMMUNES),
    arrondissements: readSheet_(SHEETS.ARRONDISSEMENTS),
    villages: readSheet_(SHEETS.VILLAGES),
    grappes: readSheet_(SHEETS.GRAPPES)
  };
}


// ============================================================
// GRAPPES — identifiées par un NUMÉRO de 1 à 20 (un village compte au plus 20 grappes), avec un
// nom facultatif. Clé fonctionnelle = (village, numéro) : on réutilise la grappe si elle existe
// déjà, sinon on la crée. Colonnes : Numero (entier) et NomPerso (nom facultatif) ; Nom reste le
// libellé affiché partout ("Grappe 3" ou "Grappe 3 – Quartier du marché"). Les anciennes grappes
// (sans colonne Numero, nommées "Grappe 3") restent reconnues grâce au chiffre de leur nom.
// ============================================================
const GRAPPE_NUM_MAX = 20;
const MSG_NUM_GRAPPE = 'Le numéro de grappe doit être un nombre entier compris entre 1 et 20.';

function numeroGrappe_(g) {
  if (!g) return null;
  const n = parseInt(g.Numero, 10);
  if (!isNaN(n) && n > 0) return n;
  const m = String(g.Nom || '').match(/(\d+)/);
  return m ? parseInt(m[1], 10) : null;
}

function libelleGrappe_(numero, nomPerso) {
  return 'Grappe ' + numero + (nomPerso ? ' – ' + nomPerso : '');
}

function lireNumeroGrappe_(valeur) {
  const s = String(valeur === undefined || valeur === null ? '' : valeur).trim();
  if (!/^\d+$/.test(s)) return null;
  const n = parseInt(s, 10);
  return (n >= 1 && n <= GRAPPE_NUM_MAX) ? n : null;
}

// Numéro de grappe reçu dans une requête : champ grappeNumero (nouveau) ou, pour les anciennes
// versions de l'application encore en cache, le chiffre contenu dans un libellé "Grappe 3".
function numeroDepuisPayload_(p) {
  const brut = p.grappeNumero;
  if (brut !== undefined && String(brut).trim() !== '') return lireNumeroGrappe_(brut);
  const m = String(p.grappeNom || p.nom || '').match(/(\d+)/);
  return m ? lireNumeroGrappe_(m[1]) : null;
}

// Prépare (sans rien écrire) la grappe (village, numéro) : existante (éventuellement à renommer)
// ou nouvelle. enregistrerGrappe_ persiste ensuite le résultat.
function trouverOuPreparerGrappe_(grappes, village, numero, nomPerso) {
  nomPerso = String(nomPerso || '').trim().slice(0, 60);
  const existante = (grappes || []).find(g => g.VillageId === village.ID && numeroGrappe_(g) === numero);
  if (existante) {
    const changes = {};
    if (existante.Numero === '' || existante.Numero === undefined || parseInt(existante.Numero, 10) !== numero) changes.Numero = numero;
    if (nomPerso && nomPerso !== (existante.NomPerso || '')) {
      changes.NomPerso = nomPerso;
      changes.Nom = libelleGrappe_(numero, nomPerso);
    }
    return { grappe: existante, modifiee: Object.keys(changes).length ? changes : null };
  }
  return {
    nouvelle: true,
    grappe: { ID: village.ID + '__GRP-' + numero, Nom: libelleGrappe_(numero, nomPerso), VillageId: village.ID,
              VillageNom: village.Nom, Numero: numero, NomPerso: nomPerso }
  };
}

function enregistrerGrappe_(res) {
  if (res.nouvelle) appendRow_(SHEETS.GRAPPES, res.grappe);
  else if (res.modifiee) { updateRowById_(SHEETS.GRAPPES, res.grappe.ID, res.modifiee); Object.assign(res.grappe, res.modifiee); }
  return res.grappe;
}

// Création/réutilisation d'une grappe depuis l'API (numéro obligatoire, nom facultatif).
function createGrappe_(actor, p) {
  if (![ROLES.ASCQ, ROLES.PF, ROLES.RCSE, ROLES.DEPARTEMENT, ROLES.NATIONAL].includes(actor.Role)) return { ok: false, error: 'Non autorisé.' };
  const village = readSheet_(SHEETS.VILLAGES).find(v => v.ID === p.villageId);
  if (!village) return { ok: false, error: 'Village introuvable.' };
  const numero = numeroDepuisPayload_(p);
  if (!numero) return { ok: false, error: MSG_NUM_GRAPPE };
  const res = trouverOuPreparerGrappe_(readSheet_(SHEETS.GRAPPES), village, numero, p.grappeNomPerso !== undefined ? p.grappeNomPerso : p.nomPerso);
  return { ok: true, item: enregistrerGrappe_(res), existait: !res.nouvelle };
}

// Commune de l'ASCQ responsable d'un RC (repli : commune enregistrée sur le RC lui-même).
function communeDuRc_(users, rc) {
  const ascq = users.find(u => u.ID === rc.ResponsableId);
  return (ascq && ascq.CommuneId) || rc.CommuneId || '';
}

// ============================================================
// PÉRIMÈTRES / ASSIGNATIONS — un niveau d'assignation par palier de la hiérarchie.
// Chaque fonction : (1) vérifie que l'acteur est bien le superviseur direct attendu pour ce
// palier, (2) vérifie que la cible appartient bien au propre périmètre de l'acteur (visibilité
// en cascade — on ne peut assigner que ce qu'on voit soi-même), (3) journalise l'assignation.
// ============================================================

// NATIONAL assigne une commune supplémentaire à la zone sanitaire d'un compte RCSE (une zone
// sanitaire peut regrouper des communes de départements différents ; plusieurs communes possibles
// pour un même RCSE, comme pour les arrondissements d'un ASCQ ou les grappes d'un RC).
function assignCommuneRcse_(actor, p) {
  if (actor.Role !== ROLES.NATIONAL && actor.Role !== ROLES.DEPARTEMENT) return { ok: false, error: 'Seul un compte Département (ou national) peut assigner une commune à une zone sanitaire.' };
  const users = readSheet_(SHEETS.USERS);
  const target = users.find(u => u.ID === p.userId);
  if (!target || target.Role !== ROLES.RCSE) return { ok: false, error: 'Compte RCSE introuvable.' };
  if (!p.communeId) return { ok: false, error: 'Commune manquante.' };
  if (actor.Role === ROLES.DEPARTEMENT) {
    if (target.DepartementId !== actor.DepartementId) return { ok: false, error: 'Ce RCSE ne dépend pas de votre département.' };
    const commune = readSheet_(SHEETS.COMMUNES).find(c => c.ID === p.communeId);
    if (!commune || commune.DepartementId !== actor.DepartementId) return { ok: false, error: 'Cette commune n\'appartient pas à votre département.' };
  }
  const dejaAssigne = readSheet_(SHEETS.PERIMETRES).some(x => x.UserId === target.ID && x.TypeCible === 'Commune' && x.CibleId === p.communeId);
  if (dejaAssigne) return { ok: false, error: 'Cette commune est déjà assignée à la zone sanitaire de ce RCSE.' };
  const entry = { ID: newId_('PER'), UserId: target.ID, TypeCible: 'Commune', CibleId: p.communeId, AssignePar: actor.ID, Date: nowStr_() };
  appendRow_(SHEETS.PERIMETRES, entry);
  appendRow_(SHEETS.JOURNAL, { ID: newId_('LOG'), Type: 'Commune', CibleId: p.communeId, AssigneA: target.ID, AssignePar: actor.ID, Date: nowStr_() });
  return { ok: true, perimetre: entry };
}

// RCSE assigne des arrondissements aux PF CNLS-TP des communes de sa zone sanitaire.
// (Conservé tel quel dans son principe : c'est le mécanisme historique. Seule la portée du
// contrôle change — la cible doit désormais appartenir aux communes de la zone du RCSE.)
function assignPerimetre_(actor, p) {
  if (actor.Role !== ROLES.RCSE) return { ok: false, error: 'Seul un RCSE peut assigner un périmètre à un PF.' };
  const users = readSheet_(SHEETS.USERS);
  const target = users.find(u => u.ID === p.userId);
  if (!target) return { ok: false, error: 'Utilisateur introuvable.' };
  if (p.typeCible !== 'Arrondissement' || target.Role !== ROLES.PF) {
    return { ok: false, error: 'Seuls des arrondissements peuvent être assignés, et uniquement à un compte PF CNLS-TP.' };
  }
  const mesArrs = arrondissementsOfRcse_(actor.ID);
  if (!mesArrs.includes(p.cibleId)) return { ok: false, error: 'Cet arrondissement ne fait pas partie des communes de votre zone sanitaire.' };
  const entry = { ID: newId_('PER'), UserId: p.userId, TypeCible: p.typeCible, CibleId: p.cibleId, AssignePar: actor.ID, Date: nowStr_() };
  appendRow_(SHEETS.PERIMETRES, entry);
  appendRow_(SHEETS.JOURNAL, { ID: newId_('LOG'), Type: p.typeCible, CibleId: p.cibleId, AssigneA: p.userId, AssignePar: actor.ID, Date: nowStr_() });
  return { ok: true, perimetre: entry };
}

function listPerimetres_(actor) {
  const all = readSheet_(SHEETS.PERIMETRES);
  if (actor.Role === ROLES.NATIONAL) return all;
  return all.filter(x => x.UserId === actor.ID);
}

// Un PF assigne un arrondissement supplémentaire à un de ses ASCQ (en plus de celui choisi à la
// création du compte). Un ASCQ peut ainsi couvrir plusieurs arrondissements ; il reçoit alors un
// rapport hebdomadaire distinct pour chacun (voir genererRapportsPourSemaine_ / listRapports_).
function assignArrondissementAscq_(actor, p) {
  if (actor.Role !== ROLES.PF) return { ok: false, error: 'Seul un PF CNLS-TP peut assigner un arrondissement à un ASCQ.' };
  const users = readSheet_(SHEETS.USERS);
  const target = users.find(u => u.ID === p.userId);
  if (!target || target.Role !== ROLES.ASCQ) return { ok: false, error: 'Compte ASCQ introuvable.' };
  if (!isSupervisorOf_(actor, target)) return { ok: false, error: 'Cet ASCQ ne dépend pas de vous.' };
  if (!p.arrondissementId) return { ok: false, error: 'Arrondissement manquant.' };
  const dejaAssigne = readSheet_(SHEETS.PERIMETRES).some(x => x.UserId === target.ID && x.TypeCible === 'Arrondissement' && x.CibleId === p.arrondissementId);
  if (dejaAssigne) return { ok: false, error: 'Cet arrondissement est déjà assigné à cet ASCQ.' };
  const entry = { ID: newId_('PER'), UserId: target.ID, TypeCible: 'Arrondissement', CibleId: p.arrondissementId, AssignePar: actor.ID, Date: nowStr_() };
  appendRow_(SHEETS.PERIMETRES, entry);
  appendRow_(SHEETS.JOURNAL, { ID: newId_('LOG'), Type: 'Arrondissement', CibleId: p.arrondissementId, AssigneA: target.ID, AssignePar: actor.ID, Date: nowStr_() });
  return { ok: true, perimetre: entry };
}

// Périmètres arrondissement des ASCQ, visibles pour : un ASCQ (les siens), un PF (ceux de tous
// ses ASCQ, pour l'écran "Mes ASCQ" et le formulaire d'assignation), le RCSE et le NATIONAL (tous
// ceux de leur périmètre).
function listArrondissementsDesAscq_(actor) {
  const perimetres = readSheet_(SHEETS.PERIMETRES).filter(p => p.TypeCible === 'Arrondissement');
  if (actor.Role === ROLES.ASCQ) return perimetres.filter(p => p.UserId === actor.ID);
  if (actor.Role === ROLES.PF) {
    const users = readSheet_(SHEETS.USERS);
    const mesAscq = users.filter(u => u.Role === ROLES.ASCQ && u.ResponsableId === actor.ID).map(u => u.ID);
    return perimetres.filter(p => mesAscq.includes(p.UserId));
  }
  if (actor.Role === ROLES.RCSE) {
    const users = readSheet_(SHEETS.USERS);
    const mesArrs = new Set(arrondissementsOfRcse_(actor.ID));
    const ascqIds = users.filter(u => u.Role === ROLES.ASCQ).map(u => u.ID);
    return perimetres.filter(p => ascqIds.includes(p.UserId) && mesArrs.has(p.CibleId));
  }
  if (actor.Role === ROLES.NATIONAL) {
    const users = readSheet_(SHEETS.USERS);
    const ascqIds = users.filter(u => u.Role === ROLES.ASCQ).map(u => u.ID);
    return perimetres.filter(p => ascqIds.includes(p.UserId));
  }
  return [];
}

// Assignation OPTIONNELLE d'une grappe supplémentaire à un RC (en plus de sa grappe principale, qui
// est dans son village). La grappe peut être : une autre grappe du même village, un autre village
// de son arrondissement, ou un village d'un autre arrondissement de la commune de son ASCQ. Elle est
// identifiée par son numéro (1 à 20) ; nom facultatif ; créée à la volée si elle n'existe pas encore.
// Plusieurs RC peuvent couvrir la même grappe — aucune exclusivité n'est imposée entre RC.
function assignGrappeRc_(actor, p) {
  const users = readSheet_(SHEETS.USERS);
  const target = users.find(u => u.ID === p.userId);
  if (!target || target.Role !== ROLES.RC) return { ok: false, error: 'Compte RC introuvable.' };
  // Autorisé pour tout superviseur, direct ou indirect (même règle que la modification de compte,
  // voir updateUser_) — pas seulement l'ASCQ direct du RC.
  if (!isSupervisorOf_(actor, target)) return { ok: false, error: 'Ce RC ne dépend pas de vous.' };
  if (!p.villageId) return { ok: false, error: 'Village manquant.' };
  const village = readSheet_(SHEETS.VILLAGES).find(v => v.ID === p.villageId);
  if (!village) return { ok: false, error: 'Village introuvable.' };
  // Le village doit rester dans la commune de l'ASCQ du RC (même arrondissement ou autre arrondissement).
  const communeId = communeDuRc_(users, target);
  if (communeId) {
    const arr = readSheet_(SHEETS.ARRONDISSEMENTS).find(a => a.ID === village.ArrondissementId);
    if (!arr || arr.CommuneId !== communeId) return { ok: false, error: 'Ce village n\'est pas dans la commune de l\'ASCQ de ce RC.' };
  }
  const grappes = readSheet_(SHEETS.GRAPPES);
  let numero = numeroDepuisPayload_(p);
  if (!numero && !p.grappeNumero && p.grappeId) {
    numero = numeroGrappe_(grappes.find(g => g.ID === p.grappeId && g.VillageId === village.ID));
  }
  if (!numero) return { ok: false, error: MSG_NUM_GRAPPE };

  const res = trouverOuPreparerGrappe_(grappes, village, numero, p.grappeNomPerso);
  if (!res.nouvelle) {
    const dejaAssigne = readSheet_(SHEETS.PERIMETRES).some(x => x.UserId === target.ID && x.TypeCible === 'Grappe' && x.CibleId === res.grappe.ID);
    if (dejaAssigne) return { ok: false, error: 'Cette grappe est déjà assignée à ce RC.' };
  }
  const grappe = enregistrerGrappe_(res);
  const entry = { ID: newId_('PER'), UserId: target.ID, TypeCible: 'Grappe', CibleId: grappe.ID, AssignePar: actor.ID, Date: nowStr_() };
  appendRow_(SHEETS.PERIMETRES, entry);
  appendRow_(SHEETS.JOURNAL, { ID: newId_('LOG'), Type: 'Grappe', CibleId: grappe.ID, AssigneA: target.ID, AssignePar: actor.ID, Date: nowStr_() });
  return { ok: true, perimetre: entry };
}

// Retire une grappe de la couverture d'un RC (sans toucher aux autres grappes qu'il couvre
// éventuellement). Autorisé pour tout superviseur, direct ou indirect — même règle que
// assignGrappeRc_. Un RC peut se retrouver sans aucune grappe (ce n'est pas bloqué ici) ; c'est
// à l'appelant de lui en assigner une nouvelle si besoin.
function retirerGrappeRc_(actor, p) {
  const users = readSheet_(SHEETS.USERS);
  const target = users.find(u => u.ID === p.userId);
  if (!target || target.Role !== ROLES.RC) return { ok: false, error: 'Compte RC introuvable.' };
  if (!isSupervisorOf_(actor, target)) return { ok: false, error: 'Ce RC ne dépend pas de vous.' };
  // La grappe principale (dans le village du RC) est obligatoire : on ne la retire pas, on la
  // remplace en modifiant le compte (champ « Grappe principale »).
  if (target.GrappeId && target.GrappeId === p.grappeId) {
    return { ok: false, error: 'La grappe principale d\'un RC ne peut pas être retirée : modifiez-la dans le champ « Grappe principale » du compte.' };
  }
  const entry = readSheet_(SHEETS.PERIMETRES).find(x => x.UserId === target.ID && x.TypeCible === 'Grappe' && x.CibleId === p.grappeId);
  if (!entry) return { ok: false, error: 'Cette grappe n\'est pas assignée à ce RC.' };
  deleteRowById_(SHEETS.PERIMETRES, entry.ID);
  return { ok: true };
}

// Toutes les grappes actuellement couvertes par un RC (nom + village), pour affichage dans le
// formulaire de modification de son compte.
function listGrappesDuRc_(actor, p) {
  const users = readSheet_(SHEETS.USERS);
  const target = users.find(u => u.ID === p.userId);
  if (!target || target.Role !== ROLES.RC) return [];
  if (!isSupervisorOf_(actor, target) && actor.ID !== target.ID) return [];
  const grappesSheet = readSheet_(SHEETS.GRAPPES);
  return readSheet_(SHEETS.PERIMETRES).filter(x => x.UserId === target.ID && x.TypeCible === 'Grappe').map(x => {
    const g = grappesSheet.find(gg => gg.ID === x.CibleId);
    return {
      grappeId: x.CibleId, grappeNom: g ? g.Nom : x.CibleId, villageNom: g ? g.VillageNom : '', villageId: g ? g.VillageId : '',
      numero: g ? numeroGrappe_(g) : null, nomPerso: g ? (g.NomPerso || '') : '', principale: !!target.GrappeId && x.CibleId === target.GrappeId
    };
  });
}

// Périmètres grappe des RC, visibles pour : un RC (les siens), un ASCQ (ceux de tous ses RC).
function listGrappesDesRc_(actor) {
  const perimetres = readSheet_(SHEETS.PERIMETRES).filter(p => p.TypeCible === 'Grappe');
  if (actor.Role === ROLES.RC) return perimetres.filter(p => p.UserId === actor.ID);
  if (actor.Role === ROLES.ASCQ) {
    const users = readSheet_(SHEETS.USERS);
    const mesRc = users.filter(u => u.Role === ROLES.RC && u.ResponsableId === actor.ID).map(u => u.ID);
    return perimetres.filter(p => mesRc.includes(p.UserId));
  }
  return [];
}

// Liste des communes qui composent la zone sanitaire d'un RCSE (peut en avoir plusieurs, y
// compris de départements différents).
function communesOfRcse_(rcseId) {
  return readSheet_(SHEETS.PERIMETRES).filter(p => p.UserId === rcseId && p.TypeCible === 'Commune').map(p => p.CibleId);
}

// Liste des arrondissements couverts par un ASCQ (peut en avoir plusieurs).
function arrondissementsOfAscq_(ascqId) {
  return readSheet_(SHEETS.PERIMETRES).filter(p => p.UserId === ascqId && p.TypeCible === 'Arrondissement').map(p => p.CibleId);
}

function arrondissementsOfPf_(pfId) {
  return readSheet_(SHEETS.PERIMETRES).filter(p => p.UserId === pfId && p.TypeCible === 'Arrondissement').map(p => p.CibleId);
}

// Tous les arrondissements situés dans la zone sanitaire (un ou plusieurs communes) d'un RCSE.
function arrondissementsOfRcse_(rcseId) {
  const comIds = new Set(communesOfRcse_(rcseId));
  if (!comIds.size) return [];
  return readSheet_(SHEETS.ARRONDISSEMENTS).filter(a => comIds.has(a.CommuneId)).map(a => a.ID);
}

// ============================================================
// FORMULAIRES 1 & 2 (RC) — soumission + notification en cascade
// ============================================================

// Les formulaires envoient des clés en camelCase (ex: "typeAlerte") alors que les colonnes du
// Sheet sont en PascalCase (ex: "TypeAlerte") — cette table fait la correspondance explicite.
// (Un simple Object.assign(p) ne suffit pas : les clés ne correspondent pas à la casse près, ce
// qui écrivait silencieusement des cellules vides pour tous les champs du formulaire.)
const ALERTE_FIELD_MAP = {
  annee: 'Annee', semaineEpi: 'SemaineEpi', mois: 'Mois', npi: 'NPI', nAlerte: 'NAlerte',
  departement: 'Departement', zoneSanitaire: 'ZoneSanitaire', communeId: 'CommuneId',
  arrondissementId: 'ArrondissementId', villageId: 'VillageId', grappeNom: 'NGrappe',
  adresse: 'Adresse', nom: 'Nom', sexe: 'Sexe', telephone: 'Telephone',
  dateNaissance: 'DateNaissance', age: 'Age', gpsLon: 'GPSLon', gpsLat: 'GPSLat',
  typeAlerte: 'TypeAlerte', autrePreciser: 'AutrePreciser', dateDebutMaladie: 'DateDebutMaladie',
  dateNotification: 'DateNotification', personnesTouchees: 'PersonnesTouchees',
  personnesMortes: 'PersonnesMortes', animauxMalades: 'AnimauxMalades', animauxMorts: 'AnimauxMorts',
  enCours: 'EnCours', titre: 'Titre', centreSante: 'CentreSante'
};
const DECES_FIELD_MAP = {
  annee: 'Annee', semaineEpi: 'SemaineEpi', mois: 'Mois', npi: 'NPI', nDeces: 'NDeces',
  departement: 'Departement', zoneSanitaire: 'ZoneSanitaire', communeId: 'CommuneId',
  arrondissementId: 'ArrondissementId', villageId: 'VillageId', grappeNom: 'NGrappe',
  adresse: 'Adresse', nom: 'Nom', nomParent: 'NomParent', telephoneParent: 'TelephoneParent',
  dateNaissance: 'DateNaissance', ageAnnees: 'AgeAnnees', ageMois: 'AgeMois', ageJours: 'AgeJours',
  sexe: 'Sexe', gpsLon: 'GPSLon', gpsLat: 'GPSLat', typeDeces: 'TypeDeces', dateDeces: 'DateDeces',
  dateNotification: 'DateNotification', lieuDeces: 'LieuDeces', circonstances: 'Circonstances',
  causeProbable: 'CauseProbable', titre: 'Titre', centreSante: 'CentreSante'
};
function mapFields_(p, fieldMap) {
  const obj = {};
  Object.keys(fieldMap).forEach(k => { if (p[k] !== undefined) obj[fieldMap[k]] = p[k]; });
  return obj;
}

// Verrou : deux envois identiques qui arriveraient en même temps (ex. deux onglets qui synchronisent) sont
// traités l'un après l'autre, et le second est reconnu comme doublon grâce au clientId.
function avecVerrou_(fn) {
  const verrou = LockService.getScriptLock();
  verrou.waitLock(20000);
  try { return fn(); } finally { verrou.releaseLock(); }
}

// ---- Notifications saisies HORS CONNEXION par le RC (assets/hors-ligne.js) ----
// Le téléphone garde la notification puis l'envoie au retour du réseau, avec un identifiant unique (clientId)
// et l'heure réelle de la saisie. Si le même envoi arrive deux fois (réponse perdue puis renvoi), le serveur
// reconnaît le clientId et renvoie la ligne déjà créée : jamais de doublon, jamais de seconde notification.
function dateSaisieClient_(p) {
  if (!p || !p.saisieHorsLigneLe) return '';
  const d = new Date(p.saisieHorsLigneLe), t = d.getTime(), maintenant = Date.now();
  if (isNaN(t) || t > maintenant + 5 * 60000 || t < maintenant - 90 * 86400000) return ''; // heure incohérente : on garde celle du serveur
  return Utilities.formatDate(d, 'Africa/Porto-Novo', 'yyyy-MM-dd HH:mm:ss');
}
function dejaRecu_(feuille, actor, p) {
  const id = String((p && p.clientId) || '');
  return id ? (readSheet_(feuille).find(r => r.ClientId === id && r.NotificateurId === actor.ID) || null) : null;
}
function tracesHorsLigne_(p) {
  const saisie = dateSaisieClient_(p);
  return { DateSaisie: saisie || nowStr_(), ClientId: String((p && p.clientId) || ''), HorsLigne: saisie ? 'Oui' : '', SynchroniseLe: saisie ? nowStr_() : '', _saisie: saisie };
}
function mentionHorsLigne_(t) { return t._saisie ? ' (saisie hors connexion le ' + t._saisie.slice(8, 10) + '/' + t._saisie.slice(5, 7) + ' à ' + t._saisie.slice(11, 16) + ')' : ''; }

function submitAlerte_(actor, p) {
  if (actor.Role !== ROLES.RC) return { ok: false, error: 'Seul un Relais Communautaire peut soumettre ce formulaire.' };
  const deja = dejaRecu_(SHEETS.ALERTES, actor, p); if (deja) return { ok: true, alerte: deja, doublon: true };
  const trace = tracesHorsLigne_(p);
  const obj = Object.assign(mapFields_(p, ALERTE_FIELD_MAP), {
    ID: newId_('ALT'), NotificateurId: actor.ID, NotificateurNom: actor.Prenom + ' ' + actor.Nom,
    DateSaisie: trace.DateSaisie, ClientId: trace.ClientId, HorsLigne: trace.HorsLigne, SynchroniseLe: trace.SynchroniseLe, Statut: 'Nouveau', InvestigationId: '',
    Signes: Array.isArray(p.signes) ? p.signes.join('|') : (p.signes || '')
  });
  appendRow_(SHEETS.ALERTES, obj);
  notifierSelonValidation_(actor, 'ALERTE', obj.ID, `Nouvelle alerte (${p.typeAlerte || ''}) notifiée par ${obj.NotificateurNom} - Village: ${p.villageNom || actor.VillageNom || ''}${mentionHorsLigne_(trace)}`);
  return { ok: true, alerte: obj };
}

function submitDeces_(actor, p) {
  if (actor.Role !== ROLES.RC) return { ok: false, error: 'Seul un Relais Communautaire peut soumettre ce formulaire.' };
  const deja = dejaRecu_(SHEETS.DECES, actor, p); if (deja) return { ok: true, deces: deja, doublon: true };
  const trace = tracesHorsLigne_(p);
  const obj = Object.assign(mapFields_(p, DECES_FIELD_MAP), {
    ID: newId_('DC'), NotificateurId: actor.ID, NotificateurNom: actor.Prenom + ' ' + actor.Nom,
    DateSaisie: trace.DateSaisie, ClientId: trace.ClientId, HorsLigne: trace.HorsLigne, SynchroniseLe: trace.SynchroniseLe, Statut: 'Nouveau', InvestigationId: ''
  });
  appendRow_(SHEETS.DECES, obj);
  notifierSelonValidation_(actor, 'DECES', obj.ID, `Nouveau décès communautaire notifié par ${obj.NotificateurNom} - Village: ${p.villageNom || actor.VillageNom || ''}${mentionHorsLigne_(trace)}`);
  return { ok: true, deces: obj };
}

// Notifie l'ASCQ superviseur direct + toute la chaîne au-dessus (PF, RCSE, NATIONAL)
// Notification d'un travail d'un RC : avec la validation ASCQ active, seul l'ASCQ du RC est prévenu ; les niveaux supérieurs
// le seront quand l'ASCQ aura validé (voir submitInvestigation_, confirmerDeces_, decideSensibilisation_).
// Sans ASCQ dans la chaîne (ou paramètre désactivé), toute la chaîne est prévenue comme avant.
function notifierSelonValidation_(rcUser, type, refId, message) {
  const chaine = chainAbove_(rcUser).filter(u => u.Role !== ROLES.RC && u.ID !== rcUser.ID);
  const ascq = chaine.find(u => u.Role === ROLES.ASCQ) || null;
  if (ascq && validationAscqActive_()) notifierComptes_([ascq], type, refId, message);
  else cascadeNotify_(rcUser, type, refId, message);
}
function cascadeNotify_(rcUser, type, refId, message) {
  const chain = chainAbove_(rcUser); // [ASCQ, PF, RCSE, ...]
  // Garde-fou : la chaîne remonte uniquement vers les superviseurs (jamais le RC lui-même,
  // ni un autre RC) — on l'impose explicitement ici pour ne jamais notifier par erreur un
  // compte RC, même si une donnée de hiérarchie (ResponsableId) venait à être incohérente.
  chain.filter(sup => sup.Role !== ROLES.RC && sup.ID !== rcUser.ID).forEach(sup => {
    appendRow_(SHEETS.NOTIFICATIONS, {
      ID: newId_('NOTIF'), DestinataireId: sup.ID, Type: type, RefId: refId,
      Message: message, Lu: false, DateCreation: nowStr_()
    });
  });
}

function listNotifications_(actor) {
  return readSheet_(SHEETS.NOTIFICATIONS).filter(n => n.DestinataireId === actor.ID)
    .sort((a, b) => new Date(b.DateCreation) - new Date(a.DateCreation));
}

function markNotificationRead_(actor, p) {
  updateRowById_(SHEETS.NOTIFICATIONS, p.id, { Lu: true });
  return { ok: true };
}

// Purge d'un coup toutes les notifications non lues de l'utilisateur connecté (bouton "Tout
// marquer comme lu" du RCSE) : la pastille "Notifications non lues" de son tableau de bord
// retombe à 0. Ne touche ni aux alertes, ni aux décès, ni à aucune autre donnée de surveillance —
// seule la boîte de notifications de ce compte est vidée.
function marquerToutesNotificationsLues_(actor) {
  const notifs = readSheet_(SHEETS.NOTIFICATIONS).filter(n => n.DestinataireId === actor.ID && (n.Lu === false || n.Lu === 'FALSE'));
  notifs.forEach(n => updateRowById_(SHEETS.NOTIFICATIONS, n.ID, { Lu: true }));
  return { count: notifs.length };
}

// Marque comme lues les notifications d'un destinataire qui portent sur un élément donné
// (alerte ou décès) — appelé quand l'ASCQ traite l'élément (investigation / confirmation).
function marquerNotificationsLuesPourRef_(destinataireId, refId) {
  readSheet_(SHEETS.NOTIFICATIONS)
    .filter(n => n.DestinataireId === destinataireId && n.RefId === refId && (n.Lu === false || n.Lu === 'FALSE'))
    .forEach(n => updateRowById_(SHEETS.NOTIFICATIONS, n.ID, { Lu: true }));
}

// ============================================================
// DÉCÈS COMMUNAUTAIRES — confirmation par l'ASCQ (pas d'investigation)
// ============================================================
// Le RC notifie un décès -> l'ASCQ est notifié et le CONFIRME (décès avéré) ou ne le confirme pas
// (non avéré, doublon... motif obligatoire). Seuls les décès confirmés sont comptés dans le
// rapport hebdomadaire. La décision est définitive (verrouillée) : Statut passe de « Nouveau » à
// « Confirmé » ou « Non confirmé ».
function confirmerDeces_(actor, p) {
  if (actor.Role !== ROLES.ASCQ) return { ok: false, error: 'Seul un ASCQ peut confirmer un décès.' };
  const d = listScoped_(SHEETS.DECES, actor).find(x => x.ID === p.id);
  if (!d) return { ok: false, error: 'Décès introuvable dans votre périmètre.' };
  const confirme = p.decision === 'confirmer';
  if (!confirme && p.decision !== 'rejeter') return { ok: false, error: 'Décision invalide.' };
  if (d.Statut !== 'Nouveau') {
    if ((confirme && d.Statut === 'Confirmé') || (!confirme && d.Statut === 'Non confirmé')) return { ok: true, doublon: true, statut: d.Statut };   // envoi différé rejoué
    return { ok: false, error: 'Ce décès a déjà été traité (' + d.Statut + ') : la décision est définitive.' };
  }
  // Décès confirmé : la FICHE DE NOTIFICATION correspondante (maternel 3_BJ, néonatal 4_BJ, autre décès 02_BJ) est obligatoire.
  if (confirme) {
    const attendu = FicheSchemas.typeDeDeces(d.TypeDeces);
    if (!p.fiche || !p.fiche.donnees) return { ok: false, error: 'La fiche de notification (' + FicheSchemas.get(attendu).court + ') est obligatoire pour confirmer ce décès.' };
    if (p.fiche.type && p.fiche.type !== attendu) return { ok: false, error: 'La fiche attendue pour ce décès est : ' + FicheSchemas.get(attendu).court + '.' };
    const fr = enregistrerFicheNotif_(actor, { type: attendu, donnees: p.fiche.donnees, clientId: p.clientId }, { refType: 'DECES', refId: d.ID });
    if (!fr.ok) return fr;
  }
  const commentaire = String(p.commentaire || '').trim();
  if (!confirme && !commentaire) return { ok: false, error: 'Indiquez le motif pour lequel ce décès n\'est pas confirmé.' };
  const nomAscq = actor.Prenom + ' ' + actor.Nom;
  const statut = confirme ? 'Confirmé' : 'Non confirmé';
  updateRowById_(SHEETS.DECES, d.ID, { Statut: statut, ConfirmePar: actor.ID, ConfirmeParNom: nomAscq, DateConfirmation: nowStr_(), CommentaireConfirmation: commentaire });
  marquerNotificationsLuesPourRef_(actor.ID, d.ID);
  const village = avecNomVillage_([d])[0].VillageNom;
  const msg = `Décès de ${d.Nom || 'personne non nommée'} (village ${village}) ${confirme ? 'confirmé' : 'non confirmé'} par ${nomAscq}` + (commentaire ? ' - ' + commentaire : '');
  const resumeDeces = confirme ? resumeAlerteValidee_('DECES', null, Object.assign({}, d, { ConfirmeParNom: nomAscq, DateConfirmation: nowStr_(), CommentaireConfirmation: commentaire }), contexteGeo_()) : null;
  (confirme || !validationAscqActive_() ? chainAbove_(actor) : []).forEach(sup => appendRow_(SHEETS.NOTIFICATIONS, resumeDeces
    ? { ID: newId_('NOTIF'), DestinataireId: sup.ID, Type: 'ALERTE_VALIDEE', RefId: d.ID, Message: messageAlerteValidee_(resumeDeces), Lu: false, DateCreation: nowStr_() }
    : { ID: newId_('NOTIF'), DestinataireId: sup.ID, Type: 'DECES_DECISION', RefId: d.ID, Message: msg, Lu: false, DateCreation: nowStr_() }));
  if (d.NotificateurId) appendRow_(SHEETS.NOTIFICATIONS, {
    ID: newId_('NOTIF'), DestinataireId: d.NotificateurId, Type: 'DECES_DECISION', RefId: d.ID, Message: msg, Lu: false, DateCreation: nowStr_()
  });
  return { ok: true, statut };
}

// ============================================================
// FORMULAIRE 3 (ASCQ) — investigation d'une alerte/décès
// ============================================================

// ============================================================
// DONNÉES COLLECTÉES PAR LE RC — l'ASCQ y a accès, peut les CORRIGER avant de valider (investigation d'une
// alerte, confirmation d'un décès) et peut SUPPRIMER une notification. Chaque correction et chaque
// suppression est tracée dans la feuille JournalModifications (qui, quand, avant/après, motif) et le RC en
// est informé par une notification.
// ============================================================
const CHAMPS_MODIFIABLES = {
  ALERTE: { Nom: 'texte', Sexe: 'sexe', Telephone: 'texte', DateNaissance: 'date', Age: 'texte', Adresse: 'texte', TypeAlerte: 'texte', AutrePreciser: 'texte',
    DateDebutMaladie: 'date', DateNotification: 'date', Signes: 'liste', PersonnesTouchees: 'entier', PersonnesMortes: 'entier', AnimauxMalades: 'entier',
    AnimauxMorts: 'entier', EnCours: 'ouinon', CentreSante: 'texte' },
  DECES: { Nom: 'texte', NomParent: 'texte', TelephoneParent: 'texte', Sexe: 'sexe', DateNaissance: 'date', AgeAnnees: 'entier', AgeMois: 'entier', TypeDeces: 'code',
    DateDeces: 'date', DateNotification: 'date', LieuDeces: 'code', Circonstances: 'code', Adresse: 'texte', CentreSante: 'texte', CauseProbable: 'texte' }
};
const LIBELLE_CHAMP = {
  Nom: 'nom', Sexe: 'sexe', Telephone: 'téléphone', DateNaissance: 'date de naissance', Age: 'âge', Adresse: 'adresse', TypeAlerte: 'type d\'alerte', AutrePreciser: 'précision',
  DateDebutMaladie: 'date de début', DateNotification: 'date de notification', Signes: 'signes', PersonnesTouchees: 'personnes touchées', PersonnesMortes: 'personnes décédées',
  AnimauxMalades: 'animaux malades', AnimauxMorts: 'animaux morts', EnCours: 'événement en cours', CentreSante: 'centre de santé', NomParent: 'parent / proche',
  TelephoneParent: 'téléphone du proche', AgeAnnees: 'âge (années)', AgeMois: 'âge (mois)', TypeDeces: 'type de décès', DateDeces: 'date du décès', LieuDeces: 'lieu du décès',
  Circonstances: 'circonstances', CauseProbable: 'cause probable'
};

function normaliserChamp_(type, v) {
  const t = v === null || v === undefined ? '' : (Array.isArray(v) ? v : String(v).trim());
  switch (type) {
    case 'texte': return { ok: true, valeur: String(t).slice(0, 300) };
    case 'sexe': return t === '' || t === 'M' || t === 'F' ? { ok: true, valeur: t } : { ok: false, error: 'M ou F attendu.' };
    case 'date': {
      if (t === '') return { ok: true, valeur: '' };
      if (!/^\d{4}-\d{2}-\d{2}$/.test(t) || isNaN(new Date(t + 'T00:00:00').getTime())) return { ok: false, error: 'date invalide (AAAA-MM-JJ).' };
      return { ok: true, valeur: t };
    }
    case 'entier': {
      if (t === '') return { ok: true, valeur: '' };
      const n = Number(t); return isFinite(n) && n >= 0 && n <= 100000 && Math.floor(n) === n ? { ok: true, valeur: n } : { ok: false, error: 'nombre entier positif attendu.' };
    }
    case 'liste': {
      const arr = Array.isArray(t) ? t : String(t).split('|');
      return { ok: true, valeur: arr.map(x => String(x).trim().slice(0, 80)).filter(Boolean).join('|').slice(0, 800) };
    }
    case 'ouinon': return t === 'Oui' || t === 'Non' ? { ok: true, valeur: t } : { ok: false, error: 'Oui ou Non attendu.' };
    case 'code': return /^\d{1,2}$/.test(String(t)) ? { ok: true, valeur: String(t) } : { ok: false, error: 'valeur non reconnue.' };
  }
  return { ok: false, error: 'champ non modifiable.' };
}

function notificationRcDuPerimetre_(actor, p) {
  if (actor.Role !== ROLES.ASCQ) return { error: 'Seul un ASCQ peut modifier ou supprimer une notification de relais communautaire.' };
  const type = p.refType === 'DECES' ? 'DECES' : 'ALERTE', feuille = type === 'DECES' ? SHEETS.DECES : SHEETS.ALERTES;
  const ligne = listScoped_(feuille, actor).find(x => x.ID === p.refId);
  if (!ligne) return { error: 'Notification introuvable dans votre périmètre.' };
  return { type: type, feuille: feuille, ligne: ligne };
}

function modifierNotificationRc_(actor, p) {
  const c = notificationRcDuPerimetre_(actor, p); if (c.error) return { ok: false, error: c.error };
  const ligne = c.ligne, autorises = CHAMPS_MODIFIABLES[c.type];
  if ((c.type === 'ALERTE' && ligne.Statut === 'Investigué') || (c.type === 'DECES' && ligne.Statut === 'Confirmé'))
    return { ok: false, error: 'Cette notification est déjà validée : elle ne peut plus être modifiée.' };
  const champs = p.champs || {}, changes = {}, avant = {}, apres = {};
  for (const col of Object.keys(champs)) {
    if (!autorises[col]) return { ok: false, error: 'Champ non modifiable : ' + col };
    const n = normaliserChamp_(autorises[col], champs[col]);
    if (!n.ok) return { ok: false, error: (LIBELLE_CHAMP[col] || col) + ' : ' + n.error };
    if (col === 'Nom' && !n.valeur) return { ok: false, error: 'Le nom du cas est obligatoire.' };
    const ancien = autorises[col] === 'date' ? dateIso_(ligne[col]) : String(ligne[col] === null || ligne[col] === undefined ? '' : ligne[col]);
    if (String(n.valeur) !== ancien) { changes[col] = n.valeur; avant[col] = ancien; apres[col] = n.valeur; }
  }
  if (!Object.keys(changes).length) return { ok: true, aucunChangement: true, ligne: ligne };
  Object.assign(changes, { ModifieParAscq: 'Oui', DateModification: nowStr_() });
  updateRowById_(c.feuille, ligne.ID, changes);
  const nomAscq = (actor.Prenom + ' ' + actor.Nom).trim();
  appendRow_(SHEETS.JOURNAL_MODIFS, { ID: newId_('MOD'), Date: nowStr_(), Action: 'MODIFICATION', RefType: c.type, RefId: ligne.ID, AuteurId: actor.ID, AuteurNom: nomAscq,
    Motif: coupe_(p.motif, 300), Avant: JSON.stringify(avant).slice(0, 45000), Apres: JSON.stringify(apres).slice(0, 45000) });
  const libelles = Object.keys(avant).map(k => LIBELLE_CHAMP[k] || k);
  if (ligne.NotificateurId) appendRow_(SHEETS.NOTIFICATIONS, { ID: newId_('NOTIF'), DestinataireId: ligne.NotificateurId, Type: 'MODIF_NOTIF', RefId: ligne.ID,
    Message: 'Votre ASCQ ' + nomAscq + ' a corrigé votre notification ' + (c.type === 'DECES' ? 'de décès' : 'd\'alerte') + ' (' + ligne.Nom + ') : ' + libelles.join(', ') + '.', Lu: false, DateCreation: nowStr_() });
  return { ok: true, ligne: Object.assign({}, ligne, changes), champsModifies: Object.keys(avant) };
}

function supprimerNotificationRc_(actor, p) {
  const c = notificationRcDuPerimetre_(actor, p); if (c.error) return { ok: false, error: c.error };
  const motif = String(p.motif || '').trim();
  if (motif.length < 3) return { ok: false, error: 'Le motif de la suppression est obligatoire.' };
  const ligne = c.ligne, inv = ligne.InvestigationId ? readSheet_(SHEETS.INVESTIGATIONS).find(i => i.ID === ligne.InvestigationId) : null;
  const nomAscq = (actor.Prenom + ' ' + actor.Nom).trim();
  // La trace est écrite AVANT la suppression : elle garde une copie de la notification (et de sa fiche d'investigation).
  appendRow_(SHEETS.JOURNAL_MODIFS, { ID: newId_('MOD'), Date: nowStr_(), Action: 'SUPPRESSION', RefType: c.type, RefId: ligne.ID, AuteurId: actor.ID, AuteurNom: nomAscq,
    Motif: coupe_(motif, 300), Avant: JSON.stringify({ notification: ligne, investigation: inv || null }).slice(0, 45000), Apres: '' });
  const liees = readSheet_(SHEETS.NOTIFICATIONS).filter(n => n.RefId === ligne.ID || (inv && n.RefId === inv.ID));
  liees.forEach(n => deleteRowById_(SHEETS.NOTIFICATIONS, n.ID));
  if (inv) deleteRowById_(SHEETS.INVESTIGATIONS, inv.ID);
  deleteRowById_(c.feuille, ligne.ID);
  if (ligne.NotificateurId) appendRow_(SHEETS.NOTIFICATIONS, { ID: newId_('NOTIF'), DestinataireId: ligne.NotificateurId, Type: 'SUPPR_NOTIF', RefId: '',
    Message: 'Votre ASCQ ' + nomAscq + ' a supprimé votre notification ' + (c.type === 'DECES' ? 'de décès' : 'd\'alerte') + ' (' + ligne.Nom + ') — motif : ' + motif + '.', Lu: false, DateCreation: nowStr_() });
  return { ok: true, supprimee: ligne.ID, notificationsRetirees: liees.length, investigationSupprimee: !!inv };
}

// Champs de la fiche d'investigation : le formulaire envoie des noms en minuscules (maladie,
// evenementAvere, description...) alors que les colonnes de la feuille sont capitalisées. Sans cette
// correspondance, ces champs n'étaient pas enregistrés (colonnes vides).
const INVESTIGATION_FIELD_MAP = {
  refType: 'RefType', refId: 'RefId', departement: 'Departement', zoneSanitaire: 'ZoneSanitaire', communeId: 'CommuneId',
  arrondissementId: 'ArrondissementId', villageId: 'VillageId', relais: 'Relais', telRelais: 'TelRelais', telASCQ: 'TelASCQ',
  gpsLon: 'GPSLon', gpsLat: 'GPSLat', evenementAvere: 'EvenementAvere', source: 'Source', maladie: 'Maladie',
  description: 'Description', circonstances: 'Circonstances', dateSurvenue: 'DateSurvenue', dateNotification: 'DateNotification',
  dateInvestigation: 'DateInvestigation', actions: 'Actions'
};

function submitInvestigation_(actor, p) {
  if (actor.Role !== ROLES.ASCQ) return { ok: false, error: 'Seul un ASCQ peut soumettre une fiche d\'investigation.' };
  const refType = p.refType === 'DECES' ? 'DECES' : 'ALERTE';
  const targetSheet = refType === 'DECES' ? SHEETS.DECES : SHEETS.ALERTES;
  const ref = listScoped_(targetSheet, actor).find(x => x.ID === p.refId) || null;
  if (ref && ref.Statut === 'Investigué') return { ok: true, doublon: true };   // déjà validée (envoi différé rejoué)
  // Événement avéré : la FICHE DE NOTIFICATION du cas (fiche générique) est obligatoire ; sans elle l'alerte n'est pas prise en compte.
  let ficheRes = null;
  if (String(p.evenementAvere || 'Oui') !== 'Non' && refType === 'ALERTE') {
    if (!p.fiche || !p.fiche.donnees) return { ok: false, error: 'La fiche de notification du cas est obligatoire pour valider cette alerte.' };
    ficheRes = enregistrerFicheNotif_(actor, { type: 'maladie', donnees: p.fiche.donnees, clientId: p.clientId }, { refType: 'ALERTE', refId: p.refId });
    if (!ficheRes.ok) return ficheRes;
  }
  const obj = Object.assign(mapFields_(p, INVESTIGATION_FIELD_MAP), {
    ID: newId_('INV'), RefType: refType, RefId: p.refId, ASCQId: actor.ID, ASCQNom: actor.Prenom + ' ' + actor.Nom, TelASCQ: actor.Telephone || '',
    DateSaisie: nowStr_(),
    CasParCategorie: JSON.stringify(p.casParCategorie || {}),
    DecesParCategorie: JSON.stringify(p.decesParCategorie || {})
  });
  // La fiche porte la géographie de l'alerte (pour qu'elle soit retrouvable par les niveaux supérieurs).
  if (ref) ['Departement', 'ZoneSanitaire', 'CommuneId', 'ArrondissementId', 'VillageId'].forEach(k => { if (!obj[k] && ref[k]) obj[k] = ref[k]; });
  appendRow_(SHEETS.INVESTIGATIONS, obj);
  updateRowById_(targetSheet, p.refId, { Statut: 'Investigué', InvestigationId: obj.ID });
  // L'alerte est traitée : la notification correspondante n'est plus « non lue » pour l'ASCQ.
  marquerNotificationsLuesPourRef_(actor.ID, p.refId);
  const chain = chainAbove_(actor); // [PF, RCSE, DEPARTEMENT, NATIONAL]
  const valide = String(obj.EvenementAvere || 'Oui') !== 'Non';
  if (valide && ref) {
    // Événement validé par l'ASCQ : « alerte infection » détaillée pour tous les niveaux supérieurs.
    const resume = resumeAlerteValidee_(refType === 'DECES' ? 'DECES' : 'ALERTE', obj, ref, contexteGeo_());
    chain.forEach(sup => appendRow_(SHEETS.NOTIFICATIONS, {
      ID: newId_('NOTIF'), DestinataireId: sup.ID, Type: 'ALERTE_VALIDEE', RefId: obj.ID,
      Message: messageAlerteValidee_(resume), Lu: false, DateCreation: nowStr_()
    }));
  } else if (!(validationAscqActive_() && !valide)) {
    // Événement non avéré : avec la validation ASCQ active, rien ne remonte (l'ASCQ n'a pas validé d'événement).
    chain.forEach(sup => appendRow_(SHEETS.NOTIFICATIONS, {
      ID: newId_('NOTIF'), DestinataireId: sup.ID, Type: 'INVESTIGATION', RefId: obj.ID,
      Message: `Investigation complétée par ${obj.ASCQNom} sur ${refType} ${p.refId}` + (valide ? '' : ' — événement non avéré'), Lu: false, DateCreation: nowStr_()
    }));
  }
  return { ok: true, investigation: obj, ficheId: ficheRes ? ficheRes.id : '' };
}

// ============================================================
// ALERTE INFECTION VALIDÉE PAR L'ASCQ — synthèse pour les niveaux supérieurs
// ============================================================
// Quand l'ASCQ investigue et valide un événement (ou confirme un décès), tous les niveaux au-dessus
// reçoivent une notification de synthèse : affection / événement, arrondissement, village, commune,
// nombre de cas touchés et décédés, animaux touchés et morts (si l'événement concerne des animaux),
// résumé et personne qui a fait la notification. Le tableau de bord les liste (listAlertesValidees).

function sommeCategories_(v) {
  try { const o = typeof v === 'string' ? JSON.parse(v || '{}') : (v || {}); return Object.keys(o).reduce((t, k) => t + (Number(o[k]) || 0), 0); }
  catch (e) { return 0; }
}
function nombre_(v) { const n = Number(v); return isFinite(n) && n > 0 ? n : 0; }
function coupe_(txt, n) { txt = String(txt || '').replace(/\s+/g, ' ').trim(); return txt.length > n ? txt.slice(0, n - 1) + '…' : txt; }

function contexteGeo_() {
  const m = { communes: {}, arrs: {}, vils: {} };
  readSheet_(SHEETS.COMMUNES).forEach(c => { m.communes[c.ID] = c; });
  readSheet_(SHEETS.ARRONDISSEMENTS).forEach(a => { m.arrs[a.ID] = a; });
  readSheet_(SHEETS.VILLAGES).forEach(v => { m.vils[v.ID] = v; });
  return m;
}

const LIBELLES_DECES = {
  type: { 1: 'Décès maternel', 2: 'Décès de bébé (0-28 jours)', 3: 'Décès d\'enfant de 1 mois à 1 an', 4: 'Décès d\'enfant de 1 à 5 ans', 5: 'Décès de personne de plus de 5 ans' },
  lieu: { 1: 'Domicile', 2: 'Accoucheuse', 3: 'Lieu de culte', 4: 'Au cours du transport', 5: 'À l\'étranger', 6: 'Autre' },
  circ: { 1: 'Grossesse / avortement / accouchement / suites de couches', 2: 'Maladie', 3: 'Accident de route', 4: 'Accident domestique', 5: 'Mort subite', 6: 'Violence', 7: 'Autre' }
};
function libelleDeces_(table, v) { const k = String(v == null ? '' : v).trim(); return LIBELLES_DECES[table][k] || (k && isNaN(Number(k)) ? k : ''); }

function resumeAlerteValidee_(kind, inv, ref, geo) {
  const arr = geo.arrs[ref.ArrondissementId] || null, vil = geo.vils[ref.VillageId] || null;
  const com = geo.communes[ref.CommuneId] || (arr ? geo.communes[arr.CommuneId] : null) || null;
  const base = {
    kind: kind, id: (kind === 'DECES' && !inv) ? ref.ID : (inv ? inv.ID : ref.ID), refId: ref.ID,
    commune: com ? com.Nom : (arr ? arr.CommuneNom : ''), arrondissement: arr ? arr.Nom : '', village: vil ? vil.Nom : (ref.VillageNom || ''),
    notificateur: ref.NotificateurNom || '', notificateurId: ref.NotificateurId || '', dateNotification: dateIso_(ref.DateNotification) || dateIso_(ref.DateSaisie)
  };
  if (kind === 'DECES') {
    const decInv = inv ? sommeCategories_(inv.DecesParCategorie) : 0, casInv = inv ? sommeCategories_(inv.CasParCategorie) : 0;
    return Object.assign(base, {
      typeDeces: String(ref.TypeDeces == null ? '' : ref.TypeDeces).trim(), maladie: inv && inv.Maladie ? inv.Maladie : '',
      affection: inv && inv.Maladie ? inv.Maladie : ('Décès communautaire' + (libelleDeces_('type', ref.TypeDeces) ? ' — ' + libelleDeces_('type', ref.TypeDeces) : '')),
      casTouches: Math.max(casInv, decInv, 1), casDeces: Math.max(decInv, 1), animauxTouches: 0, animauxMorts: 0,
      ascq: inv ? inv.ASCQNom : (ref.ConfirmeParNom || ''), dateValidation: dateIso_(inv ? (inv.DateInvestigation || inv.DateSaisie) : (ref.DateConfirmation || ref.DateSaisie)),
      resume: coupe_([inv && inv.Description, libelleDeces_('circ', ref.Circonstances) ? 'Circonstances : ' + libelleDeces_('circ', ref.Circonstances) : '',
        libelleDeces_('lieu', ref.LieuDeces) ? 'Lieu : ' + libelleDeces_('lieu', ref.LieuDeces) : '', ref.CauseProbable ? 'Cause probable : ' + ref.CauseProbable : '',
        ref.CommentaireConfirmation ? 'Commentaire de l\'ASCQ : ' + ref.CommentaireConfirmation : '',
        inv && inv.Actions ? 'Actions : ' + inv.Actions : ''].filter(Boolean).join(' — '), 400)
    });
  }
  const casInv = inv ? sommeCategories_(inv.CasParCategorie) : 0, decInv = inv ? sommeCategories_(inv.DecesParCategorie) : 0, renseigne = casInv > 0 || decInv > 0;
  const animT = nombre_(ref.AnimauxMalades), animM = nombre_(ref.AnimauxMorts);
  return Object.assign(base, {
    affection: (inv && inv.Maladie) || ref.AutrePreciser || ref.TypeAlerte || 'Événement de santé',
    casTouches: renseigne ? casInv : nombre_(ref.PersonnesTouchees), casDeces: renseigne ? decInv : nombre_(ref.PersonnesMortes),
    animauxTouches: animT, animauxMorts: animM,
    ascq: inv ? inv.ASCQNom : '', dateValidation: dateIso_(inv ? (inv.DateInvestigation || inv.DateSaisie) : ''),
    resume: coupe_([inv && inv.Description, inv && inv.Actions ? 'Actions : ' + inv.Actions : ''].filter(Boolean).join(' — '), 400)
  });
}

function messageAlerteValidee_(r) {
  const parts = ['ALERTE INFECTION VALIDÉE — ' + r.affection,
    'Commune : ' + (r.commune || '—'), 'Arrondissement : ' + (r.arrondissement || '—'), 'Village : ' + (r.village || '—'),
    'Cas touchés : ' + r.casTouches, 'Décès : ' + r.casDeces];
  if (r.animauxTouches || r.animauxMorts) parts.push('Animaux touchés : ' + r.animauxTouches, 'Animaux morts : ' + r.animauxMorts);
  parts.push('Notifiée par : ' + (r.notificateur || '—'), 'Validée par : ' + (r.ascq || '—'));
  return parts.join(' | ');
}

// Alertes validées visibles par l'utilisateur (son périmètre), la plus récente d'abord. Part des
// alertes et décès du périmètre (qui portent la géographie) puis rejoint la fiche d'investigation.
function listAlertesValidees_(actor) {
  if (actor.Role === ROLES.RC) return { ok: false, error: 'Réservé aux niveaux supérieurs au relais communautaire.' };
  const geo = contexteGeo_(), invs = {}, users = {};
  readSheet_(SHEETS.INVESTIGATIONS).forEach(i => { invs[i.ID] = i; });
  readSheet_(SHEETS.USERS).forEach(u => { users[u.ID] = u; });
  const out = [];
  listScoped_(SHEETS.ALERTES, actor).forEach(a => {
    if (a.Statut !== 'Investigué' || !a.InvestigationId) return;
    const inv = invs[a.InvestigationId]; if (!inv) return;
    if (String(inv.EvenementAvere || '') === 'Non') return; // événement non avéré : pas d'alerte infection
    out.push(resumeAlerteValidee_('ALERTE', inv, a, geo));
  });
  listScoped_(SHEETS.DECES, actor).forEach(d => {
    const inv = d.InvestigationId ? invs[d.InvestigationId] : null;
    if (!(d.Statut === 'Confirmé' || (inv && d.Statut === 'Investigué' && String(inv.EvenementAvere || '') !== 'Non'))) return;
    out.push(resumeAlerteValidee_('DECES', inv, d, geo));
  });
  out.forEach(r => {
    const u = users[r.notificateurId];
    r.notificateurTel = u ? String(u.Telephone || '') : '';
    r.date = r.dateValidation || r.dateNotification || '';
    delete r.notificateurId;
  });
  out.sort((a, b) => String(b.date).localeCompare(String(a.date)));
  return { ok: true, alertes: out.slice(0, 500) };
}

// ============================================================
// PHOTO DE PROFIL (stockée dans la colonne Photo de la feuille Utilisateurs, en data URL réduite)
// ============================================================
function setPhoto_(actor, p) {
  const photo = String(p.photo || '');
  if (photo === '') { updateRowById_(SHEETS.USERS, actor.ID, { Photo: '' }); return { ok: true, photo: '' }; }
  if (!/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+\/=]+$/.test(photo)) return { ok: false, error: 'Image non valide (JPEG, PNG ou WebP).' };
  if (photo.length > 45000) return { ok: false, error: 'Image trop lourde.' };
  updateRowById_(SHEETS.USERS, actor.ID, { Photo: photo });
  return { ok: true, photo: photo };
}

// ============================================================
// SIGNATURE (dessinée par l'utilisateur dans « Mon compte »), colonne Signature de Utilisateurs.
// Elle sert sur les rapports hebdomadaires et les listes de présence. PNG réduit uniquement.
// ============================================================
function setSignature_(actor, p) {
  const sig = String(p.signature || '');
  if (sig === '') { updateRowById_(SHEETS.USERS, actor.ID, { Signature: '' }); return { ok: true, signature: '' }; }
  if (!/^data:image\/png;base64,[A-Za-z0-9+\/=]+$/.test(sig)) return { ok: false, error: 'Signature non valide (PNG attendu).' };
  if (sig.length > 45000) return { ok: false, error: 'Signature trop lourde : redessinez-la plus simplement.' };
  updateRowById_(SHEETS.USERS, actor.ID, { Signature: sig });
  return { ok: true, signature: sig };
}
function sigDe_(u) { return u && /^data:image\/png;base64,/.test(String(u.Signature || '')) ? u.Signature : ''; }

// Superviseurs de l'ASCQ (PF, RCSE, Département…) : pour cocher les « autres participants » d'un suivi groupé.
function listSuperviseurs_(actor) {
  if (actor.Role !== ROLES.ASCQ) return { ok: false, error: 'Réservé aux ASCQ.' };
  return { ok: true, superviseurs: chainAbove_(actor).filter(u => u.Role !== ROLES.NATIONAL).map(u => ({ ID: u.ID, Nom: u.Nom, Prenom: u.Prenom, Role: u.Role, Telephone: String(u.Telephone || '') })) };
}

const QUALIFICATION_ROLE = {
  RC: 'Relais communautaire (RC)', ASCQ: 'Agent de santé communautaire qualifié (ASCQ)',
  PF_CNLS_TP: 'Point focal CNLS-TP', RCSE: 'Responsable de la coordination de zone sanitaire (RCSE)',
  DEPARTEMENT: 'Coordination départementale (DDS)', NATIONAL: 'Niveau national'
};

// Liste de présence d'un suivi groupé : en-tête (département, zone sanitaire, commune, arrondissement,
// date) et un participant par ligne (ASCQ, RC présents, autres participants) avec qualification,
// provenance, contact et signature (celle enregistrée dans le compte de chacun, s'il en a une).
function getListePresence_(actor, p) {
  const s = readSheet_(SHEETS.SUIVIS).find(x => x.ID === p.suiviId);
  if (!s) return { ok: false, error: 'Suivi groupé introuvable.' };
  if (ascqIdsVisibles_(actor).indexOf(s.AscqId) === -1) return { ok: false, error: 'Ce suivi ne fait pas partie de votre périmètre.' };
  const users = readSheet_(SHEETS.USERS), parId = {};
  users.forEach(u => { parId[u.ID] = u; });
  const ascq = parId[s.AscqId];
  const chain = ascq ? chainAbove_(ascq) : [];
  const dep = chain.find(u => u.Role === ROLES.DEPARTEMENT);
  const header = {
    departement: (ascq && ascq.DepartementNom) || (dep && dep.DepartementNom) || '',
    zoneSanitaire: ascq ? zoneSanitaireDe_(ascq) : '',
    commune: (ascq && ascq.CommuneNom) || '',
    arrondissement: s.ArrondissementNom || (ascq && ascq.ArrondissementNom) || '',
    date: dateIso_(s.Date), lieu: s.Lieu || '', ascq: s.AscqNom || ''
  };
  const provenance = u => {
    if (u.Role === ROLES.RC) return u.VillageNom || '';
    if (u.Role === ROLES.ASCQ) return header.arrondissement || u.ArrondissementNom || '';
    if (u.Role === ROLES.PF) return u.CommuneNom || '';
    if (u.Role === ROLES.RCSE) return zoneSanitaireDe_(u);
    return u.DepartementNom || '';
  };
  const ligne = u => ({
    nom: ((u.Nom || '') + ' ' + (u.Prenom || '')).replace(/\s+/g, ' ').trim(), qualification: QUALIFICATION_ROLE[u.Role] || u.Role,
    provenance: provenance(u), telephone: String(u.Telephone || ''), signature: sigDe_(u)
  });
  const participants = [];
  if (ascq) participants.push(ligne(ascq));
  parseArr_(s.RcPresentsIds).forEach(id => { if (parId[id]) participants.push(ligne(parId[id])); });
  parseArr_(s.AutresPresentsIds).forEach(id => { if (parId[id]) participants.push(ligne(parId[id])); });
  // Autres acteurs saisis à la main (sans compte) : signature laissée vide pour signer après impression.
  parseArr_(s.AutresActeurs).forEach(a => participants.push({
    nom: ((a.nom || '') + ' ' + (a.prenom || '')).replace(/\s+/g, ' ').trim(), qualification: a.qualification || 'Autre acteur',
    provenance: a.provenance || '', telephone: a.telephone || '', signature: '', autreActeur: true
  }));
  participants.forEach((x, i) => { x.ordre = i + 1; });
  // Rapport de séance : affiché avec la liste de présence (thèmes développés, participation, preuves).
  const plan = s.PlanningId ? readSheet_(SHEETS.PLANNINGS).find(x => x.ID === s.PlanningId) : null;
  const rcPresents = parseArr_(s.RcPresentsNoms);
  const rapport = {
    themes: parseArr_(s.Themes), villages: parseArr_(s.VillageNoms), objectif: plan ? (plan.Objectif || '') : '',
    commentaires: String(s.Commentaires || ''), ascq: s.AscqNom || '', dateDepot: s.DateCreation ? String(s.DateCreation).slice(0, 10) : '',
    nbRcPresents: rcPresents.length, rcAbsents: parseArr_(s.RcAbsentsNoms), rcConvies: plan ? parseArr_(plan.RcConviesNoms) : [],
    nbAutres: parseArr_(s.AutresPresentsIds).length + parseArr_(s.AutresActeurs).length, nbParticipants: participants.length,
    photos: parseArr_(s.PhotosUrls), documents: parseArr_(s.DocumentsUrls).map(d => ({ nom: d.nom || 'Document', url: d.url || '' }))
  };
  return { ok: true, header: header, participants: participants, rapport: rapport };
}

// ============================================================
// TENDANCES : nombre de notifications par semaine épidémiologique d'une année, par événement
// ============================================================
// Arrondissements couverts par un compte (sert à proposer les filtres géographiques).
function arrondissementsDuPerimetre_(actor) {
  if (actor.Role === ROLES.NATIONAL) return readSheet_(SHEETS.ARRONDISSEMENTS).map(a => a.ID);
  if (actor.Role === ROLES.RC) return actor.ArrondissementId ? [actor.ArrondissementId] : [];
  if (actor.Role === ROLES.ASCQ) return arrondissementsOfAscq_(actor.ID);
  if (actor.Role === ROLES.PF) return arrondissementsOfPf_(actor.ID);
  if (actor.Role === ROLES.RCSE) return arrondissementsOfRcse_(actor.ID);
  if (actor.Role === ROLES.DEPARTEMENT) return arrondissementsOfDepartement_(actor.DepartementId);
  return [];
}

function getTendances_(actor, p) {
  const arrSet = new Set(arrondissementsDuPerimetre_(actor).map(String));
  const arrs = readSheet_(SHEETS.ARRONDISSEMENTS).filter(a => arrSet.has(String(a.ID)));
  const comSet = new Set(arrs.map(a => String(a.CommuneId)));
  const coms = readSheet_(SHEETS.COMMUNES).filter(c => comSet.has(String(c.ID)));
  const vils = readSheet_(SHEETS.VILLAGES).filter(v => arrSet.has(String(v.ArrondissementId)));
  const deps = {}; coms.forEach(c => { if (c.DepartementId) deps[c.DepartementId] = c.DepartementNom || c.DepartementId; });
  const options = {
    departements: Object.keys(deps).map(id => ({ id, nom: deps[id] })),
    communes: coms.map(c => ({ id: c.ID, nom: c.Nom, parent: c.DepartementId })),
    arrondissements: arrs.map(a => ({ id: a.ID, nom: a.Nom, parent: a.CommuneId })),
    villages: vils.map(v => ({ id: v.ID, nom: v.Nom, parent: v.ArrondissementId }))
  };
  const f = p.filtre || {};
  const comDuDep = f.departementId ? new Set(coms.filter(c => String(c.DepartementId) === String(f.departementId)).map(c => String(c.ID))) : null;
  const garde = r => (!f.villageId || String(r.VillageId) === String(f.villageId))
    && (!f.arrondissementId || String(r.ArrondissementId) === String(f.arrondissementId))
    && (!f.communeId || String(r.CommuneId) === String(f.communeId))
    && (!comDuDep || comDuDep.has(String(r.CommuneId)));
  const alertes = listScoped_(SHEETS.ALERTES, actor).filter(garde);
  const deces = listScoped_(SHEETS.DECES, actor).filter(d => d.Statut !== 'Non confirmé').filter(garde);
  const anneeCourante = Number(nowStr_().slice(0, 4));
  const annees = {}; annees[anneeCourante] = true;
  alertes.concat(deces).forEach(r => { if (Number(r.Annee)) annees[Number(r.Annee)] = true; });
  readSheet_(SHEETS.CALENDRIER).forEach(r => { if (Number(r.Annee)) annees[Number(r.Annee)] = true; });
  const annee = Number(p.annee) || anneeCourante;
  let nb = 52;
  readSheet_(SHEETS.CALENDRIER).filter(r => Number(r.Annee) === annee).forEach(r => { if (Number(r.SemaineEpi) > nb) nb = Math.min(Number(r.SemaineEpi), 53); });
  const vide = () => { const t = []; for (let i = 0; i < nb; i++) t.push(0); return t; };
  const agreger = (rows, cleType, libelle) => {
    const total = vide(), parType = {};
    rows.filter(r => Number(r.Annee) === annee).forEach(r => {
      const w = Number(r.SemaineEpi); if (!(w >= 1 && w <= nb)) return;
      total[w - 1]++;
      const t = libelle(r) || 'Non précisé';
      if (!parType[t]) parType[t] = vide();
      parType[t][w - 1]++;
    });
    return { total, parType };
  };
  return {
    ok: true, options, annee, annees: Object.keys(annees).map(Number).sort((a, b) => b - a), nbSemaines: nb,
    alertes: agreger(alertes, 'TypeAlerte', r => r.TypeAlerte),
    deces: agreger(deces, 'TypeDeces', r => TYPES_DECES_LABELS[String(r.TypeDeces)] || 'Décès communautaire')
  };
}

// ============================================================
// NETTOYAGE DES DONNÉES (compte NATIONAL uniquement)
// ============================================================
const CATEGORIES_NETTOYAGE_ = {
  alertes:       { label: 'Alertes et investigations', sheets: ['ALERTES', 'INVESTIGATIONS'] },
  deces:         { label: 'Décès notifiés', sheets: ['DECES'] },
  rapports:      { label: 'Rapports hebdomadaires', sheets: ['RAPPORTS'] },
  suivis:        { label: 'Suivis groupés et plannings', sheets: ['SUIVIS', 'PLANNINGS'] },
  activites:     { label: 'Activités (liens, formations, tests)', sheets: ['ACTIVITES', 'ACTIVITES_SUIVI'] },
  notifications: { label: 'Notifications', sheets: ['NOTIFICATIONS'] },
  journal:       { label: 'Journal des assignations', sheets: ['JOURNAL'] },
  calendrier:    { label: 'Calendrier épidémiologique', sheets: ['CALENDRIER'] },
  geographie:    { label: 'Géographie (départements, communes, arrondissements, villages, grappes, périmètres)', sheets: ['DEPARTEMENTS', 'COMMUNES', 'ARRONDISSEMENTS', 'VILLAGES', 'GRAPPES', 'PERIMETRES'] },
  comptes:       { label: 'Tous les comptes SAUF les comptes NATIONAL', special: 'comptes' }
};

function nbLignes_(sheetName) { const sh = ss_().getSheetByName(sheetName); return sh ? Math.max(sh.getLastRow() - 1, 0) : 0; }

// Catégories réservées au compte national (données globales de la plateforme).
const CATEGORIES_NATIONAL_SEUL_ = ['journal', 'calendrier', 'geographie'];

// Comptes situés sous `actor` dans la hiérarchie (toute la descendance, via ResponsableId).
function descendantsComptes_(actor) {
  const users = readSheet_(SHEETS.USERS), res = [];
  const vus = new Set([String(actor.ID)]), file = [String(actor.ID)];
  for (let k = 0; k < file.length; k++) {
    users.filter(u => String(u.ResponsableId) === file[k] && !vus.has(String(u.ID))).forEach(u => { vus.add(String(u.ID)); file.push(String(u.ID)); res.push(u); });
  }
  return res;
}

// Pour un superviseur non national : { feuille: Set(ID) } des lignes de SON périmètre, par catégorie.
function lignesDuPerimetre_(actor, cat) {
  const ids = rows => new Set(rows.map(r => String(r.ID)));
  const desc = descendantsComptes_(actor);
  switch (cat) {
    case 'alertes': return { [SHEETS.ALERTES]: ids(listScopedBrut_(SHEETS.ALERTES, actor)), [SHEETS.INVESTIGATIONS]: ids(listScopedBrut_(SHEETS.INVESTIGATIONS, actor)) };
    case 'deces': return { [SHEETS.DECES]: ids(listScopedBrut_(SHEETS.DECES, actor)) };
    case 'rapports': {
      const moi = new Set([String(actor.ID)].concat(desc.map(u => String(u.ID))));
      return { [SHEETS.RAPPORTS]: ids(readSheet_(SHEETS.RAPPORTS).filter(r => moi.has(String(r.CompteId)))) };
    }
    case 'suivis': return { [SHEETS.SUIVIS]: ids(listScoped_(SHEETS.SUIVIS, actor)), [SHEETS.PLANNINGS]: ids(listScoped_(SHEETS.PLANNINGS, actor)) };
    case 'activites': {
      const mes = readSheet_(SHEETS.ACTIVITES).filter(a => String(a.CreeParId) === String(actor.ID));
      const idA = new Set(mes.map(a => String(a.ID)));
      return { [SHEETS.ACTIVITES]: ids(mes), [SHEETS.ACTIVITES_SUIVI]: ids(readSheet_(SHEETS.ACTIVITES_SUIVI).filter(x => idA.has(String(x.ActiviteId)))) };
    }
    case 'notifications': return { [SHEETS.NOTIFICATIONS]: ids(readSheet_(SHEETS.NOTIFICATIONS).filter(n => String(n.DestinataireId) === String(actor.ID))) };
    case 'comptes': return { [SHEETS.USERS]: new Set(desc.map(u => String(u.ID))) };
  }
  return {};
}

// Hors national : seulement les paramétrages (comptes subordonnés, activités qu'on a soi-même créées).
// Les données collectées (alertes, décès, investigations, rapports, suivis) ne sont JAMAIS supprimables par eux.
const LABELS_NETTOYAGE_PERIMETRE_ = {
  activites: 'Activités que j\'ai créées (et leur suivi)',
  comptes: 'Comptes en dessous de moi (subordonnés)'
};

function apercuNettoyage_(actor) {
  if (!(RANG_ROLE_[actor.Role] >= 1)) return { ok: false, error: 'Réservé aux niveaux supérieurs au relais communautaire.' };
  if (actor.Role === ROLES.NATIONAL) {
    const cats = Object.keys(CATEGORIES_NETTOYAGE_).map(k => {
      const c = CATEGORIES_NETTOYAGE_[k];
      const n = c.special === 'comptes' ? readSheet_(SHEETS.USERS).filter(u => u.Role !== ROLES.NATIONAL).length : c.sheets.reduce((t, sn) => t + nbLignes_(SHEETS[sn]), 0);
      return { id: k, label: c.label, nb: n };
    });
    return { ok: true, portee: 'national', categories: cats };
  }
  const cats = Object.keys(LABELS_NETTOYAGE_PERIMETRE_).map(k => {
    const m = lignesDuPerimetre_(actor, k);
    return { id: k, label: LABELS_NETTOYAGE_PERIMETRE_[k], nb: Object.keys(m).reduce((t, sn) => t + m[sn].size, 0) };
  });
  return { ok: true, portee: 'perimetre', categories: cats };
}

function viderFeuille_(sheetName) {
  const sh = ss_().getSheetByName(sheetName);
  if (!sh) return 0;
  const n = sh.getLastRow() - 1;
  if (n > 0) sh.deleteRows(2, n);
  invaliderCacheFeuille_(sheetName);
  return Math.max(n, 0);
}

function nettoyerDonnees_(actor, p) {
  if (!(RANG_ROLE_[actor.Role] >= 1)) return { ok: false, error: 'Réservé aux niveaux supérieurs au relais communautaire.' };
  if (String(p.confirmation || '').trim().toUpperCase() !== 'SUPPRIMER') return { ok: false, error: 'Tapez SUPPRIMER pour confirmer.' };
  const demandees = Array.isArray(p.categories) ? p.categories : [];
  const resultat = {};
  if (actor.Role === ROLES.NATIONAL) {
    const cats = demandees.filter(k => CATEGORIES_NETTOYAGE_[k]);
    if (!cats.length) return { ok: false, error: 'Choisissez au moins une catégorie.' };
    cats.forEach(k => {
      const c = CATEGORIES_NETTOYAGE_[k];
      if (c.special === 'comptes') {
        const aSupprimer = new Set(readSheet_(SHEETS.USERS).filter(u => u.Role !== ROLES.NATIONAL).map(u => String(u.ID)));
        deleteRowsWhereIn_(SHEETS.USERS, 'ID', aSupprimer);
        deleteRowsWhereIn_(SHEETS.SESSIONS, 'UserId', aSupprimer);
        resultat[k] = aSupprimer.size;
      } else resultat[k] = c.sheets.reduce((t, sn) => t + viderFeuille_(SHEETS[sn]), 0);
    });
    return { ok: true, supprime: resultat };
  }
  const cats = demandees.filter(k => LABELS_NETTOYAGE_PERIMETRE_[k]);
  if (!cats.length) return { ok: false, error: 'Choisissez au moins une catégorie.' };
  // Calcul de tous les périmètres AVANT toute suppression (les comptes supprimés changeraient le calcul).
  const plan = cats.map(k => ({ k, m: lignesDuPerimetre_(actor, k) }));
  plan.forEach(({ k, m }) => {
    let n = 0;
    Object.keys(m).forEach(sn => {
      if (!m[sn].size) return;
      n += m[sn].size;
      deleteRowsWhereIn_(sn, 'ID', m[sn]);
      if (sn === SHEETS.USERS) {
        deleteRowsWhereIn_(SHEETS.SESSIONS, 'UserId', m[sn]);
        deleteRowsWhereIn_(SHEETS.PERIMETRES, 'UserId', m[sn]);
        deleteRowsWhereIn_(SHEETS.NOTIFICATIONS, 'DestinataireId', m[sn]);
      }
    });
    resultat[k] = n;
  });
  return { ok: true, supprime: resultat };
}

// ============================================================
// ACTIVITÉS : liens de collecte de données, formations, tests... publiés par un niveau supérieur
// ============================================================
// Règle : seul un niveau SUPÉRIEUR peut demander une activité à un niveau INFÉRIEUR de sa propre
// hiérarchie (NATIONAL > DEPARTEMENT > RCSE > PF > ASCQ > RC). Le RC ne peut en créer aucune.
const RANG_ROLE_ = { RC: 0, ASCQ: 1, PF_CNLS_TP: 2, RCSE: 3, DEPARTEMENT: 4, NATIONAL: 5 };
const TYPE_TACHE_ = 'Tâche (recensement et suivi)';
const TYPE_COLLECTE_ = 'Collecte de données';
const TYPES_ACTIVITE_ = ['Collecte de données', TYPE_TACHE_, 'Formation', 'Test / Quiz', 'Information / Document', 'Autre'];
function estTache_(a) { return a && a.Type === TYPE_TACHE_; }
// Questionnaire simple d'une « Collecte de données » (questions ouvertes, fermées, à choix multiples, oui/non, nombre, date).
function questionnaireSimpleDe_(a) {
  try { const q = JSON.parse((a && a.Questionnaire) || '{}'); if (Array.isArray(q.champs) && q.champs.length) return { champs: q.champs, seq: Number(q.seq) || q.champs.length }; } catch (e) { /* pas de questionnaire */ }
  return null;
}
function aQuestionnaireSimple_(a) { return !!a && a.Type === TYPE_COLLECTE_ && !!questionnaireSimpleDe_(a); }
function nettoyerQuestionnaireSimple_(q) {
  const champs = nettoyerChamps_(q && q.champs, 'Questionnaire');
  if (!champs.length) throw new Error('Ajoutez au moins une question au questionnaire.');
  return verifierTailleQuestionnaire_({ champs: champs, seq: champs.length });
}
function fusionnerQuestionnaireSimple_(ancien, nouveau) {
  const anc = ancien.champs || [], num = id => Number(String(id).replace(/\D/g, '')) || 0;
  let seq = Math.max(Number(ancien.seq) || 0, anc.reduce((m, c) => Math.max(m, num(c.id)), 0));
  const vus = {}, out = [], srcs = [];
  (Array.isArray(nouveau && nouveau.champs) ? nouveau.champs : []).slice(0, 40).forEach(c => {
    const label = coupe_(c && c.label, 140); if (!label) return;
    const existant = c.id ? anc.find(x => x.id === c.id) : null;
    if (existant && vus[existant.id]) return;
    const type = TYPES_CHAMP_.indexOf(c.type) !== -1 ? c.type : (existant ? existant.type : 'texte');
    const options = optionsQuestion_(c, type, label, 'Questionnaire');
    const id = existant ? existant.id : 'c' + (++seq);
    if (existant) vus[id] = true;
    out.push({ id: id, label: label, type: type, options: options, obligatoire: type === 'calcul' ? false : !!c.obligatoire }); srcs.push(c);
  });
  if (!out.length) throw new Error('Gardez au moins une question dans le questionnaire.');
  resoudreFormules_(out, srcs, 'Questionnaire');
  resoudreLiensQ_(out, srcs, 'Questionnaire');
  return verifierTailleQuestionnaire_({ champs: out, seq: seq });
}
function estContinue_(a) { return !!a && String(a.EnContinu) === 'Oui'; }

function aujourdhuiIso_() { return nowStr_().slice(0, 10); }
// Une activité n'est visible des subalternes que jusqu'à son échéance incluse.
function activiteEcheue_(a) { const d = dateIso_(a.DateLimite); return !!d && d < aujourdhuiIso_(); }

function lienValide_(l) { return /^https?:\/\/[^\s]+$/i.test(String(l || '').trim()); }

// Comptes de la hiérarchie de `actor` appartenant à l'un des rôles ciblés.
function comptesCiblesActivite_(actor, roles, act) {
  const filtreGeo = act ? filtreGeoActivite_(act) : null;
  return readSheet_(SHEETS.USERS).filter(u => roles.includes(u.Role) && u.Actif !== false && u.Actif !== 'FALSE' && isSupervisorOf_(actor, u) && (!filtreGeo || filtreGeo(u)));
}

// ---- Ciblage géographique d'une activité (commune(s) et/ou arrondissement(s) concerné(s)) ----
// Sans ciblage, l'activité concerne tous les comptes des niveaux choisis dans la hiérarchie du demandeur.
// Avec ciblage : un compte la reçoit si sa commune (ou son arrondissement pour un RC / ASCQ) est concerné(e).
function fabriqueGeo_() {
  const arrById = {}; readSheet_(SHEETS.ARRONDISSEMENTS).forEach(a => { arrById[a.ID] = a; });
  const perParUser = {}; readSheet_(SHEETS.PERIMETRES).forEach(x => { (perParUser[x.UserId] = perParUser[x.UserId] || []).push(x); });
  const fn = function (u) {
    const arrs = new Set(), coms = new Set();
    if (u.ArrondissementId) arrs.add(u.ArrondissementId);
    if (u.CommuneId) coms.add(u.CommuneId);
    (perParUser[u.ID] || []).forEach(x => { if (x.TypeCible === 'Arrondissement') arrs.add(x.CibleId); else if (x.TypeCible === 'Commune') coms.add(x.CibleId); });
    arrs.forEach(id => { const a = arrById[id]; if (a && a.CommuneId) coms.add(a.CommuneId); });
    return { arrs: arrs, coms: coms };
  };
  fn.arrById = arrById;
  return fn;
}
function filtreGeoActivite_(act) {
  const A = parseArr_(act.CibleArrondissements), C = parseArr_(act.CibleCommunes);
  if (!A.length && !C.length) return function () { return true; };
  const geo = fabriqueGeo_();
  return function (u) {
    const g = geo(u);
    if (C.length && !C.some(id => g.coms.has(id))) return false;
    if (A.length) {
      if (RANG_ROLE_[u.Role] <= 1) return A.some(id => g.arrs.has(id));        // RC / ASCQ : leur arrondissement
      return A.some(id => { const a = geo.arrById[id]; return !!a && g.coms.has(a.CommuneId); }); // PF et au-dessus : la commune de l'arrondissement
    }
    return true;
  };
}
// Valide la zone choisie par le demandeur (dans son propre périmètre) et fabrique le libellé affiché.
function ciblageGeoDemande_(actor, p) {
  const ids = v => (Array.isArray(v) ? v : []).map(String).filter(Boolean).filter((x, i, a) => a.indexOf(x) === i).slice(0, 600);
  const C = ids(p.cibleCommunes), A = ids(p.cibleArrondissements);
  if (!C.length && !A.length) return { communes: [], arrondissements: [], libelle: '' };
  const coms = readSheet_(SHEETS.COMMUNES), arrs = readSheet_(SHEETS.ARRONDISSEMENTS);
  const geo = fabriqueGeo_(), g = geo(actor);
  const comsOk = new Set();
  if (actor.Role === ROLES.NATIONAL) coms.forEach(c => comsOk.add(c.ID));
  else if (actor.Role === ROLES.DEPARTEMENT) coms.filter(c => c.DepartementId === actor.DepartementId).forEach(c => comsOk.add(c.ID));
  else g.coms.forEach(id => comsOk.add(id));
  const arrsOk = a => actor.Role === ROLES.ASCQ ? g.arrs.has(a.ID) : comsOk.has(a.CommuneId);
  for (const id of C) if (!comsOk.has(id)) return { err: 'Une des communes choisies n\'est pas dans votre zone.' };
  const Aobj = A.map(id => arrs.find(a => a.ID === id));
  for (const a of Aobj) if (!a || !arrsOk(a)) return { err: 'Un des arrondissements choisis n\'est pas dans votre zone.' };
  const nomsC = C.map(id => (coms.find(c => c.ID === id) || {}).Nom).filter(Boolean);
  const nomsA = Aobj.map(a => a.Nom);
  const libelle = [nomsC.length ? 'Communes : ' + nomsC.join(', ') : '', nomsA.length ? 'Arrondissements : ' + nomsA.join(', ') : ''].filter(Boolean).join(' · ');
  return { communes: C, arrondissements: A, libelle: coupe_(libelle, 900) };
}

function createActivite_(actor, p) {
  if (!(RANG_ROLE_[actor.Role] >= 1)) return { ok: false, error: 'Votre niveau ne permet pas de demander une activité.' };
  const titre = String(p.titre || '').trim();
  if (titre.length < 3) return { ok: false, error: 'Donnez un titre à l\'activité.' };
  const type = TYPES_ACTIVITE_.includes(p.type) ? p.type : 'Autre';
  const lien = String(p.lien || '').trim();
  if (lien && !lienValide_(lien)) return { ok: false, error: 'Le lien doit commencer par http:// ou https://.' };
  const veutQuestionnaire = type === TYPE_COLLECTE_ && p.questionnaire && Array.isArray(p.questionnaire.champs) && p.questionnaire.champs.length > 0;
  if (!lien && type !== 'Information / Document' && type !== TYPE_TACHE_ && !veutQuestionnaire) return { ok: false, error: type === TYPE_COLLECTE_ ? 'Ajoutez le lien du formulaire ou rédigez un questionnaire dans la plateforme.' : 'Ajoutez le lien du formulaire, de la formation ou du test.' };
  let questionnaire = '';
  if (veutQuestionnaire) {
    try { questionnaire = JSON.stringify(nettoyerQuestionnaireSimple_(p.questionnaire)); } catch (e) { return { ok: false, error: e.message }; }
  }
  if (type === TYPE_TACHE_) {
    const q = nettoyerQuestionnaire_(p.questionnaire); // lève une erreur claire si le questionnaire est incomplet
    questionnaire = JSON.stringify(q);
  }
  // Une tâche (recensement et suivi) est toujours remplie par les relais communautaires.
  if (type === TYPE_TACHE_) p.cibleRoles = ['RC'];
  const roles = (Array.isArray(p.cibleRoles) ? p.cibleRoles : []).filter(r => RANG_ROLE_[r] !== undefined && RANG_ROLE_[r] < RANG_ROLE_[actor.Role]);
  if (!roles.length) return { ok: false, error: 'Choisissez au moins un niveau destinataire, situé en dessous du vôtre.' };
  const geo = ciblageGeoDemande_(actor, p);
  if (geo.err) return { ok: false, error: geo.err };
  const cibles = comptesCiblesActivite_(actor, roles, { CibleCommunes: JSON.stringify(geo.communes), CibleArrondissements: JSON.stringify(geo.arrondissements) });
  if (!cibles.length) return { ok: false, error: geo.libelle ? 'Aucun compte actif de ce(s) niveau(x) dans la zone choisie (' + geo.libelle + ').' : 'Aucun compte actif de ce(s) niveau(x) dans votre hiérarchie pour le moment.' };
  // L'échéance est facultative : sans date, l'activité reste ouverte jusqu'à son archivage.
  if (p.dateLimite && dateIso_(p.dateLimite) < aujourdhuiIso_()) return { ok: false, error: 'L\'échéance ne peut pas être dans le passé.' };
  const rec = {
    ID: newId_('ACT'), Type: type, Titre: titre, Description: String(p.description || '').trim(), Lien: lien,
    DateLimite: p.dateLimite ? dateIso_(p.dateLimite) : '', CreeParId: actor.ID, CreeParNom: actor.Prenom + ' ' + actor.Nom,
    CreeParRole: actor.Role, CibleRoles: JSON.stringify(roles), Statut: 'Active', Commentaires: '[]',
    DateCreation: nowStr_(), DateModification: nowStr_(), Questionnaire: questionnaire, EnContinu: p.enContinu ? 'Oui' : '',
    CibleCommunes: JSON.stringify(geo.communes), CibleArrondissements: JSON.stringify(geo.arrondissements), CibleGeoLibelle: geo.libelle
  };
  appendRow_(SHEETS.ACTIVITES, rec);
  notifierCiblesActivite_(cibles, rec, `Nouvelle activité (${type}) : ${titre}` + (rec.DateLimite ? ' - à faire avant le ' + rec.DateLimite.split('-').reverse().join('/') : '') + ` - demandée par ${rec.CreeParNom}` + (geo.libelle ? ' - zone : ' + geo.libelle : ''));
  return { ok: true, activite: rec, nbCibles: cibles.length };
}

function notifierCiblesActivite_(cibles, act, message) {
  appendRowsBulk_(SHEETS.NOTIFICATIONS, cibles.map(u => [newId_('NOTIF'), u.ID, 'ACTIVITE', act.ID, message, false, nowStr_()]));
}

// Une activité est visible par un compte si son rôle est ciblé ET que le créateur est au-dessus de lui.
function activiteVisiblePar_(act, user) {
  if (act.Statut !== 'Active') return false;
  const roles = parseArr_(act.CibleRoles);
  if (!roles.includes(user.Role)) return false;
  if (!chainAbove_(user).some(sup => sup.ID === act.CreeParId)) return false;
  if (!filtreGeoActivite_(act)(user)) return false;
  if (!activiteEcheue_(act)) return true;
  // Une tâche échue (plus de nouveaux cas) reste visible tant que le RC a des cas à suivre.
  return estTache_(act) && activitesAvecCasEnSuivi_(user.ID).has(act.ID);
}

function mesSuiviActivites_(userId) {
  const m = {};
  readSheet_(SHEETS.ACTIVITES_SUIVI).filter(x => x.UserId === userId).forEach(x => { m[x.ActiviteId] = x; });
  return m;
}

function listActivites_(actor) {
  const toutes = readSheet_(SHEETS.ACTIVITES);
  const suivi = mesSuiviActivites_(actor.ID);
  const chaine = chainAbove_(actor).map(u => u.ID);
  const casEnSuivi = actor.Role === ROLES.RC ? activitesAvecCasEnSuivi_(actor.ID) : new Set();
  const mesRealisations = {}; readSheet_(SHEETS.REALISATIONS).filter(x => x.UserId === actor.ID).forEach(x => { (mesRealisations[x.ActiviteId] = mesRealisations[x.ActiviteId] || []).push(x); });
  const mesCollectes = {}; readSheet_(SHEETS.COLLECTES).filter(x => x.UserId === actor.ID).forEach(x => { mesCollectes[x.ActiviteId] = (mesCollectes[x.ActiviteId] || 0) + 1; });
  const statsTaches = actor.Role === ROLES.RC ? statsTachesDuRc_(actor.ID) : {};
  const recues = toutes.filter(a => a.Statut === 'Active' && (!activiteEcheue_(a) || (estTache_(a) && casEnSuivi.has(a.ID))) && parseArr_(a.CibleRoles).includes(actor.Role) && chaine.includes(a.CreeParId) && filtreGeoActivite_(a)(actor))
    .map(a => Object.assign({}, a, { DateLimite: dateIso_(a.DateLimite), Echue: activiteEcheue_(a), MonStatut: estContinue_(a) ? 'En continu' : (suivi[a.ID] ? suivi[a.ID].Statut : 'À faire'), MaDate: suivi[a.ID] ? suivi[a.ID].Date : '' },
      estContinue_(a) ? { NbRealisations: (mesRealisations[a.ID] || []).length, DerniereRealisation: (mesRealisations[a.ID] || []).reduce((m, x) => { const d = dateIso_(x.Date); return d > m ? d : m; }, '') } : {},
      aQuestionnaireSimple_(a) ? { NbReponses: (mesCollectes[a.ID] || 0) } : {},
      estTache_(a) ? { NbCas: (statsTaches[a.ID] || {}).nbCas || 0, NbCasEnSuivi: (statsTaches[a.ID] || {}).enSuivi || 0, NbSuivisDus: (statsTaches[a.ID] || {}).dus || 0 } : {}));
  recues.sort((a, b) => String(b.DateCreation).localeCompare(String(a.DateCreation)));

  let creees = [];
  if (RANG_ROLE_[actor.Role] >= 1) {
    const tousSuivis = readSheet_(SHEETS.ACTIVITES_SUIVI);
    const tousRealisations = readSheet_(SHEETS.REALISATIONS);
    const users = readSheet_(SHEETS.USERS);
    creees = toutes.filter(a => a.CreeParId === actor.ID).map(a => {
      const filtreGeo = filtreGeoActivite_(a);
      const cibles = users.filter(u => parseArr_(a.CibleRoles).includes(u.Role) && u.Actif !== false && u.Actif !== 'FALSE' && isSupervisorOf_(actor, u) && filtreGeo(u));
      const ids = new Set(cibles.map(u => u.ID));
      const sv = tousSuivis.filter(x => x.ActiviteId === a.ID && ids.has(x.UserId));
      const casA = estTache_(a) ? readSheet_(SHEETS.TACHES_CAS).filter(c => c.ActiviteId === a.ID && ids.has(c.RcId)) : [];
      return Object.assign({}, a, { Echue: activiteEcheue_(a), DateLimite: dateIso_(a.DateLimite), NbCibles: cibles.length,
        NbFaits: sv.filter(x => x.Statut === 'Fait').length, NbOuverts: sv.filter(x => x.Statut === 'Ouvert').length },
        estTache_(a) ? { NbCas: casA.length, NbCasEnSuivi: casA.filter(c => etatCas_(c, aujourdhuiIso_()) === 'En suivi').length } : {},
        aQuestionnaireSimple_(a) ? (() => { const rc = readSheet_(SHEETS.COLLECTES).filter(x => x.ActiviteId === a.ID && ids.has(x.UserId)); return { NbReponses: rc.length, NbRepondants: new Set(rc.map(x => x.UserId)).size }; })() : {},
        estContinue_(a) ? (() => { const rl = tousRealisations.filter(x => x.ActiviteId === a.ID && ids.has(x.UserId)); return { NbRealisations: rl.length, NbCiblesActives: new Set(rl.map(x => x.UserId)).size }; })() : {});
    }).sort((x, y) => String(y.DateCreation).localeCompare(String(x.DateCreation)));
  }
  return { ok: true, recues, creees, peutCreer: RANG_ROLE_[actor.Role] >= 1 };
}

function activiteDuCreateur_(actor, id) {
  const a = readSheet_(SHEETS.ACTIVITES).find(x => x.ID === id);
  if (!a) return { err: 'Activité introuvable.' };
  if (a.CreeParId !== actor.ID && actor.Role !== ROLES.NATIONAL) return { err: 'Seul le demandeur de l\'activité peut la modifier.' };
  return { a };
}

function getActiviteDetail_(actor, p) {
  const r = activiteDuCreateur_(actor, p.id); if (r.err) return { ok: false, error: r.err };
  const a = r.a;
  const suivi = {};
  readSheet_(SHEETS.ACTIVITES_SUIVI).filter(x => x.ActiviteId === a.ID).forEach(x => { suivi[x.UserId] = x; });
  const reals = {}; readSheet_(SHEETS.REALISATIONS).filter(x => x.ActiviteId === a.ID).forEach(x => { (reals[x.UserId] = reals[x.UserId] || []).push(x); });
  const filtreGeoDetail = filtreGeoActivite_(a);
  const cibles = readSheet_(SHEETS.USERS).filter(u => filtreGeoDetail(u) && parseArr_(a.CibleRoles).includes(u.Role) && u.Actif !== false && u.Actif !== 'FALSE' && isSupervisorOf_(actor.Role === ROLES.NATIONAL && a.CreeParId !== actor.ID ? { ID: a.CreeParId, Role: a.CreeParRole } : actor, u))
    .map(u => ({ id: u.ID, nom: u.Prenom + ' ' + u.Nom, role: u.Role, telephone: u.Telephone, lieu: u.VillageNom || u.ArrondissementNom || u.CommuneNom || u.ZoneSanitaireNom || u.DepartementNom || '',
      statut: estContinue_(a) ? (reals[u.ID] ? 'En continu' : 'Non ouvert') : (suivi[u.ID] ? suivi[u.ID].Statut : 'Non ouvert'), date: suivi[u.ID] ? suivi[u.ID].Date : '',
      nb: (reals[u.ID] || []).length, derniere: (reals[u.ID] || []).reduce((m, x) => { const d = dateIso_(x.Date); return d > m ? d : m; }, '') }));
  return { ok: true, activite: Object.assign({}, a, { DateLimite: dateIso_(a.DateLimite) }), cibles };
}

function updateActivite_(actor, p) {
  const r = activiteDuCreateur_(actor, p.id); if (r.err) return { ok: false, error: r.err };
  const ch = { DateModification: nowStr_() }, modifs = [];
  if (p.titre !== undefined && String(p.titre).trim() !== r.a.Titre) { if (String(p.titre).trim().length < 3) return { ok: false, error: 'Titre trop court.' }; ch.Titre = String(p.titre).trim(); modifs.push('titre'); }
  let nouvelleTache = false, quitteTache = false;
  if (p.type !== undefined && TYPES_ACTIVITE_.includes(p.type) && p.type !== r.a.Type) {
    if (p.type === TYPE_TACHE_ && !estTache_(r.a)) nouvelleTache = true;
    if (p.type !== TYPE_TACHE_ && estTache_(r.a)) {
      if (readSheet_(SHEETS.TACHES_CAS).some(c => c.ActiviteId === r.a.ID)) return { ok: false, error: 'Cette tâche a déjà des cas recensés : elle ne peut pas devenir une activité classique (supprimez-la ou archivez-la).' };
      quitteTache = true;
    }
    ch.Type = p.type; modifs.push('type');
  }
  const typeFinal = ch.Type || r.a.Type;
  if (p.description !== undefined && String(p.description).trim() !== String(r.a.Description || '')) { ch.Description = String(p.description).trim(); modifs.push('consignes'); }
  if (p.lien !== undefined) { const l = String(p.lien).trim(); if (l && !lienValide_(l)) return { ok: false, error: 'Le lien doit commencer par http:// ou https://.' }; if (l !== String(r.a.Lien || '')) { ch.Lien = l; modifs.push('lien'); } }
  // Échéance facultative : une valeur vide la supprime.
  if (p.dateLimite !== undefined) { const d = p.dateLimite ? dateIso_(p.dateLimite) : ''; if (d !== dateIso_(r.a.DateLimite)) { ch.DateLimite = d; modifs.push('échéance'); } }
  if (p.enContinu !== undefined && !!p.enContinu !== estContinue_(r.a)) { ch.EnContinu = p.enContinu ? 'Oui' : ''; modifs.push(p.enContinu ? 'activité en continu' : 'fin du mode continu'); }
  // Destinataires (niveaux ciblés) d'une activité classique ; une tâche reste destinée aux RC.
  if (p.cibleRoles !== undefined && typeFinal !== TYPE_TACHE_) {
    const roles = (Array.isArray(p.cibleRoles) ? p.cibleRoles : []).filter(x => RANG_ROLE_[x] !== undefined && RANG_ROLE_[x] < RANG_ROLE_[actor.Role]);
    if (!roles.length) return { ok: false, error: 'Cochez au moins un niveau destinataire.' };
    if (!comptesCiblesActivite_(actor, roles, r.a).length) return { ok: false, error: 'Aucun compte actif dans votre hiérarchie (et la zone ciblée) pour ces niveaux.' };
    if (quitteTache || JSON.stringify(roles) !== JSON.stringify(parseArr_(r.a.CibleRoles))) { ch.CibleRoles = JSON.stringify(roles); modifs.push('destinataires'); }
  }
  // Questionnaire d'une tâche : questions ajoutées, modifiées, déplacées ou retirées ; durée du suivi.
  let prolongation = null;
  if (nouvelleTache) {
    // Une activité classique devient une tâche : questionnaire obligatoire, destinataires = RC de la hiérarchie.
    let q; try { q = nettoyerQuestionnaire_(p.questionnaire); } catch (e) { return { ok: false, error: e.message }; }
    if (!comptesCiblesActivite_(actor, ['RC'], r.a).length) return { ok: false, error: 'Aucun relais communautaire actif dans votre hiérarchie (et la zone ciblée).' };
    ch.Questionnaire = JSON.stringify(q); ch.CibleRoles = JSON.stringify(['RC']); modifs.push('questionnaire');
  } else if (quitteTache) {
    ch.Questionnaire = '';
  } else if (p.questionnaire !== undefined && estTache_(r.a)) {
    const ancien = questionnaireDe_(r.a);
    let q; try { q = fusionnerQuestionnaire_(ancien, p.questionnaire); } catch (e) { return { ok: false, error: e.message }; }
    const avant = JSON.stringify({ a: ancien.champsCas, b: ancien.champsSuivi, d: ancien.dureeJours, s: ancien.suivisParJour, g: ancien.gpsSuivi, l: ancien.libellesSeances });
    if (JSON.stringify({ a: q.champsCas, b: q.champsSuivi, d: q.dureeJours, s: q.suivisParJour, g: q.gpsSuivi, l: q.libellesSeances }) !== avant) {
      ch.Questionnaire = JSON.stringify(q);
      if (q.dureeJours !== ancien.dureeJours) { modifs.push('durée du suivi'); prolongation = q.dureeJours; }
      if (q.suivisParJour !== ancien.suivisParJour) modifs.push('nombre de suivis par jour');
      if (q.gpsSuivi !== ancien.gpsSuivi) modifs.push('position GPS du suivi');
      if (JSON.stringify(q.libellesSeances) !== JSON.stringify(ancien.libellesSeances) && q.suivisParJour === ancien.suivisParJour) modifs.push('noms des suivis de la journée');
      if (JSON.stringify(q.champsCas) !== JSON.stringify(ancien.champsCas) || JSON.stringify(q.champsSuivi) !== JSON.stringify(ancien.champsSuivi)) modifs.push('questionnaire');
    }
  }
  // Questionnaire simple d'une « Collecte de données » : ajout, modification, retrait.
  const avaitQ = aQuestionnaireSimple_(r.a);
  const nbReponsesCollecte = () => readSheet_(SHEETS.COLLECTES).filter(x => x.ActiviteId === r.a.ID).length;
  if (r.a.Type === TYPE_COLLECTE_ && typeFinal !== TYPE_COLLECTE_ && avaitQ) {
    if (nbReponsesCollecte()) return { ok: false, error: 'Ce questionnaire a déjà reçu des réponses : supprimez-les d\'abord pour changer le type de l\'activité.' };
    ch.Questionnaire = '';
  } else if (typeFinal === TYPE_COLLECTE_ && p.questionnaire !== undefined) {
    const veut = p.questionnaire && Array.isArray(p.questionnaire.champs) && p.questionnaire.champs.length > 0;
    if (!veut) {
      if (avaitQ) {
        if (nbReponsesCollecte()) return { ok: false, error: 'Ce questionnaire a déjà reçu des réponses : vous ne pouvez pas le retirer (supprimez d\'abord les réponses).' };
        ch.Questionnaire = ''; modifs.push('questionnaire retiré');
      }
    } else {
      let q; try { q = avaitQ ? fusionnerQuestionnaireSimple_(questionnaireSimpleDe_(r.a), p.questionnaire) : nettoyerQuestionnaireSimple_(p.questionnaire); } catch (e) { return { ok: false, error: e.message }; }
      if (!avaitQ || JSON.stringify(q.champs) !== JSON.stringify(questionnaireSimpleDe_(r.a).champs)) { ch.Questionnaire = JSON.stringify(q); modifs.push('questionnaire'); }
    }
  }
  const aQApres = typeFinal === TYPE_COLLECTE_ && (ch.Questionnaire !== undefined ? !!ch.Questionnaire : avaitQ);
  if (typeFinal !== TYPE_TACHE_ && typeFinal !== 'Information / Document' && !aQApres && !String(ch.Lien !== undefined ? ch.Lien : (r.a.Lien || '')).trim()) return { ok: false, error: typeFinal === TYPE_COLLECTE_ ? 'Ajoutez le lien du formulaire ou rédigez un questionnaire dans la plateforme.' : 'Ajoutez le lien du formulaire, de la formation ou du test.' };
  // Zone ciblée (commune(s) / arrondissement(s)).
  if (p.cibleCommunes !== undefined || p.cibleArrondissements !== undefined) {
    const geo = ciblageGeoDemande_(actor, p);
    if (geo.err) return { ok: false, error: geo.err };
    const nouvelleC = JSON.stringify(geo.communes), nouvelleA = JSON.stringify(geo.arrondissements);
    if (nouvelleC !== JSON.stringify(parseArr_(r.a.CibleCommunes)) || nouvelleA !== JSON.stringify(parseArr_(r.a.CibleArrondissements))) {
      const rolesApres = typeFinal === TYPE_TACHE_ ? ['RC'] : parseArr_(ch.CibleRoles !== undefined ? ch.CibleRoles : r.a.CibleRoles);
      if (!comptesCiblesActivite_(actor, rolesApres, { CibleCommunes: nouvelleC, CibleArrondissements: nouvelleA }).length) return { ok: false, error: 'Aucun compte actif de ce(s) niveau(x) dans la zone choisie.' };
      ch.CibleCommunes = nouvelleC; ch.CibleArrondissements = nouvelleA; ch.CibleGeoLibelle = geo.libelle; modifs.push('zone ciblée');
    }
  }
  if (quitteTache && ch.CibleRoles === undefined) return { ok: false, error: 'Cochez au moins un niveau destinataire.' };
  if (p.statut !== undefined) { if (!['Active', 'Archivée'].includes(p.statut)) return { ok: false, error: 'Statut invalide.' }; ch.Statut = p.statut; }
  updateRowById_(SHEETS.ACTIVITES, r.a.ID, ch);
  // Nouvelle durée : s'applique aussi aux cas déjà recensés dont le suivi n'est pas clôturé.
  if (prolongation) {
    readSheet_(SHEETS.TACHES_CAS).filter(c => c.ActiviteId === r.a.ID && c.Statut !== 'Clôturé')
      .forEach(c => updateRowById_(SHEETS.TACHES_CAS, c.ID, { DateFinSuivi: ajouterJours_(dateIso_(c.DateEnregistrement), prolongation) }));
  }
  // Les destinataires sont prévenus de toute modification d'une activité en cours.
  const apres = Object.assign({}, r.a, ch);
  if (modifs.length && apres.Statut === 'Active') {
    const createur = { ID: r.a.CreeParId, Role: r.a.CreeParRole };
    notifierCiblesActivite_(comptesCiblesActivite_(createur, parseArr_(apres.CibleRoles), apres), apres,
      `Activité modifiée : « ${apres.Titre} » (${modifs.join(', ')}) - par ${r.a.CreeParNom}`);
  }
  return { ok: true, modifications: modifs };
}

// ---- Activités en continu : renseignements répétés (une ligne par réalisation)
function renseignerActivite_(actor, p) {
  const a = readSheet_(SHEETS.ACTIVITES).find(x => x.ID === p.activiteId);
  if (!a || !activiteVisiblePar_(a, actor)) return { ok: false, error: 'Activité introuvable pour votre compte.' };
  if (!estContinue_(a)) return { ok: false, error: 'Cette activité n\'est pas en continu : utilisez « J\'ai terminé ».' };
  const clientId = String(p.clientId || '');
  if (clientId) { const deja = readSheet_(SHEETS.REALISATIONS).find(x => x.ClientId === clientId && x.UserId === actor.ID); if (deja) return { ok: true, doublon: true }; }
  const auj = aujourdhuiIso_(), date = p.date ? dateIso_(p.date) : auj;
  if (date > auj) return { ok: false, error: 'La date ne peut pas être dans le futur.' };
  let nombre = '';
  if (p.nombre !== undefined && p.nombre !== null && p.nombre !== '') {
    const n = Number(p.nombre);
    if (!isFinite(n) || n < 0 || Math.floor(n) !== n || n > 1000000) return { ok: false, error: 'Le nombre doit être un entier positif ou nul.' };
    nombre = n;
  }
  const note = String(p.note || '').trim().slice(0, 600);
  const rec = { ID: newId_('REAL'), ActiviteId: a.ID, UserId: actor.ID, UserNom: actor.Prenom + ' ' + actor.Nom, Date: date, Nombre: nombre, Note: note, DateSaisie: dateSaisieClient_(p) || nowStr_(), ClientId: clientId };
  appendRow_(SHEETS.REALISATIONS, rec);
  return { ok: true, realisation: rec };
}
function listRealisations_(actor, p) {
  const a = readSheet_(SHEETS.ACTIVITES).find(x => x.ID === p.activiteId);
  if (!a || !estContinue_(a)) return { ok: false, error: 'Activité introuvable.' };
  let rows = readSheet_(SHEETS.REALISATIONS).filter(x => x.ActiviteId === a.ID);
  if (a.CreeParId === actor.ID || actor.Role === ROLES.NATIONAL) {
    const users = {}; readSheet_(SHEETS.USERS).forEach(u => { users[u.ID] = u; });
    const demandeur = actor.Role === ROLES.NATIONAL && a.CreeParId !== actor.ID ? { ID: a.CreeParId, Role: a.CreeParRole } : actor;
    rows = rows.filter(x => users[x.UserId] && isSupervisorOf_(demandeur, users[x.UserId]));
    rows = rows.map(x => Object.assign({}, x, { Lieu: (users[x.UserId].VillageNom || users[x.UserId].ArrondissementNom || '') }));
  } else rows = rows.filter(x => x.UserId === actor.ID);
  rows = rows.map(x => Object.assign({}, x, { Date: dateIso_(x.Date) })).sort((x, y) => (y.Date + y.ID).localeCompare(x.Date + x.ID));
  return { ok: true, realisations: rows, activite: { id: a.ID, titre: a.Titre }, enTantQueDemandeur: a.CreeParId === actor.ID || actor.Role === ROLES.NATIONAL };
}
// Le destinataire peut retirer ses propres lignes (erreur de saisie) ; le demandeur peut retirer n'importe quelle ligne de son activité.
function supprimerRealisations_(actor, p) {
  const a = readSheet_(SHEETS.ACTIVITES).find(x => x.ID === p.activiteId);
  if (!a) return { ok: false, error: 'Activité introuvable.' };
  const demandeur = a.CreeParId === actor.ID || actor.Role === ROLES.NATIONAL;
  const ids = (Array.isArray(p.ids) ? p.ids : []).map(String).slice(0, 2000);
  if (!ids.length) return { ok: false, error: 'Sélectionnez au moins une ligne.' };
  const rows = readSheet_(SHEETS.REALISATIONS).filter(x => x.ActiviteId === a.ID && ids.indexOf(String(x.ID)) !== -1 && (demandeur || x.UserId === actor.ID));
  if (!rows.length) return { ok: false, error: 'Aucune ligne supprimable parmi la sélection.' };
  deleteRowsWhereIn_(SHEETS.REALISATIONS, 'ID', new Set(rows.map(x => String(x.ID))));
  if (demandeur) {
    const parUser = {}; rows.forEach(x => { if (x.UserId !== actor.ID) parUser[x.UserId] = (parUser[x.UserId] || 0) + 1; });
    const users = readSheet_(SHEETS.USERS);
    Object.keys(parUser).forEach(uid => { const u = users.find(z => z.ID === uid); if (u) notifierComptes_([u], 'ACTIVITE', a.ID, `${parUser[uid]} de vos renseignements sur « ${a.Titre} » ont été supprimés par ${a.CreeParNom}.`); });
  }
  return { ok: true, supprimes: rows.length };
}

function commenterActivite_(actor, p) {
  const r = activiteDuCreateur_(actor, p.id); if (r.err) return { ok: false, error: r.err };
  const texte = String(p.texte || '').trim();
  if (!texte) return { ok: false, error: 'Le commentaire est vide.' };
  const com = parseArr_(r.a.Commentaires); com.push({ date: nowStr_(), auteur: actor.Prenom + ' ' + actor.Nom, texte });
  updateRowById_(SHEETS.ACTIVITES, r.a.ID, { Commentaires: JSON.stringify(com), DateModification: nowStr_() });
  if (r.a.Statut === 'Active' && !activiteEcheue_(r.a)) {
    const createur = { ID: r.a.CreeParId, Role: r.a.CreeParRole };
    notifierCiblesActivite_(comptesCiblesActivite_(createur, parseArr_(r.a.CibleRoles), r.a), r.a, `Nouveau commentaire sur l'activité « ${r.a.Titre} » : ${texte.slice(0, 140)}`);
  }
  return { ok: true };
}

function deleteActivite_(actor, p) {
  const r = activiteDuCreateur_(actor, p.id); if (r.err) return { ok: false, error: r.err };
  deleteRowById_(SHEETS.ACTIVITES, r.a.ID);
  deleteRowsWhere_(SHEETS.ACTIVITES_SUIVI, 'ActiviteId', r.a.ID);
  if (estTache_(r.a)) { deleteRowsWhere_(SHEETS.TACHES_CAS, 'ActiviteId', r.a.ID); deleteRowsWhere_(SHEETS.TACHES_SUIVIS, 'ActiviteId', r.a.ID); }
  deleteRowsWhere_(SHEETS.REALISATIONS, 'ActiviteId', r.a.ID);
  deleteRowsWhere_(SHEETS.COLLECTES, 'ActiviteId', r.a.ID);
  deleteRowsWhere_(SHEETS.COLLECTE_ANALYSES, 'ActiviteId', r.a.ID);
  return { ok: true };
}

// Un compte destinataire indique qu'il a ouvert le lien ou qu'il a terminé l'activité.
function marquerActivite_(actor, p) {
  const a = readSheet_(SHEETS.ACTIVITES).find(x => x.ID === p.id);
  if (!a || !activiteVisiblePar_(a, actor)) return { ok: false, error: 'Activité introuvable pour votre compte.' };
  if (!['Ouvert', 'Fait'].includes(p.statut)) return { ok: false, error: 'Statut invalide.' };
  if (estContinue_(a) && p.statut === 'Fait') return { ok: false, error: 'Cette activité est en continu : renseignez-la à chaque réalisation (il n\'y a pas de « terminé »).' };
  const ex = readSheet_(SHEETS.ACTIVITES_SUIVI).find(x => x.ActiviteId === a.ID && x.UserId === actor.ID);
  if (!ex) appendRow_(SHEETS.ACTIVITES_SUIVI, { ID: newId_('AS'), ActiviteId: a.ID, UserId: actor.ID, UserNom: actor.Prenom + ' ' + actor.Nom, Statut: p.statut, Date: nowStr_() });
  else if (p.statut === 'Fait' || ex.Statut !== 'Fait' || p.force) updateRowById_(SHEETS.ACTIVITES_SUIVI, ex.ID, { Statut: p.statut, Date: nowStr_() });
  return { ok: true };
}

// ============================================================
// TÂCHES « RECENSEMENT ET SUIVI » (activité de type tâche)
// ============================================================
// Le niveau supérieur rédige, DANS la plateforme, deux questionnaires :
//   • « champsCas »   : les informations clés demandées quand un RC recense un cas ;
//   • « champsSuivi » : le questionnaire de suivi que le RC remplit chaque jour pour ce cas.
// Un cas recensé est suivi pendant `dureeJours` jours (DateFinSuivi = date du recensement + durée).
// Les réponses sont enregistrées dans les feuilles TachesCas / TachesSuivis et consultées par le
// demandeur (et le National) dans l'onglet Activités > « Données collectées ».

// Types de questions : les tâches de suivi gardent la liste historique ; la collecte de données dispose de la liste complète.
const TYPES_TACHE_ = ['texte', 'texte_long', 'nombre', 'date', 'choix', 'choix_multiple', 'oui_non'];
const TYPES_CHAMP_ = TYPES_TACHE_.concat(['entier', 'decimal', 'heure', 'gps', 'signature', 'photo', 'calcul']);
const TYPES_NUMERIQUES_ = ['nombre', 'entier', 'decimal', 'oui_non', 'calcul'];

// Évaluateur de formules sans eval() (même code que assets/formules.js).
const Formules_ = (function () {
  // Évaluateur de formules arithmétiques SANS eval() — partagé entre le navigateur et Code.gs.
  // Syntaxe : nombres (1,5 ou 1.5), {c3} (réponse à une question), Nom (variable/paramètre), + - * / ^ ( ), comparaisons
  // (> < >= <= = != <>) qui rendent 1 ou 0, et les fonctions ABS RACINE ARRONDI(x;n) MIN MAX SOMME MOYENNE SI(cond;a;b).
  var FONCTIONS = { ABS: 1, RACINE: 1, ARRONDI: 1, MIN: 1, MAX: 1, SOMME: 1, MOYENNE: 1, SI: 1 };
  function tokeniser(s) {
    var t = [], i = 0, m;
    s = String(s == null ? '' : s);
    while (i < s.length) {
      var c = s.charAt(i);
      if (/\s/.test(c)) { i++; continue; }
      if (c === '{') { var j = s.indexOf('}', i); if (j < 0) throw new Error('Formule invalide : accolade « { » non fermée.'); t.push({ k: 'ref', v: s.slice(i + 1, j).trim() }); i = j + 1; continue; }
      if ((m = /^\d+(?:[.,]\d+)?/.exec(s.slice(i)))) { t.push({ k: 'num', v: parseFloat(m[0].replace(',', '.')) }); i += m[0].length; continue; }
      if ((m = /^[A-Za-zÀ-ÿ_][A-Za-zÀ-ÿ0-9_]*/.exec(s.slice(i)))) { t.push({ k: 'id', v: m[0] }); i += m[0].length; continue; }
      if ((m = /^(>=|<=|!=|<>|[><=+\-*\/^();])/.exec(s.slice(i)))) { t.push({ k: 'op', v: m[0] === '<>' ? '!=' : m[0] }); i += m[0].length; continue; }
      throw new Error('Formule invalide : caractère « ' + c + ' » non reconnu.');
    }
    return t;
  }
  function analyser(expr) {
    var t = tokeniser(expr), p = 0, refs = [], ids = [];
    if (!t.length) throw new Error('Formule vide.');
    function ahead() { return t[p]; }
    function op(v) { var x = t[p]; if (x && x.k === 'op' && x.v === v) { p++; return true; } return false; }
    function attendre(v) { if (!op(v)) throw new Error('Formule invalide : « ' + v + ' » attendu.'); }
    function comparaison() {
      var a = additif(), x = ahead();
      if (x && x.k === 'op' && ['>', '<', '>=', '<=', '=', '!='].indexOf(x.v) !== -1) { p++; return { n: 'cmp', o: x.v, a: a, b: additif() }; }
      return a;
    }
    function additif() { var a = terme(); while (ahead() && ahead().k === 'op' && (ahead().v === '+' || ahead().v === '-')) { var o = t[p++].v; a = { n: 'bin', o: o, a: a, b: terme() }; } return a; }
    function terme() { var a = puissance(); while (ahead() && ahead().k === 'op' && (ahead().v === '*' || ahead().v === '/')) { var o = t[p++].v; a = { n: 'bin', o: o, a: a, b: puissance() }; } return a; }
    function puissance() { var a = unaire(); if (op('^')) return { n: 'bin', o: '^', a: a, b: puissance() }; return a; }
    function unaire() { if (op('-')) return { n: 'neg', a: unaire() }; if (op('+')) return unaire(); return primaire(); }
    function primaire() {
      var x = t[p++];
      if (!x) throw new Error('Formule invalide : expression incomplète.');
      if (x.k === 'num') return { n: 'num', v: x.v };
      if (x.k === 'ref') { if (!x.v) throw new Error('Formule invalide : référence { } vide.'); if (refs.indexOf(x.v) === -1) refs.push(x.v); return { n: 'ref', v: x.v }; }
      if (x.k === 'id') {
        var nom = x.v.toUpperCase();
        if (ahead() && ahead().k === 'op' && ahead().v === '(' && FONCTIONS[nom]) {
          p++; var args = [];
          if (!op(')')) { do { args.push(comparaison()); } while (op(';')); attendre(')'); }
          if (nom === 'SI' && args.length !== 3) throw new Error('Formule invalide : SI(condition ; si_vrai ; si_faux) attend 3 valeurs.');
          if (nom === 'ARRONDI' && (args.length < 1 || args.length > 2)) throw new Error('Formule invalide : ARRONDI(valeur ; décimales).');
          if ((nom === 'ABS' || nom === 'RACINE') && args.length !== 1) throw new Error('Formule invalide : ' + nom + ' attend 1 valeur.');
          if ((nom === 'MIN' || nom === 'MAX' || nom === 'SOMME' || nom === 'MOYENNE') && !args.length) throw new Error('Formule invalide : ' + nom + ' attend au moins 1 valeur.');
          return { n: 'fn', f: nom, args: args };
        }
        if (FONCTIONS[nom] && ahead() && ahead().k === 'op' && ahead().v === '(') throw new Error('Formule invalide.');
        if (ids.indexOf(x.v) === -1) ids.push(x.v);
        return { n: 'id', v: x.v };
      }
      if (x.v === '(') { var e = comparaison(); attendre(')'); return e; }
      throw new Error('Formule invalide : « ' + x.v + ' » inattendu.');
    }
    var ast = comparaison();
    if (p < t.length) throw new Error('Formule invalide : « ' + t[p].v + ' » inattendu.');
    return { ast: ast, refs: refs, ids: ids };
  }
  // resolveur(type, nom) → nombre ou NaN (type : 'ref' | 'id'). Résultat NaN si une donnée manque ou division par zéro.
  function calculer(an, resolveur) {
    function ev(x) {
      switch (x.n) {
        case 'num': return x.v;
        case 'ref': return Number(resolveur('ref', x.v));
        case 'id': return Number(resolveur('id', x.v));
        case 'neg': return -ev(x.a);
        case 'cmp': { var a = ev(x.a), b = ev(x.b); if (isNaN(a) || isNaN(b)) return NaN; return ({ '>': a > b, '<': a < b, '>=': a >= b, '<=': a <= b, '=': Math.abs(a - b) < 1e-9, '!=': Math.abs(a - b) >= 1e-9 })[x.o] ? 1 : 0; }
        case 'bin': { var u = ev(x.a), v = ev(x.b); if (isNaN(u) || isNaN(v)) return NaN;
          if (x.o === '+') return u + v; if (x.o === '-') return u - v; if (x.o === '*') return u * v;
          if (x.o === '/') return v === 0 ? NaN : u / v; var r = Math.pow(u, v); return isFinite(r) ? r : NaN; }
        case 'fn': {
          if (x.f === 'SI') { var cnd = ev(x.args[0]); if (isNaN(cnd)) return NaN; return cnd !== 0 ? ev(x.args[1]) : ev(x.args[2]); }
          var vals = x.args.map(ev); if (vals.some(isNaN)) return NaN;
          if (x.f === 'ABS') return Math.abs(vals[0]);
          if (x.f === 'RACINE') return vals[0] < 0 ? NaN : Math.sqrt(vals[0]);
          if (x.f === 'ARRONDI') { var d = Math.max(0, Math.min(10, Math.round(vals[1] || 0))), f = Math.pow(10, d); return Math.round(vals[0] * f) / f; }
          if (x.f === 'MIN') return Math.min.apply(null, vals);
          if (x.f === 'MAX') return Math.max.apply(null, vals);
          if (x.f === 'SOMME') return vals.reduce(function (s, y) { return s + y; }, 0);
          return vals.reduce(function (s, y) { return s + y; }, 0) / vals.length;
        }
      }
      return NaN;
    }
    var r = ev(an.ast);
    return isFinite(r) ? Math.round(r * 1e9) / 1e9 : NaN;
  }
  return { analyser: analyser, calculer: calculer };
})();

// Conditions d'affichage (« Afficher cette question seulement si… ») — même code que assets/conditions.js.
const Conditions_ = (function () {
  var OPS = ['=', '!=', '>', '>=', '<', '<=', 'contient', 'ne_contient_pas', 'renseigne', 'vide'];
    function vide(v) { return v === '' || v == null || (Array.isArray(v) && v.length === 0); }
    function num(v) { if (v === '' || v == null || Array.isArray(v) || typeof v === 'object') return NaN; var n = Number(String(v).replace(',', '.')); return isFinite(n) ? n : NaN; }
    function regle(r, v) {
      var val = r.valeur == null ? '' : String(r.valeur);
      switch (r.op) {
        case 'renseigne': return !vide(v);
        case 'vide': return vide(v);
        case 'contient':
          if (Array.isArray(v)) return v.indexOf(val) !== -1;
          return String(v == null ? '' : v).toLowerCase().indexOf(val.toLowerCase()) !== -1;
        case 'ne_contient_pas': return !regle({ op: 'contient', valeur: val }, v);
        case '=': case '!=': {
          var egal;
          if (Array.isArray(v)) egal = v.length === 1 && v[0] === val;
          else if (vide(v)) egal = false;
          else { var a = num(v), b = num(val); egal = (isFinite(a) && isFinite(b)) ? a === b : String(v) === val; }
          return r.op === '=' ? egal : !egal;
        }
        default: {
          if (vide(v) || Array.isArray(v)) return false;
          var x = num(v), y = num(val), c;
          if (isFinite(x) && isFinite(y)) c = x < y ? -1 : (x > y ? 1 : 0);
          else { var s = String(v); c = s < val ? -1 : (s > val ? 1 : 0); }   // dates AAAA-MM-JJ et heures HH:MM : comparaison de texte
          return r.op === '>' ? c > 0 : r.op === '>=' ? c >= 0 : r.op === '<' ? c < 0 : r.op === '<=' ? c <= 0 : false;
        }
      }
    }
    // valeurDe(id) : réponse (texte, nombre ou liste) donnée à la question `id` ; une question masquée vaut « vide ».
    function evaluer(cond, valeurDe) {
      if (!cond || !Array.isArray(cond.regles) || !cond.regles.length) return true;
      var res = cond.regles.map(function (r) { return regle(r, valeurDe(r.champ)); });
      return cond.op === 'ou' ? res.some(Boolean) : res.every(Boolean);
    }
  return { OPS: OPS, evaluer: evaluer, regle: regle, vide: vide };
})();

// Liens entre questions d'une collecte : conditions d'affichage et choix en cascade (comme dans KoboToolbox).
// Le demandeur désigne la question source par son rang (« Q2 ») ; elle doit être placée AVANT la question concernée.
// Les liens sont stockés avec les identifiants (« c2 »), ce qui les protège des changements d'ordre ultérieurs.
const SOURCES_COND_EXCLUES_ = ['calcul', 'gps', 'signature', 'photo'];
function resoudreLiensQ_(out, srcs, lib) {
  const rang = (ref, i, c, nature) => {
    const m = /^Q(\d+)$/i.exec(String(ref || '').trim()), k = m ? Number(m[1]) - 1 : -1;
    if (k < 0 || k >= out.length || k >= i) throw new Error('Dans « ' + lib + ' », ' + nature + ' de « ' + c.label + ' » doit porter sur une question placée AVANT elle.');
    return k;
  };
  out.forEach((c, i) => {
    const s = srcs[i] || {};
    if (s.condition && Array.isArray(s.condition.regles) && s.condition.regles.length) {
      const regles = s.condition.regles.slice(0, 6).map(r => {
        const src = out[rang(r.champ, i, c, 'la condition d\'affichage')];
        if (SOURCES_COND_EXCLUES_.indexOf(src.type) !== -1) throw new Error('Condition de « ' + c.label + ' » : la question « ' + src.label + ' » ne peut pas servir de condition (calcul, GPS, signature ou photo).');
        const op = Conditions_.OPS.indexOf(r.op) !== -1 ? r.op : '=';
        let valeur = '';
        if (op !== 'renseigne' && op !== 'vide') {
          valeur = coupe_(r.valeur, 80);
          if (valeur === '') throw new Error('Condition de « ' + c.label + ' » : indiquez la valeur à comparer avec « ' + src.label + ' ».');
          if ((src.type === 'choix' || src.type === 'choix_multiple') && src.options.indexOf(valeur) === -1) throw new Error('Condition de « ' + c.label + ' » : « ' + valeur + ' » n\'est pas un choix de « ' + src.label + ' ».');
          if (src.type === 'oui_non' && valeur !== 'Oui' && valeur !== 'Non') throw new Error('Condition de « ' + c.label + ' » : choisissez Oui ou Non.');
          if (TYPES_NUMERIQUES_.indexOf(src.type) !== -1 && src.type !== 'oui_non' && !isFinite(Number(String(valeur).replace(',', '.')))) throw new Error('Condition de « ' + c.label + ' » : « ' + src.label + ' » se compare à un nombre.');
        }
        return { champ: src.id, op: op, valeur: valeur };
      });
      c.condition = { op: s.condition.op === 'ou' ? 'ou' : 'et', regles: regles };
    }
    if (s.cascade && s.cascade.champ) {
      if (c.type !== 'choix') throw new Error('Les choix en cascade ne s\'appliquent qu\'aux questions « Choix unique » (« ' + c.label + ' »).');
      const par = out[rang(s.cascade.champ, i, c, 'le choix en cascade')];
      if (par.type !== 'choix') throw new Error('Choix en cascade de « ' + c.label + ' » : la question parente « ' + par.label + ' » doit être un « Choix unique ».');
      const vu = {}, liens = [];
      (Array.isArray(s.cascade.liens) ? s.cascade.liens : []).slice(0, 2000).forEach(l => {
        const o = coupe_(l && l[0], 80), pv = coupe_(l && l[1], 80); if (!o || !pv || vu[o + '\u0001' + pv]) return;
        if (par.options.indexOf(pv) === -1) throw new Error('Choix en cascade de « ' + c.label + ' » : « ' + pv + ' » n\'existe pas parmi les choix de « ' + par.label + ' ».');
        vu[o + '\u0001' + pv] = 1; liens.push([o, pv]);
      });
      if (!liens.length) throw new Error('Choix en cascade de « ' + c.label + ' » : ajoutez des lignes « Choix | Valeur du parent ».');
      c.cascade = { champ: par.id, liens: liens };
      c.options = liens.map(l => l[0]).filter((o, k, a) => a.indexOf(o) === k);
    }
  });
}
// Les choix d'une question en cascade viennent de ses liens (jusqu'à 600 choix distincts) ; sinon 30 choix maximum.
function optionsQuestion_(c, type, label, lib) {
  if (type !== 'choix' && type !== 'choix_multiple') return [];
  if (type === 'choix' && c.cascade && c.cascade.champ) return (Array.isArray(c.cascade.liens) ? c.cascade.liens : []).map(l => coupe_(l && l[0], 80)).filter(Boolean).filter((o, k, a) => a.indexOf(o) === k).slice(0, 600);
  const options = (Array.isArray(c.options) ? c.options : []).map(o => coupe_(o, 80)).filter(Boolean).filter((o, k, a) => a.indexOf(o) === k).slice(0, 30);
  if (options.length < 2) throw new Error('Dans « ' + lib + ' », la question « ' + label + ' » doit proposer au moins 2 choix.');
  return options;
}
function optionsQuestionSimple_(c, label, lib) {
  const options = (Array.isArray(c.options) ? c.options : []).map(o => coupe_(o, 80)).filter(Boolean).filter((o, k, a) => a.indexOf(o) === k).slice(0, 30);
  if (options.length < 2) throw new Error('Dans « ' + lib + ' », la question « ' + label + ' » doit proposer au moins 2 choix.');
  return options;
}
function verifierTailleQuestionnaire_(q) { if (JSON.stringify(q).length > 44000) throw new Error('Le questionnaire est trop volumineux (listes de choix en cascade trop longues) : réduisez le nombre de choix ou de questions.'); return q; }

// Questions « Calcul automatique » : le demandeur désigne les autres questions par leur rang ({Q1}, {Q2}…) ; la formule est
// stockée avec les identifiants ({c3}), ce qui la protège des changements d'ordre ultérieurs.
function resoudreFormules_(out, srcs, lib) {
  out.forEach((c, i) => {
    if (c.type !== 'calcul') return;
    const brut = coupe_(srcs[i] && srcs[i].formule, 300);
    if (!brut) throw new Error('Dans « ' + lib + ' », le calcul « ' + c.label + ' » n\'a pas de formule.');
    const f = brut.replace(/\{\s*Q(\d+)\s*\}/gi, (m, n) => {
      const k = Number(n) - 1;
      if (k < 0 || k >= out.length || k === i) throw new Error('Calcul « ' + c.label + ' » : la question Q' + n + ' n\'existe pas ou désigne le calcul lui-même.');
      if (TYPES_NUMERIQUES_.indexOf(out[k].type) === -1) throw new Error('Calcul « ' + c.label + ' » : la question Q' + n + ' n\'est pas numérique.');
      if (out[k].type === 'calcul' && k > i) throw new Error('Calcul « ' + c.label + ' » : il ne peut utiliser qu\'un calcul placé avant lui dans la liste.');
      return '{' + out[k].id + '}';
    });
    let an; try { an = Formules_.analyser(f); } catch (e) { throw new Error('Calcul « ' + c.label + ' » : ' + e.message); }
    if (an.ids.length) throw new Error('Calcul « ' + c.label + ' » : « ' + an.ids[0] + ' » n\'est pas reconnu (désignez les questions par {Q1}, {Q2}…).');
    an.refs.forEach(r => { if (!out.some(o => o.id === r)) throw new Error('Calcul « ' + c.label + ' » : question inconnue {' + r + '}.'); });
    c.formule = f;
  });
}
const ISSUES_CAS_ = ['Guéri', 'Décédé', 'Référé / transféré', 'Perdu de vue', 'Autre'];

function nettoyerChamps_(arr, libelleListe, types) {
  const liste = Array.isArray(arr) ? arr.slice(0, 40) : [];
  const out = [], srcs = [];
  liste.forEach(c => {
    const label = coupe_(c && c.label, 140);
    if (!label) return;
    const type = (types || TYPES_CHAMP_).indexOf(c.type) !== -1 ? c.type : 'texte';
    const options = types ? ((type === 'choix' || type === 'choix_multiple') ? optionsQuestionSimple_(c, label, libelleListe) : []) : optionsQuestion_(c, type, label, libelleListe);
    out.push({ id: 'c' + (out.length + 1), label: label, type: type, options: options, obligatoire: type === 'calcul' ? false : !!c.obligatoire }); srcs.push(c);
  });
  resoudreFormules_(out, srcs, libelleListe);
  if (!types) resoudreLiensQ_(out, srcs, libelleListe);   // conditions et cascades : réservées aux collectes
  return out;
}

// Nombre de séances de suivi attendues par jour pour chaque cas (1 à 10 ; 1 = comportement historique).
function nombreSuivisParJour_(v, defaut) {
  if (v === undefined || v === null || v === '') return defaut;
  const n = Math.floor(Number(v));
  if (!isFinite(n) || n < 1 || n > 10) throw new Error('Le nombre de suivis par jour doit être compris entre 1 et 10.');
  return n;
}

// Position GPS à chaque suivi : 'non' (désactivée) | 'facultatif' (défaut) | 'obligatoire'.
function modeGpsSuivi_(v, defaut) {
  if (v === undefined || v === null || v === '') return defaut;
  if (['non', 'facultatif', 'obligatoire'].indexOf(v) === -1) throw new Error('Option GPS du suivi invalide.');
  return v;
}

// Nom de chaque suivi de la journée (matin, midi, soir… ou toute période choisie par le demandeur).
function libellesSeances_(arr, spj) {
  const src = Array.isArray(arr) ? arr : [];
  const out = [];
  for (let k = 0; k < spj; k++) out.push(coupe_(src[k], 40) || ('Séance ' + (k + 1)));
  return out;
}

function nettoyerQuestionnaire_(q) {
  q = q || {};
  const champsCas = nettoyerChamps_(q.champsCas, 'Informations du cas', TYPES_TACHE_);
  const champsSuivi = nettoyerChamps_(q.champsSuivi, 'Questionnaire de suivi', TYPES_TACHE_);
  if (!champsCas.length) throw new Error('Ajoutez au moins une question dans « Informations du cas à recenser ».');
  if (!champsSuivi.length) throw new Error('Ajoutez au moins une question dans le « Questionnaire de suivi ».');
  const duree = Math.floor(Number(q.dureeJours));
  if (!isFinite(duree) || duree < 1 || duree > 90) throw new Error('La durée du suivi doit être comprise entre 1 et 90 jours.');
  const spj = nombreSuivisParJour_(q.suivisParJour, 1);
  return { champsCas: champsCas, champsSuivi: champsSuivi, dureeJours: duree, suivisParJour: spj, libellesSeances: libellesSeances_(q.libellesSeances, spj), gpsSuivi: modeGpsSuivi_(q.gpsSuivi, 'facultatif'), seq: { champsCas: champsCas.length, champsSuivi: champsSuivi.length } };
}

// Modification d'un questionnaire déjà publié : les questions existantes (id connu) gardent leur identifiant,
// donc leurs réponses déjà collectées (tout reste modifiable : intitulé, type, choix, ordre). Les nouvelles questions reçoivent un id jamais utilisé.
function fusionnerQuestionnaire_(ancien, nouveau) {
  nouveau = nouveau || {};
  const out = { champsCas: [], champsSuivi: [], seq: {} };
  [['champsCas', 'Informations du cas'], ['champsSuivi', 'Questionnaire de suivi']].forEach(([cle, lib]) => {
    const anc = ancien[cle] || [];
    const num = id => Number(String(id).replace(/\D/g, '')) || 0;
    let seq = Math.max(Number((ancien.seq || {})[cle]) || 0, anc.reduce((m, c) => Math.max(m, num(c.id)), 0));
    const vus = {};
    (Array.isArray(nouveau[cle]) ? nouveau[cle] : []).slice(0, 40).forEach(c => {
      const label = coupe_(c && c.label, 140); if (!label) return;
      const existant = c.id ? anc.find(x => x.id === c.id) : null;
      if (existant && vus[existant.id]) return;
      const type = TYPES_TACHE_.indexOf(c.type) !== -1 ? c.type : (existant && TYPES_TACHE_.indexOf(existant.type) !== -1 ? existant.type : 'texte'); // le type reste modifiable ; les anciennes réponses sont conservées telles quelles
      let options = [];
      if (type === 'choix' || type === 'choix_multiple') {
        options = (Array.isArray(c.options) ? c.options : []).map(o => coupe_(o, 80)).filter(Boolean).filter((o, k, a) => a.indexOf(o) === k).slice(0, 30);
        if (options.length < 2) throw new Error('Dans « ' + lib + ' », la question « ' + label + ' » doit proposer au moins 2 choix.');
      }
      const id = existant ? existant.id : 'c' + (++seq);
      if (existant) vus[id] = true;
      out[cle].push({ id: id, label: label, type: type, options: options, obligatoire: !!c.obligatoire });
    });
    out.seq[cle] = seq;
  });
  if (!out.champsCas.length) throw new Error('Gardez au moins une question dans « Informations du cas à recenser ».');
  if (!out.champsSuivi.length) throw new Error('Gardez au moins une question dans le « Questionnaire de suivi ».');
  const duree = Math.floor(Number(nouveau.dureeJours === undefined ? ancien.dureeJours : nouveau.dureeJours));
  if (!isFinite(duree) || duree < 1 || duree > 90) throw new Error('La durée du suivi doit être comprise entre 1 et 90 jours.');
  out.dureeJours = duree;
  out.suivisParJour = nombreSuivisParJour_(nouveau.suivisParJour, ancien.suivisParJour || 1);
  out.gpsSuivi = modeGpsSuivi_(nouveau.gpsSuivi, ancien.gpsSuivi || 'facultatif');
  out.libellesSeances = libellesSeances_(nouveau.libellesSeances !== undefined ? nouveau.libellesSeances : ancien.libellesSeances, out.suivisParJour);
  return out;
}

function questionnaireDe_(a) {
  let q = {};
  try { q = JSON.parse(a.Questionnaire || '{}') || {}; } catch (e) { q = {}; }
  const spj = Math.min(10, Math.max(1, Math.floor(Number(q.suivisParJour)) || 1));
  return { champsCas: q.champsCas || [], champsSuivi: q.champsSuivi || [], dureeJours: Number(q.dureeJours) || 7, suivisParJour: spj,
    libellesSeances: libellesSeances_(q.libellesSeances, spj), gpsSuivi: ['non', 'obligatoire'].indexOf(q.gpsSuivi) !== -1 ? q.gpsSuivi : 'facultatif', seq: q.seq || {} };
}

// Valide et normalise les réponses d'un RC par rapport à la liste de questions.
function nettoyerReponses_(champs, rep) {
  rep = rep || {};
  const out = {}, masquees = {};
  champs.forEach(c => {
    // Condition d'affichage : une question masquée n'est ni obligatoire ni conservée (sa réponse éventuelle est ignorée).
    if (c.condition && !Conditions_.evaluer(c.condition, id => out[id])) { out[c.id] = c.type === 'choix_multiple' ? [] : ''; masquees[c.id] = true; return; }
    let v = rep[c.id];
    let vide = v === undefined || v === null || v === '' || (Array.isArray(v) && !v.length);
    if (!vide) {
      if (c.type === 'calcul') { vide = true; }
      else if (c.type === 'nombre' || c.type === 'decimal') { const n = Number(v); if (!isFinite(n)) throw new Error('Réponse numérique attendue : ' + c.label); v = n; }
      else if (c.type === 'entier') { const n = Number(v); if (!isFinite(n) || Math.floor(n) !== n) throw new Error('Nombre entier attendu : ' + c.label); v = n; }
      else if (c.type === 'heure') { if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(String(v))) throw new Error('Heure invalide : ' + c.label); v = String(v); }
      else if (c.type === 'gps') {
        const la = Number(v && v.lat), lo = Number(v && v.lon), pr = v && v.precision !== undefined && v.precision !== null && v.precision !== '' ? Math.round(Number(v.precision)) : '';
        if (!v || typeof v !== 'object' || !isFinite(la) || !isFinite(lo) || la < -90 || la > 90 || lo < -180 || lo > 180) throw new Error('Position GPS invalide : ' + c.label);
        v = { lat: Math.round(la * 1e6) / 1e6, lon: Math.round(lo * 1e6) / 1e6, precision: isFinite(pr) ? pr : '' };
      }
      else if (c.type === 'photo') { v = String(v); if (!/^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+\/=]+$/.test(v) || v.length > 350000) throw new Error('Photo invalide ou trop volumineuse : ' + c.label); }
      else if (c.type === 'signature') { v = String(v); if (!/^data:image\/png;base64,[A-Za-z0-9+\/=]+$/.test(v) || v.length > 40000) throw new Error('Signature invalide ou trop volumineuse : ' + c.label); }
      else if (c.type === 'date') { if (!/^\d{4}-\d{2}-\d{2}$/.test(String(v))) throw new Error('Date invalide : ' + c.label); v = String(v); }
      else if (c.type === 'choix') {
        if (c.options.indexOf(String(v)) === -1) throw new Error('Choix invalide : ' + c.label);
        // Choix en cascade : le choix doit correspondre à la réponse donnée à la question parente.
        if (c.cascade && !c.cascade.liens.some(l => l[0] === String(v) && l[1] === out[c.cascade.champ])) throw new Error('Choix incompatible avec la réponse à la question parente : ' + c.label);
        v = String(v);
      }
      else if (c.type === 'choix_multiple') { v = (Array.isArray(v) ? v : [v]).map(String).filter(x => c.options.indexOf(x) !== -1); vide = !v.length; }
      else if (c.type === 'oui_non') { v = String(v) === 'Oui' ? 'Oui' : (String(v) === 'Non' ? 'Non' : ''); vide = !v; }
      else v = String(v).replace(/\r/g, '').trim().slice(0, c.type === 'texte_long' ? 2000 : 500);
      if (v === '') vide = true;
    }
    if (vide) { if (c.obligatoire && c.type !== 'calcul') throw new Error('Réponse obligatoire : ' + c.label); out[c.id] = (c.type === 'choix_multiple') ? [] : ''; }
    else out[c.id] = v;
  });
  // Questions « Calcul automatique » : recalculées ici à partir des réponses validées (la valeur envoyée par l'appareil n'est jamais crue).
  const numDe = id => {
    const ch = champs.find(x => x.id === id), v = out[id]; if (!ch) return NaN;
    if (ch.type === 'oui_non') return v === 'Oui' ? 1 : (v === 'Non' ? 0 : NaN);
    if (v === '' || v === undefined || v === null || typeof v === 'object') return NaN;
    const n = Number(v); return isFinite(n) ? n : NaN;
  };
  champs.forEach(c => {
    if (c.type !== 'calcul' || masquees[c.id]) return;
    let r = NaN; try { r = Formules_.calculer(Formules_.analyser(c.formule), (k, nom) => k === 'ref' ? numDe(nom) : NaN); } catch (e) { r = NaN; }
    out[c.id] = isFinite(r) ? r : '';
  });
  return out;
}

function ajouterJours_(iso, n) {
  const d = new Date(String(iso).slice(0, 10) + 'T12:00:00');
  d.setDate(d.getDate() + n);
  return Utilities.formatDate(d, 'Africa/Porto-Novo', 'yyyy-MM-dd');
}
function joursEntre_(a, b) { return Math.round((new Date(String(b).slice(0, 10) + 'T12:00:00') - new Date(String(a).slice(0, 10) + 'T12:00:00')) / 86400000); }

// 'En suivi' | 'Suivi terminé' (durée écoulée) | 'Clôturé' (clôturé par le RC avec une issue)
function etatCas_(c, aujourdhui) {
  if (c.Statut === 'Clôturé') return 'Clôturé';
  return dateIso_(c.DateFinSuivi) >= aujourdhui ? 'En suivi' : 'Suivi terminé';
}

// Pour chaque cas : jours de suivi attendus (1..durée, jusqu'à aujourd'hui), faits, manquants.
function enrichirCas_(c, suivisDuCas, aujourdhui, suivisParJour) {
  const spj = Math.max(1, Math.floor(Number(suivisParJour)) || 1);
  const enreg = dateIso_(c.DateEnregistrement), fin = dateIso_(c.DateFinSuivi);
  const duree = joursEntre_(enreg, fin);
  const dernierJourAttendu = aujourdhui < fin ? aujourdhui : fin;
  // Un « suivi attendu » = un jour × une séance (suivisParJour séances par jour ; 1 par défaut).
  const attendus = [];
  for (let j = 1; j <= duree; j++) { const jour = ajouterJours_(enreg, j); if (jour <= dernierJourAttendu) for (let k = 1; k <= spj; k++) attendus.push({ Jour: jour, Seance: k }); }
  const faits = {};
  suivisDuCas.forEach(s => { faits[dateIso_(s.Jour) + '|' + (Number(s.Seance) || 1)] = true; });
  const manquantsDetail = attendus.filter(a => !faits[a.Jour + '|' + a.Seance]);
  const manquants = manquantsDetail.map(a => a.Jour).filter((j, i, t) => t.indexOf(j) === i);
  const etat = etatCas_(c, aujourdhui);
  return {
    ID: c.ID, ActiviteId: c.ActiviteId, RcId: c.RcId, RcNom: c.RcNom, VillageNom: c.VillageNom, ArrondissementId: c.ArrondissementId,
    Reponses: (function () { try { return JSON.parse(c.Reponses || '{}'); } catch (e) { return {}; } })(),
    DateEnregistrement: enreg, DateFinSuivi: fin, DureeJours: duree, Etat: etat, Issue: c.Issue || '', DateCloture: dateIso_(c.DateCloture),
    HorsLigne: c.HorsLigne || '',
    SuivisParJour: spj, NbTotal: duree * spj,
    Suivis: suivisDuCas.map(s => ({ ID: s.ID, Jour: dateIso_(s.Jour), Seance: Number(s.Seance) || 1, Latitude: s.Latitude === '' || s.Latitude == null ? '' : Number(s.Latitude), Longitude: s.Longitude === '' || s.Longitude == null ? '' : Number(s.Longitude), Precision: s.Precision === '' || s.Precision == null ? '' : Number(s.Precision), DateSaisie: s.DateSaisie, Reponses: (function () { try { return JSON.parse(s.Reponses || '{}'); } catch (e) { return {}; } })() }))
      .sort((x, y) => (x.Jour + x.Seance).localeCompare(y.Jour + y.Seance)),
    NbAttendus: attendus.length, NbFaits: attendus.length - manquantsDetail.length, JoursManquants: manquants, SeancesManquantes: manquantsDetail,
    SuiviDu: etat === 'En suivi' && manquants.indexOf(aujourdhui) !== -1
  };
}

function activitesAvecCasEnSuivi_(rcId) {
  const auj = aujourdhuiIso_(), set = new Set();
  readSheet_(SHEETS.TACHES_CAS).forEach(c => { if (c.RcId === rcId && etatCas_(c, auj) === 'En suivi') set.add(c.ActiviteId); });
  return set;
}

// { activiteId: { nbCas, enSuivi, dus } } pour un RC (dus = cas dont le suivi d'un jour attendu manque).
function statsTachesDuRc_(rcId) {
  const auj = aujourdhuiIso_(), out = {};
  const suivis = readSheet_(SHEETS.TACHES_SUIVIS).filter(s => s.RcId === rcId);
  const spjDe = {}; readSheet_(SHEETS.ACTIVITES).filter(a => estTache_(a)).forEach(a => { spjDe[a.ID] = questionnaireDe_(a).suivisParJour; });
  readSheet_(SHEETS.TACHES_CAS).filter(c => c.RcId === rcId).forEach(c => {
    const e = enrichirCas_(c, suivis.filter(s => s.CasId === c.ID), auj, spjDe[c.ActiviteId]);
    const o = out[c.ActiviteId] || (out[c.ActiviteId] = { nbCas: 0, enSuivi: 0, dus: 0 });
    o.nbCas++; if (e.Etat === 'En suivi') { o.enSuivi++; if (e.JoursManquants.length) o.dus++; }
  });
  return out;
}

function tacheEnregistrerCas_(actor, p) {
  if (actor.Role !== ROLES.RC) return { ok: false, error: 'Seul un Relais Communautaire peut recenser un cas.' };
  const a = readSheet_(SHEETS.ACTIVITES).find(x => x.ID === p.activiteId);
  if (!a || !estTache_(a) || !activiteVisiblePar_(a, actor)) return { ok: false, error: 'Tâche introuvable pour votre compte.' };
  if (activiteEcheue_(a)) return { ok: false, error: 'Le recensement de cette tâche est clos (échéance dépassée) : vous ne pouvez plus ajouter de cas, seulement suivre ceux déjà recensés.' };
  const clientId = String(p.clientId || '');
  if (clientId) { const deja = readSheet_(SHEETS.TACHES_CAS).find(c => c.ClientId === clientId && c.RcId === actor.ID); if (deja) return { ok: true, cas: deja, doublon: true }; }
  const q = questionnaireDe_(a);
  const reponses = nettoyerReponses_(q.champsCas, p.reponses);
  const auj = aujourdhuiIso_();
  const date = p.date ? dateIso_(p.date) : auj;
  if (date > auj) return { ok: false, error: 'La date de recensement ne peut pas être dans le futur.' };
  const saisie = dateSaisieClient_(p);
  const rec = {
    ID: newId_('CAS'), ActiviteId: a.ID, RcId: actor.ID, RcNom: actor.Prenom + ' ' + actor.Nom,
    ArrondissementId: actor.ArrondissementId || '', VillageId: actor.VillageId || '', VillageNom: actor.VillageNom || '',
    Reponses: JSON.stringify(reponses), DateEnregistrement: date, DateFinSuivi: ajouterJours_(date, q.dureeJours),
    Statut: 'En suivi', Issue: '', DateCloture: '', DateCreation: saisie || nowStr_(), ClientId: clientId, HorsLigne: saisie ? 'Oui' : ''
  };
  appendRow_(SHEETS.TACHES_CAS, rec);
  return { ok: true, cas: rec };
}

function tacheSaisirSuivi_(actor, p) {
  if (actor.Role !== ROLES.RC) return { ok: false, error: 'Seul un Relais Communautaire peut saisir le suivi d\'un cas.' };
  const c = readSheet_(SHEETS.TACHES_CAS).find(x => x.ID === p.casId && x.RcId === actor.ID);
  if (!c) return { ok: false, error: 'Cas introuvable pour votre compte.' };
  const a = readSheet_(SHEETS.ACTIVITES).find(x => x.ID === c.ActiviteId);
  if (!a || a.Statut !== 'Active') return { ok: false, error: 'Cette tâche a été archivée ou supprimée par son demandeur.' };
  if (c.Statut === 'Clôturé') return { ok: false, error: 'Le suivi de ce cas est clôturé.' };
  const auj = aujourdhuiIso_();
  const jour = p.jour ? dateIso_(p.jour) : auj;
  if (jour > auj) return { ok: false, error: 'Le suivi ne peut pas être saisi pour une date future.' };
  if (jour < dateIso_(c.DateEnregistrement)) return { ok: false, error: 'La date du suivi précède le recensement du cas.' };
  if (jour > dateIso_(c.DateFinSuivi)) return { ok: false, error: 'La période de suivi de ce cas est terminée (fin le ' + dateIso_(c.DateFinSuivi).split('-').reverse().join('/') + ').' };
  const q = questionnaireDe_(a);
  const seance = p.seance === undefined || p.seance === null || p.seance === '' ? 1 : Math.floor(Number(p.seance));
  if (!isFinite(seance) || seance < 1 || seance > q.suivisParJour) return { ok: false, error: q.suivisParJour > 1 ? 'Séance invalide : cette tâche prévoit ' + q.suivisParJour + ' suivis par jour.' : 'Cette tâche prévoit un seul suivi par jour.' };
  const reponses = nettoyerReponses_(q.champsSuivi, p.reponses);
  // Position GPS prise par le RC à ce suivi (propre à chaque séance).
  let gps = null;
  if (q.gpsSuivi !== 'non' && p.gps && p.gps.lat !== undefined && p.gps.lat !== null && p.gps.lat !== '') {
    const la = Number(p.gps.lat), lo = Number(p.gps.lon), pr = p.gps.precision === undefined || p.gps.precision === null || p.gps.precision === '' ? '' : Math.round(Number(p.gps.precision));
    if (!isFinite(la) || !isFinite(lo) || la < -90 || la > 90 || lo < -180 || lo > 180) return { ok: false, error: 'Coordonnées GPS invalides.' };
    gps = { Latitude: Math.round(la * 1e6) / 1e6, Longitude: Math.round(lo * 1e6) / 1e6, Precision: isFinite(pr) ? pr : '', DateGps: dateSaisieClient_(p) || nowStr_() };
  }
  const existant = readSheet_(SHEETS.TACHES_SUIVIS).find(s => s.CasId === c.ID && dateIso_(s.Jour) === jour && (Number(s.Seance) || 1) === seance);
  if (q.gpsSuivi === 'obligatoire' && !gps && !(existant && existant.Latitude !== '' && existant.Latitude != null)) return { ok: false, error: 'La position GPS est obligatoire pour ce suivi : prenez-la avant d\'enregistrer.' };
  const saisie = dateSaisieClient_(p);
  if (existant) updateRowById_(SHEETS.TACHES_SUIVIS, existant.ID, Object.assign({ Reponses: JSON.stringify(reponses), DateSaisie: saisie || nowStr_() }, gps || {}));
  else appendRow_(SHEETS.TACHES_SUIVIS, Object.assign({ ID: newId_('SUV'), CasId: c.ID, ActiviteId: c.ActiviteId, RcId: actor.ID, Jour: jour, Seance: seance, Reponses: JSON.stringify(reponses), DateSaisie: saisie || nowStr_(), ClientId: String(p.clientId || '') }, gps || {}));
  if (p.cloturer) {
    const issue = ISSUES_CAS_.indexOf(p.issue) !== -1 ? p.issue : '';
    if (!issue) return { ok: false, error: 'Choisissez l\'issue du cas pour clôturer son suivi (le suivi du jour est enregistré).' };
    updateRowById_(SHEETS.TACHES_CAS, c.ID, { Statut: 'Clôturé', Issue: issue, DateCloture: auj });
  }
  return { ok: true, remplace: !!existant };
}

// Lecture des cas : le RC voit les siens ; le demandeur (et le National) voit ceux des RC de sa hiérarchie.
// p.activiteId (facultatif) restreint à une tâche.
function listTacheCas_(actor, p) {
  p = p || {};
  const auj = aujourdhuiIso_();
  const activites = readSheet_(SHEETS.ACTIVITES).filter(a => estTache_(a));
  let casListe;
  if (actor.Role === ROLES.RC) {
    casListe = readSheet_(SHEETS.TACHES_CAS).filter(c => c.RcId === actor.ID);
  } else {
    const miennes = activites.filter(a => a.CreeParId === actor.ID || actor.Role === ROLES.NATIONAL).map(a => a.ID);
    const ids = new Set(miennes);
    const rcOk = {};
    casListe = readSheet_(SHEETS.TACHES_CAS).filter(c => {
      if (!ids.has(c.ActiviteId)) return false;
      if (actor.Role === ROLES.NATIONAL) return true;
      if (rcOk[c.RcId] === undefined) { const rc = readSheet_(SHEETS.USERS).find(u => u.ID === c.RcId); rcOk[c.RcId] = !!rc && isSupervisorOf_(actor, rc); }
      return rcOk[c.RcId];
    });
  }
  if (p.activiteId) casListe = casListe.filter(c => c.ActiviteId === p.activiteId);
  const suivis = readSheet_(SHEETS.TACHES_SUIVIS);
  const parCas = {};
  suivis.forEach(s => { (parCas[s.CasId] = parCas[s.CasId] || []).push(s); });
  const spjDe = {}; activites.forEach(a => { spjDe[a.ID] = questionnaireDe_(a).suivisParJour; });
  const cas = casListe.map(c => enrichirCas_(c, parCas[c.ID] || [], auj, spjDe[c.ActiviteId]))
    .sort((x, y) => (y.DateEnregistrement + y.ID).localeCompare(x.DateEnregistrement + x.ID));
  // Questionnaires nécessaires pour afficher les réponses (étiquettes des questions).
  const actIds = new Set(cas.map(c => c.ActiviteId));
  if (p.activiteId) actIds.add(p.activiteId);
  const acts = {};
  activites.filter(a => actIds.has(a.ID)).forEach(a => { acts[a.ID] = { id: a.ID, titre: a.Titre, questionnaire: questionnaireDe_(a), dateLimite: dateIso_(a.DateLimite), statut: a.Statut }; });
  return { ok: true, cas: cas, activites: acts };
}

// Le demandeur de la tâche (ou le National) supprime, ligne par ligne, les cas recensés — et leurs suivis — qu'il ne veut pas
// garder. Suppression définitive ; le relais communautaire concerné est prévenu.
function tacheSupprimerCas_(actor, p) {
  const r = activiteDuCreateur_(actor, p.activiteId); if (r.err) return { ok: false, error: r.err.replace('la modifier', 'supprimer ses données') };
  if (!estTache_(r.a)) return { ok: false, error: 'Cette activité n\'a pas de données de cas.' };
  const ids = (Array.isArray(p.casIds) ? p.casIds : []).map(String).slice(0, 2000);
  if (!ids.length) return { ok: false, error: 'Sélectionnez au moins un cas à supprimer.' };
  const cas = readSheet_(SHEETS.TACHES_CAS).filter(c => c.ActiviteId === r.a.ID && ids.indexOf(String(c.ID)) !== -1);
  if (!cas.length) return { ok: false, error: 'Aucun des cas sélectionnés n\'existe plus dans cette tâche.' };
  const idsOk = cas.map(c => String(c.ID));
  deleteRowsWhereIn_(SHEETS.TACHES_SUIVIS, 'CasId', new Set(idsOk));
  deleteRowsWhereIn_(SHEETS.TACHES_CAS, 'ID', new Set(idsOk));
  const parRc = {};
  cas.forEach(c => { parRc[c.RcId] = (parRc[c.RcId] || 0) + 1; });
  const users = readSheet_(SHEETS.USERS);
  Object.keys(parRc).forEach(rcId => {
    const rc = users.find(u => u.ID === rcId);
    if (rc) notifierComptes_([rc], 'ACTIVITE', r.a.ID, `${parRc[rcId]} cas que vous aviez recensé(s) dans la tâche « ${r.a.Titre} » ont été supprimé(s) par ${r.a.CreeParNom}.`);
  });
  return { ok: true, supprimes: cas.length };
}

// ============================================================
// PREUVES DE SENSIBILISATION COMMUNAUTAIRE (par le RC)
// ============================================================
// Photo(s) de la séance + liste nominative des personnes sensibilisées (nom, sexe, âge).
// Stockage des photos dans Google Drive (voir autoriserDrive). Envoi possible hors connexion.

// ---- Sensibilisations : lecture fiable (colonnes décalées détectées et remises en place) ----
// Des lignes enregistrées avant la correction de appendRow_ peuvent avoir leurs valeurs décalées par rapport aux
// en-têtes de la feuille (ex. une date lue comme « adultes hommes » → 1 794 301 378 000 personnes). Chaque ligne est
// lue selon l'ordre des en-têtes ; si les valeurs sont incohérentes, elle est relue selon l'ordre du code (COLS) ;
// seule une disposition entièrement cohérente est retenue. Jamais de valeur inventée.
const SENS_STATUTS_ = ['', 'Approuvée', 'En attente', 'Rejetée'];
function sensEntier_(v, max) {
  if (v === '' || v === null || v === undefined) return true;
  if (typeof v === 'number') return isFinite(v) && v >= 0 && v <= max && Math.floor(v) === v;
  if (typeof v === 'string') return /^\d{1,6}$/.test(v.trim()) && Number(v) <= max;
  return false; // Date, booléen… : pas un effectif
}
function sensDateOk_(v) { return v === '' || v === null || v === undefined || Object.prototype.toString.call(v) === '[object Date]' || /^\d{4}-\d{2}-\d{2}/.test(String(v)) || /^\d{2}\/\d{2}\/\d{4}/.test(String(v)); }
function sensLayoutValide_(o) {
  return ['NbAdultesH', 'NbAdultesF', 'NbEnfantsG', 'NbEnfantsF', 'NbHommes', 'NbFemmes'].every(k => sensEntier_(o[k], 5000)) &&
    sensEntier_(o.NbParticipants, 20000) && SENS_STATUTS_.indexOf(o.Statut === undefined || o.Statut === null ? '' : String(o.Statut)) !== -1 &&
    sensDateOk_(o.Date) && sensDateOk_(o.DateSaisie);
}
function sensAligner_(headers, row) {
  const cols = COLS[SHEETS.SENSIBILISATIONS];
  const parEntete = {}; headers.forEach((h, i) => { parEntete[h] = row[i]; });
  if (sensLayoutValide_(parEntete)) return { obj: parEntete, decale: false };
  const parPos = {}; cols.forEach((h, i) => { parPos[h] = row[i]; });
  if (sensLayoutValide_(parPos)) return { obj: parPos, decale: true };
  return { obj: parEntete, decale: false };
}
function lireSensibilisations_() {
  const nom = SHEETS.SENSIBILISATIONS;
  if (__sheetCache_[nom]) return __sheetCache_[nom];
  const values = ss_().getSheetByName(nom).getDataRange().getValues();
  const headers = values.shift().map(String);
  const rows = values.filter(r => r.join('') !== '').map(row => sensAligner_(headers, row).obj);
  __sheetCache_[nom] = rows;
  return rows;
}
// Remet réellement en place (dans la feuille) les lignes décalées. Sans danger : une ligne n'est réécrite que si sa lecture
// par en-têtes est incohérente ET que sa lecture selon COLS est cohérente.
function reparerSensibilisations_() {
  const nom = SHEETS.SENSIBILISATIONS, sh = ss_().getSheetByName(nom);
  if (!sh || sh.getLastRow() < 2) return 0;
  const values = sh.getDataRange().getValues(), headers = values[0].map(String);
  let n = 0;
  for (let r = 1; r < values.length; r++) {
    if (values[r].join('') === '') continue;
    const a = sensAligner_(headers, values[r]);
    if (!a.decale) continue;
    sh.getRange(r + 1, 1, 1, headers.length).setValues([headers.map(h => (a.obj[h] !== undefined ? a.obj[h] : ''))]);
    n++;
  }
  invaliderCacheFeuille_(nom);
  return n;
}

function submitSensibilisation_(actor, p) {
  if (actor.Role !== ROLES.RC) return { ok: false, error: 'Seul un Relais Communautaire peut enregistrer une sensibilisation.' };
  const clientId = String(p.clientId || '');
  if (clientId) { const deja = lireSensibilisations_().find(r => r.ClientId === clientId && r.RcId === actor.ID); if (deja) return { ok: true, sensibilisation: deja, doublon: true }; }
  const theme = coupe_(p.theme, 160);
  if (theme.length < 3) return { ok: false, error: 'Indiquez le thème de la sensibilisation.' };
  if (!p.date) return { ok: false, error: 'La date de la sensibilisation est obligatoire.' };
  const date = dateIso_(p.date);
  if (date > aujourdhuiIso_()) return { ok: false, error: 'La date de la sensibilisation ne peut pas être dans le futur : c\'est une preuve, enregistrez-la une fois la séance tenue.' };
  // Statistiques de la séance (pas de noms) : adultes et enfants (moins de 18 ans), par sexe.
  const effectif = (v, lib) => {
    const n = (v === undefined || v === null || v === '') ? 0 : Number(v);
    if (!isFinite(n) || n < 0 || Math.floor(n) !== n || n > 5000) throw new Error('Effectif invalide pour « ' + lib + ' » : saisissez un nombre entier entre 0 et 5000.');
    return n;
  };
  const adH = effectif(p.adultesHommes, 'Adultes - hommes'), adF = effectif(p.adultesFemmes, 'Adultes - femmes');
  const enG = effectif(p.enfantsGarcons, 'Enfants - garçons'), enF = effectif(p.enfantsFilles, 'Enfants - filles');
  const total = adH + adF + enG + enF;
  if (total < 1) return { ok: false, error: 'Indiquez le nombre de personnes sensibilisées (adultes et enfants, par sexe).' };
  const photos = (Array.isArray(p.photos) ? p.photos : []).slice(0, 5);
  if (!photos.length) return { ok: false, error: 'Ajoutez au moins une photo de la sensibilisation : c\'est la preuve de la séance.' };
  let urls = [];
  try { urls = enregistrerPhotosSuivi_(photos, 'sensibilisation_' + actor.ID + '_' + date); }
  catch (e) {
    if (/authoriz|autoris|permission/i.test(e.message || '')) return { ok: false, error: 'Le script n\'a pas encore l\'autorisation d\'accéder à Google Drive (nécessaire pour stocker les photos). Dans l\'éditeur Apps Script : exécutez la fonction "autoriserDrive", acceptez l\'autorisation, puis redéployez une nouvelle version de l\'application web.' };
    return { ok: false, error: 'Erreur lors de l\'enregistrement des photos : ' + e.message };
  }
  if (!urls.length) return { ok: false, error: 'Les photos envoyées sont invalides (formats acceptés : JPEG, PNG, WebP).' };
  const trace = tracesHorsLigne_(p);
  const rec = {
    ID: newId_('SENS'), RcId: actor.ID, RcNom: actor.Prenom + ' ' + actor.Nom,
    ArrondissementId: actor.ArrondissementId || '', VillageId: actor.VillageId || '', VillageNom: actor.VillageNom || '', GrappeNom: actor.GrappeNom || '',
    Date: date, Theme: theme, Lieu: coupe_(p.lieu, 120),
    Participants: '', NbParticipants: total, NbHommes: adH + enG, NbFemmes: adF + enF,
    NbAdultesH: adH, NbAdultesF: adF, NbEnfantsG: enG, NbEnfantsF: enF,
    PhotosUrls: JSON.stringify(urls), Commentaires: String(p.commentaires || '').trim().slice(0, 1000),
    DateSaisie: trace.DateSaisie, ClientId: trace.ClientId, HorsLigne: trace.HorsLigne, SynchroniseLe: trace.SynchroniseLe,
    Statut: 'Approuvée', ApprouveParId: '', ApprouveParNom: '', DateDecision: '', MotifRejet: ''
  };
  // Approbation par l'ASCQ (paramètre national, activé par défaut) : tant qu'elle n'est pas donnée, seuls le RC et son ASCQ voient
  // la sensibilisation ; PF, RCSE, Département et National la reçoivent uniquement après approbation.
  const chaine = chainAbove_(actor).filter(u => u.Role !== ROLES.RC);
  const ascq = chaine.find(u => u.Role === ROLES.ASCQ) || null;
  const aApprouver = !!ascq && parametreBool_('validationAscq', true);
  if (aApprouver) rec.Statut = 'En attente';
  appendRow_(SHEETS.SENSIBILISATIONS, rec);
  const resume = `Sensibilisation « ${theme} » réalisée par ${rec.RcNom} le ${date.split('-').reverse().join('/')} : ${total} personne(s) sensibilisée(s) (adultes : ${adH + adF}, enfants : ${enG + enF})${rec.VillageNom ? ' - Village: ' + rec.VillageNom : ''}${mentionHorsLigne_(trace)}`;
  if (aApprouver) notifierComptes_([ascq], 'SENSIBILISATION_A_APPROUVER', rec.ID, 'À approuver — ' + resume);
  else cascadeNotify_(actor, 'SENSIBILISATION', rec.ID, resume);
  return { ok: true, sensibilisation: rec };
}

function listSensibilisations_(actor, p) {
  // Réparation unique (une seule fois après la mise à jour) des lignes décalées déjà présentes dans la feuille.
  try {
    const props = PropertiesService.getScriptProperties();
    if (!props.getProperty('SENS_ALIGNE_V1')) avecVerrou_(() => { reparerSensibilisations_(); props.setProperty('SENS_ALIGNE_V1', nowStr_()); });
  } catch (e) { /* non bloquant : la lecture ci-dessous reste corrigée à la volée */ }
  let rows = lireSensibilisations_();
  const statutDe = r => r.Statut || 'Approuvée'; // anciennes saisies : approuvées
  if (actor.Role === ROLES.RC) rows = rows.filter(r => r.RcId === actor.ID);
  else {
    const ok = {};
    if (actor.Role !== ROLES.NATIONAL) readSheet_(SHEETS.USERS).forEach(u => { if (u.Role === ROLES.RC && isSupervisorOf_(actor, u)) ok[u.ID] = true; });
    // L'ASCQ voit tout (y compris en attente / rejetées) pour décider ; les autres niveaux ne voient que les sensibilisations approuvées.
    rows = rows.filter(r => (actor.Role === ROLES.NATIONAL || ok[r.RcId]) && (actor.Role === ROLES.ASCQ || statutDe(r) === 'Approuvée'));
  }
  rows = rows.map(r => Object.assign({}, r, { Statut: statutDe(r) }));
  // Anciennes saisies nominatives (si elles existent) : effectifs déduits des âges (enfant = moins de 18 ans).
  const effectifs = r => {
    const brut = [r.NbAdultesH, r.NbAdultesF, r.NbEnfantsG, r.NbEnfantsF];
    const saisi = brut.some(v => v !== '' && v !== undefined && v !== null);
    const total = (r.NbParticipants === '' || r.NbParticipants === null || r.NbParticipants === undefined || !sensEntier_(r.NbParticipants, 20000)) ? null : Number(r.NbParticipants);
    if (saisi) {
      const ok = brut.every(v => v !== '' && v !== null && v !== undefined && sensEntier_(v, 5000));
      const [a, b, c, d] = brut.map(Number);
      if (ok && (total === null || a + b + c + d === total)) return { NbAdultesH: a, NbAdultesF: b, NbEnfantsG: c, NbEnfantsF: d, NbParticipants: total === null ? a + b + c + d : total, DetailOk: true };
      // Détail incohérent (valeurs décalées/corrompues) : on ne montre QUE le total enregistré, jamais un détail faux.
      return { NbAdultesH: '', NbAdultesF: '', NbEnfantsG: '', NbEnfantsF: '', NbParticipants: total === null ? 0 : total, DetailOk: false };
    }
    const o = { NbAdultesH: 0, NbAdultesF: 0, NbEnfantsG: 0, NbEnfantsF: 0, DetailOk: true };
    parseArr_(r.Participants).forEach(x => { const enf = Number(x.age) < 18; if (x.sexe === 'F') o[enf ? 'NbEnfantsF' : 'NbAdultesF']++; else o[enf ? 'NbEnfantsG' : 'NbAdultesH']++; });
    o.NbParticipants = total === null ? o.NbAdultesH + o.NbAdultesF + o.NbEnfantsG + o.NbEnfantsF : total;
    return o;
  };
  const sorted = rows.map(r => Object.assign({}, r, { Date: dateIso_(r.Date) }, effectifs(r))).sort((a, b) => (b.Date + b.ID).localeCompare(a.Date + a.ID));
  return { ok: true, sensibilisations: sorted.slice(0, 1000), total: sorted.length, nbEnAttente: sorted.filter(r => r.Statut === 'En attente').length, approbationActive: parametreBool_('validationAscq', true) };
}

// Décision de l'ASCQ : approuver (la sensibilisation remonte alors aux niveaux supérieurs) ou rejeter (motif obligatoire, le RC est prévenu).
function decideSensibilisation_(actor, p) {
  if (actor.Role !== ROLES.ASCQ) return { ok: false, error: 'Seul l\'ASCQ du relais communautaire peut approuver ou rejeter une sensibilisation.' };
  const s = lireSensibilisations_().find(x => x.ID === p.id);
  if (!s) return { ok: false, error: 'Sensibilisation introuvable.' };
  const rc = readSheet_(SHEETS.USERS).find(u => u.ID === s.RcId);
  if (!rc || !isSupervisorOf_(actor, rc)) return { ok: false, error: 'Cette sensibilisation ne concerne pas un relais communautaire de votre périmètre.' };
  const statut = s.Statut || 'Approuvée';
  if (statut === 'Approuvée') return { ok: false, error: 'Cette sensibilisation est déjà approuvée.' };
  const decision = p.decision === 'rejeter' ? 'Rejetée' : (p.decision === 'approuver' ? 'Approuvée' : '');
  if (!decision) return { ok: false, error: 'Décision invalide.' };
  const motif = String(p.motif || '').trim().slice(0, 500);
  if (decision === 'Rejetée' && motif.length < 3) return { ok: false, error: 'Indiquez le motif du rejet (le relais communautaire le verra).' };
  const nom = actor.Prenom + ' ' + actor.Nom;
  updateRowById_(SHEETS.SENSIBILISATIONS, s.ID, { Statut: decision, ApprouveParId: actor.ID, ApprouveParNom: nom, DateDecision: nowStr_(), MotifRejet: decision === 'Rejetée' ? motif : '' });
  const total = Number(s.NbParticipants) || 0, date = dateIso_(s.Date).split('-').reverse().join('/');
  notifierComptes_([rc], 'SENSIBILISATION_DECISION', s.ID, decision === 'Approuvée'
    ? `Votre sensibilisation « ${s.Theme} » du ${date} a été approuvée par votre ASCQ ${nom}.`
    : `Votre sensibilisation « ${s.Theme} » du ${date} a été rejetée par votre ASCQ ${nom} — motif : ${motif}. Vous pouvez l'enregistrer à nouveau après correction.`);
  if (decision === 'Approuvée') {
    const apresAscq = chainAbove_(rc).filter(u => u.Role !== ROLES.RC && u.ID !== actor.ID && RANG_ROLE_[u.Role] > RANG_ROLE_[ROLES.ASCQ]);
    notifierComptes_(apresAscq, 'SENSIBILISATION', s.ID, `Sensibilisation « ${s.Theme} » réalisée par ${s.RcNom} le ${date} (approuvée par l'ASCQ) : ${total} personne(s) sensibilisée(s)${[s.NbAdultesH, s.NbAdultesF, s.NbEnfantsG, s.NbEnfantsF].every(v => v !== '' && sensEntier_(v, 5000)) && (Number(s.NbAdultesH) + Number(s.NbAdultesF) + Number(s.NbEnfantsG) + Number(s.NbEnfantsF) === total) ? ' (adultes : ' + (Number(s.NbAdultesH) + Number(s.NbAdultesF)) + ', enfants : ' + (Number(s.NbEnfantsG) + Number(s.NbEnfantsF)) + ')' : ''}${s.VillageNom ? ' - Village: ' + s.VillageNom : ''}`);
  }
  return { ok: true, statut: decision };
}

function notifierComptes_(comptes, type, refId, message) {
  comptes.filter(Boolean).forEach(u => appendRow_(SHEETS.NOTIFICATIONS, { ID: newId_('NOTIF'), DestinataireId: u.ID, Type: type, RefId: refId, Message: message, Lu: false, DateCreation: nowStr_() }));
}

// ---- Paramètres de l'application (modifiables par le National)
const PARAMETRES_AUTORISES_ = { validationAscq: true };
function parametreBool_(cle, defaut) {
  const r = readSheet_(SHEETS.PARAMETRES).find(x => x.ID === cle);
  if (!r || r.Valeur === '' || r.Valeur === undefined) return defaut;
  return String(r.Valeur) === '1' || String(r.Valeur).toLowerCase() === 'true';
}
function getParametres_(actor) {
  return { ok: true, parametres: { validationAscq: parametreBool_('validationAscq', true) } };
}
function setParametre_(actor, p) {
  if (actor.Role !== ROLES.NATIONAL) return { ok: false, error: 'Seul le compte national peut modifier les paramètres.' };
  if (!PARAMETRES_AUTORISES_[p.cle]) return { ok: false, error: 'Paramètre inconnu.' };
  const valeur = p.valeur ? '1' : '0';
  const ex = readSheet_(SHEETS.PARAMETRES).find(x => x.ID === p.cle);
  const maj = { Valeur: valeur, ModifieLe: nowStr_(), ModifiePar: actor.Prenom + ' ' + actor.Nom };
  if (ex) updateRowById_(SHEETS.PARAMETRES, p.cle, maj); else appendRow_(SHEETS.PARAMETRES, Object.assign({ ID: p.cle }, maj));
  return { ok: true, parametres: { validationAscq: parametreBool_('validationAscq', true) } };
}

// ============================================================
// SUIVI GROUPÉ DES RC (par l'ASCQ)
// ============================================================

// À EXÉCUTER UNE FOIS depuis l'éditeur Apps Script (liste de fonctions -> autoriserDrive -> Exécuter)
// pour accorder au script l'accès à Google Drive (stockage des photos et documents des suivis).
function autoriserDrive() {
  const dossier = dossierPhotosSuivi_();
  Logger.log('Accès Drive autorisé. Dossier : ' + dossier.getUrl());
}

// Dossier Drive où sont rangées les photos de séance des suivis groupés (créé une seule fois).
function dossierPhotosSuivi_() {
  const nom = 'Surveillance_Communautaire_PhotosSuiviGroupe';
  const it = DriveApp.getFoldersByName(nom);
  if (it.hasNext()) return it.next();
  return DriveApp.createFolder(nom);
}

// Enregistre une liste de photos (data URLs "data:image/xxx;base64,...", déjà redimensionnées
// côté client) dans Drive, et renvoie leurs URLs de partage (lecture pour quiconque a le lien).
// Peut lever une erreur (autorisation Drive manquante, quota...) — voir submitSuiviGroupe_, qui
// la capture pour renvoyer un message clair plutôt que de laisser planter toute la sauvegarde.
function enregistrerPhotosSuivi_(photosDataUrl, nomBase) {
  const dossier = dossierPhotosSuivi_();
  const urls = [];
  (photosDataUrl || []).forEach((dataUrl, i) => {
    const m = /^data:(image\/(?:jpeg|png|webp|gif|heic|heif));base64,(.*)$/.exec(dataUrl || '');
    if (!m) return;
    const mime = m[1], data = m[2];
    const ext = mime.split('/')[1].replace('jpeg', 'jpg');
    const blob = Utilities.newBlob(Utilities.base64Decode(data), mime, `${nomBase}_${i + 1}.${ext}`);
    const file = dossier.createFile(blob);
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    urls.push(file.getUrl());
  });
  return urls;
}

// Photos prises dans les questionnaires des collectes de données (type de question « Photo »).
function dossierPhotosCollecte_() {
  const nom = 'Surveillance_Communautaire_PhotosCollecte';
  const it = DriveApp.getFoldersByName(nom);
  if (it.hasNext()) return it.next();
  return DriveApp.createFolder(nom);
}
function enregistrerPhotoCollecte_(dataUrl, nomBase) {
  const m = /^data:(image\/(?:jpeg|png|webp));base64,(.*)$/.exec(dataUrl || '');
  if (!m) throw new Error('photo illisible');
  const ext = m[1].split('/')[1].replace('jpeg', 'jpg');
  const file = dossierPhotosCollecte_().createFile(Utilities.newBlob(Utilities.base64Decode(m[2]), m[1], nomBase + '.' + ext));
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  return file.getUrl();
}

// Types de documents acceptés pour le rapport d'un suivi groupé (en plus des photos).
const DOCUMENTS_MIME_AUTORISES_ = {
  'application/pdf': 'pdf',
  'application/msword': 'doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.ms-excel': 'xls',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'application/vnd.oasis.opendocument.text': 'odt',
  'text/plain': 'txt'
};

// Enregistre les documents du rapport (PDF, Word, Excel...) envoyés en data URL et renvoie
// [{ nom, url }]. Même dossier Drive et même partage "lecture avec le lien" que les photos.
function enregistrerDocumentsSuivi_(fichiers, nomBase) {
  const dossier = dossierPhotosSuivi_();
  const res = [];
  (fichiers || []).forEach((f, i) => {
    const m = /^data:([^;,]+);base64,(.*)$/.exec((f && f.dataUrl) || '');
    if (!m) return;
    const ext = DOCUMENTS_MIME_AUTORISES_[m[1]];
    if (!ext) return;
    const nomPropre = String(f.name || ('document_' + (i + 1) + '.' + ext)).replace(/[^\w.\- ]+/g, '_').slice(0, 80);
    const blob = Utilities.newBlob(Utilities.base64Decode(m[2]), m[1], `${nomBase}_${nomPropre}`);
    const file = dossier.createFile(blob);
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    res.push({ nom: nomPropre, url: file.getUrl() });
  });
  return res;
}

// Enregistre une séance de suivi groupé : thèmes abordés (définitions de cas uniquement — voir
// assets/briefing-data.js côté frontend, aucune saisie libre), liste de présence des RC (cochés
// parmi les RC de l'ASCQ, village par village), et au moins une pièce justificative du rapport :
// photo(s) de la séance et/ou document(s) (PDF, Word...). La date du suivi est celle choisie par
// l'ASCQ. Si le suivi correspond à une séance planifiée (p.planningId), celle-ci passe à "Réalisé".
function submitSuiviGroupe_(actor, p) {
  if (actor.Role !== ROLES.ASCQ) return { ok: false, error: 'Seul un compte ASCQ peut enregistrer un suivi groupé.' };
  if (!p.date) return { ok: false, error: 'La date du suivi est obligatoire.' };
  if (!Array.isArray(p.themes) || !p.themes.length) return { ok: false, error: 'Sélectionnez au moins un thème abordé (définition de cas).' };
  if (!Array.isArray(p.rcPresentsIds) || !p.rcPresentsIds.length) return { ok: false, error: 'Cochez au moins un RC dans la liste de présence.' };
  const photos = Array.isArray(p.photos) ? p.photos : [];
  const fichiers = Array.isArray(p.fichiers) ? p.fichiers : [];
  if (!photos.length && !fichiers.length) return { ok: false, error: 'Ajoutez au moins une photo ou un document du rapport de suivi.' };

  const mesRc = readSheet_(SHEETS.USERS).filter(u => u.Role === ROLES.RC && u.ResponsableId === actor.ID);
  const rcValides = mesRc.filter(u => p.rcPresentsIds.includes(u.ID));
  if (!rcValides.length) return { ok: false, error: 'Aucun des RC cochés ne dépend de votre compte.' };

  // Autres participants : uniquement des superviseurs de cet ASCQ (PF, RCSE, Département…).
  const supIds = chainAbove_(actor).map(u => u.ID);
  const autresPresents = (Array.isArray(p.autresPresentsIds) ? p.autresPresentsIds : []).filter((id, k, a) => supIds.indexOf(id) !== -1 && a.indexOf(id) === k)
    .map(id => readSheet_(SHEETS.USERS).find(u => u.ID === id)).filter(Boolean);

  // Autres acteurs : personnes sans compte SIVEC (ex. médecin chef de commune) saisies à la main par l'ASCQ
  // avec les informations de la liste de présence (nom, prénom, qualification, provenance, contact).
  const autresActeurs = [];
  (Array.isArray(p.autresActeurs) ? p.autresActeurs : []).slice(0, 40).forEach(x => {
    const nom = coupe_(x && x.nom, 60), prenom = coupe_(x && x.prenom, 80), qualification = coupe_(x && x.qualification, 120);
    if (!nom && !prenom && !qualification && !coupe_(x && x.provenance, 1) && !coupe_(x && x.telephone, 1)) return; // ligne vide ignorée
    const etiquette = (prenom + ' ' + nom).trim() || 'un autre acteur';
    if (!nom || !prenom) throw new Error('Autres acteurs : renseignez le nom ET le prénom de « ' + etiquette + ' ».');
    if (!qualification) throw new Error('Autres acteurs : renseignez la qualification (fonction) de « ' + etiquette + ' ».');
    autresActeurs.push({ nom: nom, prenom: prenom, qualification: qualification, provenance: coupe_(x.provenance, 120), telephone: coupe_(x.telephone, 30) });
  });

  // Un rapport est une PREUVE : la séance ne peut pas être datée dans le futur.
  if (dateIso_(p.date) > dateIso_(new Date())) return { ok: false, error: 'La date du suivi ne peut pas être dans le futur : enregistrez le compte rendu une fois la séance tenue.' };

  let planning = null;
  if (p.planningId) {
    planning = readSheet_(SHEETS.PLANNINGS).find(x => x.ID === p.planningId && x.AscqId === actor.ID);
    if (!planning) return { ok: false, error: 'Séance planifiée introuvable.' };
    if (planning.Statut === 'Réalisé') return { ok: false, error: 'Cette séance a déjà un compte rendu : il est verrouillé et ne peut plus être modifié ni remplacé.' };
  }
  // Garde-fou contre le double envoi : même ASCQ, même date, mêmes présents.
  const cle = JSON.stringify(rcValides.map(u => u.ID).sort());
  const doublon = readSheet_(SHEETS.SUIVIS).some(x => x.AscqId === actor.ID && dateIso_(x.Date) === dateIso_(p.date) && JSON.stringify(parseArr_(x.RcPresentsIds).slice().sort()) === cle);
  if (doublon) return { ok: false, error: 'Un suivi groupé identique (même date, mêmes RC présents) est déjà enregistré.' };

  let urls = [], docs = [];
  try {
    const base = `suivi_${actor.ID}_${p.date}`;
    if (photos.length) urls = enregistrerPhotosSuivi_(photos, base);
    if (fichiers.length) docs = enregistrerDocumentsSuivi_(fichiers, base);
  } catch (e) {
    // Erreur d'autorisation Drive la plus fréquente : le script n'a pas encore le droit d'y
    // accéder (scope ajouté après la dernière autorisation). Rien n'est enregistré tant que ce
    // n'est pas résolu — message explicite plutôt que l'erreur brute d'Apps Script.
    if (/authoriz|autoris|permission/i.test(e.message || '')) {
      return { ok: false, error: 'Le script n\'a pas encore l\'autorisation d\'accéder à Google Drive (nécessaire pour stocker les photos). Dans l\'éditeur Apps Script : choisissez la fonction "autoriserDrive" dans la liste, cliquez sur "Exécuter", acceptez l\'autorisation Drive demandée, puis redéployez une nouvelle version de l\'application web (Déployer > Gérer les déploiements > Modifier > Nouvelle version).' };
    }
    return { ok: false, error: 'Erreur lors de l\'enregistrement des fichiers : ' + e.message };
  }
  if (!urls.length && !docs.length) return { ok: false, error: 'Les fichiers envoyés sont invalides (formats acceptés : photos, PDF, Word, Excel, texte) ou n\'ont pas pu être enregistrés.' };

  // Villages couverts par la séance : ceux des RC présents (domicile + grappes assignées)
  const villagesSheet = readSheet_(SHEETS.VILLAGES);
  const grappes = readSheet_(SHEETS.GRAPPES);
  const periGrappes = readSheet_(SHEETS.PERIMETRES).filter(x => x.TypeCible === 'Grappe');
  const villageIds = [];
  const ajouteVillage = id => { if (id && villageIds.indexOf(id) === -1) villageIds.push(id); };
  (Array.isArray(p.villageIds) ? p.villageIds : []).forEach(id => {
    if (rcValides.some(rc => villagesDuRc_(rc, periGrappes, grappes).indexOf(id) !== -1)) ajouteVillage(id);
  });
  rcValides.forEach(rc => { if (!villageIds.length) villagesDuRc_(rc, periGrappes, grappes).forEach(ajouteVillage); });
  const villageNoms = villageIds.map(id => { const v = villagesSheet.find(x => x.ID === id); return v ? v.Nom : id; });

  const rec = {
    ID: newId_('SUI'), AscqId: actor.ID, AscqNom: actor.Prenom + ' ' + actor.Nom,
    ArrondissementId: p.arrondissementId || actor.ArrondissementId || '', ArrondissementNom: p.arrondissementNom || actor.ArrondissementNom || '',
    Date: p.date, Themes: JSON.stringify(p.themes),
    RcPresentsIds: JSON.stringify(rcValides.map(u => u.ID)),
    RcPresentsNoms: JSON.stringify(rcValides.map(u => u.Prenom + ' ' + u.Nom)),
    NbPresents: rcValides.length, PhotosUrls: JSON.stringify(urls),
    DocumentsUrls: JSON.stringify(docs),
    VillageIds: JSON.stringify(villageIds), VillageNoms: JSON.stringify(villageNoms),
    PlanningId: planning ? planning.ID : '',
    Lieu: p.lieu || (planning ? planning.Lieu : '') || '',
    RcConviesNoms: planning ? planning.RcConviesNoms : '',
    RcAbsentsNoms: planning ? JSON.stringify(
      parseArr_(planning.RcConviesIds).filter(id => !rcValides.some(u => u.ID === id))
        .map(id => { const u = mesRc.find(x => x.ID === id); return u ? u.Prenom + ' ' + u.Nom : id; })) : '',
    Commentaires: p.commentaires || '', DateCreation: nowStr_(),
    AutresPresentsIds: JSON.stringify(autresPresents.map(u => u.ID)),
    AutresPresentsNoms: JSON.stringify(autresPresents.map(u => u.Prenom + ' ' + u.Nom)),
    AutresActeurs: JSON.stringify(autresActeurs)
  };
  appendRow_(SHEETS.SUIVIS, rec);
  if (planning) updateRowById_(SHEETS.PLANNINGS, planning.ID, { Statut: 'Réalisé', SuiviId: rec.ID });
  return { ok: true, suivi: rec };
}

// Identifiants des villages couverts par un RC : son village d'origine + les villages de ses grappes.
function villagesDuRc_(rc, periGrappes, grappes) {
  const ids = [];
  if (rc.VillageId) ids.push(rc.VillageId);
  periGrappes.filter(x => x.UserId === rc.ID).forEach(x => {
    const g = grappes.find(gg => gg.ID === x.CibleId);
    if (g && g.VillageId && ids.indexOf(g.VillageId) === -1) ids.push(g.VillageId);
  });
  return ids;
}

// ============================================================
// PLANNING DES SUIVIS GROUPÉS (par l'ASCQ, visible par sa hiérarchie)
// ============================================================

// Date au format "yyyy-MM-dd" quel que soit le type renvoyé par la feuille (texte ou Date).
function dateIso_(v) {
  if (!v) return '';
  if (Object.prototype.toString.call(v) === '[object Date]') return Utilities.formatDate(v, 'Africa/Porto-Novo', 'yyyy-MM-dd');
  return String(v).slice(0, 10);
}

function submitPlanningSuivi_(actor, p) {
  if (actor.Role !== ROLES.ASCQ) return { ok: false, error: 'Seul un compte ASCQ peut planifier un suivi groupé.' };
  if (!p.datePrevue) return { ok: false, error: 'La date prévue est obligatoire.' };
  if (dateIso_(p.datePrevue) < dateIso_(new Date())) return { ok: false, error: 'La date prévue ne peut pas être dans le passé.' };
  const mesRc = readSheet_(SHEETS.USERS).filter(u => u.Role === ROLES.RC && u.ResponsableId === actor.ID);
  const rcConvies = mesRc.filter(u => (p.rcConviesIds || []).includes(u.ID));
  const villagesSheet = readSheet_(SHEETS.VILLAGES);
  const villageIds = (Array.isArray(p.villageIds) ? p.villageIds : []).filter(id => villagesSheet.some(v => v.ID === id));
  if (!villageIds.length && !rcConvies.length) return { ok: false, error: 'Indiquez au moins un village ou un RC concerné.' };
  const villageNoms = villageIds.map(id => villagesSheet.find(v => v.ID === id).Nom);
  const rec = {
    ID: newId_('PLN'), AscqId: actor.ID, AscqNom: actor.Prenom + ' ' + actor.Nom,
    ArrondissementId: actor.ArrondissementId || '', ArrondissementNom: actor.ArrondissementNom || '',
    DatePrevue: dateIso_(p.datePrevue), Heure: String(p.heure || '').replace(':', 'h'), // "09h00" : reste du texte dans Sheets ("09:00" serait converti en heure)
    VillageIds: JSON.stringify(villageIds), VillageNoms: JSON.stringify(villageNoms),
    Lieu: p.lieu || '', Themes: JSON.stringify(Array.isArray(p.themes) ? p.themes : []),
    RcConviesIds: JSON.stringify(rcConvies.map(u => u.ID)),
    RcConviesNoms: JSON.stringify(rcConvies.map(u => u.Prenom + ' ' + u.Nom)),
    Objectif: p.objectif || '', Statut: 'Planifié', SuiviId: '', DateCreation: nowStr_()
  };
  appendRow_(SHEETS.PLANNINGS, rec);
  // La hiérarchie (PF, RCSE, Département, National) est prévenue de la séance planifiée...
  cascadeNotify_(actor, 'PLANNING', rec.ID, `Suivi groupé planifié le ${rec.DatePrevue} par ${rec.AscqNom}${villageNoms.length ? ' - Village(s): ' + villageNoms.join(', ') : ''}`);
  // ... et chaque RC convoqué reçoit sa propre notification (date, heure, lieu, objectif).
  notifierRcConvoques_(rcConvies, rec, 'Vous êtes convoqué(e) à un suivi groupé');
  return { ok: true, planning: rec };
}

// Tableau JSON stocké en texte dans une cellule -> tableau (vide si absent ou invalide).
function parseArr_(v) { try { const a = JSON.parse(v || '[]'); return Array.isArray(a) ? a : []; } catch (e) { return []; } }

// Notification individuelle à chaque RC concerné par une séance de suivi groupé.
function notifierRcConvoques_(rcs, plan, titre) {
  const villages = parseArr_(plan.VillageNoms).join(', ');
  const d = dateIso_(plan.DatePrevue).split('-').reverse().join('/');
  const msg = `${titre} : le ${d}${plan.Heure ? ' à ' + plan.Heure : ''}` + (plan.Lieu ? ' - Lieu: ' + plan.Lieu : '') +
    (villages ? ' - Village(s): ' + villages : '') + (plan.Objectif ? ' - Objectif: ' + plan.Objectif : '') +
    ` - Organisé par ${plan.AscqNom}`;
  rcs.forEach(rc => appendRow_(SHEETS.NOTIFICATIONS, {
    ID: newId_('NOTIF'), DestinataireId: rc.ID, Type: 'PLANNING', RefId: plan.ID, Message: msg, Lu: false, DateCreation: nowStr_()
  }));
}

// Annuler, ré-ouvrir ou reporter une séance planifiée (jamais une séance déjà réalisée).
function updatePlanningSuivi_(actor, p) {
  if (actor.Role !== ROLES.ASCQ) return { ok: false, error: 'Seul un compte ASCQ peut modifier son planning.' };
  const plan = readSheet_(SHEETS.PLANNINGS).find(x => x.ID === p.id && x.AscqId === actor.ID);
  if (!plan) return { ok: false, error: 'Séance planifiée introuvable.' };
  if (plan.Statut === 'Réalisé') return { ok: false, error: 'Cette séance est déjà réalisée.' };
  const changes = {}, modifs = [];
  if (p.statut) {
    if (['Planifié', 'Annulé'].indexOf(p.statut) === -1) return { ok: false, error: 'Statut invalide.' };
    changes.Statut = p.statut;
  }
  if (p.datePrevue && dateIso_(p.datePrevue) !== dateIso_(plan.DatePrevue)) {
    if (dateIso_(p.datePrevue) < dateIso_(new Date())) return { ok: false, error: 'La date prévue ne peut pas être dans le passé.' };
    changes.DatePrevue = dateIso_(p.datePrevue); modifs.push('date');
  }
  if (p.heure !== undefined) { const h = String(p.heure || '').replace(':', 'h'); if (h !== String(plan.Heure || '')) { changes.Heure = h; modifs.push('heure'); } }
  if (p.lieu !== undefined && String(p.lieu || '') !== String(plan.Lieu || '')) { changes.Lieu = coupe_(p.lieu, 160); modifs.push('lieu'); }
  if (p.objectif !== undefined && String(p.objectif || '') !== String(plan.Objectif || '')) { changes.Objectif = String(p.objectif || '').trim().slice(0, 500); modifs.push('objectif'); }
  if (p.themes !== undefined) {
    const th = (Array.isArray(p.themes) ? p.themes : []).map(String);
    if (JSON.stringify(th) !== JSON.stringify(parseArr_(plan.Themes))) { changes.Themes = JSON.stringify(th); modifs.push('thèmes'); }
  }
  if (!Object.keys(changes).length) return { ok: false, error: 'Aucune modification demandée.' };
  updateRowById_(SHEETS.PLANNINGS, plan.ID, changes);
  const apres = Object.assign({}, plan, changes);
  const action = changes.Statut === 'Annulé' ? 'annulé' : (changes.Statut === 'Planifié' ? 'réactivé' : (modifs.length === 1 && modifs[0] === 'date' ? 'reporté' : 'modifié (' + modifs.join(', ') + ')'));
  cascadeNotify_(actor, 'PLANNING', plan.ID, `Suivi groupé ${action} (prévu le ${dateIso_(apres.DatePrevue)}) par ${plan.AscqNom}`);
  const ids = parseArr_(plan.RcConviesIds);
  const rcs = readSheet_(SHEETS.USERS).filter(u => u.Role === ROLES.RC && ids.includes(u.ID));
  notifierRcConvoques_(rcs, apres, 'Suivi groupé ' + action);
  return { ok: true };
}

function listPlanningsSuivis_(actor) {
  const ascqIds = ascqIdsVisibles_(actor);
  if (!ascqIds.length) return [];
  return readSheet_(SHEETS.PLANNINGS).filter(x => ascqIds.includes(x.AscqId))
    .map(x => Object.assign({}, x, { DatePrevue: dateIso_(x.DatePrevue) }))
    .sort((a, b) => String(a.DatePrevue).localeCompare(String(b.DatePrevue)));
}

// Historique des suivis groupés d'un ASCQ (les siens uniquement).
// Tous les ASCQ visibles par l'utilisateur connecté (lui-même s'il est ASCQ, ou tous les ASCQ
// de son périmètre s'il est au-dessus) — sert à donner à PF/RCSE/DEPARTEMENT/NATIONAL accès aux
// synthèses de suivi groupé de leurs ASCQ, en plus de l'ASCQ lui-même.
function ascqIdsVisibles_(actor) {
  const users = readSheet_(SHEETS.USERS);
  if (actor.Role === ROLES.ASCQ) return [actor.ID];
  if (actor.Role === ROLES.PF) {
    return users.filter(u => u.Role === ROLES.ASCQ && u.ResponsableId === actor.ID).map(u => u.ID);
  }
  if (actor.Role === ROLES.RCSE) {
    const pfIds = users.filter(u => u.Role === ROLES.PF && u.ResponsableId === actor.ID).map(u => u.ID);
    return users.filter(u => u.Role === ROLES.ASCQ && pfIds.includes(u.ResponsableId)).map(u => u.ID);
  }
  if (actor.Role === ROLES.DEPARTEMENT) {
    const rcseIds = users.filter(u => u.Role === ROLES.RCSE && u.DepartementId === actor.DepartementId).map(u => u.ID);
    const pfIds = users.filter(u => u.Role === ROLES.PF && rcseIds.includes(u.ResponsableId)).map(u => u.ID);
    return users.filter(u => u.Role === ROLES.ASCQ && pfIds.includes(u.ResponsableId)).map(u => u.ID);
  }
  if (actor.Role === ROLES.NATIONAL) return users.filter(u => u.Role === ROLES.ASCQ).map(u => u.ID);
  return [];
}

// Suivis groupés visibles par l'utilisateur connecté : les siens s'il est ASCQ, ceux de tous
// ses ASCQ s'il est PF/RCSE/DEPARTEMENT/NATIONAL (synthèse en lecture — la saisie reste
// réservée à l'ASCQ lui-même, voir submitSuiviGroupe_).
function listSuivisGroupes_(actor) {
  const ascqIds = ascqIdsVisibles_(actor);
  if (!ascqIds.length) return [];
  return readSheet_(SHEETS.SUIVIS).filter(s => ascqIds.includes(s.AscqId))
    .map(s => Object.assign({}, s, { Date: dateIso_(s.Date) }))
    .sort((a, b) => String(b.Date).localeCompare(String(a.Date)));
}

// Tous les arrondissements situés dans le département d'un compte DEPARTEMENT (union des
// arrondissements de toutes les zones sanitaires — RCSE — de ce département).
function arrondissementsOfDepartement_(departementId) {
  const users = readSheet_(SHEETS.USERS);
  const rcses = users.filter(u => u.Role === ROLES.RCSE && u.DepartementId === departementId);
  const arrs = new Set();
  rcses.forEach(rcse => arrondissementsOfRcse_(rcse.ID).forEach(id => arrs.add(id)));
  return [...arrs];
}

// Ajoute VillageNom (absent des feuilles Alertes/Deces, qui ne stockent que VillageId) pour l'affichage.
function avecNomVillage_(rows) {
  const noms = {};
  readSheet_(SHEETS.VILLAGES).forEach(v => { noms[v.ID] = v.Nom; });
  return rows.map(r => Object.assign({}, r, { VillageNom: r.VillageNom || noms[r.VillageId] || '' }));
}

// Validation par l'ASCQ avant remontée : PF, RCSE, Département et National ne voient une alerte ou un décès notifié
// par un RC qu'une fois VALIDÉ par l'ASCQ (alerte investiguée et avérée ; décès confirmé ou investigué et avéré).
// Désactivable par le National (paramètre validationAscq). L'ASCQ et le RC concerné voient tout leur périmètre.
function validationAscqActive_() { return parametreBool_('validationAscq', true); }
function listScoped_(sheetName, actor) {
  const rows = listScopedBrut_(sheetName, actor);
  if (!(RANG_ROLE_[actor.Role] > RANG_ROLE_[ROLES.ASCQ]) || (sheetName !== SHEETS.ALERTES && sheetName !== SHEETS.DECES) || !validationAscqActive_()) return rows;
  const invs = {}; readSheet_(SHEETS.INVESTIGATIONS).forEach(i => { invs[i.ID] = i; });
  const avere = r => { const inv = r.InvestigationId ? invs[r.InvestigationId] : null; return !!inv && String(inv.EvenementAvere || '') !== 'Non'; };
  return rows.filter(r => sheetName === SHEETS.ALERTES ? (r.Statut === 'Investigué' && avere(r)) : (r.Statut === 'Confirmé' || (r.Statut === 'Investigué' && avere(r))));
}
function listScopedBrut_(sheetName, actor) {
  const rows = readSheet_(sheetName);
  if (actor.Role === ROLES.NATIONAL) return rows;
  if (actor.Role === ROLES.RC) return rows.filter(r => r.NotificateurId === actor.ID);
  if (actor.Role === ROLES.ASCQ) {
    // Un ASCQ peut couvrir plusieurs arrondissements (partagés avec d'éventuels autres ASCQ du
    // même arrondissement).
    const arrs = arrondissementsOfAscq_(actor.ID);
    return rows.filter(r => arrs.includes(r.ArrondissementId));
  }
  if (actor.Role === ROLES.PF) {
    const arrs = arrondissementsOfPf_(actor.ID);
    return rows.filter(r => arrs.includes(r.ArrondissementId));
  }
  if (actor.Role === ROLES.RCSE) {
    const arrs = arrondissementsOfRcse_(actor.ID);
    return rows.filter(r => arrs.includes(r.ArrondissementId));
  }
  if (actor.Role === ROLES.DEPARTEMENT) {
    const arrs = arrondissementsOfDepartement_(actor.DepartementId);
    return rows.filter(r => arrs.includes(r.ArrondissementId));
  }
  return [];
}

// ============================================================
// CALENDRIER EPIDEMIOLOGIQUE (import annuel, semaine 1..52/53)
// ============================================================

function importCalendrier_(actor, p) {
  if (actor.Role !== ROLES.NATIONAL) return { ok: false, error: 'Seul le compte national peut importer le calendrier.' };
  const rows = (p.rows || []).slice(0, 53); // garde-fou : jamais plus de 53 semaines (52 + éventuelle semaine 53)
  const cleaned = rows.filter(r => Number(r.semaine) >= 1 && Number(r.semaine) <= 53);
  cleaned.forEach(r => appendRow_(SHEETS.CALENDRIER, {
    Annee: r.annee, SemaineEpi: r.semaine, DateDebut: r.dateDebut, DateFin: r.dateFin
  }));
  return { ok: true, count: cleaned.length };
}

// Supprime les semaines importées. Si p.annee est fourni, ne supprime que cette année-là ;
// sinon vide tout le calendrier.
function clearCalendrier_(actor, p) {
  if (actor.Role !== ROLES.NATIONAL) return { ok: false, error: 'Seul le compte national peut modifier le calendrier.' };
  const sh = ss_().getSheetByName(SHEETS.CALENDRIER);
  const values = sh.getDataRange().getValues();
  const headers = values[0];
  const anneeCol = headers.indexOf('Annee');
  let removed = 0;
  for (let r = values.length - 1; r >= 1; r--) {
    if (!p.annee || String(values[r][anneeCol]) === String(p.annee)) {
      sh.deleteRow(r + 1);
      removed++;
    }
  }
  return { ok: true, removed };
}

function semaineCouranteInfo_() {
  const cal = readSheet_(SHEETS.CALENDRIER);
  const today = new Date();
  const match = cal.find(r => debutJournee_(r.DateDebut) <= today && today <= finJournee_(r.DateFin));
  return match || null;
}

// ============================================================
// FORMULAIRE / SUPPORT 4 — RAPPORT HEBDOMADAIRE AUTOMATIQUE
// ============================================================

// A appeler manuellement (bouton "Générer") ou via un déclencheur horaire hebdomadaire (voir README).
function genererRapportHebdo_(actor, p) {
  if (![ROLES.ASCQ, ROLES.PF, ROLES.RCSE, ROLES.NATIONAL].includes(actor.Role) && actor.Role !== undefined) {
    // autorisé pour tous les niveaux administrateurs, ou déclencheur système (actor peut être null)
  }
  if (p && p.annee && p.semaine) {
    supprimerRapportsPourSemaine_(p.annee, p.semaine);
    return { ok: true, rapports: genererRapportsPourSemaine_(p.annee, p.semaine) };
  }
  // Sans semaine précisée : comble les semaines passées du calendrier qui n'ont encore aucun
  // rapport (pour que la navigation Précédent/Suivant ait un historique à parcourir, pas
  // seulement la semaine courante), puis régénère TOUJOURS la semaine en cours (celle-ci peut
  // évoluer en cours de semaine — "actualiser" doit refléter les dernières notifications).
  const semaineInfo = semaineCouranteInfo_();
  if (!semaineInfo) return { ok: false, error: 'Aucune semaine épidémiologique correspondante dans le calendrier importé.' };
  genererRapportsManquants_(semaineInfo.Annee, semaineInfo.SemaineEpi);
  supprimerRapportsPourSemaine_(semaineInfo.Annee, semaineInfo.SemaineEpi);
  return { ok: true, rapports: genererRapportsPourSemaine_(semaineInfo.Annee, semaineInfo.SemaineEpi) };
}

// Supprime les rapports déjà générés pour une semaine donnée (tous niveaux confondus), afin de
// pouvoir la régénérer proprement sans laisser d'anciennes lignes dupliquées/obsolètes.
function supprimerRapportsPourSemaine_(annee, semaine) {
  const sh = ss_().getSheetByName(SHEETS.RAPPORTS);
  const values = sh.getDataRange().getValues();
  const headers = values[0];
  const anneeCol = headers.indexOf('Annee'), semCol = headers.indexOf('SemaineEpi');
  for (let r = values.length - 1; r >= 1; r--) {
    if (String(values[r][anneeCol]) === String(annee) && String(values[r][semCol]) === String(semaine)) sh.deleteRow(r + 1);
  }
}

// Génère les rapports de toutes les semaines du calendrier déjà écoulées (DateFin <= aujourd'hui,
// semaine courante exclue) qui n'ont encore aucun rapport enregistré — pour que la navigation
// Précédent/Suivant des rapports ait un historique à parcourir, pas seulement la semaine
// courante. Les semaines déjà générées ne sont jamais touchées ici (voir genererRapportHebdo_
// pour la régénération explicite de la semaine courante).
function genererRapportsManquants_(anneeCourante, semaineCourante) {
  const cal = readSheet_(SHEETS.CALENDRIER);
  const existants = readSheet_(SHEETS.RAPPORTS);
  const dejaGenere = new Set(existants.map(r => r.Annee + '-' + r.SemaineEpi));
  const today = new Date();
  // Plafond de semaines traitées en un seul appel : avec le cache de feuilles (readSheet_), un
  // gros retard à combler reste rapide, mais on borne quand même le pire des cas (première
  // utilisation après une longue interruption) pour ne jamais faire traîner une simple
  // consultation du rapport. S'il reste plus de semaines à générer, elles le seront au prochain
  // appel (chaque semaine traitée est immédiatement marquée générée, donc jamais reprise à zéro).
  const PLAFOND_SEMAINES_PAR_APPEL = 12;
  let traitees = 0;
  cal.filter(r => finJournee_(r.DateFin) <= today && !(String(r.Annee) === String(anneeCourante) && String(r.SemaineEpi) === String(semaineCourante)))
    .sort((a, b) => (Number(a.Annee) - Number(b.Annee)) || (Number(a.SemaineEpi) - Number(b.SemaineEpi)))
    .forEach(r => {
      if (traitees >= PLAFOND_SEMAINES_PAR_APPEL) return;
      const key = r.Annee + '-' + r.SemaineEpi;
      if (dejaGenere.has(key)) return;
      genererRapportsPourSemaine_(r.Annee, r.SemaineEpi);
      traitees++;
    });
}

function genererRapportsPourSemaine_(annee, semaine) {
  const alertes = readSheet_(SHEETS.ALERTES).filter(a => String(a.Annee) === String(annee) && String(a.SemaineEpi) === String(semaine));
  // Seuls les décès CONFIRMÉS par l'ASCQ (Statut = 'Confirmé') entrent dans le rapport hebdomadaire.
  const deces = readSheet_(SHEETS.DECES).filter(d => d.Statut === 'Confirmé' && String(d.Annee) === String(annee) && String(d.SemaineEpi) === String(semaine));
  const investigations = readSheet_(SHEETS.INVESTIGATIONS);
  const users = readSheet_(SHEETS.USERS);
  const perimetres = readSheet_(SHEETS.PERIMETRES);
  const generated = [];

  // IMPORTANT : la synthèse (cases ci-dessus) doit correspondre EXACTEMENT à ce que montre le
  // détail du rapport (listRapportDetail_) — c'est-à-dire les événements AVÉRÉS uniquement
  // (alertes investiguées avec EvenementAvere = "Oui") + tous les décès notifiés (considérés
  // avérés dès leur notification, voir listRapportDetail_). Avant cette correction,
  // NbPersonnesTouchees/NbPersonnesDecedees comptaient TOUTES les alertes (même non avérées) et
  // ignoraient les décès du formulaire dédié, d'où des écarts du type "0 événement avéré / 1
  // personne touchée" affichés en même temps.
  function computeAggregate_(alertesSub, decesSub) {
    const investiguees = alertesSub.filter(a => a.Statut === 'Investigué');
    const averees = investiguees.filter(a => {
      const inv = investigations.find(i => i.ID === a.InvestigationId);
      return inv && String(inv.EvenementAvere).toLowerCase() === 'oui';
    });
    const nbCasAverees = averees.reduce((s, a) => {
      const inv = investigations.find(i => i.ID === a.InvestigationId);
      return s + (sumJsonValues_(inv && inv.CasParCategorie) || Number(a.PersonnesTouchees) || 0);
    }, 0);
    const nbDecesAlertesAverees = averees.reduce((s, a) => {
      const inv = investigations.find(i => i.ID === a.InvestigationId);
      return s + (sumJsonValues_(inv && inv.DecesParCategorie) || Number(a.PersonnesMortes) || 0);
    }, 0);
    const nbDecesDeclares = decesSub.reduce((s, d) => {
      const inv = investigations.find(i => i.ID === d.InvestigationId);
      return s + (inv ? (sumJsonValues_(inv.DecesParCategorie) || 1) : 1);
    }, 0);
    return {
      NbAlertesDetectees: alertesSub.length,
      NbPersonnesTouchees: nbCasAverees,
      NbPersonnesDecedees: nbDecesAlertesAverees + nbDecesDeclares,
      NbAlertesVerifiees24_48h: investiguees.length,
      NbAlertesAverees: averees.length + decesSub.length,
      DecesMaternel: decesSub.filter(d => String(d.TypeDeces) === '1').length,
      DecesNeonatal: decesSub.filter(d => String(d.TypeDeces) === '2').length,
      DecesInfantile: decesSub.filter(d => ['2', '3'].includes(String(d.TypeDeces))).length,
      DecesInfantoJuvenile: decesSub.filter(d => ['2', '3', '4'].includes(String(d.TypeDeces))).length,
      Deces5ansPlus: decesSub.filter(d => String(d.TypeDeces) === '5').length
    };
  }

  // Niveau ASCQ : un seul rapport par arrondissement (et non par ASCQ), puisque le Support 4
  // se construit à l'échelle de l'arrondissement. Si plusieurs ASCQ sont rattachés au même
  // arrondissement, ils partagent exactement ce même rapport ; si un ASCQ couvre plusieurs
  // arrondissements, il reçoit un rapport distinct pour chacun (voir listRapports_).
  const arrondissementsAvecAscq = {};
  perimetres.filter(pe => pe.TypeCible === 'Arrondissement').forEach(pe => {
    const proprietaire = users.find(u => u.ID === pe.UserId);
    if (proprietaire && proprietaire.Role === ROLES.ASCQ) arrondissementsAvecAscq[pe.CibleId] = true;
  });
  Object.keys(arrondissementsAvecAscq).forEach(arrId => {
    const aSub = alertes.filter(a => a.ArrondissementId === arrId);
    const dSub = deces.filter(d => d.ArrondissementId === arrId);
    const rec = Object.assign(
      { ID: newId_('RAP'), Annee: annee, SemaineEpi: semaine, Niveau: 'ASCQ', CompteId: arrId, ArrondissementId: arrId, GenereLe: nowStr_() },
      computeAggregate_(aSub, dSub)
    );
    appendRow_(SHEETS.RAPPORTS, rec);
    generated.push(rec);
  });

  // Niveau PF (par arrondissement assigné)
  users.filter(u => u.Role === ROLES.PF).forEach(pf => {
    const arrs = perimetres.filter(pe => pe.UserId === pf.ID && pe.TypeCible === 'Arrondissement').map(pe => pe.CibleId);
    if (!arrs.length) return;
    const aSub = alertes.filter(a => arrs.includes(a.ArrondissementId));
    const dSub = deces.filter(d => arrs.includes(d.ArrondissementId));
    const rec = Object.assign({ ID: newId_('RAP'), Annee: annee, SemaineEpi: semaine, Niveau: 'PF', CompteId: pf.ID, GenereLe: nowStr_() }, computeAggregate_(aSub, dSub));
    appendRow_(SHEETS.RAPPORTS, rec);
    generated.push(rec);
  });

  // Niveau RCSE (par département assigné, un ou plusieurs)
  users.filter(u => u.Role === ROLES.RCSE).forEach(rcse => {
    const arrs = arrondissementsOfRcse_(rcse.ID);
    if (!arrs.length) return;
    const aSub = alertes.filter(a => arrs.includes(a.ArrondissementId));
    const dSub = deces.filter(d => arrs.includes(d.ArrondissementId));
    const rec = Object.assign({ ID: newId_('RAP'), Annee: annee, SemaineEpi: semaine, Niveau: 'RCSE', CompteId: rcse.ID, GenereLe: nowStr_() }, computeAggregate_(aSub, dSub));
    appendRow_(SHEETS.RAPPORTS, rec);
    generated.push(rec);
  });

  // Niveau DEPARTEMENT (toutes les zones sanitaires — RCSE — de ce département confondues)
  users.filter(u => u.Role === ROLES.DEPARTEMENT).forEach(dep => {
    const arrs = arrondissementsOfDepartement_(dep.DepartementId);
    if (!arrs.length) return;
    const aSub = alertes.filter(a => arrs.includes(a.ArrondissementId));
    const dSub = deces.filter(d => arrs.includes(d.ArrondissementId));
    const rec = Object.assign({ ID: newId_('RAP'), Annee: annee, SemaineEpi: semaine, Niveau: 'DEPARTEMENT', CompteId: dep.ID, GenereLe: nowStr_() }, computeAggregate_(aSub, dSub));
    appendRow_(SHEETS.RAPPORTS, rec);
    generated.push(rec);
  });

  // Niveau NATIONAL (tout le pays confondu)
  const recNat = Object.assign({ ID: newId_('RAP'), Annee: annee, SemaineEpi: semaine, Niveau: 'NATIONAL', CompteId: 'NATIONAL', GenereLe: nowStr_() }, computeAggregate_(alertes, deces));
  appendRow_(SHEETS.RAPPORTS, recNat);
  generated.push(recNat);

  return generated;
}

// S'assure que TOUTES les semaines épidémiologiques déjà écoulées (calendrier importé, DateFin
// <= aujourd'hui, semaine en cours exclue) ont un rapport enregistré dans RapportsHebdo — quitte
// à le générer avec des zéros partout si aucune alerte/décès n'a été notifié cette semaine-là.
// Sans cet appel, une semaine sans la moindre notification n'aurait tout simplement AUCUNE ligne
// de rapport (donc rien à afficher), au lieu d'un rapport à 0 : le rapport hebdomadaire doit
// toujours exister pour une semaine terminée, même quand il n'y a rien à y mettre. Rappelée à
// chaque consultation de la liste des rapports (listRapports_) ; ne refait rien pour une semaine
// déjà générée (voir genererRapportsManquants_), donc sans coût une fois les rapports à jour.
function ensureRapportsPassesGeneres_() {
  const info = semaineCouranteInfo_();
  if (!info) return; // aucun calendrier importé : rien à générer
  genererRapportsManquants_(info.Annee, info.SemaineEpi);
}

function listRapports_(actor) {
  ensureRapportsPassesGeneres_();
  const all = readSheet_(SHEETS.RAPPORTS);
  if (actor.Role === ROLES.NATIONAL) return all.filter(r => r.Niveau === 'NATIONAL');
  if (actor.Role === ROLES.DEPARTEMENT) {
    // Un DEPARTEMENT reçoit, en plus de son propre rapport départemental, les rapports RCSE
    // (par zone sanitaire), PF (par commune) et ASCQ (par arrondissement) de tout son périmètre.
    const users = readSheet_(SHEETS.USERS);
    const rcses = users.filter(u => u.Role === ROLES.RCSE && u.DepartementId === actor.DepartementId);
    const rcseIds = rcses.map(u => u.ID);
    const pfIds = users.filter(u => u.Role === ROLES.PF && rcseIds.includes(u.ResponsableId)).map(u => u.ID);
    const mesArrs = arrondissementsOfDepartement_(actor.DepartementId);
    return all.filter(r =>
      (r.Niveau === 'DEPARTEMENT' && r.CompteId === actor.ID) ||
      (r.Niveau === 'RCSE' && rcseIds.includes(r.CompteId)) ||
      (r.Niveau === 'PF' && pfIds.includes(r.CompteId)) ||
      (r.Niveau === 'ASCQ' && mesArrs.includes(r.ArrondissementId))
    );
  }
  if (actor.Role === ROLES.RCSE) {
    // Un RCSE reçoit, en plus de son propre rapport de zone, les rapports PF (par commune) et
    // ASCQ (par arrondissement) de tout son périmètre — pour permettre le détail par
    // commune/arrondissement en plus de la zone sanitaire complète (voir listPerimetreRapport_).
    const users = readSheet_(SHEETS.USERS);
    const pfIds = users.filter(u => u.Role === ROLES.PF && u.ResponsableId === actor.ID).map(u => u.ID);
    const mesArrs = arrondissementsOfRcse_(actor.ID);
    return all.filter(r =>
      (r.Niveau === 'RCSE' && r.CompteId === actor.ID) ||
      (r.Niveau === 'PF' && pfIds.includes(r.CompteId)) ||
      (r.Niveau === 'ASCQ' && mesArrs.includes(r.ArrondissementId))
    );
  }
  if (actor.Role === ROLES.PF) {
    // Un PF reçoit, en plus de son propre rapport de commune, les rapports ASCQ (par
    // arrondissement) de ses arrondissements — pour le détail par arrondissement.
    const mesArrs = arrondissementsOfPf_(actor.ID);
    return all.filter(r =>
      (r.Niveau === 'PF' && r.CompteId === actor.ID) ||
      (r.Niveau === 'ASCQ' && mesArrs.includes(r.ArrondissementId))
    );
  }
  // Niveau ASCQ : un rapport par arrondissement couvert (partagé avec les autres ASCQ du même
  // arrondissement ; un ASCQ avec plusieurs arrondissements reçoit un rapport par arrondissement).
  if (actor.Role === ROLES.ASCQ) {
    const mesArrs = arrondissementsOfAscq_(actor.ID);
    return all.filter(r => r.Niveau === 'ASCQ' && mesArrs.includes(r.ArrondissementId));
  }
  return [];
}

// Hiérarchie géographique disponible pour construire les listes déroulantes en cascade du
// rapport hebdomadaire (bouton "Par commune" / "Par arrondissement" côté PF et RCSE).
//  - PF  : la liste de SES arrondissements (sa commune est déjà connue, c'est la vue par défaut).
//  - RCSE: pour chaque PF de sa zone, sa commune ET la liste des arrondissements de ce PF —
//    permet de choisir d'abord une commune, puis un arrondissement de cette commune.
function listPerimetreRapport_(actor) {
  const arrondissementsSheet = readSheet_(SHEETS.ARRONDISSEMENTS);
  function arrsDe_(ids) { return arrondissementsSheet.filter(a => ids.includes(a.ID)).map(a => ({ id: a.ID, nom: a.Nom })); }

  if (actor.Role === ROLES.PF) {
    return { arrondissements: arrsDe_(arrondissementsOfPf_(actor.ID)) };
  }
  if (actor.Role === ROLES.RCSE) {
    const users = readSheet_(SHEETS.USERS);
    const pfs = users.filter(u => u.Role === ROLES.PF && u.ResponsableId === actor.ID);
    const communes = pfs.map(pf => ({
      pfId: pf.ID, communeId: pf.CommuneId, nom: pf.CommuneNom,
      arrondissements: arrsDe_(arrondissementsOfPf_(pf.ID))
    }));
    return { zoneSanitaireNom: zoneSanitaireNomDeRcse_(actor), communes: communes };
  }
  if (actor.Role === ROLES.DEPARTEMENT) {
    const users = readSheet_(SHEETS.USERS);
    const rcses = users.filter(u => u.Role === ROLES.RCSE && u.DepartementId === actor.DepartementId);
    const zones = rcses.map(rcse => {
      const pfs = users.filter(u => u.Role === ROLES.PF && u.ResponsableId === rcse.ID);
      return {
        rcseId: rcse.ID, nom: zoneSanitaireNomDeRcse_(rcse),
        communes: pfs.map(pf => ({ pfId: pf.ID, communeId: pf.CommuneId, nom: pf.CommuneNom, arrondissements: arrsDe_(arrondissementsOfPf_(pf.ID)) }))
      };
    });
    return { departementNom: actor.DepartementNom, zones: zones };
  }
  return {};
}

// Libellés des types de décès (doit rester synchronisé avec TYPES_DECES dans assets/forms.js),
// utilisés quand un décès n'a pas encore été investigué par l'ASCQ (il apparaît quand même dans
// le rapport, voir listRapportDetail_).
const TYPES_DECES_LABELS = {
  '1': 'Décès maternel', '2': 'Décès de bébé (0-28 jours)', '3': "Décès d'enfant 1 mois à 1 an",
  '4': 'Décès d\'enfant 1 à 5 ans', '5': 'Décès de personne de plus de 5 ans'
};

// Somme les valeurs numériques d'un objet JSON (ex: CasParCategorie / DecesParCategorie)
function sumJsonValues_(jsonStr) {
  try {
    const obj = JSON.parse(jsonStr || '{}');
    return Object.values(obj).reduce((s, v) => s + (Number(v) || 0), 0);
  } catch (e) { return 0; }
}

// Détail COMPLET des événements AVÉRÉS (confirmés par l'ASCQ, EvenementAvere = "Oui") pour une
// semaine épidémiologique donnée, dans le périmètre de l'utilisateur connecté. Reprend, pour
// chaque événement, TOUTES les rubriques de la fiche officielle "10_BJ_Fiche d'investigation des
// événements de santé par les ASCQ" (et non plus seulement la ligne de synthèse), plus :
//  - la liste des SITES NOTIFICATEURS (les RC / villages à l'origine des cas comptabilisés dans
//    la synthèse du rapport de la semaine), pour objectiver d'où viennent les données ;
//  - les SIGNATAIRES du rapport (ASCQ, PF CCLS-TP, RCSE responsables du périmètre couvert), pour
//    le bas de page du rapport imprimé/exporté en PDF.
// Renvoie { detail, sites, signataires }.
function listRapportDetail_(actor, p) {
  const annee = p.annee, semaine = p.semaine;
  const investigations = readSheet_(SHEETS.INVESTIGATIONS);
  const villages = readSheet_(SHEETS.VILLAGES);
  const arrondissements = readSheet_(SHEETS.ARRONDISSEMENTS);
  const users = readSheet_(SHEETS.USERS);
  const userById_ = {}; users.forEach(u => userById_[u.ID] = u);

  function resolveGeo_(villageId, arrondissementIdFallback) {
    const v = villages.find(x => x.ID === villageId);
    const arrId = v ? v.ArrondissementId : arrondissementIdFallback;
    const arr = arrondissements.find(x => x.ID === arrId);
    return {
      village: v ? v.Nom : '',
      arrondissement: v ? v.ArrondissementNom : (arr ? arr.Nom : ''),
      commune: arr ? arr.CommuneNom : ''
    };
  }

  let alertes = readSheet_(SHEETS.ALERTES).filter(a => String(a.Annee) === String(annee) && String(a.SemaineEpi) === String(semaine));
  // Seuls les décès CONFIRMÉS par l'ASCQ figurent dans le détail du rapport.
  let deces = readSheet_(SHEETS.DECES).filter(d => d.Statut === 'Confirmé' && String(d.Annee) === String(annee) && String(d.SemaineEpi) === String(semaine));

  // Périmètre PROPRE de l'utilisateur connecté (sert de garde-fou de sécurité ci-dessous).
  let mesArrondissements = null; // null = pas de restriction (NATIONAL)
  if (actor.Role === ROLES.ASCQ) mesArrondissements = arrondissementsOfAscq_(actor.ID);
  else if (actor.Role === ROLES.PF) mesArrondissements = arrondissementsOfPf_(actor.ID);
  else if (actor.Role === ROLES.RCSE) mesArrondissements = arrondissementsOfRcse_(actor.ID);
  else if (actor.Role === ROLES.DEPARTEMENT) mesArrondissements = arrondissementsOfDepartement_(actor.DepartementId);
  else if (actor.Role !== ROLES.NATIONAL) return { detail: [], sites: [], signataires: {} };

  // Périmètre EFFECTIF du rapport consulté (celui de la ligne RapportsHebdo affichée : un PF, un
  // RCSE ou un DEPARTEMENT peut demander le détail d'un niveau EN DESSOUS du sien — voir
  // listPerimetreRapport_ / listRapports_, qui exposent déjà ces rapports plus fins).
  let arrondissementsVises;
  if (p.niveau === 'ASCQ' && p.arrondissementId) arrondissementsVises = [p.arrondissementId];
  else if (p.niveau === 'PF' && p.compteId) arrondissementsVises = arrondissementsOfPf_(p.compteId);
  else if (p.niveau === 'RCSE' && p.compteId) arrondissementsVises = arrondissementsOfRcse_(p.compteId);
  else if (p.niveau === 'DEPARTEMENT' && p.compteId) {
    const compte = users.find(u => u.ID === p.compteId);
    arrondissementsVises = compte ? arrondissementsOfDepartement_(compte.DepartementId) : [];
  }
  else if (p.niveau === 'NATIONAL') arrondissementsVises = null;
  else arrondissementsVises = mesArrondissements;

  // Sécurité : le rapport demandé ne peut jamais sortir du périmètre propre de l'utilisateur.
  if (mesArrondissements) {
    arrondissementsVises = (arrondissementsVises || mesArrondissements).filter(id => mesArrondissements.includes(id));
  }

  if (arrondissementsVises) {
    alertes = alertes.filter(a => arrondissementsVises.includes(a.ArrondissementId));
    deces = deces.filter(d => arrondissementsVises.includes(d.ArrondissementId));
  }

  const rows = [];
  const sitesParNotificateur = {}; // NotificateurId -> agrégat pour le "point des sites notificateurs"

  function enregistrerSite_(notificateurId, notificateurNom, geo, nbCas, nbDeces) {
    if (!notificateurId) return;
    if (!sitesParNotificateur[notificateurId]) {
      const rc = userById_[notificateurId];
      sitesParNotificateur[notificateurId] = {
        relaisId: notificateurId,
        relaisNom: notificateurNom || (rc ? (rc.Prenom + ' ' + rc.Nom) : ''),
        telephoneRelais: rc ? rc.Telephone : '',
        village: geo.village, arrondissement: geo.arrondissement, commune: geo.commune,
        nbEvenements: 0, nbCas: 0, nbDeces: 0
      };
    }
    const s = sitesParNotificateur[notificateurId];
    s.nbEvenements += 1;
    s.nbCas += nbCas;
    s.nbDeces += nbDeces;
  }

  alertes.forEach(a => {
    const inv = investigations.find(i => i.ID === a.InvestigationId);
    if (!inv || String(inv.EvenementAvere).toLowerCase() !== 'oui') return; // seulement les événements avérés
    const geo = resolveGeo_(a.VillageId, a.ArrondissementId);
    const casParCategorie = safeParseJson_(inv.CasParCategorie);
    const decesParCategorie = safeParseJson_(inv.DecesParCategorie);
    const nbCas = sumJsonValues_(inv.CasParCategorie) || Number(a.PersonnesTouchees) || 0;
    const nbDeces = sumJsonValues_(inv.DecesParCategorie) || Number(a.PersonnesMortes) || 0;
    rows.push({
      refType: 'ALERTE', refId: a.ID,
      date: a.DateNotification || a.DateDebutMaladie,
      departement: inv.Departement || a.Departement || '', zoneSanitaire: inv.ZoneSanitaire || a.ZoneSanitaire || '',
      commune: geo.commune, arrondissement: geo.arrondissement, village: geo.village,
      relais: inv.Relais || a.NotificateurNom || '', telRelais: inv.TelRelais || (userById_[a.NotificateurId] ? userById_[a.NotificateurId].Telephone : ''),
      ascqNom: inv.ASCQNom || '', telAscq: inv.TelASCQ || '',
      gpsLat: inv.GPSLat || a.GPSLat || '', gpsLon: inv.GPSLon || a.GPSLon || '',
      evenementAvere: inv.EvenementAvere || '', source: inv.Source || '',
      maladie: inv.Maladie || a.TypeAlerte || '', evenement: inv.Maladie || a.TypeAlerte || '',
      description: inv.Description || '', circonstances: inv.Circonstances || '',
      dateSurvenue: inv.DateSurvenue || a.DateDebutMaladie || '',
      dateNotification: inv.DateNotification || a.DateNotification || '',
      dateInvestigation: inv.DateInvestigation || '',
      casParCategorie: casParCategorie, decesParCategorie: decesParCategorie,
      nombreCas: nbCas, nombreDeces: nbDeces, actions: inv.Actions || '',
      notificateurNom: a.NotificateurNom || ''
    });
    enregistrerSite_(a.NotificateurId, a.NotificateurNom, geo, nbCas, nbDeces);
  });

  // Contrairement aux alertes, un décès notifié par un RC est considéré directement comme une
  // donnée avérée : il est compté dans le rapport dès sa notification, sans attendre
  // l'investigation de l'ASCQ (celle-ci reste utile pour préciser la cause/les circonstances,
  // mais n'est jamais une condition pour qu'il apparaisse ici).
  deces.forEach(d => {
    const inv = investigations.find(i => i.ID === d.InvestigationId);
    const geo = resolveGeo_(d.VillageId, d.ArrondissementId);
    const nbCas = inv ? (sumJsonValues_(inv.CasParCategorie) || 0) : 0;
    const nbDeces = inv ? (sumJsonValues_(inv.DecesParCategorie) || 1) : 1;
    const libelleTypeDeces = TYPES_DECES_LABELS[String(d.TypeDeces)] || 'Décès communautaire';
    rows.push({
      refType: 'DECES', refId: d.ID,
      date: d.DateDeces,
      departement: (inv && inv.Departement) || d.Departement || '', zoneSanitaire: (inv && inv.ZoneSanitaire) || d.ZoneSanitaire || '',
      commune: geo.commune, arrondissement: geo.arrondissement, village: geo.village,
      relais: (inv && inv.Relais) || d.NotificateurNom || '', telRelais: (inv && inv.TelRelais) || (userById_[d.NotificateurId] ? userById_[d.NotificateurId].Telephone : ''),
      ascqNom: (inv && inv.ASCQNom) || '', telAscq: (inv && inv.TelASCQ) || '',
      gpsLat: (inv && inv.GPSLat) || d.GPSLat || '', gpsLon: (inv && inv.GPSLon) || d.GPSLon || '',
      evenementAvere: (inv && inv.EvenementAvere) || 'Oui (décès communautaire)', source: (inv && inv.Source) || '',
      maladie: (inv && inv.Maladie) || libelleTypeDeces, evenement: (inv && inv.Maladie) || libelleTypeDeces,
      description: (inv && inv.Description) || '', circonstances: (inv && inv.Circonstances) || d.Circonstances || '',
      dateSurvenue: (inv && inv.DateSurvenue) || d.DateDeces || '',
      dateNotification: (inv && inv.DateNotification) || d.DateNotification || '',
      dateInvestigation: (inv && inv.DateInvestigation) || '',
      casParCategorie: safeParseJson_(inv ? inv.CasParCategorie : ''), decesParCategorie: safeParseJson_(inv ? inv.DecesParCategorie : ''),
      nombreCas: nbCas, nombreDeces: nbDeces, actions: (inv && inv.Actions) || '',
      notificateurNom: d.NotificateurNom || ''
    });
    enregistrerSite_(d.NotificateurId, d.NotificateurNom, geo, nbCas, nbDeces);
  });

  rows.sort((x, y) => new Date(x.date) - new Date(y.date));
  const sites = Object.values(sitesParNotificateur).sort((x, y) => String(x.village).localeCompare(String(y.village)));
  const signataires = computeSignataires_(p.niveau, p.compteId, p.arrondissementId || (rows[0] ? rows[0].arrondissement : ''));

  return { detail: rows, sites: sites, signataires: signataires };
}

// Parse sûr d'un champ JSON (CasParCategorie / DecesParCategorie) vers un objet simple.
function safeParseJson_(jsonStr) {
  try { return JSON.parse(jsonStr || '{}'); } catch (e) { return {}; }
}

// Noms à faire figurer en bas de page du rapport hebdomadaire imprimé : l'ASCQ (ou les ASCQ,
// si plusieurs couvrent le même arrondissement), le PF CCLS-TP et le RCSE responsables du
// périmètre du rapport consulté. niveau/compteId sont ceux de la ligne RapportsHebdo affichée
// (r.Niveau / r.CompteId côté frontend) ; arrondissementId sert à retrouver le ou les ASCQ pour
// un rapport de niveau ASCQ.
// Signataires (ASCQ/PF/RCSE + téléphones) ET périmètre géographique (département, zone
// sanitaire, commune, arrondissement) du rapport hebdomadaire consulté — sert à préremplir
// l'en-tête de la fiche hebdomadaire même quand aucun événement n'a eu lieu cette semaine
// (le périmètre vient du compte lui-même, pas des événements). niveau/compteId sont ceux de la
// ligne RapportsHebdo affichée (r.Niveau / r.CompteId côté frontend) ; arrondissementId sert à
// retrouver le ou les ASCQ et le nom de l'arrondissement pour un rapport de niveau ASCQ.
// Nom de la zone sanitaire d'un RCSE : la concaténation des communes des DIFFÉRENTS PF qu'il a
// créés (ex. PF de Djidja, Abomey, Agbangnizoun -> "Djidja-Abomey-Agbangnizoun"), dans l'ordre
// où ces PF ont été créés, sans doublon. Si le RCSE n'a pas encore de PF (tout début
// d'activité), on retombe sur les communes assignées à sa zone à sa création (Perimetres), puis
// en dernier recours sur le champ ZoneSanitaireNom saisi manuellement.
function zoneSanitaireNomDeRcse_(rcseUser) {
  const users = readSheet_(SHEETS.USERS);
  const pfs = users.filter(u => u.Role === ROLES.PF && u.ResponsableId === rcseUser.ID);
  const communes = [];
  pfs.forEach(pf => { if (pf.CommuneNom && communes.indexOf(pf.CommuneNom) === -1) communes.push(pf.CommuneNom); });
  if (communes.length) return communes.join('-');

  const perimetres = readSheet_(SHEETS.PERIMETRES).filter(pe => pe.UserId === rcseUser.ID && pe.TypeCible === 'Commune');
  if (perimetres.length) {
    const communesSheet = readSheet_(SHEETS.COMMUNES);
    const noms = [];
    perimetres.forEach(pe => {
      const c = communesSheet.find(x => x.ID === pe.CibleId);
      if (c && noms.indexOf(c.Nom) === -1) noms.push(c.Nom);
    });
    if (noms.length) return noms.join('-');
  }
  return rcseUser.ZoneSanitaireNom || '';
}

// Nom de la zone sanitaire d'un utilisateur : c'est TOUJOURS celui du RCSE qui le chapeaute (la
// zone sanitaire n'existe qu'au niveau RCSE — PF/ASCQ/RC n'ont pas leur propre champ "zone
// sanitaire", ils héritent de celui de leur RCSE). Remonte la hiérarchie jusqu'au premier RCSE
// trouvé ; renvoie '' si l'utilisateur est lui-même NATIONAL ou orphelin.
function zoneSanitaireDe_(user) {
  if (!user) return '';
  const rcse = user.Role === ROLES.RCSE ? user : chainAbove_(user).find(u => u.Role === ROLES.RCSE);
  return rcse ? zoneSanitaireNomDeRcse_(rcse) : '';
}

function computeSignataires_(niveau, compteId, arrondissementId) {
  const users = readSheet_(SHEETS.USERS);
  const perimetres = readSheet_(SHEETS.PERIMETRES);
  const out = {
    ascq: '', pf: '', rcse: '', departementResp: '', ascqTel: '', pfTel: '', rcseTel: '', departementTel: '',
    departement: '', zoneSanitaire: '', commune: '', arrondissement: '',
    // signatures enregistrées dans « Mon compte » (vide si la personne n'en a pas)
    ascqSigs: [], pfSig: '', rcseSig: '', departementSig: ''
  };

  function nomComplet_(u) { return u ? (u.Prenom + ' ' + u.Nom) : ''; }

  if (niveau === 'ASCQ' && arrondissementId) {
    const ascqIds = perimetres.filter(pe => pe.TypeCible === 'Arrondissement' && pe.CibleId === arrondissementId).map(pe => pe.UserId);
    const ascqs = users.filter(u => ascqIds.includes(u.ID) && u.Role === ROLES.ASCQ);
    out.ascq = ascqs.map(nomComplet_).join(', ');
    out.ascqTel = ascqs.map(u => u.Telephone).filter(Boolean).join(', ');
    out.ascqSigs = ascqs.map(u => ({ nom: nomComplet_(u), signature: sigDe_(u) }));
    if (ascqs[0]) {
      out.departement = ascqs[0].DepartementNom || '';
      out.zoneSanitaire = zoneSanitaireDe_(ascqs[0]);
      out.commune = ascqs[0].CommuneNom || '';
      const arr = readSheet_(SHEETS.ARRONDISSEMENTS).find(a => a.ID === arrondissementId);
      out.arrondissement = arr ? arr.Nom : (ascqs[0].ArrondissementNom || '');
      const chain = chainAbove_(ascqs[0]);
      const pf = chain.find(u => u.Role === ROLES.PF);
      const rcse = chain.find(u => u.Role === ROLES.RCSE);
      const dep = chain.find(u => u.Role === ROLES.DEPARTEMENT);
      out.pf = nomComplet_(pf); out.pfTel = pf ? pf.Telephone : ''; out.pfSig = sigDe_(pf);
      out.rcse = nomComplet_(rcse); out.rcseTel = rcse ? rcse.Telephone : ''; out.rcseSig = sigDe_(rcse);
      out.departementResp = nomComplet_(dep); out.departementTel = dep ? dep.Telephone : ''; out.departementSig = sigDe_(dep);
    }
  } else if (niveau === 'PF') {
    const pf = users.find(u => u.ID === compteId);
    out.pf = nomComplet_(pf); out.pfTel = pf ? pf.Telephone : ''; out.pfSig = sigDe_(pf);
    if (pf) {
      out.departement = pf.DepartementNom || ''; out.zoneSanitaire = zoneSanitaireDe_(pf); out.commune = pf.CommuneNom || '';
      const chain = chainAbove_(pf);
      const rcse = chain.find(u => u.Role === ROLES.RCSE);
      const dep = chain.find(u => u.Role === ROLES.DEPARTEMENT);
      out.rcse = nomComplet_(rcse); out.rcseTel = rcse ? rcse.Telephone : ''; out.rcseSig = sigDe_(rcse);
      out.departementResp = nomComplet_(dep); out.departementTel = dep ? dep.Telephone : ''; out.departementSig = sigDe_(dep);
    }
  } else if (niveau === 'RCSE') {
    const rcse = users.find(u => u.ID === compteId);
    out.rcse = nomComplet_(rcse); out.rcseTel = rcse ? rcse.Telephone : ''; out.rcseSig = sigDe_(rcse);
    if (rcse) {
      out.departement = rcse.DepartementNom || ''; out.zoneSanitaire = zoneSanitaireDe_(rcse);
      const dep = chainAbove_(rcse).find(u => u.Role === ROLES.DEPARTEMENT);
      out.departementResp = nomComplet_(dep); out.departementTel = dep ? dep.Telephone : ''; out.departementSig = sigDe_(dep);
    }
  } else if (niveau === 'DEPARTEMENT') {
    const dep = users.find(u => u.ID === compteId);
    out.departementResp = nomComplet_(dep); out.departementTel = dep ? dep.Telephone : ''; out.departementSig = sigDe_(dep);
    if (dep) out.departement = dep.DepartementNom || '';
  }
  return out;
}

// ============================================================
// TABLEAU DE BORD
// ============================================================

function getDashboard_(actor) {
  const alertes = listScoped_(SHEETS.ALERTES, actor);
  const deces = listScoped_(SHEETS.DECES, actor);
  const notifications = listNotifications_(actor);
  return {
    totalAlertes: alertes.length,
    alertesNonInvestiguees: alertes.filter(a => a.Statut !== 'Investigué').length,
    totalDeces: deces.length,
    decesAConfirmer: deces.filter(d => d.Statut === 'Nouveau').length,
    decesConfirmes: deces.filter(d => d.Statut === 'Confirmé').length,
    notificationsNonLues: notifications.filter(n => n.Lu === false || n.Lu === 'FALSE').length
  };
}

// Détail géographique des 4 pastilles du tableau de bord (Alertes / Décès / Non investiguées),
// dans le périmètre de l'utilisateur connecté : pour chaque village, arrondissement et commune
// où il y a EU AU MOINS UN CAS (alerte ou décès), le nombre d'alertes, de décès et d'alertes non
// investiguées. Sert à afficher, sous les pastilles, "quels villages/arrondissements/communes
// ont des cas" plutôt que de simples totaux globaux.
function getDashboardDetail_(actor) {
  const alertes = listScoped_(SHEETS.ALERTES, actor);
  const deces = listScoped_(SHEETS.DECES, actor);
  const villages = readSheet_(SHEETS.VILLAGES);
  const arrondissements = readSheet_(SHEETS.ARRONDISSEMENTS);

  function resolveGeo_(villageId, arrondissementIdFallback) {
    const v = villages.find(x => x.ID === villageId);
    const arrId = v ? v.ArrondissementId : arrondissementIdFallback;
    const arr = arrondissements.find(x => x.ID === arrId);
    return {
      village: v ? v.Nom : '',
      arrondissement: v ? v.ArrondissementNom : (arr ? arr.Nom : ''),
      commune: arr ? arr.CommuneNom : ''
    };
  }

  function agrege_(niveauCle) {
    const parCle = {};
    function ajoute_(geo, champ) {
      const cle = geo[niveauCle];
      if (!cle) return;
      if (!parCle[cle]) {
        parCle[cle] = { nom: cle, village: geo.village, arrondissement: geo.arrondissement, commune: geo.commune,
          nbAlertes: 0, nbNonInvestiguees: 0, nbDeces: 0 };
      }
      parCle[cle][champ]++;
    }
    alertes.forEach(a => {
      const geo = resolveGeo_(a.VillageId, a.ArrondissementId);
      ajoute_(geo, 'nbAlertes');
      if (a.Statut !== 'Investigué') ajoute_(geo, 'nbNonInvestiguees');
    });
    deces.forEach(d => {
      const geo = resolveGeo_(d.VillageId, d.ArrondissementId);
      ajoute_(geo, 'nbDeces');
    });
    return Object.values(parCle).sort((x, y) => (y.nbAlertes + y.nbDeces) - (x.nbAlertes + x.nbDeces));
  }

  return {
    parVillage: agrege_('village'),
    parArrondissement: agrege_('arrondissement'),
    parCommune: agrege_('commune')
  };
}

// Liste, pour l'utilisateur connecté, le SITE de chacun de ses subordonnés (directs et
// indirects) : un ASCQ voit le village de chacun de ses RC ; un PF voit l'arrondissement de
// chacun de ses ASCQ ET le village de chacun des RC de cet ASCQ ; un RCSE voit tout, jusqu'au
// village de chaque RC, pour toute sa zone (commune -> PF -> arrondissement -> ASCQ -> village
// -> RC). Une ligne par RC (le niveau le plus fin) ; les ASCQ/PF sans aucun RC apparaissent
// quand même, avec les colonnes RC/village vides, pour rester visibles.
function listCouverture_(actor) {
  const users = readSheet_(SHEETS.USERS);
  const nomComplet_ = u => u ? (u.Prenom + ' ' + u.Nom) : '';
  // Champs "éditables" d'un compte (ID/Nom/Prenom/Telephone), sous un préfixe donné — sert au
  // frontend (couverture.js) pour ouvrir la fiche de modification d'un subordonné INDIRECT
  // (ex. un RCSE qui corrige un ASCQ ou un RC), sans dupliquer une table dédiée pour chaque
  // niveau intermédiaire.
  function editable_(prefixe, u) {
    if (!u) return {};
    const o = {};
    o[prefixe + 'Id'] = u.ID; o[prefixe + 'NomChamp'] = u.Nom; o[prefixe + 'PrenomChamp'] = u.Prenom; o[prefixe + 'Telephone'] = u.Telephone;
    o[prefixe + 'Role'] = u.Role;
    o[prefixe + 'DepartementId'] = u.DepartementId; o[prefixe + 'DepartementNom'] = u.DepartementNom;
    o[prefixe + 'CommuneId'] = u.CommuneId; o[prefixe + 'CommuneNom'] = u.CommuneNom;
    o[prefixe + 'ArrondissementId'] = u.ArrondissementId; o[prefixe + 'ArrondissementNom'] = u.ArrondissementNom;
    o[prefixe + 'VillageId'] = u.VillageId; o[prefixe + 'VillageNom'] = u.VillageNom;
    return o;
  }

  if (actor.Role === ROLES.ASCQ) {
    const rcs = users.filter(u => u.Role === ROLES.RC && u.ResponsableId === actor.ID);
    return rcs.map(rc => Object.assign({
      rc: nomComplet_(rc), telephoneRc: rc.Telephone, arrondissement: rc.ArrondissementNom || '', village: rc.VillageNom || ''
    }, editable_('rc', rc))).sort((a, b) => a.village.localeCompare(b.village));
  }

  if (actor.Role === ROLES.PF) {
    const ascqs = users.filter(u => u.Role === ROLES.ASCQ && u.ResponsableId === actor.ID);
    const rows = [];
    ascqs.forEach(ascq => {
      const rcs = users.filter(u => u.Role === ROLES.RC && u.ResponsableId === ascq.ID);
      const base = { ascq: nomComplet_(ascq), arrondissement: ascq.ArrondissementNom || '' };
      if (!rcs.length) {
        rows.push(Object.assign({ rc: '', village: '' }, base));
      } else {
        rcs.forEach(rc => rows.push(Object.assign({ rc: nomComplet_(rc), village: rc.VillageNom || '' }, base, editable_('rc', rc))));
      }
    });
    return rows.sort((a, b) => a.arrondissement.localeCompare(b.arrondissement) || a.village.localeCompare(b.village));
  }

  if (actor.Role === ROLES.RCSE) {
    const pfs = users.filter(u => u.Role === ROLES.PF && u.ResponsableId === actor.ID);
    const rows = [];
    pfs.forEach(pf => {
      const ascqs = users.filter(u => u.Role === ROLES.ASCQ && u.ResponsableId === pf.ID);
      if (!ascqs.length) { rows.push({ commune: pf.CommuneNom || '', pf: nomComplet_(pf), ascq: '', arrondissement: '', rc: '', village: '' }); return; }
      ascqs.forEach(ascq => {
        const rcs = users.filter(u => u.Role === ROLES.RC && u.ResponsableId === ascq.ID);
        const base = { commune: pf.CommuneNom || '', pf: nomComplet_(pf), ascq: nomComplet_(ascq), arrondissement: ascq.ArrondissementNom || '' };
        if (!rcs.length) {
          rows.push(Object.assign({ rc: '', village: '' }, base, editable_('ascq', ascq)));
        } else {
          rcs.forEach(rc => rows.push(Object.assign({ rc: nomComplet_(rc), village: rc.VillageNom || '' }, base, editable_('ascq', ascq), editable_('rc', rc))));
        }
      });
    });
    return rows.sort((a, b) => a.commune.localeCompare(b.commune) || a.arrondissement.localeCompare(b.arrondissement) || a.village.localeCompare(b.village));
  }

  if (actor.Role === ROLES.DEPARTEMENT) {
    const rcses = users.filter(u => u.Role === ROLES.RCSE && u.DepartementId === actor.DepartementId);
    const rows = [];
    rcses.forEach(rcse => {
      const zoneNom = zoneSanitaireNomDeRcse_(rcse);
      const pfs = users.filter(u => u.Role === ROLES.PF && u.ResponsableId === rcse.ID);
      if (!pfs.length) { rows.push({ zone: zoneNom, commune: '', pf: '', ascq: '', arrondissement: '', rc: '', village: '' }); return; }
      pfs.forEach(pf => {
        const ascqs = users.filter(u => u.Role === ROLES.ASCQ && u.ResponsableId === pf.ID);
        if (!ascqs.length) { rows.push(Object.assign({ zone: zoneNom, commune: pf.CommuneNom || '', pf: nomComplet_(pf), ascq: '', arrondissement: '', rc: '', village: '' }, editable_('pf', pf))); return; }
        ascqs.forEach(ascq => {
          const rcs = users.filter(u => u.Role === ROLES.RC && u.ResponsableId === ascq.ID);
          const base = { zone: zoneNom, commune: pf.CommuneNom || '', pf: nomComplet_(pf), ascq: nomComplet_(ascq), arrondissement: ascq.ArrondissementNom || '' };
          if (!rcs.length) {
            rows.push(Object.assign({ rc: '', village: '' }, base, editable_('pf', pf), editable_('ascq', ascq)));
          } else {
            rcs.forEach(rc => rows.push(Object.assign({ rc: nomComplet_(rc), village: rc.VillageNom || '' }, base, editable_('pf', pf), editable_('ascq', ascq), editable_('rc', rc))));
          }
        });
      });
    });
    return rows.sort((a, b) => a.zone.localeCompare(b.zone) || a.commune.localeCompare(b.commune) || a.village.localeCompare(b.village));
  }

  return [];
}

// ============================================================
// DECLENCHEUR HEBDOMADAIRE (à activer manuellement — voir README)
// ============================================================

function triggerHebdomadaire_() {
  const info = semaineCouranteInfo_();
  if (info) { supprimerRapportsPourSemaine_(info.Annee, info.SemaineEpi); genererRapportsPourSemaine_(info.Annee, info.SemaineEpi); }
}

// ============================================================
// MIGRATION MANUELLE — à exécuter UNE SEULE FOIS depuis l'éditeur Apps Script
// (menu déroulant des fonctions en haut → sélectionner "migrerUtilisateurs_" → ▶ Exécuter)
// pour convertir une feuille Utilisateurs créée avec une ancienne version du script
// (colonnes Departement/Commune/Arrondissement/Village en texte + MotDePasseHash) vers la
// structure actuelle (DepartementNom/... + MotDePasse en clair), SANS perdre les comptes déjà créés.
//
// Comme les anciens mots de passe étaient hachés (donc impossibles à récupérer), chaque compte
// migré reçoit temporairement son NUMÉRO DE TÉLÉPHONE comme mot de passe. Communiquez ce mot de
// passe temporaire à chaque titulaire de compte (ou modifiez-le vous-même directement dans la
// colonne MotDePasse du Sheet après migration), et invitez-les à le changer dès leur connexion.
// ============================================================
function migrerUtilisateurs_() {
  const sh = ss_().getSheetByName(SHEETS.USERS);
  if (!sh) { Logger.log('Feuille Utilisateurs introuvable.'); return { migrated: 0, message: 'Feuille Utilisateurs introuvable.' }; }
  const values = sh.getDataRange().getValues();
  if (values.length < 1) { Logger.log('Feuille vide, rien à migrer.'); return { migrated: 0, message: 'Feuille vide, rien à migrer.' }; }
  const oldHeaders = values[0];
  const oldRows = values.slice(1).filter(r => r.join('') !== '');

  function get(row, h) {
    const i = oldHeaders.indexOf(h);
    return i >= 0 ? row[i] : '';
  }

  const newRows = oldRows.map(r => {
    const departementNom = get(r, 'DepartementNom') || get(r, 'Departement') || '';
    const communeNom = get(r, 'CommuneNom') || get(r, 'Commune') || '';
    const arrondissementNom = get(r, 'ArrondissementNom') || get(r, 'Arrondissement') || '';
    const villageNom = get(r, 'VillageNom') || get(r, 'Village') || '';
    const ids = geoIds_(departementNom || '_', communeNom || '_', arrondissementNom || '_', villageNom || '_');
    const telephone = get(r, 'Telephone');
    const motDePasseExistant = get(r, 'MotDePasse'); // déjà en clair si une migration a déjà tourné
    return [
      get(r, 'ID'), get(r, 'Nom'), get(r, 'Prenom'), telephone,
      motDePasseExistant || String(telephone), // mot de passe temporaire = numéro de téléphone
      get(r, 'Role'), get(r, 'ResponsableId'),
      departementNom ? ids.depId : (get(r, 'DepartementId') || ''),
      communeNom ? ids.comId : (get(r, 'CommuneId') || ''),
      arrondissementNom ? ids.arrId : (get(r, 'ArrondissementId') || ''),
      villageNom ? ids.vilId : (get(r, 'VillageId') || ''),
      get(r, 'GrappeId') || '',
      departementNom, communeNom, arrondissementNom, villageNom, get(r, 'GrappeNom') || '',
      get(r, 'ZoneSanitaireNom') || '',
      get(r, 'Actif') === '' ? true : get(r, 'Actif'),
      get(r, 'DateCreation'), get(r, 'CreePar')
    ];
  });

  sh.clear();
  sh.appendRow(COLS.Utilisateurs);
  sh.setFrozenRows(1);
  if (newRows.length) sh.getRange(2, 1, newRows.length, COLS.Utilisateurs.length).setValues(newRows);
  const message = 'Migration terminée : ' + newRows.length + ' compte(s) migré(s). Mot de passe temporaire = numéro de téléphone pour les comptes qui n\'avaient pas encore de mot de passe en clair.';
  Logger.log(message);
  return { migrated: newRows.length, message: message };
}

// ============================================================
// MIGRATION MANUELLE — INTRODUCTION DU RÔLE NATIONAL (à exécuter UNE SEULE FOIS, après
// migrerUtilisateurs_ si nécessaire, depuis l'éditeur Apps Script ou le menu ⚙️ Surveillance -
// Outils ci-dessous) pour les classeurs créés AVANT l'introduction du niveau NATIONAL, où le
// compte RCSE unique (U-RCSE-0001) faisait office de racine nationale.
//
// Cette migration :
//  1) Convertit ce compte RCSE racine en compte NATIONAL (même téléphone/mot de passe, pour ne
//     pas perdre l'accès), et crée un premier compte RCSE "de transition" par département déjà
//     utilisé par au moins un PF existant, avec pour mot de passe temporaire son numéro de
//     téléphone national + un suffixe (à communiquer/changer manuellement). Sa "zone sanitaire"
//     de transition regroupe TOUTES les communes du département (pas seulement celles déjà
//     utilisées par un PF), pour ne rien restreindre par rapport à avant — à ajuster ensuite
//     depuis l'écran national si vos zones sanitaires réelles ne suivent pas les départements.
//  2) Réattache chaque PF existant (ResponsableId) à ce nouveau RCSE de son département.
// Vérifiez toujours le résultat dans le Sheet après exécution avant d'informer les utilisateurs.
// ============================================================
function migrerVersNational_() {
  ensureSchema_();
  const users = readSheet_(SHEETS.USERS);
  const ancienneRacine = users.find(u => u.ID === 'U-RCSE-0001' && u.Role === 'RCSE');
  if (!ancienneRacine) {
    return { ok: false, message: 'Aucun ancien compte racine "U-RCSE-0001" trouvé — migration probablement déjà effectuée, ou classeur déjà créé avec la structure NATIONAL.' };
  }

  updateRowById_(SHEETS.USERS, ancienneRacine.ID, { Role: ROLES.NATIONAL, DepartementId: '', DepartementNom: '' });

  const pfs = users.filter(u => u.Role === ROLES.PF && u.ResponsableId === ancienneRacine.ID);
  const toutesCommunes = readSheet_(SHEETS.COMMUNES);
  const parDepartement = {};
  pfs.forEach(pf => {
    const depNom = pf.DepartementNom || 'Departement-inconnu';
    if (!parDepartement[depNom]) parDepartement[depNom] = { depId: pf.DepartementId || ('DEP-' + slug_(depNom)), pfs: [] };
    parDepartement[depNom].pfs.push(pf);
  });

  let rcseCrees = 0, pfReattaches = 0;
  Object.keys(parDepartement).forEach((depNom, idx) => {
    const info = parDepartement[depNom];
    const rcse = {
      ID: newId_('U') + '-MIG' + idx, Nom: 'RCSE', Prenom: depNom, Telephone: ancienneRacine.Telephone + '-' + (idx + 1),
      MotDePasse: 'rcse' + (idx + 1) + '2026', Role: ROLES.RCSE, ResponsableId: ancienneRacine.ID,
      DepartementId: '', CommuneId: '', ArrondissementId: '', VillageId: '', GrappeId: '',
      DepartementNom: '', CommuneNom: '', ArrondissementNom: '', VillageNom: '', GrappeNom: '',
      ZoneSanitaireNom: depNom + ' (transition)',
      Actif: true, DateCreation: nowStr_(), CreePar: ancienneRacine.ID
    };
    appendRow_(SHEETS.USERS, rcse);
    const communesDuDep = toutesCommunes.filter(c => c.DepartementId === info.depId);
    communesDuDep.forEach(c => appendRow_(SHEETS.PERIMETRES, { ID: newId_('PER'), UserId: rcse.ID, TypeCible: 'Commune', CibleId: c.ID, AssignePar: ancienneRacine.ID, Date: nowStr_() }));
    rcseCrees++;
    info.pfs.forEach(pf => { updateRowById_(SHEETS.USERS, pf.ID, { ResponsableId: rcse.ID }); pfReattaches++; });
  });

  const message = `Migration NATIONAL terminée : ${rcseCrees} compte(s) RCSE de transition créé(s) (téléphones : ${ancienneRacine.Telephone}-1, -2, ...), ${pfReattaches} PF réattaché(s). Mots de passe temporaires : rcse12026, rcse22026, ... à communiquer puis à changer. Le compte ${ancienneRacine.Telephone} est maintenant le compte NATIONAL.`;
  Logger.log(message);
  return { ok: true, rcseCrees, pfReattaches, message };
}

// ============================================================
// MENU PERSONNALISÉ DANS LE GOOGLE SHEET
// ============================================================
// Contournement fiable au cas où le menu déroulant "Sélectionner une fonction" de l'éditeur
// Apps Script n'affiche pas (ou plus) toutes les fonctions du script — un bug d'affichage de
// l'éditeur qui arrive de temps en temps, sans rapport avec le code lui-même. Ce menu, lui,
// s'affiche directement dans le Google Sheet (onglet du haut) et exécute les fonctions
// correspondantes sans jamais passer par ce menu déroulant.
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('⚙️ Surveillance - Outils')
    .addItem('Tester l\'exécution (diagnostic)', 'runTestDiagnostic_')
    .addSeparator()
    .addItem('Réparer les colonnes décalées (Sensibilisations)', 'runReparerSensibilisations_')
    .addItem('Diagnostiquer l\'ordre des colonnes de toutes les feuilles', 'runDiagnosticColonnes_')
    .addItem('Exécuter la migration des utilisateurs', 'runMigrerUtilisateurs_')
    .addItem('Exécuter la migration vers le rôle NATIONAL', 'runMigrerVersNational_')
    .addToUi();
}

function runTestDiagnostic_() {
  SpreadsheetApp.getUi().alert(
    '✅ Ce menu fonctionne : les fonctions du script s\'exécutent normalement.\n\n' +
    'Le souci ne concerne donc que l\'affichage du menu déroulant "Sélectionner une fonction" ' +
    'de l\'éditeur Apps Script (un bug d\'interface), pas votre code. Vous pouvez utiliser ce ' +
    'menu ⚙️ Surveillance - Outils pour exécuter les fonctions à la place.'
  );
}

function runReparerSensibilisations_() {
  const ui = SpreadsheetApp.getUi();
  try { const n = reparerSensibilisations_(); PropertiesService.getScriptProperties().setProperty('SENS_ALIGNE_V1', nowStr_()); ui.alert(n + ' ligne(s) de la feuille Sensibilisations remise(s) en place.'); }
  catch (err) { ui.alert('Erreur : ' + (err && err.message ? err.message : err)); }
}

// Liste les feuilles dont l'ordre réel des colonnes diffère de celui du code (risque de valeurs décalées dans d'anciennes lignes).
function runDiagnosticColonnes_() {
  const ui = SpreadsheetApp.getUi(), ss = ss_(), lignes = [];
  Object.keys(COLS).forEach(nom => {
    const sh = ss.getSheetByName(nom); if (!sh || sh.getLastRow() < 1 || sh.getLastColumn() < 1) return;
    const h = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(String);
    const diff = COLS[nom].some((c, i) => h[i] !== c);
    if (diff && sh.getLastRow() > 1) lignes.push('• ' + nom + ' (' + (sh.getLastRow() - 1) + ' ligne(s))');
  });
  ui.alert(lignes.length ? 'Feuilles dont l\'ordre des colonnes diffère du code :\n\n' + lignes.join('\n') + '\n\nLes nouvelles lignes sont désormais écrites selon les en-têtes réels (aucun nouveau décalage). Les anciennes lignes de ces feuilles peuvent contenir des valeurs décalées : signalez-le pour qu\'elles soient vérifiées.' : 'Toutes les feuilles ont le même ordre de colonnes que le code : aucun décalage possible.');
}

function runMigrerUtilisateurs_() {
  const ui = SpreadsheetApp.getUi();
  const confirm = ui.alert(
    'Migrer les utilisateurs',
    'Cette opération convertit la feuille Utilisateurs vers la structure la plus récente, sans supprimer aucun compte. Continuer ?',
    ui.ButtonSet.YES_NO
  );
  if (confirm !== ui.Button.YES) return;
  try {
    const res = migrerUtilisateurs_();
    ui.alert(res && res.message ? res.message : 'Migration terminée.');
  } catch (err) {
    ui.alert('Erreur pendant la migration : ' + (err && err.message ? err.message : err));
  }
}

function runMigrerVersNational_() {
  const ui = SpreadsheetApp.getUi();
  const confirm = ui.alert(
    'Migrer vers le rôle NATIONAL',
    'Cette opération transforme votre compte RCSE racine (U-RCSE-0001) en compte NATIONAL et crée un compte RCSE de transition par département déjà utilisé. À exécuter UNE SEULE FOIS. Continuer ?',
    ui.ButtonSet.YES_NO
  );
  if (confirm !== ui.Button.YES) return;
  try {
    const res = migrerVersNational_();
    ui.alert(res && res.message ? res.message : 'Migration terminée.');
  } catch (err) {
    ui.alert('Erreur pendant la migration : ' + (err && err.message ? err.message : err));
  }
}


// ============================================================
// FICHE GÉNÉRIQUE DE NOTIFICATION DES MALADIES SOUS SURVEILLANCE (niveaux RCSE et ASCQ)
// ============================================================
// Le RCSE et l'ASCQ remplissent la fiche officielle « 1_BJ_FORMULAIRE GENERIQUE DE NOTIFICATION DES MALADIES
// SOUS SURVEILLANCE » de façon indépendante (hors alertes/décès communautaires).
//  - L'ASCQ ne notifie que pour son/ses arrondissement(s) ; il ne voit et ne gère que ses propres fiches.
//  - Le RCSE voit ses propres fiches ET celles de tous les ASCQ placés sous lui, qu'il peut aussi modifier et supprimer ;
//    la synthèse par arrondissement affichée sur sa page agrège l'ensemble.
//  - Chaque fiche porte l'arrondissement de résidence du cas (ArrondissementId), contrôlé côté serveur.

function ficheNotifTexte_(v, n) { return coupe_(v, n || 200); }
function ficheNotifRoleOk_(actor) { return actor.Role === ROLES.RCSE || actor.Role === ROLES.ASCQ; }

// Zone sanitaire d'un compte : celle du RCSE lui-même, ou celle du RCSE dont dépend l'ASCQ.
function ficheNotifZoneDe_(actor) {
  if (actor.ZoneSanitaireNom) return actor.ZoneSanitaireNom;
  const rcse = chainAbove_(actor).find(u => u.Role === ROLES.RCSE);
  return rcse ? (rcse.ZoneSanitaireNom || '') : '';
}

// Nettoie la fiche reçue : seules les clés attendues sont conservées, chaque valeur est bornée en taille
// (texte, nombre ou liste de textes) avant d'être stockée en JSON dans la colonne Donnees.
function ficheNotifNettoyer_(brut) {
  const out = {};
  const src = (brut && typeof brut === 'object') ? brut : {};
  Object.keys(src).slice(0, 220).forEach(k => {
    if (!/^[A-Za-z0-9_]{1,40}$/.test(k)) return;
    const v = src[k];
    if (Array.isArray(v)) out[k] = v.slice(0, 40).map(x => ficheNotifTexte_(x, 80));
    else if (typeof v === 'boolean') out[k] = v;
    else out[k] = ficheNotifTexte_(v, 300);
  });
  return out;
}

// Une fiche est gérable (modifier / supprimer) par son auteur, et par le RCSE pour les fiches saisies par les ASCQ placés sous lui.
function ficheNotifGerable_(actor, f) {
  if (!f) return false;
  if (String(f.CreeParId) === String(actor.ID)) return true;
  if (actor.Role !== ROLES.RCSE) return false;
  return descendantsComptes_(actor).some(u => u.Role === ROLES.ASCQ && String(u.ID) === String(f.CreeParId));
}

function saveFicheNotif_(actor, p) { return enregistrerFicheNotif_(actor, p, null); }

// Enregistre (ou met à jour) une fiche de notification de n'importe quel type : maladie (1_BJ), décès maternel (3_BJ), décès néonatal (4_BJ),
// autres décès (02_BJ). TOUTES les rubriques sont obligatoires (sauf conditionnelles / facultatives) : contrôle identique à celui de
// l'application (FicheSchemas). `lien` = { refType, refId } quand la fiche accompagne la validation d'une alerte ou la confirmation d'un décès.
function enregistrerFicheNotif_(actor, p, lien) {
  if (!ficheNotifRoleOk_(actor)) return { ok: false, error: 'Seuls les comptes RCSE et ASCQ peuvent remplir la fiche de notification.' };
  const brutType = String(p.type || (p.donnees && p.donnees.typeFiche) || 'maladie');
  const type = FicheSchemas.types.indexOf(brutType) !== -1 ? brutType : 'maladie';
  const S = FicheSchemas.get(type);
  const d = ficheNotifNettoyer_(p.donnees);
  d.typeFiche = type;

  // Arrondissement de résidence : obligatoire et obligatoirement dans le périmètre du compte (ASCQ : ses
  // arrondissements ; RCSE : ceux de sa zone sanitaire). Commune et département en sont déduits.
  const arrId = String(d.arrondissementId || '');
  if (!arrId) return { ok: false, error: 'Choisissez l\'arrondissement de résidence du cas.' };
  if (arrondissementsDuPerimetre_(actor).map(String).indexOf(arrId) === -1) return { ok: false, error: 'Cet arrondissement n\'est pas dans votre périmètre.' };
  const arr = readSheet_(SHEETS.ARRONDISSEMENTS).find(a => String(a.ID) === arrId);
  if (!arr) return { ok: false, error: 'Arrondissement introuvable.' };
  const com = readSheet_(SHEETS.COMMUNES).find(c => String(c.ID) === String(arr.CommuneId));
  d.arrondissement = ficheNotifTexte_(arr.Nom, 120);
  d.comResidence = ficheNotifTexte_(arr.CommuneNom || (com ? com.Nom : ''), 120);
  if (com && com.DepartementNom) d.depResidence = ficheNotifTexte_(com.DepartementNom, 120);
  if (!d.zoneSanitaire) d.zoneSanitaire = ficheNotifTexte_(ficheNotifZoneDe_(actor), 120);

  // Rubriques conditionnelles qui ne s'appliquent pas : écartées ; puis contrôle des rubriques obligatoires.
  FicheSchemas.champs(S).forEach(c => { if (c.siTous && c.siTous.length && !FicheSchemas.cond(c.siTous, d)) delete d[c.k]; });
  const manq = FicheSchemas.manquants(type, d);
  if (manq.length) return { ok: false, error: 'Rubriques obligatoires manquantes (' + manq.length + ') : ' + manq.slice(0, 6).join(', ') + (manq.length > 6 ? '…' : '') + '. Écrivez NA si sans objet.' };

  let nom, maladie, sexe, age, village, evolution, classification;
  if (type === 'maladie') {
    nom = ficheNotifTexte_(d.nomPatient, 120);
    maladie = d.maladie === 'Autre' ? ficheNotifTexte_(d.maladieAutre, 120) : ficheNotifTexte_(d.maladie, 80);
    sexe = ficheNotifTexte_(d.sexe, 2);
    age = [d.ageAns ? d.ageAns + ' an(s)' : '', d.ageMois ? d.ageMois + ' mois' : '', d.ageJours ? d.ageJours + ' j' : ''].filter(Boolean).join(' ');
    village = d.village; evolution = d.evolution; classification = d.classification;
  } else {
    const R = S.resume;
    nom = ficheNotifTexte_(R.nom.map(k => d[k]).filter(Boolean)[0] || '', 120);
    maladie = S.court;
    sexe = R.sexeFixe || (R.sexe ? (R.sexe.map[d[R.sexe.k]] || '') : '');
    age = (R.age && d[R.age.k] !== undefined && String(d[R.age.k]) !== '') ? d[R.age.k] + R.age.suffixe : '';
    village = d[R.village]; evolution = 'Décédé'; classification = '';
  }
  if (nom.length < 2) return { ok: false, error: 'Indiquez le nom de la personne concernée.' };

  const resume = {
    ZoneSanitaire: ficheNotifTexte_(d.zoneSanitaire, 120), Annee: ficheNotifTexte_(d.annee, 6), SemaineEpi: ficheNotifTexte_(d.semaine, 6),
    Maladie: maladie, NomPatient: nom, Sexe: ficheNotifTexte_(sexe, 2), Age: age,
    Village: ficheNotifTexte_(village, 120), Evolution: ficheNotifTexte_(evolution, 20), Classification: ficheNotifTexte_(classification, 60),
    CommuneId: String(arr.CommuneId || ''), CommuneNom: d.comResidence, ArrondissementId: arrId, ArrondissementNom: d.arrondissement, TypeFiche: type
  };
  if (lien) { resume.RefType = lien.refType; resume.RefId = lien.refId; }
  const json = JSON.stringify(d);
  if (json.length > 40000) return { ok: false, error: 'La fiche est trop volumineuse.' };

  let existante = null;
  if (p.id) {
    existante = readSheet_(SHEETS.FICHES_NOTIF).find(x => x.ID === p.id);
    if (!ficheNotifGerable_(actor, existante)) return { ok: false, error: 'Fiche introuvable ou non modifiable par ce compte.' };
  } else if (lien) {
    existante = readSheet_(SHEETS.FICHES_NOTIF).find(x => x.RefType === lien.refType && x.RefId === lien.refId) || null;   // une seule fiche par alerte / décès
  }
  if (existante) {
    updateRowById_(SHEETS.FICHES_NOTIF, existante.ID, Object.assign({}, resume, { Donnees: json, DateModification: nowStr_() }));
    return { ok: true, id: existante.ID };
  }
  const clientId = String(p.clientId || '').slice(0, 60);
  if (clientId) {
    const deja = readSheet_(SHEETS.FICHES_NOTIF).find(r => r.ClientId === clientId && r.CreeParId === actor.ID);
    if (deja) return { ok: true, id: deja.ID, doublon: true };
  }
  const rec = Object.assign({ ID: newId_('FNOT'), CreeParId: actor.ID, CreeParNom: actor.Prenom + ' ' + actor.Nom, CreeParRole: actor.Role, Donnees: json,
    DateSaisie: nowStr_(), DateModification: '', ClientId: clientId }, resume);
  appendRow_(SHEETS.FICHES_NOTIF, rec);
  return { ok: true, id: rec.ID };
}

// ASCQ : ses propres fiches. RCSE : ses propres fiches + celles de tous les ASCQ placés sous lui.
// Les anciennes fiches (sans arrondissement enregistré) sont rattachées par le nom saisi dans la fiche.
function listFichesNotif_(actor) {
  if (!ficheNotifRoleOk_(actor)) return { ok: false, error: 'Réservé aux comptes RCSE et ASCQ.' };
  const ids = new Set([String(actor.ID)]);
  if (actor.Role === ROLES.RCSE) descendantsComptes_(actor).filter(u => u.Role === ROLES.ASCQ).forEach(u => ids.add(String(u.ID)));
  const fiches = readSheet_(SHEETS.FICHES_NOTIF).filter(f => ids.has(String(f.CreeParId)))
    .map(f => {
      const o = Object.assign({}, f);
      if (!o.CreeParRole) o.CreeParRole = ROLES.RCSE;
      if (!o.TypeFiche) o.TypeFiche = 'maladie';
      if (!o.ArrondissementNom) { try { o.ArrondissementNom = String((JSON.parse(f.Donnees || '{}') || {}).arrondissement || ''); } catch (e) { o.ArrondissementNom = ''; } }
      return o;
    })
    .sort((a, b) => String(b.DateSaisie).localeCompare(String(a.DateSaisie)));
  // Signature enregistrée dans « Mon compte » de chaque notificateur (une seule fois par compte) : elle est imprimée sur la fiche PDF.
  const signatures = {};
  const auteurs = new Set(fiches.map(f => String(f.CreeParId)));
  readSheet_(SHEETS.USERS).forEach(u => { if (auteurs.has(String(u.ID))) { const sg = sigDe_(u); if (sg) signatures[String(u.ID)] = sg; } });
  return { ok: true, fiches: fiches, signatures: signatures };
}

function deleteFicheNotif_(actor, p) {
  if (!ficheNotifRoleOk_(actor)) return { ok: false, error: 'Réservé aux comptes RCSE et ASCQ.' };
  const f = readSheet_(SHEETS.FICHES_NOTIF).find(x => x.ID === p.id);
  if (!ficheNotifGerable_(actor, f)) return { ok: false, error: 'Fiche introuvable ou non supprimable par ce compte.' };
  deleteRowById_(SHEETS.FICHES_NOTIF, f.ID);
  return { ok: true };
}

// ============================================================
// COLLECTE DE DONNÉES AVEC QUESTIONNAIRE SIMPLE (activité de type « Collecte de données »)
// ============================================================
// Le demandeur rédige un questionnaire simple dans la plateforme (questions ouvertes, fermées, à choix multiples, oui/non,
// nombre, date). Chaque destinataire peut le remplir autant de fois que nécessaire, y compris HORS CONNEXION (envoi différé).
// Le demandeur consulte toutes les réponses de sa hiérarchie et peut en supprimer ; un destinataire peut retirer les siennes.

function submitCollecte_(actor, p) {
  const a = readSheet_(SHEETS.ACTIVITES).find(x => x.ID === p.activiteId);
  if (!a || a.Statut !== 'Active' || !parseArr_(a.CibleRoles).includes(actor.Role) || !chainAbove_(actor).some(sup => sup.ID === a.CreeParId) || !filtreGeoActivite_(a)(actor))
    return { ok: false, error: 'Activité introuvable pour votre compte.' };
  const q = a.Type === TYPE_COLLECTE_ ? questionnaireSimpleDe_(a) : null;
  if (!q) return { ok: false, error: 'Cette activité n\'a pas de questionnaire intégré.' };
  const saisie = dateSaisieClient_(p);
  // Une saisie faite hors connexion avant l'échéance reste valable même si elle est synchronisée après.
  const dateRef = saisie ? saisie.slice(0, 10) : aujourdhuiIso_();
  const dl = dateIso_(a.DateLimite);
  if (dl && dateRef > dl) return { ok: false, error: 'Cette collecte est close (échéance dépassée).' };
  const clientId = String(p.clientId || '');
  if (clientId) { const deja = readSheet_(SHEETS.COLLECTES).find(x => x.ClientId === clientId && x.UserId === actor.ID); if (deja) return { ok: true, doublon: true, id: deja.ID }; }
  let reponses; try { reponses = nettoyerReponses_(q.champs, p.reponses); } catch (e) { return { ok: false, error: e.message }; }
  // Photos : envoyées en data URL (déjà réduites par l'appareil), rangées dans Drive ; seule l'adresse est conservée dans la réponse.
  const idColl = newId_('COL');
  try {
    q.champs.filter(c => c.type === 'photo' && String(reponses[c.id] || '').indexOf('data:image/') === 0)
      .forEach(c => { reponses[c.id] = enregistrerPhotoCollecte_(reponses[c.id], 'collecte_' + a.ID + '_' + idColl + '_' + c.id); });
  } catch (e) { return { ok: false, error: 'Enregistrement de la photo impossible (' + e.message + '). Si le problème persiste, l\'administrateur doit exécuter « autoriserDrive » dans Apps Script.' }; }
  if (JSON.stringify(reponses).length > 48000) return { ok: false, error: 'Réponse trop volumineuse (signature ou textes trop longs).' };
  const rec = {
    ID: idColl, ActiviteId: a.ID, UserId: actor.ID, UserNom: actor.Prenom + ' ' + actor.Nom, Role: actor.Role,
    CommuneId: actor.CommuneId || '', ArrondissementId: actor.ArrondissementId || '', VillageNom: actor.VillageNom || '',
    Lieu: coupe_(p.lieu, 120), Reponses: JSON.stringify(reponses), DateSaisie: saisie || nowStr_(), ClientId: clientId, HorsLigne: saisie ? 'Oui' : ''
  };
  appendRow_(SHEETS.COLLECTES, rec);
  return { ok: true, id: rec.ID };
}

function listCollectes_(actor, p) {
  const a = readSheet_(SHEETS.ACTIVITES).find(x => x.ID === p.activiteId);
  if (!a || a.Type !== TYPE_COLLECTE_) return { ok: false, error: 'Activité introuvable.' };
  const q = questionnaireSimpleDe_(a); if (!q) return { ok: false, error: 'Cette activité n\'a pas de questionnaire intégré.' };
  const demandeur = a.CreeParId === actor.ID || actor.Role === ROLES.NATIONAL;
  if (!demandeur && !(parseArr_(a.CibleRoles).includes(actor.Role) && chainAbove_(actor).some(sup => sup.ID === a.CreeParId) && filtreGeoActivite_(a)(actor))) return { ok: false, error: 'Activité introuvable pour votre compte.' };
  let rows = readSheet_(SHEETS.COLLECTES).filter(x => x.ActiviteId === a.ID);
  const users = {}; readSheet_(SHEETS.USERS).forEach(u => { users[u.ID] = u; });
  if (demandeur) {
    const ref = actor.Role === ROLES.NATIONAL && a.CreeParId !== actor.ID ? { ID: a.CreeParId, Role: a.CreeParRole } : actor;
    rows = rows.filter(x => users[x.UserId] && isSupervisorOf_(ref, users[x.UserId]));
  } else rows = rows.filter(x => x.UserId === actor.ID);
  const out = rows.map(x => {
    let rep = {}; try { rep = JSON.parse(x.Reponses || '{}'); } catch (e) { rep = {}; }
    const u = users[x.UserId] || {};
    return { ID: x.ID, UserId: x.UserId, UserNom: x.UserNom, Role: x.Role, Lieu: x.Lieu || u.VillageNom || u.ArrondissementNom || u.CommuneNom || '', DateSaisie: x.DateSaisie, HorsLigne: x.HorsLigne || '', Reponses: rep };
  }).sort((x, y) => String(y.DateSaisie).localeCompare(String(x.DateSaisie)));
  const res = { ok: true, reponses: out, activite: { id: a.ID, titre: a.Titre, questionnaire: q }, enTantQueDemandeur: demandeur };
  if (demandeur) {
    // Analyses descriptives, indicateurs et paramètres enregistrés par le demandeur (évalués sur les lignes ci-dessus).
    res.analyses = readSheet_(SHEETS.COLLECTE_ANALYSES).filter(x => x.ActiviteId === a.ID).sort((x, y) => (Number(x.Ordre) || 0) - (Number(y.Ordre) || 0))
      .map(x => { let cfg = {}; try { cfg = JSON.parse(x.Config || '{}'); } catch (e) { cfg = {}; } return { ID: x.ID, Genre: x.Genre, Titre: x.Titre, Config: cfg }; });
    res.peutAnalyser = a.CreeParId === actor.ID || actor.Role === ROLES.NATIONAL;
  }
  return res;
}

function supprimerCollectes_(actor, p) {
  const a = readSheet_(SHEETS.ACTIVITES).find(x => x.ID === p.activiteId);
  if (!a) return { ok: false, error: 'Activité introuvable.' };
  const demandeur = a.CreeParId === actor.ID || actor.Role === ROLES.NATIONAL;
  const ids = (Array.isArray(p.ids) ? p.ids : []).map(String).slice(0, 2000);
  if (!ids.length) return { ok: false, error: 'Sélectionnez au moins une réponse.' };
  const rows = readSheet_(SHEETS.COLLECTES).filter(x => x.ActiviteId === a.ID && ids.indexOf(String(x.ID)) !== -1 && (demandeur || x.UserId === actor.ID));
  if (!rows.length) return { ok: false, error: 'Aucune réponse supprimable parmi la sélection.' };
  deleteRowsWhereIn_(SHEETS.COLLECTES, 'ID', new Set(rows.map(x => String(x.ID))));
  if (demandeur) {
    const parUser = {}; rows.forEach(x => { if (x.UserId !== actor.ID) parUser[x.UserId] = (parUser[x.UserId] || 0) + 1; });
    const users = readSheet_(SHEETS.USERS);
    Object.keys(parUser).forEach(uid => { const u = users.find(z => z.ID === uid); if (u) notifierComptes_([u], 'ACTIVITE', a.ID, `${parUser[uid]} de vos réponses au questionnaire « ${a.Titre} » ont été supprimées par ${a.CreeParNom}.`); });
  }
  return { ok: true, supprimes: rows.length };
}

// ---- Analyses descriptives, indicateurs et paramètres d'une collecte (enregistrés par le demandeur) ----
const GENRES_ANALYSE_ = ['analyse', 'indicateur', 'parametre'];
const OPS_FILTRE_ = ['=', '!=', '>', '<', '>=', '<=', 'contient'];
const AGREGATS_ = ['nb', 'nb_valeurs', 'somme', 'moyenne', 'mediane', 'min', 'max'];
const IDENT_RE_ = /^[A-Za-zÀ-ÿ_][A-Za-zÀ-ÿ0-9_]{0,29}$/;

function nettoyerConfigAnalyse_(genre, cfg, q, a, idCourant) {
  const champs = q.champs || [];
  const champ = (v, meta, defautVide) => {
    v = String(v || ''); if (!v) { if (defautVide) return ''; throw new Error('Choisissez une question.'); }
    if (meta && ['meta:lieu', 'meta:compte', 'meta:niveau'].indexOf(v) !== -1) return v;
    if (!champs.some(c => c.id === v)) throw new Error('Question inconnue dans l\'analyse.');
    return v;
  };
  const filtre = f => {
    if (!f || !f.champ) return null;
    const op = OPS_FILTRE_.indexOf(f.op) !== -1 ? f.op : '=';
    return { champ: champ(f.champ, true), op: op, valeur: coupe_(f.valeur, 80) };
  };
  const dateOk = d => /^\d{4}-\d{2}-\d{2}$/.test(String(d || '')) ? String(d) : '';
  if (genre === 'parametre') {
    const nom = String(cfg.nom || '').trim();
    if (!IDENT_RE_.test(nom)) throw new Error('Le nom du paramètre doit commencer par une lettre et ne contenir que lettres, chiffres ou _ (30 caractères max).');
    if (['ABS', 'RACINE', 'ARRONDI', 'MIN', 'MAX', 'SOMME', 'MOYENNE', 'SI'].indexOf(nom.toUpperCase()) !== -1) throw new Error('« ' + nom + ' » est un nom de fonction : choisissez un autre nom.');
    const valeur = Number(String(cfg.valeur).replace(',', '.'));
    if (cfg.valeur === '' || cfg.valeur === null || cfg.valeur === undefined || !isFinite(valeur)) throw new Error('La valeur du paramètre doit être un nombre.');
    return { nom: nom, valeur: valeur, unite: coupe_(cfg.unite, 20), description: coupe_(cfg.description, 200) };
  }
  if (genre === 'analyse') {
    const type = String(cfg.type || '');
    if (['frequences', 'numerique', 'croise', 'groupe', 'evolution'].indexOf(type) === -1) throw new Error('Type d\'analyse inconnu.');
    const out = { type: type, filtre: filtre(cfg.filtre), du: dateOk(cfg.du), au: dateOk(cfg.au) };
    if (type === 'frequences') out.champ = champ(cfg.champ, true);
    else if (type === 'numerique') out.champ = champ(cfg.champ);
    else if (type === 'croise') { out.ligne = champ(cfg.ligne, true); out.colonne = champ(cfg.colonne, true); out.pct = cfg.pct === 'ligne' || cfg.pct === 'colonne' ? cfg.pct : ''; }
    else if (type === 'groupe') { out.valeur = champ(cfg.valeur); out.groupe = champ(cfg.groupe, true); out.stat = ['somme', 'moyenne', 'mediane', 'min', 'max', 'nb'].indexOf(cfg.stat) !== -1 ? cfg.stat : 'moyenne'; }
    else { out.pas = ['jour', 'semaine', 'mois'].indexOf(cfg.pas) !== -1 ? cfg.pas : 'semaine'; out.champ = champ(cfg.champ, false, true); }
    return out;
  }
  // indicateur
  const vars = (Array.isArray(cfg.variables) ? cfg.variables : []).slice(0, 12).map(v => {
    const nom = String(v && v.nom || '').trim();
    if (!IDENT_RE_.test(nom)) throw new Error('Nom de variable invalide : « ' + nom + ' ».');
    const agregat = AGREGATS_.indexOf(v.agregat) !== -1 ? v.agregat : 'nb';
    return { nom: nom, agregat: agregat, champ: agregat === 'nb' ? champ(v.champ, false, true) : champ(v.champ), filtre: filtre(v.filtre) };
  });
  const noms = {}; vars.forEach(v => { if (noms[v.nom.toUpperCase()]) throw new Error('Nom de variable en double : ' + v.nom); noms[v.nom.toUpperCase()] = true; });
  const formule = coupe_(cfg.formule, 400); if (!formule) throw new Error('Saisissez la formule de l\'indicateur.');
  let an; try { an = Formules_.analyser(formule); } catch (e) { throw new Error(e.message); }
  if (an.refs.length) throw new Error('Dans la formule, utilisez les noms des variables (pas {…}).');
  const params = {}; readSheet_(SHEETS.COLLECTE_ANALYSES).filter(x => x.ActiviteId === a.ID && x.Genre === 'parametre').forEach(x => { try { params[JSON.parse(x.Config).nom.toUpperCase()] = true; } catch (e) { /* ignoré */ } });
  an.ids.forEach(n => { if (!noms[n.toUpperCase()] && !params[n.toUpperCase()]) throw new Error('« ' + n + ' » n\'est ni une variable de l\'indicateur ni un paramètre enregistré.'); });
  return { variables: vars, formule: formule, decimales: Math.max(0, Math.min(6, Math.floor(Number(cfg.decimales)) || 0)), unite: coupe_(cfg.unite, 20), description: coupe_(cfg.description, 300), du: dateOk(cfg.du), au: dateOk(cfg.au) };
}

function saveCollecteAnalyse_(actor, p) {
  const r = activiteDuCreateur_(actor, p.activiteId); if (r.err) return { ok: false, error: r.err.replace('la modifier', 'gérer ses analyses') };
  const q = questionnaireSimpleDe_(r.a); if (!q) return { ok: false, error: 'Cette activité n\'a pas de questionnaire intégré.' };
  const genre = String(p.genre || ''); if (GENRES_ANALYSE_.indexOf(genre) === -1) return { ok: false, error: 'Type d\'élément inconnu.' };
  const toutes = readSheet_(SHEETS.COLLECTE_ANALYSES).filter(x => x.ActiviteId === r.a.ID);
  const existant = p.id ? toutes.find(x => x.ID === p.id) : null;
  if (p.id && !existant) return { ok: false, error: 'Élément introuvable.' };
  if (!existant && toutes.filter(x => x.Genre === genre).length >= 40) return { ok: false, error: 'Limite atteinte (40 éléments de ce type par collecte).' };
  let cfg; try { cfg = nettoyerConfigAnalyse_(genre, p.config && typeof p.config === 'object' ? p.config : {}, q, r.a); } catch (e) { return { ok: false, error: e.message }; }
  if (genre === 'parametre' && toutes.some(x => x.Genre === 'parametre' && x.ID !== (existant && existant.ID) && (() => { try { return JSON.parse(x.Config).nom.toUpperCase() === cfg.nom.toUpperCase(); } catch (e) { return false; } })())) return { ok: false, error: 'Un paramètre porte déjà ce nom.' };
  const titre = genre === 'parametre' ? cfg.nom : coupe_(p.titre, 120);
  if (!titre) return { ok: false, error: 'Donnez un titre.' };
  const json = JSON.stringify(cfg); if (json.length > 4000) return { ok: false, error: 'Configuration trop volumineuse.' };
  if (existant) { updateRowById_(SHEETS.COLLECTE_ANALYSES, existant.ID, { Titre: titre, Config: json, DateModif: nowStr_() }); return { ok: true, id: existant.ID }; }
  const rec = { ID: newId_('ANA'), ActiviteId: r.a.ID, Genre: genre, Titre: titre, Config: json, Ordre: toutes.reduce((m, x) => Math.max(m, Number(x.Ordre) || 0), 0) + 1, CreeParId: actor.ID, DateCreation: nowStr_(), DateModif: nowStr_() };
  appendRow_(SHEETS.COLLECTE_ANALYSES, rec);
  return { ok: true, id: rec.ID };
}

function supprimerCollecteAnalyse_(actor, p) {
  const r = activiteDuCreateur_(actor, p.activiteId); if (r.err) return { ok: false, error: r.err.replace('la modifier', 'gérer ses analyses') };
  const ligne = readSheet_(SHEETS.COLLECTE_ANALYSES).find(x => x.ID === p.id && x.ActiviteId === r.a.ID);
  if (!ligne) return { ok: false, error: 'Élément introuvable.' };
  deleteRowsWhereIn_(SHEETS.COLLECTE_ANALYSES, 'ID', new Set([String(ligne.ID)]));
  return { ok: true };
}

// Le demandeur d'une tâche (ou le National) supprime des suivis journaliers précis (une erreur de saisie, par exemple), sans supprimer le cas.
function tacheSupprimerSuivis_(actor, p) {
  const r = activiteDuCreateur_(actor, p.activiteId); if (r.err) return { ok: false, error: r.err.replace('la modifier', 'supprimer ses données') };
  if (!estTache_(r.a)) return { ok: false, error: 'Cette activité n\'a pas de suivis.' };
  const ids = (Array.isArray(p.suiviIds) ? p.suiviIds : []).map(String).slice(0, 2000);
  if (!ids.length) return { ok: false, error: 'Sélectionnez au moins un suivi à supprimer.' };
  const suivis = readSheet_(SHEETS.TACHES_SUIVIS).filter(x => x.ActiviteId === r.a.ID && ids.indexOf(String(x.ID)) !== -1);
  if (!suivis.length) return { ok: false, error: 'Aucun des suivis sélectionnés n\'existe plus.' };
  deleteRowsWhereIn_(SHEETS.TACHES_SUIVIS, 'ID', new Set(suivis.map(x => String(x.ID))));
  const parRc = {}; suivis.forEach(x => { parRc[x.RcId] = (parRc[x.RcId] || 0) + 1; });
  const users = readSheet_(SHEETS.USERS);
  Object.keys(parRc).forEach(rcId => { const rc = users.find(u => u.ID === rcId); if (rc) notifierComptes_([rc], 'ACTIVITE', r.a.ID, `${parRc[rcId]} suivi(s) que vous aviez saisi(s) dans la tâche « ${r.a.Titre} » ont été supprimé(s) par ${r.a.CreeParNom} : vous pouvez les ressaisir.`); });
  return { ok: true, supprimes: suivis.length };
}

// ===== DÉBUT FICHE_SCHEMAS — copie de assets/fiche-schemas.js (source unique des fiches de notification) : NE PAS MODIFIER ICI =====
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
// ===== FIN FICHE_SCHEMAS =====
