// Dev-only helper used while iterating on scripts/test-full-lifecycle.ts: posts a
// compensating ADJUSTMENT ledger entry to bring each of the 4 test suppliers back
// to a zero balance, since supplier_ledger_entries is append-only (can't be deleted)
// and the E2E script's supplier-closing-balance assertions are absolute, not relative.
const fs = require('fs');
const path = require('path');
const Database = require(path.join(__dirname, '..', '..', 'backend', 'node_modules', 'better-sqlite3'));

const envText = fs.readFileSync(path.join(__dirname, '..', '.env.local'), 'utf8');
const tokenLine = envText.split('\n').find((l) => l.startsWith('STRAPI_SERVICE_TOKEN='));
const token = tokenLine.slice('STRAPI_SERVICE_TOKEN='.length).trim();

const db = new Database(path.join(__dirname, '..', '..', 'backend', '.tmp', 'data.db'), { readonly: true });
const suppliers = db
  .prepare("SELECT id, document_id, name, current_balance_paise FROM suppliers WHERE name IN (?,?,?,?)")
  .all('Adani Wilmar Distributors', 'ITC FMCG Supply Hub', 'Parle Products Depot', 'Tata Consumer Direct');
db.close();

(async () => {
  for (const s of suppliers) {
    const balance = Number(s.current_balance_paise);
    if (balance === 0) {
      console.log(`${s.name}: already zero`);
      continue;
    }
    const res = await fetch(`http://localhost:1337/api/suppliers/${s.document_id}/ledger-entries`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ entry_type: 'ADJUSTMENT', direction: 'DEBIT', amount_paise: balance, note: 'Dev cleanup before next E2E run' }),
    });
    console.log(`${s.name}: zeroed (was ${balance}) -> ${res.status}`);
  }
})();
