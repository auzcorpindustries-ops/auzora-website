// test/portal-lead-industry-wiring.test.js
// Ticket zeus_1791521283546_a0a695ec — LEAD-INDUSTRY.
//
// portal.html is a single-file app with no module boundary, so this file
// asserts the WIRING: an optional per-lead `industry` is accepted by the CSV
// import (auto-detected + mappable), previewed, and rendered in the Captured
// Leads table. A regression that silently drops industry must fail here.

const fs = require('fs');
const path = require('path');
const html = fs.readFileSync(path.join(__dirname, '..', 'portal.html'), 'utf8');

// Body of a top-level function: from its declaration to the next top-level
// `function`/`async function` declaration.
function fnBody(name) {
  const start = html.indexOf('function ' + name + '(');
  expect(start).toBeGreaterThan(-1);
  const rest = html.slice(start + 1);
  const m = rest.search(/\n(async )?function /);
  return m === -1 ? rest : rest.slice(0, m);
}

describe('portal.html lead-industry wiring', () => {
  test('CSV import auto-detects an industry column', () => {
    const body = fnBody('parseLeadImportPreview');
    expect(body).toContain("hl.includes('industry')");
    expect(body).toContain("liMapping[i] = 'industry'");
  });

  test('industry is a selectable import mapping target', () => {
    const body = fnBody('renderLeadImportMapping');
    expect(body).toContain("'industry'");
  });

  test('the import preview table shows an Industry column', () => {
    expect(html).toContain('>Industry</th>');
    expect(fnBody('renderLeadImportPreview')).toContain("item.lead.industry");
  });

  test('the Captured Leads table renders an Industry column + cell', () => {
    const body = fnBody('renderObLeads');
    // header
    expect(body).toMatch(/<th>Industry<\/th>/);
    // row cell reads latest.industry
    expect(body).toContain('latest.industry');
    // the expanded-history row spans the added column (13 -> 14)
    expect(body).toContain('colspan="14"');
  });

  test('getImportedLeads carries an arbitrary mapped field (industry) through', () => {
    // generic assignment — any non-consent field is copied as-is
    expect(fnBody('getImportedLeads')).toContain('lead[field] = row[parseInt(colIdx)]');
  });
});
