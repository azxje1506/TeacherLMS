/* English Tutor LMS — export utilities (RC2)
 *
 * Self-contained, dependency-free spreadsheet export: builds a minimal
 * single-sheet .xlsx (OOXML) from an array-of-arrays and triggers a download.
 * This is pure plumbing with no ties to the component, so it lives here rather
 * than inside the UI class. PDF export stays in the component because it drives
 * the live DOM via html2canvas/jsPDF.
 */
(function (root) {
  var ETLMS = (root.ETLMS = root.ETLMS || {});

  /**
   * CRC-32 (IEEE, reflected) over a byte array — the checksum each zip entry needs.
   * @param {Uint8Array} buf
   * @returns {number} unsigned 32-bit CRC
   */
  function crc32(buf) {
    var c = ~0;
    for (var i = 0; i < buf.length; i++) {
      c ^= buf[i];
      for (var k = 0; k < 8; k++) c = (c >>> 1) ^ (0xEDB88320 & -(c & 1));
    }
    return (~c) >>> 0;
  }

  /**
   * Build a single-worksheet .xlsx (OOXML) Blob from a 2-D array of cells.
   * Numbers are written as numeric cells; everything else as inline strings.
   * @param {string} sheetName  truncated to Excel's 31-char limit
   * @param {Array.<Array.<(string|number)>>} aoa  rows of cells
   * @returns {Blob} an .xlsx spreadsheet
   */
  function xlsxBlob(sheetName, aoa) {
    var enc = new TextEncoder();
    var esc = function (s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); };
    var colRef = function (i) { var s = ''; i++; while (i > 0) { var m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; };
    var rowsXml = '';
    aoa.forEach(function (row, r) {
      var cells = '';
      row.forEach(function (cell, ci) {
        var ref = colRef(ci) + (r + 1);
        if (typeof cell === 'number' && isFinite(cell)) cells += '<c r="' + ref + '"><v>' + cell + '</v></c>';
        else cells += '<c r="' + ref + '" t="inlineStr"><is><t xml:space="preserve">' + esc(cell == null ? '' : cell) + '</t></is></c>';
      });
      rowsXml += '<row r="' + (r + 1) + '">' + cells + '</row>';
    });
    var sheet = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>' + rowsXml + '</sheetData></worksheet>';
    var wb = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="' + esc(sheetName || 'Report').slice(0, 31) + '" sheetId="1" r:id="rId1"/></sheets></workbook>';
    var wbRels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>';
    var ct = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>';
    var rels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>';
    var files = [['[Content_Types].xml', ct], ['_rels/.rels', rels], ['xl/workbook.xml', wb], ['xl/_rels/workbook.xml.rels', wbRels], ['xl/worksheets/sheet1.xml', sheet]];
    var u16 = function (n) { return [n & 255, (n >> 8) & 255]; };
    var u32 = function (n) { return [n & 255, (n >> 8) & 255, (n >> 16) & 255, (n >> 24) & 255]; };
    var chunks = [], central = [], offset = 0;
    files.forEach(function (f) {
      var name = f[0], content = f[1];
      var data = enc.encode(content), crc = crc32(data), nb = enc.encode(name);
      var local = [].concat(u32(0x04034b50), u16(20), u16(0), u16(0), u16(0), u16(0), u32(crc), u32(data.length), u32(data.length), u16(nb.length), u16(0));
      chunks.push(new Uint8Array(local), nb, data);
      var cen = [].concat(u32(0x02014b50), u16(20), u16(20), u16(0), u16(0), u16(0), u16(0), u32(crc), u32(data.length), u32(data.length), u16(nb.length), u16(0), u16(0), u16(0), u16(0), u32(0), u32(offset));
      central.push(new Uint8Array(cen), nb);
      offset += local.length + nb.length + data.length;
    });
    var cenSize = 0; central.forEach(function (c) { cenSize += c.length; });
    var end = new Uint8Array([].concat(u32(0x06054b50), u16(0), u16(0), u16(files.length), u16(files.length), u32(cenSize), u32(offset), u16(0)));
    return new Blob(chunks.concat(central, [end]), { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  }

  /**
   * Trigger a browser download for a Blob via a transient <a download>.
   * No-ops safely if the DOM/URL APIs are unavailable.
   * @param {Blob} blob
   * @param {string} fname  suggested filename
   */
  function download(blob, fname) {
    if (!blob || typeof document === 'undefined') return;
    try {
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url; a.download = fname;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(function () { URL.revokeObjectURL(url); }, 1500);
    } catch (e) {
      if (typeof console !== 'undefined') console.error('xlsx download failed:', e);
    }
  }

  ETLMS.xlsx = { crc32: crc32, blob: xlsxBlob, download: download };
})(window);
