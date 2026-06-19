const LOG_LEVELS = ['Info', 'Warning', 'Error', 'FatalError']

const LOG_SELECT = `
  id AS "id",
  date AS "date",
  loglevel AS "logLevel",
  callingclass AS "callingClass",
  callingmethod AS "callingMethod",
  message AS "message",
  sessionid AS "sessionId"
`

export function getDiscoveryGuide() {
  return {
    schema: {
      id: 'integer, primary key',
      date: 'timestamptz UTC',
      logLevel: '0=Info, 1=Warning, 2=Error, 3=FatalError',
      callingClass: 'source file name without .cs',
      callingMethod: 'caller method name',
      message: 'free text',
      sessionId: 'process session id'
    },
    endpoints: {
      discover: 'GET /api/logs/discover — this guide',
      search: 'GET /api/logs — universal search (filters below)',
      classes: 'GET /api/logs/classes — list components; detailed=true for counts',
      methods: 'GET /api/logs/methods?callingClass=Name — methods in a class',
      summary: 'GET /api/logs/summary — counts and hotspots',
      timeline: 'GET /api/logs/timeline — context around a log id or timestamp'
    },
    searchParams: {
      startDate: 'ISO datetime',
      endDate: 'ISO datetime',
      className: 'repeatable, alias callingClass',
      callingMethod: 'repeatable',
      minLevel: '0..3 inclusive min',
      maxLevel: '0..3 inclusive max',
      messageSearch: 'ILIKE substring',
      sessionId: 'exact process session',
      currentSessionOnly: 'true — logs after latest SESSION STARTED marker',
      limit: 'default 500',
      offset: 'default 0',
      order: 'desc (default) or asc',
      includeTotalCount: 'true — adds totalCount and hasMore',
      format: 'json (default) or text (plain lines for LLM agents)'
    },
    workflow: [
      'GET /api/logs/classes?detailed=true&minLevel=1',
      'GET /api/logs/methods?callingClass=LegOrderMachine',
      'GET /api/logs?className=LegOrderMachine&minLevel=2&limit=100',
      'GET /api/logs/timeline?aroundLogId=12345&before=30&after=10'
    ],
    messagePatterns: [
      'SESSION STARTED: {sessionId}',
      'ArbitrageExecution[{guid}] event=...',
      'Diagnostics [snapshot]: Class | Metric | Value'
    ]
  }
}

export function parseArrayParam(value) {
  if (value == null || value === '') return []
  return Array.isArray(value) ? value.filter(Boolean) : [value].filter(Boolean)
}

export function parseIntParam(value, fallback = null) {
  if (value === undefined || value === null || value === '') return fallback
  const n = parseInt(value, 10)
  return Number.isFinite(n) ? n : fallback
}

export function parseBoolParam(value) {
  return value === true || value === 'true' || value === '1'
}

function appendDateLevelFilters(conditions, params, { startDate, endDate, minLevel, maxLevel }, paramIndex) {
  let idx = paramIndex
  if (startDate) {
    conditions.push(`date >= $${idx}`)
    params.push(new Date(startDate))
    idx++
  }
  if (endDate) {
    conditions.push(`date <= $${idx}`)
    params.push(new Date(endDate))
    idx++
  }
  if (minLevel != null) {
    conditions.push(`loglevel >= $${idx}`)
    params.push(minLevel)
    idx++
  }
  if (maxLevel != null) {
    conditions.push(`loglevel <= $${idx}`)
    params.push(maxLevel)
    idx++
  }
  return idx
}

function appendInFilter(conditions, params, column, values, paramPrefix, paramIndex) {
  let idx = paramIndex
  if (!values.length) return idx
  const placeholders = values.map((_, i) => `$${idx + i}`).join(', ')
  conditions.push(`${column} IN (${placeholders})`)
  params.push(...values)
  return idx + values.length
}

export async function getLatestSessionStart(pool) {
  const result = await pool.query(`
    SELECT date AS session_start_time
    FROM Logs
    WHERE message LIKE '%SESSION STARTED%' OR message LIKE '%НОВАЯ СЕССИЯ ЗАПУЩЕНА%'
    ORDER BY id DESC
    LIMIT 1
  `)
  return result.rows[0]?.session_start_time ?? null
}

export function buildSearchQuery(options) {
  const {
    startDate,
    endDate,
    classNames = [],
    callingMethods = [],
    minLevel = null,
    maxLevel = null,
    messageSearch = null,
    sessionId = null,
    currentSessionOnly = false,
    latestSessionStart = null,
    limit = 500,
    offset = 0,
    orderDescending = true
  } = options

  const conditions = []
  const params = []
  let paramIndex = 1

  paramIndex = appendDateLevelFilters(conditions, params, { startDate, endDate, minLevel, maxLevel }, paramIndex)
  paramIndex = appendInFilter(conditions, params, 'callingclass', classNames, 'class', paramIndex)
  paramIndex = appendInFilter(conditions, params, 'callingmethod', callingMethods, 'method', paramIndex)

  if (messageSearch) {
    conditions.push(`message ILIKE $${paramIndex}`)
    params.push(`%${messageSearch}%`)
    paramIndex++
  }

  if (sessionId) {
    conditions.push(`sessionid = $${paramIndex}`)
    params.push(sessionId)
    paramIndex++
  }

  if (currentSessionOnly && latestSessionStart) {
    conditions.push(`date >= $${paramIndex}`)
    params.push(latestSessionStart)
    paramIndex++
  }

  const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''
  const order = orderDescending ? 'DESC' : 'ASC'
  const countParams = [...params]

  params.push(Math.max(0, limit))
  const limitParam = `$${paramIndex++}`
  params.push(Math.max(0, offset))
  const offsetParam = `$${paramIndex++}`

  const sql = `
    SELECT ${LOG_SELECT}
    FROM Logs
    ${whereClause}
    ORDER BY date ${order}, id ${order}
    LIMIT ${limitParam} OFFSET ${offsetParam}
  `

  const countSql = `SELECT COUNT(*)::int AS total FROM Logs ${whereClause}`

  return { sql, countSql, params, countParams }
}

export function parseSearchQuery(reqQuery, latestSessionStart = null) {
  const classNames = [
    ...parseArrayParam(reqQuery.className),
    ...parseArrayParam(reqQuery.callingClass)
  ]

  return {
    startDate: reqQuery.startDate || null,
    endDate: reqQuery.endDate || null,
    classNames: [...new Set(classNames)],
    callingMethods: parseArrayParam(reqQuery.callingMethod),
    minLevel: parseIntParam(reqQuery.minLevel),
    maxLevel: parseIntParam(reqQuery.maxLevel),
    messageSearch: reqQuery.messageSearch || reqQuery.messageContains || null,
    sessionId: reqQuery.sessionId || null,
    currentSessionOnly: parseBoolParam(reqQuery.currentSessionOnly) || parseBoolParam(reqQuery.latestSessionOnly),
    latestSessionStart: parseBoolParam(reqQuery.currentSessionOnly) || parseBoolParam(reqQuery.latestSessionOnly)
      ? latestSessionStart
      : null,
    limit: parseIntParam(reqQuery.limit, 500),
    offset: parseIntParam(reqQuery.offset, 0),
    orderDescending: (reqQuery.order || 'desc').toLowerCase() !== 'asc',
    includeTotalCount: parseBoolParam(reqQuery.includeTotalCount),
    format: (reqQuery.format || 'json').toLowerCase()
  }
}

export async function searchLogs(pool, reqQuery) {
  const needsSession = parseBoolParam(reqQuery.currentSessionOnly) || parseBoolParam(reqQuery.latestSessionOnly)
  const latestSessionStart = needsSession ? await getLatestSessionStart(pool) : null

  const options = parseSearchQuery(reqQuery, latestSessionStart)
  const { sql, countSql, params, countParams } = buildSearchQuery(options)

  const logsResult = await pool.query(sql, params)
  let totalCount = null
  let hasMore = false

  if (options.includeTotalCount) {
    const countResult = await pool.query(countSql, countParams)
    totalCount = countResult.rows[0]?.total ?? 0
    hasMore = options.offset + logsResult.rows.length < totalCount
  } else {
    hasMore = logsResult.rows.length >= options.limit && options.limit > 0
  }

  return {
    logs: logsResult.rows,
    totalCount,
    hasMore,
    meta: {
      limit: options.limit,
      offset: options.offset,
      order: options.orderDescending ? 'desc' : 'asc'
    }
  }
}

export async function getClasses(pool, { startDate, endDate, minLevel, detailed }) {
  const conditions = ['callingclass IS NOT NULL', "callingclass <> ''"]
  const params = []
  let paramIndex = 1
  paramIndex = appendDateLevelFilters(conditions, params, { startDate, endDate, minLevel, maxLevel: null }, paramIndex)

  const whereClause = `WHERE ${conditions.join(' AND ')}`

  if (detailed) {
    const sql = `
      SELECT callingclass AS "callingClass",
             COUNT(*)::int AS "totalCount",
             COUNT(*) FILTER (WHERE loglevel = 0)::int AS "infoCount",
             COUNT(*) FILTER (WHERE loglevel = 1)::int AS "warningCount",
             COUNT(*) FILTER (WHERE loglevel = 2)::int AS "errorCount",
             COUNT(*) FILTER (WHERE loglevel = 3)::int AS "fatalCount",
             MAX(date) AS "lastLogDate"
      FROM Logs
      ${whereClause}
      GROUP BY callingclass
      ORDER BY "lastLogDate" DESC NULLS LAST, callingclass
    `
    const result = await pool.query(sql, params)
    return { detailed: true, classes: result.rows }
  }

  const sql = `
    SELECT DISTINCT callingclass AS "callingClass"
    FROM Logs
    ${whereClause}
    ORDER BY callingclass
  `
  const result = await pool.query(sql, params)
  return { detailed: false, classes: result.rows.map(r => r.callingClass) }
}

export async function getMethods(pool, callingClass, { startDate, endDate, minLevel }) {
  const conditions = ['callingclass = $1']
  const params = [callingClass]
  let paramIndex = 2
  paramIndex = appendDateLevelFilters(conditions, params, { startDate, endDate, minLevel, maxLevel: null }, paramIndex)

  const sql = `
    SELECT callingmethod AS "callingMethod",
           COUNT(*)::int AS "totalCount",
           MAX(date) AS "lastLogDate"
    FROM Logs
    WHERE ${conditions.join(' AND ')}
    GROUP BY callingmethod
    ORDER BY "lastLogDate" DESC NULLS LAST, callingmethod
  `

  const result = await pool.query(sql, params)
  return result.rows
}

export async function getSummary(pool, { startDate, endDate, classNames = [], topClassCount = 15, recentErrorLimit = 20 }) {
  const conditions = []
  const params = []
  let paramIndex = 1
  paramIndex = appendDateLevelFilters(conditions, params, { startDate, endDate, minLevel: null, maxLevel: null }, paramIndex)
  paramIndex = appendInFilter(conditions, params, 'callingclass', classNames, 'class', paramIndex)

  const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''

  const totalsSql = `
    SELECT COUNT(*)::int AS total,
           COUNT(*) FILTER (WHERE loglevel = 0)::int AS "infoCount",
           COUNT(*) FILTER (WHERE loglevel = 1)::int AS "warningCount",
           COUNT(*) FILTER (WHERE loglevel = 2)::int AS "errorCount",
           COUNT(*) FILTER (WHERE loglevel = 3)::int AS "fatalCount"
    FROM Logs
    ${whereClause}
  `
  const totalsResult = await pool.query(totalsSql, params)
  const totals = totalsResult.rows[0]

  const topConditions = [...conditions, 'loglevel >= 1']
  const topWhere = topConditions.length ? `WHERE ${topConditions.join(' AND ')}` : 'WHERE loglevel >= 1'
  const topSql = `
    SELECT callingclass AS "callingClass",
           COUNT(*)::int AS "totalCount",
           COUNT(*) FILTER (WHERE loglevel = 1)::int AS "warningCount",
           COUNT(*) FILTER (WHERE loglevel = 2)::int AS "errorCount",
           COUNT(*) FILTER (WHERE loglevel = 3)::int AS "fatalCount",
           MAX(date) AS "lastLogDate"
    FROM Logs
    ${topWhere}
    GROUP BY callingclass
    ORDER BY "totalCount" DESC, "lastLogDate" DESC
    LIMIT $${paramIndex}
  `
  const topParams = [...params, topClassCount]
  const topResult = await pool.query(topSql, topParams)

  const errorWhere = conditions.length
    ? `${whereClause} AND loglevel >= 2`
    : 'WHERE loglevel >= 2'
  const recentSql = `
    SELECT ${LOG_SELECT}
    FROM Logs
    ${errorWhere}
    ORDER BY date DESC, id DESC
    LIMIT $${paramIndex}
  `
  const recentParams = [...params, recentErrorLimit]
  const recentResult = await pool.query(recentSql, recentParams)

  return {
    startDate: startDate || null,
    endDate: endDate || null,
    totalCount: totals.total,
    infoCount: totals.infoCount,
    warningCount: totals.warningCount,
    errorCount: totals.errorCount,
    fatalCount: totals.fatalCount,
    topClasses: topResult.rows,
    recentErrors: recentResult.rows
  }
}

export async function getTimeline(pool, {
  aroundDate = null,
  aroundLogId = null,
  before = 30,
  after = 10,
  classNames = [],
  minLevel = null
}) {
  let anchorDate = aroundDate ? new Date(aroundDate) : null
  let anchorId = aroundLogId != null ? parseInt(aroundLogId, 10) : null

  if (anchorId != null && Number.isFinite(anchorId)) {
    const anchorResult = await pool.query(
      `SELECT id, date FROM Logs WHERE id = $1`,
      [anchorId]
    )
    if (!anchorResult.rows.length) return { logs: [], anchor: null }
    anchorDate = anchorResult.rows[0].date
    anchorId = anchorResult.rows[0].id
  } else if (anchorDate) {
    const nearest = await pool.query(
      `SELECT id, date FROM Logs WHERE date <= $1 ORDER BY date DESC, id DESC LIMIT 1`,
      [anchorDate]
    )
    if (nearest.rows.length) {
      anchorDate = nearest.rows[0].date
      anchorId = nearest.rows[0].id
    } else {
      anchorId = 0
    }
  } else {
    throw new Error('Specify aroundDate or aroundLogId')
  }

  const extraConditions = []
  const extraParams = []
  if (minLevel != null) {
    extraParams.push(minLevel)
    extraConditions.push(`loglevel >= $${4 + extraParams.length}`)
  }
  if (classNames.length) {
    const startIdx = 4 + extraParams.length + 1
    const placeholders = classNames.map((_, i) => `$${startIdx + i}`).join(', ')
    extraConditions.push(`callingclass IN (${placeholders})`)
    extraParams.push(...classNames)
  }
  const extraWhere = extraConditions.length ? ` AND ${extraConditions.join(' AND ')}` : ''

  const params = [anchorDate, anchorId, Math.max(0, before), Math.max(0, after), ...extraParams]

  const sql = `
    (
      SELECT ${LOG_SELECT}
      FROM Logs
      WHERE (date < $1 OR (date = $1 AND id <= $2))${extraWhere}
      ORDER BY date DESC, id DESC
      LIMIT $3
    )
    UNION ALL
    (
      SELECT ${LOG_SELECT}
      FROM Logs
      WHERE (date > $1 OR (date = $1 AND id > $2))${extraWhere}
      ORDER BY date ASC, id ASC
      LIMIT $4
    )
    ORDER BY date ASC, id ASC
  `

  const result = await pool.query(sql, params)
  return {
    anchor: { id: anchorId, date: anchorDate },
    logs: result.rows
  }
}

export function formatLogsAsText(logs) {
  if (!logs?.length) return '(no logs)'

  const levelChar = { 0: 'I', 1: 'W', 2: 'E', 3: 'F' }
  return logs.map(log => {
    const d = new Date(log.date).toISOString().replace('T', ' ').replace('Z', 'Z')
    const ch = levelChar[log.logLevel] ?? '?'
    return `${d} ${ch} ${log.callingClass}.${log.callingMethod}: ${log.message}`
  }).join('\n')
}

export function formatSummaryAsText(summary) {
  const lines = [
    `Log summary (${summary.startDate || '…'} — ${summary.endDate || '…'})`,
    `Total=${summary.totalCount} Info=${summary.infoCount} Warn=${summary.warningCount} Err=${summary.errorCount} Fatal=${summary.fatalCount}`,
    'Top warning+ classes:'
  ]

  for (const c of summary.topClasses) {
    lines.push(`  ${c.callingClass}: total=${c.totalCount} W=${c.warningCount} E=${c.errorCount} F=${c.fatalCount}`)
  }

  if (summary.recentErrors?.length) {
    lines.push('Recent errors:')
    lines.push(formatLogsAsText(summary.recentErrors).split('\n').map(l => `  ${l}`).join('\n'))
  }

  return lines.join('\n')
}

export { LOG_LEVELS }
