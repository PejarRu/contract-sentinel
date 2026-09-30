import { loadSheetsConfig, getAccessToken } from './src/lib/sheets.js'
const fs = await import('node:fs')
const cfg = loadSheetsConfig()
const token = await getAccessToken(cfg)
const base = `https://sheets.googleapis.com/v4/spreadsheets/${cfg.spreadsheetId}`
const hdr = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
async function call(p: string, init?: RequestInit) {
  for (let i = 0; i < 5; i++) {
    try {
      const r = await fetch(`${base}${p}`, init)
      const body = await r.text()
      if (r.ok) return JSON.parse(body)
      if (![403,429,500].includes(r.status)) throw new Error(`${p} ${r.status} ${body.slice(0,300)}`)
      fs.writeFileSync('/tmp/qa_last.err', `${p} ${r.status} headers=${JSON.stringify(Object.fromEntries(r.headers))} body=${body}`)
      console.log(`retry ${i + 1} tras ${r.status}`)
      await new Promise(s => setTimeout(s, 30000))
    } catch (e) {
      if (String(e).startsWith(`${p}`)) throw e
      throw new Error(`${p} fetch-err: ${e}`)
    }
  }
  throw new Error(`${p} agotado; ver /tmp/qa_last.err`)
}
const info = await call('')
console.log('tabs:', info.sheets.map((s: any) => s.properties.title).join(','))
const existing = info.sheets.find((s: any) => s.properties.title === 'QA')
if (!existing) console.log('QA creada:', JSON.stringify(await call('/sheets?sheetId=0', { method: 'POST', body: JSON.stringify({ sheet: { properties: { title: 'QA' }, gridProperties: { rowCount: 5000, columnCount: 15 } } }) })).slice(0, 120))
else console.log('QA ya existe sheetId', existing.properties.sheetId)
const cols = ['A','B','C','D','E','F','G','H','I','J','K','L']
const rows: string[][] = [
  ['address','nombre','symbol','chain','visto','src','findings','sev_max','ESTADO','revisado_en','notas','bounty','VERDICTO_QA','notas_qa'],
  cols.map(c => `='Revisiones'!${c}2`).concat(['','']),
]
await call('/values/QA!A1:N3000', { method: 'PUT', body: JSON.stringify({ values: rows, valueInputOption: 'USER_ENTERED' }) })
console.log('OK: formulas QA!A1:N3000 escritas')
