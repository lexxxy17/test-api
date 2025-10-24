import 'dotenv/config'
import express from 'express'
import bodyParser from 'body-parser'
import { db, upsertUser, getUser, listUserIds, getSessionRow, setSessionRow, deleteSessionRow, getCompletionRow, setCompletionRow, deleteCompletionRow } from './src/db.js'
import https from 'https';
import fs from 'fs';

const app = express()
const PORT = Number(process.env.PORT || 3000)
const ADMIN_KEY = process.env.ADMIN_KEY || 'ad777'
const BOT_KEY = process.env.BOT_KEY || process.env.ADMIN_KEY || 'ad777'

app.use(bodyParser.json({ limit: '10mb' }))

const options = {
  key: fs.readFileSync('/etc/letsencrypt/live/ai.lingofast.fun/privkey.pem'),
  cert: fs.readFileSync('/etc/letsencrypt/live/ai.lingofast.fun/fullchain.pem'),
};


// Basic CORS for admin API
const allowCors = (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Requested-With, x-admin-key, x-bot-key, Authorization')
  res.setHeader('Vary', 'Origin')
}
app.use((req, res, next) => { allowCors(req, res); if (req.method === 'OPTIONS') return res.sendStatus(204); next() })
app.options('*', (req, res) => { allowCors(req, res); res.sendStatus(204) })

function checkAdmin(req, res) {
  const provided = req.get('x-admin-key') || req.query.key
  if (provided !== ADMIN_KEY) { res.sendStatus(401); return false }
  return true
}
function checkBot(req, res) {
  const provided = req.get('x-bot-key') || req.query.botKey
  if (provided !== BOT_KEY) { res.sendStatus(401); return false }
  return true
}

app.get('/healthz', (_req, res) => res.status(200).send('ok'))

// Admin purge: delete all rows from users/sessions/completions (irreversible)
// Requires x-admin-key and confirm=ERASE
app.delete('/api/admin/purge', (req, res) => {
  if (!checkAdmin(req, res)) return
  const confirm = (req.query.confirm || req.body?.confirm || '').toString()
  if (confirm !== 'ERASE') return res.status(400).json({ error: 'Set confirm=ERASE to purge' })
  try {
    const delSessions = db.prepare('DELETE FROM sessions').run().changes || 0
    const delCompletions = db.prepare('DELETE FROM completions').run().changes || 0
    const delUsers = db.prepare('DELETE FROM users').run().changes || 0
    try { db.exec('VACUUM') } catch {}
    res.json({ ok: true, deleted: { users: delUsers, sessions: delSessions, completions: delCompletions } })
  } catch (e) {
    res.status(500).json({ error: e?.message || String(e) })
  }
})

// Admin listing
app.get('/api/users', async (req, res) => {
  if (!checkAdmin(req, res)) return
  const limit = Math.min(Number(req.query.limit || 200), 1000)
  const offset = Math.max(Number(req.query.offset || 0), 0)
  try {
    const ids = listUserIds(limit, offset)
    const items = []
    for (const id of ids) {
      const u = getUser(id) || {}
      const sess = getSessionRow(id)
      const completedRow = getCompletionRow(id)
      let step = '-'; let mode = '-'
      if (sess?.data) {
        try {
          const parsed = JSON.parse(sess.data)
          step = parsed?.step || '-'
          mode = parsed?.mode || (parsed?.test?.mode || '-')
        } catch {}
      }
      items.push({
        id: String(id),
        username: u.username || '',
        first_name: u.first_name || '',
        last_name: u.last_name || '',
        lang: u.lang || '',
        updated_at: String(u.updated_at || ''),
        step,
        mode,
        completed: !!completedRow && (!completedRow.expires_at || completedRow.expires_at > Date.now())
      })
    }
    res.json({ total: items.length + offset, users: items })
  } catch (e) {
    res.status(500).json({ error: e?.message || String(e) })
  }
})

// Bot-facing user upsert
app.post('/api/users/upsert', (req, res) => {
  if (!checkBot(req, res)) return
  try {
    const p = req.body || {}
    if (!p.id) return res.status(400).json({ error: 'id required' })
    upsertUser({ ...p, id: String(p.id), updated_at: Date.now() })
    res.json({ ok: true })
  } catch (e) { res.status(500).json({ error: e?.message || String(e) }) }
})

// Bot-facing get user (optional)
app.get('/api/users/:id', (req, res) => {
  if (!checkBot(req, res) && !checkAdmin(req, res)) return
  const u = getUser(String(req.params.id))
  if (!u) return res.sendStatus(404)
  res.json(u)
})

// Sessions
app.get('/api/session/:id', (req, res) => { if (!checkBot(req, res)) return; const row = getSessionRow(String(req.params.id)); if (!row) return res.sendStatus(404); res.json(row) })
app.put('/api/session/:id', (req, res) => { if (!checkBot(req, res)) return; const { data, expiresAt } = req.body || {}; setSessionRow(String(req.params.id), String(data || '{}'), expiresAt ?? null); res.json({ ok: true }) })
app.delete('/api/session/:id', (req, res) => { if (!checkBot(req, res)) return; deleteSessionRow(String(req.params.id)); res.json({ ok: true }) })

// Completions
app.get('/api/completion/:id', (req, res) => { if (!checkBot(req, res)) return; const row = getCompletionRow(String(req.params.id)); if (!row) return res.sendStatus(404); res.json(row) })
app.put('/api/completion/:id', (req, res) => { if (!checkBot(req, res)) return; const { expiresAt } = req.body || {}; setCompletionRow(String(req.params.id), expiresAt ?? null); res.json({ ok: true }) })
app.delete('/api/completion/:id', (req, res) => { if (!checkBot(req, res)) return; deleteCompletionRow(String(req.params.id)); res.json({ ok: true }) })

app.listen(PORT, () => console.log(`API server listening on ${PORT}`))

https.createServer(options, app).listen(8080, () => {
  console.log('HTTPS сервер запущен на 8080 порту');
});

