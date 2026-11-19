/**
 * Générateur de PDF minimal (sans dépendance, hors connexion) : texte, filets, rectangles et image RGB.
 * Polices intégrées Helvetica / Helvetica-Gras (WinAnsi : accents français, ’ … – — € œ).
 * Coordonnées en points, origine en HAUT à gauche (y vers le bas), page A4 par défaut.
 *
 *   var doc = new PdfMini({ titre: '…' }); var p = doc.page();
 *   p.texte(x, y, 'Texte', { taille: 10, gras: true, oblique: true, angle: 0.8, couleur: '#0B3D3A', align: 'left|center|right' });
 *   p.rect(x, y, l, h, { fond: '#E6EFEE', trait: '#333', epaisseur: 0.5 });  p.ligne(x1, y1, x2, y2, { couleur, epaisseur, arrondi: true });
 *   p.image({ rgb: Uint8Array, l: 96, h: 96 }, x, y, largeur, hauteur);
 *   doc.octets() -> Uint8Array ;  doc.telecharger('nom.pdf')
 */
(function (global) {
  'use strict';
  var W_N = [278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556, 1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556, 333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584, 761, 556, 556, 222, 556, 333, 1000, 556, 556, 333, 1000, 667, 333, 1000, 556, 611, 556, 556, 222, 222, 333, 333, 350, 556, 1000, 333, 1000, 500, 333, 944, 556, 500, 667, 278, 333, 556, 556, 556, 556, 260, 556, 333, 737, 370, 556, 584, 333, 737, 333, 400, 584, 333, 333, 333, 556, 537, 278, 333, 333, 365, 556, 834, 834, 834, 611, 667, 667, 667, 667, 667, 667, 1000, 722, 667, 667, 667, 667, 278, 278, 278, 278, 722, 722, 778, 778, 778, 778, 778, 584, 778, 722, 722, 722, 722, 667, 667, 611, 556, 556, 556, 556, 556, 556, 889, 500, 556, 556, 556, 556, 278, 278, 278, 278, 556, 556, 556, 556, 556, 556, 556, 584, 611, 556, 556, 556, 556, 500, 556, 500], W_B = [278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 333, 333, 584, 584, 584, 611, 975, 722, 722, 722, 722, 667, 611, 778, 722, 278, 556, 722, 611, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 333, 278, 333, 584, 556, 333, 556, 611, 556, 611, 556, 333, 611, 611, 278, 278, 556, 278, 889, 611, 611, 611, 611, 389, 556, 333, 611, 556, 778, 556, 556, 500, 389, 280, 389, 584, 761, 556, 611, 278, 556, 500, 1000, 556, 556, 333, 1000, 667, 333, 1000, 611, 611, 611, 611, 278, 278, 500, 500, 350, 556, 1000, 333, 1000, 556, 333, 944, 611, 500, 667, 278, 333, 556, 556, 556, 556, 280, 556, 333, 737, 370, 556, 584, 333, 737, 333, 400, 584, 333, 333, 333, 611, 556, 278, 333, 333, 365, 556, 834, 834, 834, 611, 722, 722, 722, 722, 722, 722, 1000, 722, 667, 667, 667, 667, 278, 278, 278, 278, 722, 722, 778, 778, 778, 778, 778, 584, 778, 722, 722, 722, 722, 667, 667, 611, 556, 556, 556, 556, 556, 556, 889, 556, 556, 556, 556, 556, 278, 278, 278, 278, 611, 611, 611, 611, 611, 611, 611, 584, 611, 611, 611, 611, 611, 556, 611, 556];
  var CP1252 = { 0x20AC: 0x80, 0x201A: 0x82, 0x0192: 0x83, 0x201E: 0x84, 0x2026: 0x85, 0x2020: 0x86, 0x2021: 0x87, 0x02C6: 0x88, 0x2030: 0x89, 0x0160: 0x8A, 0x2039: 0x8B, 0x0152: 0x8C,
    0x017D: 0x8E, 0x2018: 0x91, 0x2019: 0x92, 0x201C: 0x93, 0x201D: 0x94, 0x2022: 0x95, 0x2013: 0x96, 0x2014: 0x97, 0x02DC: 0x98, 0x2122: 0x99, 0x0161: 0x9A, 0x203A: 0x9B, 0x0153: 0x9C, 0x017E: 0x9E, 0x0178: 0x9F };
  function octet(c) { var k = c.charCodeAt(0); if (k >= 32 && k < 127) return k; if (k >= 160 && k <= 255) return k; if (CP1252[k]) return CP1252[k]; if (k === 0x202F || k === 0xA0 || k === 0x2009) return 32; return 63; }
  function octets(str) { var o = []; for (var i = 0; i < str.length; i++) o.push(octet(str[i])); return o; }
  function largeurTexte(str, taille, gras) {
    var t = gras ? W_B : W_N, w = 0, o = octets(String(str));
    for (var i = 0; i < o.length; i++) { var k = o[i] - 32; w += (k >= 0 && k < t.length && t[k]) ? t[k] : 556; }
    return w * taille / 1000;
  }
  function echapper(str) {
    var s = '', o = octets(str);
    for (var i = 0; i < o.length; i++) {
      var c = o[i];
      if (c === 40 || c === 41 || c === 92) s += '\\' + String.fromCharCode(c);
      else if (c < 32 || c > 126) s += '\\' + ('00' + c.toString(8)).slice(-3);
      else s += String.fromCharCode(c);
    }
    return s;
  }
  function couleur(hex, def) {
    var m = /^#?([0-9a-f]{6})$/i.exec(hex || ''); if (!m) return def || '0 0 0';
    var n = parseInt(m[1], 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255].map(function (x) { return (x / 255).toFixed(3); }).join(' ');
  }
  function Page(l, h) { this.l = l; this.h = h; this.ops = []; this.images = []; }
  Page.prototype.texte = function (x, y, str, o) {
    o = o || {}; var taille = o.taille || 10, gras = !!o.gras, w = largeurTexte(str, taille, gras);
    if (o.align === 'center') x -= w / 2; else if (o.align === 'right') x -= w;
    var a = (o.angle || 0) * Math.PI / 180, c = Math.cos(a).toFixed(4), sn = Math.sin(a).toFixed(4), police = o.oblique ? 'F3' : (gras ? 'F2' : 'F1');
    this.ops.push('BT /' + police + ' ' + taille + ' Tf ' + couleur(o.couleur, '0 0 0') + ' rg ' + c + ' ' + sn + ' ' + (-sn) + ' ' + c + ' ' + x.toFixed(2) + ' ' + (this.h - y).toFixed(2) + ' Tm (' + echapper(String(str)) + ') Tj ET');
    return w;
  };
  Page.prototype.rect = function (x, y, l, h, o) {
    o = o || {}; var parts = [];
    if (o.fond) parts.push(couleur(o.fond) + ' rg');
    if (o.trait) parts.push(couleur(o.trait) + ' RG ' + (o.epaisseur || 0.5) + ' w');
    parts.push(x.toFixed(2) + ' ' + (this.h - y - h).toFixed(2) + ' ' + l.toFixed(2) + ' ' + h.toFixed(2) + ' re ' + (o.fond && o.trait ? 'B' : (o.fond ? 'f' : 'S')));
    this.ops.push(parts.join(' '));
  };
  Page.prototype.ligne = function (x1, y1, x2, y2, o) {
    o = o || {}; this.ops.push((o.arrondi ? '1 J 1 j ' : '') + couleur(o.couleur, '0 0 0') + ' RG ' + (o.epaisseur || 0.5) + ' w ' + x1.toFixed(2) + ' ' + (this.h - y1).toFixed(2) + ' m ' + x2.toFixed(2) + ' ' + (this.h - y2).toFixed(2) + ' l S');
  };
  Page.prototype.image = function (img, x, y, l, h) {
    this.images.push(img); var n = this.images.length;
    this.ops.push('q ' + l.toFixed(2) + ' 0 0 ' + h.toFixed(2) + ' ' + x.toFixed(2) + ' ' + (this.h - y - h).toFixed(2) + ' cm /Im' + n + ' Do Q');
  };
  function PdfMini(opts) { this.opts = opts || {}; this.pages = []; }
  PdfMini.prototype.page = function (l, h) { var p = new Page(l || 595.28, h || 841.89); this.pages.push(p); return p; };
  PdfMini.prototype.octets = function () {
    var enc = function (s) { var u = new Uint8Array(s.length); for (var i = 0; i < s.length; i++) u[i] = s.charCodeAt(i) & 255; return u; };
    var corps = [], pos = 0, offs = [];
    function ecrire(x) { var u = typeof x === 'string' ? enc(x) : x; corps.push(u); pos += u.length; }
    function obj(n, contenu) { offs[n] = pos; ecrire(n + ' 0 obj\n'); ecrire(contenu); ecrire('\nendobj\n'); }
    function flux(n, dict, data) { offs[n] = pos; ecrire(n + ' 0 obj\n<< ' + dict + ' /Length ' + data.length + ' >>\nstream\n'); ecrire(data); ecrire('\nendstream\nendobj\n'); }
    ecrire('%PDF-1.4\n%\u00e2\u00e3\u00cf\u00d3\n');
    var nb = this.pages.length, num = 6, pageNums = [], plan = [];
    this.pages.forEach(function (p) { var po = num++, co = num++, im = []; p.images.forEach(function () { im.push(num++); }); pageNums.push(po); plan.push({ p: p, po: po, co: co, im: im }); });
    var total = num - 1;
    obj(1, '<< /Type /Catalog /Pages 2 0 R >>');
    obj(2, '<< /Type /Pages /Kids [' + pageNums.map(function (n) { return n + ' 0 R'; }).join(' ') + '] /Count ' + nb + ' >>');
    obj(3, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
    obj(4, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
    obj(5, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Oblique /Encoding /WinAnsiEncoding >>');
    plan.forEach(function (it) {
      var xo = it.im.map(function (n, i) { return '/Im' + (i + 1) + ' ' + n + ' 0 R'; }).join(' ');
      obj(it.po, '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ' + it.p.l.toFixed(2) + ' ' + it.p.h.toFixed(2) + '] /Resources << /Font << /F1 3 0 R /F2 4 0 R /F3 5 0 R >>' + (xo ? ' /XObject << ' + xo + ' >>' : '') + ' >> /Contents ' + it.co + ' 0 R >>');
      flux(it.co, '', enc(it.p.ops.join('\n')));
      it.p.images.forEach(function (img, i) { flux(it.im[i], '/Type /XObject /Subtype /Image /Width ' + img.l + ' /Height ' + img.h + ' /ColorSpace /DeviceRGB /BitsPerComponent 8', img.rgb); });
    });
    var info = total + 1;
    var titreAscii = String(this.opts.titre || 'SIVEC').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^\x20-\x7E]/g, '-');
    obj(info, '<< /Title (' + echapper(titreAscii) + ') /Producer (SIVEC) /Creator (SIVEC) >>');
    var xref = pos; ecrire('xref\n0 ' + (info + 1) + '\n0000000000 65535 f \n');
    for (var i = 1; i <= info; i++) ecrire(('0000000000' + offs[i]).slice(-10) + ' 00000 n \n');
    ecrire('trailer\n<< /Size ' + (info + 1) + ' /Root 1 0 R /Info ' + info + ' 0 R >>\nstartxref\n' + xref + '\n%%EOF\n');
    var sortie = new Uint8Array(pos), p = 0; corps.forEach(function (u) { sortie.set(u, p); p += u.length; }); return sortie;
  };
  PdfMini.prototype.telecharger = function (nom) {
    var blob = new Blob([this.octets()], { type: 'application/pdf' }), a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = String(nom).replace(/[\\/:*?"<>|]/g, '-'); document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
  };
  PdfMini.largeurTexte = largeurTexte;
  global.PdfMini = PdfMini;
  if (typeof module !== 'undefined' && module.exports) module.exports = PdfMini;
})(typeof window !== 'undefined' ? window : globalThis);
