/**
 * Formulaire à l'écran des fiches décès (3_BJ maternel, 4_BJ néonatal, 02_BJ autres décès), généré à partir des schémas
 * (fiche-schemas.js). Toutes les rubriques sont obligatoires, sauf celles qui dépendent d'un choix (elles n'apparaissent
 * que lorsque le choix correspondant est fait) et quelques rubriques facultatives par nature.
 *
 *   const form = FicheForm.monter(zoneEl, type, { arrs, valeurs, libelleBouton, onSubmit(donnees) })
 *   form.lire()  form.remplir(valeurs)  form.marquer(manquantsDetail)  form.fixerBouton(texte)
 */
(function (global) {
  'use strict';
  var Sch = function () { return global.FicheSchemas; };
  var esc = function (s) { return String(s === undefined || s === null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var etoile = function (fd) { return (fd.opt || fd.unDe || fd.si) ? '' : ' <span class="fn-req">*</span>'; };

  function champHtml(fd, arrs) {
    var k = esc(fd.k), lib = esc(fd.l), data = ' data-k="' + (fd.t === 'arr' ? 'arrondissementId' : k) + '" data-l="' + lib + '"' + (fd.si ? " data-si='" + esc(JSON.stringify(fd.si)) + "'" : '') + (fd.unDe ? ' data-undue="1"' : '');
    switch (fd.t) {
      case 'note': return '<p class="petit" style="grid-column:1/-1;margin:2px 0"><strong>' + lib + '</strong></p>';
      case 'arr': return '<div class="field"' + data + '><label>' + lib + ' *</label><select name="arrondissementId" required><option value="">— Choisir —</option>' +
        arrs.map(function (a) { return '<option value="' + esc(a.ID) + '">' + esc(a.Nom) + (a.CommuneNom ? ' (' + esc(a.CommuneNom) + ')' : '') + '</option>'; }).join('') + '</select></div>';
      case 'date': return '<div class="field"' + data + '><label>' + lib + etoile(fd) + '</label><input type="date" name="' + k + '"></div>';
      case 'heure': return '<div class="field"' + data + '><label>' + lib + etoile(fd) + '</label><input type="time" name="' + k + '"></div>';
      case 'num': return '<div class="field"' + data + '><label>' + lib + etoile(fd) + '</label><input type="number" min="0" step="any" inputmode="decimal" name="' + k + '"></div>';
      case 'code': return '<div class="field"' + data + '><label>' + lib + etoile(fd) + '</label><div class="fn-ligne">' + fd.opts.map(function (o) {
        return '<label class="fn-opt"><input type="radio" name="' + k + '" value="' + esc(o[0]) + '"> ' + esc(o[0]) + ' — ' + esc(o[1]) + '</label>'; }).join('') + '</div></div>';
      case 'multi': return '<div class="field"' + data + '><label>' + lib + etoile(fd) + ' <span class="petit">(cochez ce qui s\u2019applique)</span></label><div class="fn-grille">' + fd.opts.map(function (o, i) {
        return '<label class="fn-opt"><input type="checkbox" name="' + k + '__' + i + '"> ' + esc(o) + '</label>'; }).join('') + '</div></div>';
      default: return '<div class="field"' + data + '><label>' + lib + etoile(fd) + '</label><input name="' + k + '"' + (fd.auto ? ' readonly' : '') + ' placeholder="' + (fd.auto ? 'rempli automatiquement' : 'écrire NA si sans objet') + '"></div>';
    }
  }

  function sectionHtml(sec, arrs) {
    var corps = '';
    if (sec.style === 'boites') {
      corps = '<div class="grid grid-2">' + sec.cols.map(function (c) {
        var h = champHtml({ t: 'code', k: c.k, l: c.l, opts: c.opts, si: c.si }, arrs);
        if (c.autre) h += champHtml({ t: 'txt', k: c.autre.k, l: c.autre.l, si: c.autre.si }, arrs);
        return h;
      }).join('') + '</div>';
    } else if (sec.style === 'vacc') {
      corps = '<div class="grid grid-2">' + sec.champs.map(function (fd) { return champHtml(fd, arrs); }).join('') + '</div>';
    } else if (sec.style === 'enfants') {
      corps = [1, 2, 3, 4].map(function (i) {
        return '<fieldset class="fn-enfant"><legend>Enfant ' + i + (i > 1 ? ' <span class="petit">(si naissance multiple)</span>' : '') + '</legend><div class="grid grid-2">' +
          sec.vars.map(function (v) { return champHtml(v.num ? { t: 'num', k: v.k + i, l: v.l, opt: i > 1 } : { t: 'code', k: v.k + i, l: v.l, opts: v.opts, opt: i > 1 }, arrs); }).join('') + '</div></fieldset>';
      }).join('');
    } else {
      corps = '<div class="grid grid-2">' + (sec.rows || []).map(function (row) { return row.map(function (fd) { return champHtml(fd, arrs); }).join(''); }).join('') + '</div>';
    }
    return '<div class="fn-bloc"' + (sec.si ? " data-si='" + esc(JSON.stringify(sec.si)) + "'" : '') + '>' + (sec.titre ? '<h3>' + esc(sec.titre) + '</h3>' : '') + corps + '</div>';
  }

  function monter(zone, type, opts) {
    opts = opts || {};
    var S = Sch().get(type), arrs = opts.arrs || [];
    zone.innerHTML = '<form class="fn-schema" autocomplete="off" novalidate>' +
      '<div class="fn-bloc"><h3>' + esc(S.code + ' — ' + (S.titreLignes ? S.titreLignes.join(' ') : S.titre)) + '</h3><p class="petit" style="margin:0 0 8px">Toutes les rubriques marquées <span class="fn-req">*</span> sont obligatoires. Pour une information inconnue ou sans objet, écrivez <strong>NA</strong> (ou choisissez « Inconnu » quand il est proposé). Les rubriques qui dépendent d\u2019un choix n\u2019apparaissent seulement quand elles s\u2019appliquent.</p>' +
      '<div class="grid grid-2">' + [['annee', 'Année de notification'], ['semaine', 'Semaine épidémiologique']].map(function (z) { return champHtml({ t: 'num', k: z[0], l: z[1] }, arrs); }).join('') + '</div></div>' +
      S.sections.map(function (sec) { return sectionHtml(sec, arrs); }).join('') +
      '<div class="fn-actions"><button type="submit" class="fn-save">💾 Enregistrer la fiche</button><button type="button" class="btn-secondary fn-reset">Vider le formulaire</button><span class="fn-info petit"></span></div></form>';
    var form = zone.querySelector('form');

    function lire() {
      var d = {}; var champs = Sch().champs(S);
      form.querySelectorAll('input, select').forEach(function (el) {
        if (!el.name) return;
        if (el.type === 'radio') { if (el.checked) d[el.name] = el.value; }
        else if (el.type === 'checkbox') return;
        else d[el.name] = el.value.trim();
      });
      champs.filter(function (c) { return c.t === 'multi'; }).forEach(function (c) { d[c.k] = c.opts.filter(function (o, i) { var el = form.elements[c.k + '__' + i]; return el && el.checked; }); });
      var a = arrs.filter(function (x) { return String(x.ID) === String(d.arrondissementId); })[0];
      if (a) { d.arrondissement = a.Nom; d.comResidence = a.CommuneNom || d.comResidence || ''; d.depResidence = a.DepartementNom || d.depResidence || ''; }
      d.typeFiche = type;
      // Les rubriques « conditionnelles » qui ne s'appliquent pas sont écartées (aucune valeur périmée n'est enregistrée).
      champs.forEach(function (c) { if (c.siTous && c.siTous.length && !Sch().cond(c.siTous, d)) delete d[c.k]; });
      return d;
    }
    function remplir(v) {
      v = v || {};
      form.reset();
      form.querySelectorAll('input, select').forEach(function (el) {
        if (!el.name || el.type === 'checkbox') return;
        if (el.type === 'radio') el.checked = String(v[el.name]) === el.value;
        else el.value = v[el.name] !== undefined && v[el.name] !== null ? v[el.name] : '';
      });
      Sch().champs(S).filter(function (c) { return c.t === 'multi'; }).forEach(function (c) {
        c.opts.forEach(function (o, i) { var el = form.elements[c.k + '__' + i]; if (el) el.checked = (v[c.k] || []).indexOf(o) !== -1; });
      });
      majArr(false); majConditions();
    }
    function majArr(ecraser) {
      var sel = form.elements.arrondissementId; if (!sel) return;
      var a = arrs.filter(function (x) { return String(x.ID) === String(sel.value); })[0];
      if (a || ecraser) {
        if (form.elements.comResidence && (ecraser || !form.elements.comResidence.value)) form.elements.comResidence.value = a ? (a.CommuneNom || '') : '';
        if (form.elements.depResidence && (ecraser || !form.elements.depResidence.value)) form.elements.depResidence.value = a ? (a.DepartementNom || '') : '';
      }
    }
    function majConditions() {
      var d = lireBrut();
      form.querySelectorAll('[data-si]').forEach(function (el) {
        var ok; try { ok = Sch().cond(JSON.parse(el.getAttribute('data-si')), d); } catch (e) { ok = true; }
        el.style.display = ok ? '' : 'none';
      });
    }
    var multis = {}; Sch().champs(S).filter(function (c) { return c.t === 'multi'; }).forEach(function (c) { multis[c.k] = c.opts; });
    function lireBrut() {
      var d = {};
      form.querySelectorAll('input, select').forEach(function (el) {
        if (!el.name) return;
        if (el.type === 'radio') { if (el.checked) d[el.name] = el.value; }
        else if (el.type === 'checkbox') { var m = /^(.*)__(\d+)$/.exec(el.name); if (m && multis[m[1]]) { d[m[1]] = d[m[1]] || []; if (el.checked) d[m[1]].push(multis[m[1]][+m[2]]); } }
        else d[el.name] = el.value.trim();
      });
      return d;
    }
    function marquer(manq) {
      form.querySelectorAll('.fn-err').forEach(function (e) { e.classList.remove('fn-err'); });
      var premier = null;
      (manq || []).forEach(function (m) {
        var els = form.querySelectorAll('.field[data-k="' + m.k + '"]');
        if (!els.length && m.ks) m.ks.forEach(function (k) { form.querySelectorAll('.field[data-k="' + k + '"]').forEach(function (e) { els = [e]; }); });
        Array.prototype.forEach.call(els, function (e) { e.classList.add('fn-err'); if (!premier) premier = e; });
      });
      if (premier) premier.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
    form.addEventListener('change', function (e) { if (e.target.name === 'arrondissementId') majArr(true); majConditions(); form.querySelectorAll('.fn-err').forEach(function (x) { if (x.contains(e.target)) x.classList.remove('fn-err'); }); });
    form.addEventListener('submit', function (e) { e.preventDefault(); if (opts.onSubmit) opts.onSubmit(lire()); });
    form.querySelector('.fn-reset').onclick = function () { if (opts.onReset) opts.onReset(); };
    remplir(opts.valeurs || {});
    return {
      form: form, lire: lire, remplir: remplir, marquer: marquer, majConditions: majConditions,
      fixerBouton: function (t) { form.querySelector('.fn-save').textContent = t; },
      fixerInfo: function (t) { form.querySelector('.fn-info').textContent = t; },
      bloquer: function (b) { form.querySelector('.fn-save').disabled = !!b; }
    };
  }

  global.FicheForm = { monter: monter };
})(typeof window !== 'undefined' ? window : globalThis);
