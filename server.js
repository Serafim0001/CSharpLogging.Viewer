import express from 'express'
import cors from 'cors'
import dotenv from 'dotenv'
import { Pool } from 'pg'
import path from 'path'
import { fileURLToPath } from 'url'
import {
  getDiscoveryGuide,
  searchLogs,
  getClasses,
  getMethods,
  getSummary,
  getTimeline,
  formatLogsAsText,
  formatSummaryAsText,
  parseArrayParam,
  parseIntParam,
  parseBoolParam
} from './logQuery.js'

dotenv.config({ path: './config.env' })

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const app = express()
const port = process.env.PORT || 7002
const apiKey = process.env.LOG_API_KEY || process.env.LOG_AGENT_API_KEY || ''

app.use((req, res, next) => {
  const start = Date.now()
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`)

  res.on('finish', () => {
    const duration = Date.now() - start
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.url} - ${res.statusCode} (${duration}ms)`)
  })

  next()
})

app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  maxAge: 86400
}))
app.use(express.json({ limit: '50mb' }))
app.use(express.urlencoded({ limit: '50mb', extended: true }))

function requireApiKey(req, res, next) {
  if (!apiKey) return next()
  const header = req.headers.authorization || ''
  const token = header.startsWith('Bearer ') ? header.slice(7) : header
  if (token === apiKey) return next()
  return res.status(401).json({ error: 'Unauthorized', message: 'Invalid or missing Authorization Bearer token' })
}

const sslModeEnv = (process.env.PGSSLMODE || '').toLowerCase()
const dbSslEnv = (process.env.DATABASE_SSL || '').toLowerCase()
const useSsl = dbSslEnv === 'true' || ['require', 'verify-full', 'verify-ca'].includes(sslModeEnv)

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/logs',
  ssl: useSsl ? { rejectUnauthorized: false } : false,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
  maxUses: 7500
})

pool.on('connect', () => console.log('Подключение к базе данных установлено'))
pool.on('error', (err) => console.error('Ошибка подключения к базе данных:', err))

let classesCache = { key: null, data: null, timestamp: null }
const CLASSES_CACHE_TTL = 60000

function classesCacheKey(query) {
  return JSON.stringify({
    startDate: query.startDate || '',
    endDate: query.endDate || '',
    minLevel: query.minLevel || '',
    detailed: query.detailed || ''
  })
}

;(async () => {
  try {
    const client = await pool.connect()
    console.log('✅ Тестовое подключение к базе данных успешно!')
    const result = await client.query('SELECT COUNT(*) FROM Logs')
    console.log('Количество записей в таблице Logs:', result.rows[0].count)
    client.release()
  } catch (error) {
    console.error('❌ Ошибка тестового подключения к базе данных:', error.message)
  }
})()

// ─── Universal log read API (UI + LLM agents) ───────────────────────────────

app.get('/api/logs/discover', requireApiKey, (req, res) => {
  res.json(getDiscoveryGuide())
})

app.get('/api/logs', requireApiKey, async (req, res) => {
  try {
    res.set({ 'Cache-Control': 'no-cache, no-store, must-revalidate', 'Pragma': 'no-cache', 'Expires': '0' })
    const result = await searchLogs(pool, req.query)

    if ((req.query.format || 'json').toLowerCase() === 'text') {
      res.type('text/plain; charset=utf-8')
      return res.send(formatLogsAsText(result.logs))
    }

    res.json(result)
  } catch (error) {
    console.error('Ошибка при получении логов:', error)
    res.status(500).json({ error: 'Ошибка сервера', message: error.message })
  }
})

app.get('/api/logs/classes', requireApiKey, async (req, res) => {
  try {
    const detailed = parseBoolParam(req.query.detailed)
    const cacheKey = classesCacheKey({ ...req.query, detailed: detailed ? '1' : '0' })
    const now = Date.now()

    if (!detailed && classesCache.data && classesCache.key === cacheKey &&
        classesCache.timestamp && (now - classesCache.timestamp < CLASSES_CACHE_TTL)) {
      res.set({ 'Cache-Control': 'public, max-age=60' })
      return res.json(classesCache.data)
    }

    const result = await getClasses(pool, {
      startDate: req.query.startDate || null,
      endDate: req.query.endDate || null,
      minLevel: parseIntParam(req.query.minLevel),
      detailed
    })

    if (!detailed) {
      classesCache = { key: cacheKey, data: result.classes, timestamp: now }
      res.set({ 'Cache-Control': 'public, max-age=60' })
      return res.json(result.classes)
    }

    res.json(result)
  } catch (error) {
    console.error('Ошибка при получении классов:', error)
    res.status(500).json({ error: 'Ошибка сервера', message: error.message })
  }
})

app.get('/api/logs/methods', requireApiKey, async (req, res) => {
  try {
    const callingClass = req.query.callingClass
    if (!callingClass) {
      return res.status(400).json({ error: 'Bad request', message: 'callingClass is required' })
    }

    const methods = await getMethods(pool, callingClass, {
      startDate: req.query.startDate || null,
      endDate: req.query.endDate || null,
      minLevel: parseIntParam(req.query.minLevel)
    })

    res.json({ callingClass, methods })
  } catch (error) {
    console.error('Ошибка при получении методов:', error)
    res.status(500).json({ error: 'Ошибка сервера', message: error.message })
  }
})

app.get('/api/logs/summary', requireApiKey, async (req, res) => {
  try {
    const classNames = [
      ...parseArrayParam(req.query.className),
      ...parseArrayParam(req.query.callingClass)
    ]

    const summary = await getSummary(pool, {
      startDate: req.query.startDate || null,
      endDate: req.query.endDate || null,
      classNames: [...new Set(classNames)],
      topClassCount: parseIntParam(req.query.topClassCount, 15),
      recentErrorLimit: parseIntParam(req.query.recentErrorLimit, 20)
    })

    if ((req.query.format || 'json').toLowerCase() === 'text') {
      res.type('text/plain; charset=utf-8')
      return res.send(formatSummaryAsText(summary))
    }

    res.json(summary)
  } catch (error) {
    console.error('Ошибка при получении summary:', error)
    res.status(500).json({ error: 'Ошибка сервера', message: error.message })
  }
})

app.get('/api/logs/timeline', requireApiKey, async (req, res) => {
  try {
    const classNames = [
      ...parseArrayParam(req.query.className),
      ...parseArrayParam(req.query.callingClass)
    ]

    const timeline = await getTimeline(pool, {
      aroundDate: req.query.aroundDate || null,
      aroundLogId: req.query.aroundLogId || null,
      before: parseIntParam(req.query.before, 30),
      after: parseIntParam(req.query.after, 10),
      classNames: [...new Set(classNames)],
      minLevel: parseIntParam(req.query.minLevel)
    })

    if ((req.query.format || 'json').toLowerCase() === 'text') {
      res.type('text/plain; charset=utf-8')
      return res.send(formatLogsAsText(timeline.logs))
    }

    res.json(timeline)
  } catch (error) {
    console.error('Ошибка при получении timeline:', error)
    const status = error.message?.includes('Specify aroundDate') ? 400 : 500
    res.status(status).json({ error: status === 400 ? 'Bad request' : 'Ошибка сервера', message: error.message })
  }
})

/** @deprecated Use GET /api/logs/summary — kept for backward compatibility */
app.get('/api/logs/stats', requireApiKey, async (req, res) => {
  try {
    const { startDate, endDate } = req.query
    let query = `SELECT loglevel AS "logLevel", COUNT(*) AS "count", callingclass AS "callingClass" FROM Logs`
    const conditions = []
    const params = []
    let paramIndex = 1
    if (startDate) { conditions.push(`date >= $${paramIndex}`); params.push(new Date(startDate)); paramIndex++ }
    if (endDate) { conditions.push(`date <= $${paramIndex}`); params.push(new Date(endDate)); paramIndex++ }
    if (conditions.length > 0) query += ' WHERE ' + conditions.join(' AND ')
    query += ' GROUP BY loglevel, callingclass ORDER BY loglevel, COUNT(*) DESC'
    const result = await pool.query(query, params)
    res.json(result.rows)
  } catch (error) {
    console.error('Ошибка при получении статистики:', error)
    res.status(500).json({ error: 'Ошибка сервера', message: error.message })
  }
})

app.delete('/api/logs', requireApiKey, async (req, res) => {
  try {
    const result = await pool.query('DELETE FROM Logs')
    classesCache = { key: null, data: null, timestamp: null }
    res.json({ success: true, message: `Успешно удалено ${result.rowCount} записей из базы данных`, deletedCount: result.rowCount })
  } catch (error) {
    console.error('Ошибка при удалении логов:', error)
    res.status(500).json({ error: 'Ошибка сервера', message: error.message })
  }
})

app.get('/api/health', (req, res) => res.json({ status: 'OK', timestamp: new Date().toISOString() }))

const distPath = path.join(__dirname, 'dist')
app.use(express.static(distPath))
app.get('*', (req, res) => res.sendFile(path.join(distPath, 'index.html')))

app.listen(port, () => {
  console.log(`Сервер запущен на порту ${port}`)
  console.log(`Universal log API: http://localhost:${port}/api/logs/discover`)
  if (apiKey) console.log('LOG_API_KEY is set — Bearer token required for /api/logs*')
})

process.on('SIGINT', async () => { await pool.end(); process.exit(0) })
process.on('SIGTERM', async () => { await pool.end(); process.exit(0) })
