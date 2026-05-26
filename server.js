import express from 'express'
import cors from 'cors'
import dotenv from 'dotenv'
import { Pool } from 'pg'
import path from 'path'
import { fileURLToPath } from 'url'

dotenv.config({ path: './config.env' })

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const app = express()
const port = process.env.PORT || 7002

// Request logging middleware
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

const sslModeEnv = (process.env.PGSSLMODE || '').toLowerCase()
const dbSslEnv = (process.env.DATABASE_SSL || '').toLowerCase()
const useSsl = dbSslEnv === 'true' || ['require', 'verify-full', 'verify-ca'].includes(sslModeEnv)

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/logs',
  ssl: useSsl ? { rejectUnauthorized: false } : false,
  max: 20, // Maximum number of clients in the pool
  idleTimeoutMillis: 30000, // Close idle clients after 30 seconds
  connectionTimeoutMillis: 5000, // Return an error after 5 seconds if connection could not be established
  maxUses: 7500, // Close connections after 7500 queries (prevents memory leaks)
})

pool.on('connect', () => console.log('Подключение к базе данных установлено'))
pool.on('error', (err) => console.error('Ошибка подключения к базе данных:', err))

// Cache for available classes with TTL
let classesCache = { data: null, timestamp: null }
const CLASSES_CACHE_TTL = 60000 // 1 minute cache

;(async () => {
  try {
    const client = await pool.connect()
    console.log('✅ Тестовое подключение к базе данных успешно!')
    const result = await client.query('SELECT COUNT(*) FROM Logs')
    console.log('Количество записей в таблице Logs:', result.rows[0].count)
    const classesResult = await client.query('SELECT DISTINCT callingclass AS "callingClass" FROM Logs ORDER BY callingclass')
    console.log('Найдено классов при запуске:', classesResult.rows.length)
    client.release()
  } catch (error) {
    console.error('❌ Ошибка тестового подключения к базе данных:', error.message)
  }
})()

app.get('/api/logs', async (req, res) => {
  try {
    res.set({ 'Cache-Control': 'no-cache, no-store, must-revalidate', 'Pragma': 'no-cache', 'Expires': '0' })
    const { startDate, endDate, className, minLevel, messageSearch, limit = 1000, currentSessionOnly = false } = req.query

    let query = 'SELECT date AS "date", loglevel AS "logLevel", callingclass AS "callingClass", callingmethod AS "callingMethod", message AS "message", sessionid AS "sessionId" FROM Logs'
    const conditions = []
    const params = []
    let paramIndex = 1

    if (startDate) { conditions.push(`date >= $${paramIndex}`); params.push(new Date(startDate)); paramIndex++ }
    if (endDate)   { conditions.push(`date <= $${paramIndex}`); params.push(new Date(endDate));   paramIndex++ }
    if (className) {
      const classNames = Array.isArray(className) ? className : [className]
      if (classNames.length > 0) {
        const placeholders = classNames.map((_, i) => `$${paramIndex + i}`).join(', ')
        conditions.push(`callingclass IN (${placeholders})`)
        params.push(...classNames)
        paramIndex += classNames.length
      }
    }
    if (minLevel !== undefined && minLevel !== '') { conditions.push(`loglevel >= $${paramIndex}`); params.push(parseInt(minLevel)); paramIndex++ }
    if (messageSearch) { conditions.push(`message ILIKE $${paramIndex}`); params.push(`%${messageSearch}%`); paramIndex++ }

    if (currentSessionOnly === 'true') {
      // Ищем маркер начала сессии (поддерживаем старый русский и новый английский варианты)
      const latestSessionQuery = `SELECT date as session_start_time FROM Logs WHERE (message LIKE '%НОВАЯ СЕССИЯ ЗАПУЩЕНА%' OR message LIKE '%SESSION STARTED%') ORDER BY id DESC LIMIT 1`
      try {
        const sessionResult = await pool.query(latestSessionQuery)
        if (sessionResult.rows.length > 0) { conditions.push(`date >= $${paramIndex}`); params.push(sessionResult.rows[0].session_start_time); paramIndex++ }
      } catch (error) { console.error('Ошибка при получении времени начала последней сессии:', error) }
    }

    if (conditions.length > 0) query += ' WHERE ' + conditions.join(' AND ')
    query += ' ORDER BY date DESC'
    if (limit) { query += ` LIMIT $${paramIndex}`; params.push(parseInt(limit)) }

    const result = await pool.query(query, params)
    res.json(result.rows)
  } catch (error) {
    console.error('Ошибка при получении логов:', error)
    res.status(500).json({ error: 'Ошибка сервера', message: error.message })
  }
})

app.get('/api/logs/stats', async (req, res) => {
  try {
    const { startDate, endDate } = req.query
    let query = `SELECT loglevel AS "logLevel", COUNT(*) AS "count", callingclass AS "callingClass" FROM Logs`
    const conditions = []
    const params = []
    let paramIndex = 1
    if (startDate) { conditions.push(`date >= $${paramIndex}`); params.push(new Date(startDate)); paramIndex++ }
    if (endDate)   { conditions.push(`date <= $${paramIndex}`); params.push(new Date(endDate));   paramIndex++ }
    if (conditions.length > 0) query += ' WHERE ' + conditions.join(' AND ')
    query += ' GROUP BY loglevel, callingclass ORDER BY loglevel, COUNT(*) DESC'
    const result = await pool.query(query, params)
    res.json(result.rows)
  } catch (error) {
    console.error('Ошибка при получении статистики:', error)
    res.status(500).json({ error: 'Ошибка сервера', message: error.message })
  }
})

app.get('/api/logs/classes', async (req, res) => {
  try {
    const now = Date.now()
    
    // Return cached data if it's still fresh
    if (classesCache.data && classesCache.timestamp && (now - classesCache.timestamp < CLASSES_CACHE_TTL)) {
      res.set({ 'Cache-Control': 'public, max-age=60' })
      return res.json(classesCache.data)
    }
    
    // Query is optimized with index on CallingClass
    const query = 'SELECT DISTINCT callingclass AS "callingClass" FROM Logs WHERE callingclass IS NOT NULL ORDER BY callingclass'
    const result = await pool.query(query)
    const classes = result.rows.map(row => row.callingClass)
    
    // Update cache
    classesCache = { data: classes, timestamp: now }
    
    res.set({ 'Cache-Control': 'public, max-age=60' })
    res.json(classes)
  } catch (error) {
    console.error('Ошибка при получении классов:', error)
    res.status(500).json({ error: 'Ошибка сервера', message: error.message })
  }
})

app.delete('/api/logs', async (req, res) => {
  try {
    const result = await pool.query('DELETE FROM Logs')
    // Invalidate classes cache after deleting logs
    classesCache = { data: null, timestamp: null }
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
  console.log(`API доступен по адресу: http://localhost:${port}/api`)
})

process.on('SIGINT', async () => { await pool.end(); process.exit(0) })
process.on('SIGTERM', async () => { await pool.end(); process.exit(0) })

