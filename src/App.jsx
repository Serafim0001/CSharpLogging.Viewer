import React, { useState, useEffect } from 'react'
import axios from 'axios'
import { format } from 'date-fns'
import { ru } from 'date-fns/locale'
import HighlightText from './HighlightText.jsx'
import LogStats from './LogStats.jsx'

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || `${window.location.origin}/api`
const ENV_NAME = import.meta.env.VITE_ENV_NAME || 'Development'

const LogLevel = {
  Info: 0,
  Warning: 1,
  Error: 2,
  FatalError: 3
}

const LogLevelLabels = {
  [LogLevel.Info]: 'Info',
  [LogLevel.Warning]: 'Warning',
  [LogLevel.Error]: 'Error',
  [LogLevel.FatalError]: 'Fatal Error'
}

export default function App() {
  const [logs, setLogs] = useState([])
  const [totalCount, setTotalCount] = useState(null)
  const [hasMore, setHasMore] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [filters, setFilters] = useState({
    startDate: '',
    endDate: '',
    selectedClasses: [],
    minLevel: LogLevel.Warning,
    messageSearch: '',
    limit: 1000,
    currentSessionOnly: true
  })
  const [availableClasses, setAvailableClasses] = useState([])
  const [autoRefresh, setAutoRefresh] = useState(false)
  const [refreshInterval, setRefreshInterval] = useState(30)
  const [showStats, setShowStats] = useState(false)
  const [lastUpdateTime, setLastUpdateTime] = useState(null)
  const [searchMatches, setSearchMatches] = useState(0)
  const [copyStatus, setCopyStatus] = useState(null)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [deleteStatus, setDeleteStatus] = useState(null)
  // Default theme is 'dark'
  const [theme, setTheme] = useState(localStorage.getItem('theme') || 'dark')

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
    localStorage.setItem('theme', theme)
  }, [theme])

  const toggleTheme = () => {
    setTheme(prev => prev === 'dark' ? 'light' : 'dark')
  }

  const fetchLogs = async () => {
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams()
      if (filters.startDate) params.append('startDate', new Date(filters.startDate).toISOString())
      if (filters.endDate) params.append('endDate', new Date(filters.endDate).toISOString())
      if (filters.selectedClasses && filters.selectedClasses.length > 0) {
        filters.selectedClasses.forEach(cls => params.append('className', cls))
      }
      if (filters.minLevel !== '') params.append('minLevel', filters.minLevel)
      if (filters.messageSearch) params.append('messageSearch', filters.messageSearch)
      if (filters.limit) params.append('limit', filters.limit)
      if (filters.currentSessionOnly) params.append('currentSessionOnly', filters.currentSessionOnly)
      params.append('includeTotalCount', 'true')

      const url = `${API_BASE_URL}/logs?${params.toString()}`
      console.log('Fetching logs with URL:', url)
      const response = await axios.get(url, { timeout: 30000 })
      const payload = response.data
      const rows = Array.isArray(payload) ? payload : (payload.logs || [])
      setLogs(rows)
      setTotalCount(Array.isArray(payload) ? rows.length : payload.totalCount)
      setHasMore(Array.isArray(payload) ? false : !!payload.hasMore)
      setLastUpdateTime(new Date())
      if (filters.messageSearch) {
        const matches = rows.filter(l => l.message?.toLowerCase().includes(filters.messageSearch.toLowerCase())).length
        setSearchMatches(matches)
      } else setSearchMatches(0)
    } catch (err) {
      setError('Ошибка при загрузке логов: ' + (err.response?.data?.message || err.message))
    } finally {
      setLoading(false)
    }
  }

  const fetchAvailableClasses = async () => {
    try {
      const response = await axios.get(`${API_BASE_URL}/logs/classes`)
      const classes = response.data
      setAvailableClasses(classes)
      // Если это первая загрузка и selectedClasses пустой, выбираем все классы по умолчанию
      if (filters.selectedClasses.length === 0 && classes.length > 0) {
        setFilters(prev => ({ ...prev, selectedClasses: classes }))
      }
    } catch (err) {
      console.error('Ошибка при загрузке классов:', err)
    }
  }

  const handleFilterChange = (field, value) => setFilters(prev => ({ ...prev, [field]: value }))

  const clearFilters = () => setFilters({
    startDate: '', endDate: '', selectedClasses: availableClasses, minLevel: LogLevel.Warning, messageSearch: '', limit: 1000, currentSessionOnly: true
  })
  
  const handleClassToggle = (className) => {
    setFilters(prev => {
      const isSelected = prev.selectedClasses.includes(className)
      return {
        ...prev,
        selectedClasses: isSelected
          ? prev.selectedClasses.filter(c => c !== className)
          : [...prev.selectedClasses, className]
      }
    })
  }
  
  const handleToggleAllClasses = () => {
    setFilters(prev => ({
      ...prev,
      selectedClasses: prev.selectedClasses.length === availableClasses.length ? [] : [...availableClasses]
    }))
  }

  const formatDate = (dateString) => {
    try { return format(new Date(dateString), 'dd.MM.yyyy HH:mm:ss', { locale: ru }) } catch { return dateString }
  }

  const getLogLevelClass = (levelValue) => {
    const level = Number(levelValue)
    switch (level) {
      case LogLevel.Info: return 'log-level-info'
      case LogLevel.Warning: return 'log-level-warning'
      case LogLevel.Error: return 'log-level-error'
      case LogLevel.FatalError: return 'log-level-fatalerror'
      default: return 'log-level-info'
    }
  }

  const getLogItemClass = (levelValue) => {
    // Избегаем конфликта со стилем .error (панель ошибок)
    // Строки логов оставляем без дополнительного класса
    return ''
  }

  const buildClipboardText = () => {
    if (!logs || logs.length === 0) return ''
    const lines = logs.map(log => {
      const date = formatDate(log.date)
      const level = LogLevelLabels[log.logLevel]
      const cls = log.callingClass || 'Неизвестно'
      const method = log.callingMethod || 'Неизвестно'
      const message = (log.message || '').replace(/\s+/g, ' ').trim()
      return `[${date}] [${level}] ${cls}.${method} - ${message}`
    })
    return lines.join('\n')
  }

  const handleCopyVisibleLogs = async () => {
    const text = buildClipboardText()
    if (!text) {
      setCopyStatus('Нет данных для копирования')
      setTimeout(() => setCopyStatus(null), 1500)
      return
    }

    let copied = false

    // 1) Пытаемся использовать современный Clipboard API (работает в https/localhost)
    if (navigator?.clipboard?.writeText) {
      try {
        await navigator.clipboard.writeText(text)
        copied = true
      } catch (_) {
        copied = false
      }
    }

    // 2) Фоллбэк через скрытое textarea для http/некоторых браузеров
    if (!copied) {
      try {
        const textarea = document.createElement('textarea')
        textarea.value = text
        textarea.setAttribute('readonly', '')
        textarea.style.position = 'fixed'
        textarea.style.top = '-1000px'
        textarea.style.left = '-1000px'
        document.body.appendChild(textarea)
        textarea.focus()
        textarea.select()
        textarea.setSelectionRange(0, textarea.value.length)
        copied = document.execCommand('copy')
        document.body.removeChild(textarea)
      } catch (_) {
        copied = false
      }
    }

    setCopyStatus(copied ? `Скопировано: ${logs.length}` : 'Не удалось скопировать. Скопируйте вручную.')
    setTimeout(() => setCopyStatus(null), 2000)
  }

  const handleDeleteAllLogs = async () => {
    try {
      setLoading(true)
      setError(null)
      const response = await axios.delete(`${API_BASE_URL}/logs`)
      if (response.data.success) {
        setDeleteStatus(`Успешно удалено ${response.data.deletedCount} записей`)
        setLogs([])
        setAvailableClasses([])
        setLastUpdateTime(new Date())
        if (showStats) setTimeout(() => { fetchLogs() }, 100)
      } else setError('Ошибка при удалении логов')
    } catch (err) {
      setError('Ошибка при удалении логов: ' + (err.response?.data?.message || err.message))
    } finally {
      setLoading(false)
      setShowDeleteConfirm(false)
      setTimeout(() => setDeleteStatus(null), 3000)
    }
  }

  useEffect(() => { fetchLogs(); fetchAvailableClasses() }, [])
  useEffect(() => {
    let interval
    if (autoRefresh) interval = setInterval(() => { fetchLogs() }, refreshInterval * 1000)
    return () => { if (interval) clearInterval(interval) }
  }, [autoRefresh, refreshInterval, filters])

  return (
    <div className="container">
      <div className="header">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
          <h1 style={{ margin: 0 }}>Просмотр логов</h1>
          <button className="btn btn-secondary" onClick={toggleTheme}>
            {theme === 'dark' ? '☀️ Светлая' : '🌙 Темная'}
          </button>
        </div>
        <div className="filters">
          <div className="filter-group">
            <label htmlFor="startDate">Дата начала:</label>
            <input id="startDate" type="datetime-local" value={filters.startDate} onChange={(e) => handleFilterChange('startDate', e.target.value)} />
          </div>
          <div className="filter-group">
            <label htmlFor="endDate">Дата окончания:</label>
            <input id="endDate" type="datetime-local" value={filters.endDate} onChange={(e) => handleFilterChange('endDate', e.target.value)} />
          </div>
          <div className="filter-group">
            <label htmlFor="minLevel">Минимальный уровень:</label>
            <select id="minLevel" value={filters.minLevel} onChange={(e) => handleFilterChange('minLevel', e.target.value)}>
              <option value="">Все уровни</option>
              <option value={LogLevel.Info}>Info и выше</option>
              <option value={LogLevel.Warning}>Warning и выше</option>
              <option value={LogLevel.Error}>Error и выше</option>
              <option value={LogLevel.FatalError}>Только Fatal Error</option>
            </select>
          </div>
          <div className="filter-group">
            <label htmlFor="messageSearch">Поиск в сообщении:</label>
            <input id="messageSearch" type="text" placeholder="Введите текст для поиска" value={filters.messageSearch} onChange={(e) => handleFilterChange('messageSearch', e.target.value)} />
          </div>
          <div className="filter-group">
            <label htmlFor="limit">Лимит записей:</label>
            <select id="limit" value={filters.limit} onChange={(e) => handleFilterChange('limit', parseInt(e.target.value))}>
              <option value={100}>100</option>
              <option value={500}>500</option>
              <option value={1000}>1000</option>
              <option value={5000}>5000</option>
            </select>
          </div>
        </div>

        <div className="classes-filter-section">
          <div className="classes-header">
            <label>📁 Классы:</label>
            <div className="classes-controls">
              <button 
                className="btn-toggle-all" 
                onClick={handleToggleAllClasses}
                type="button"
              >
                {filters.selectedClasses.length === availableClasses.length ? 'Снять все' : 'Выбрать все'}
              </button>
              <span className="selected-count">
                Выбрано: {filters.selectedClasses.length} из {availableClasses.length}
              </span>
            </div>
          </div>
          <div className="classes-checkboxes">
            {availableClasses.map(className => (
              <label key={className} className="class-checkbox-label">
                <input
                  type="checkbox"
                  checked={filters.selectedClasses.includes(className)}
                  onChange={() => handleClassToggle(className)}
                />
                <span className="class-name-text">{className}</span>
              </label>
            ))}
          </div>
        </div>

        <div className="checkboxes-section">
          <div className="checkbox-group">
            <label style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
              <input type="checkbox" checked={filters.currentSessionOnly} onChange={(e) => handleFilterChange('currentSessionOnly', e.target.checked)} />
              Только текущая сессия
            </label>
          </div>
          <div className="checkbox-group">
            <label style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
              <input type="checkbox" checked={autoRefresh} onChange={(e) => setAutoRefresh(e.target.checked)} />
              Автообновление
            </label>
            {autoRefresh && (
              <select value={refreshInterval} onChange={(e) => setRefreshInterval(parseInt(e.target.value))} style={{ padding: '5px', marginTop: '5px' }}>
                <option value={10}>10 сек</option>
                <option value={30}>30 сек</option>
                <option value={60}>1 мин</option>
                <option value={300}>5 мин</option>
              </select>
            )}
          </div>
        </div>

        <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
          <button className="btn btn-primary" onClick={fetchLogs} disabled={loading}>{loading ? 'Загрузка...' : 'Обновить'}</button>
          <button className="btn btn-secondary" onClick={clearFilters}>Очистить фильтры</button>
          <button className="btn btn-secondary" onClick={handleCopyVisibleLogs} disabled={logs.length === 0}>Скопировать видимые логи</button>
          {copyStatus && (<span style={{ color: '#6c757d', fontSize: '12px' }}>{copyStatus}</span>)}
          <button className="btn btn-danger" onClick={() => setShowDeleteConfirm(true)} disabled={loading} style={{ backgroundColor: '#dc3545', borderColor: '#dc3545' }}>Удалить все логи</button>
          {deleteStatus && (<span style={{ color: '#28a745', fontSize: '12px' }}>{deleteStatus}</span>)}
          <button className={`btn ${showStats ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setShowStats(!showStats)}>{showStats ? 'Скрыть статистику' : 'Показать статистику'}</button>
        </div>
      </div>

      {error && (<div className="error">{error}</div>)}

      {showDeleteConfirm && (
        <div className="modal-overlay" onClick={() => setShowDeleteConfirm(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <h3>⚠️ Подтверждение удаления</h3>
            <p>Вы уверены, что хотите удалить <strong>ВСЕ</strong> логи из базы данных?</p>
            <p style={{ color: '#dc3545', fontWeight: 'bold' }}>Это действие нельзя отменить!</p>
            <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end', marginTop: '20px' }}>
              <button className="btn btn-secondary" onClick={() => setShowDeleteConfirm(false)} disabled={loading}>Отмена</button>
              <button className="btn btn-danger" onClick={handleDeleteAllLogs} disabled={loading} style={{ backgroundColor: '#dc3545', borderColor: '#dc3545' }}>{loading ? 'Удаление...' : 'Да, удалить все'}</button>
            </div>
          </div>
        </div>
      )}

      {showStats && (<LogStats filters={filters} apiBaseUrl={API_BASE_URL} />)}

      <div className="logs-container">
        <div className="logs-header">
          <h3>Логи</h3>
          <div className="logs-count">
            Найдено записей: {logs.length}
            {totalCount != null && totalCount !== logs.length && (
              <span style={{ marginLeft: '10px', color: '#6c757d', fontSize: '12px' }}>из {totalCount}{hasMore ? '+' : ''}</span>
            )}
            {filters.minLevel !== '' && (<span style={{ marginLeft: '15px', color: '#ff9800', fontSize: '12px' }}>📊 Фильтр: {LogLevelLabels[filters.minLevel]} и выше</span>)}
            {filters.currentSessionOnly && (<span style={{ marginLeft: '15px', color: '#28a745', fontSize: '12px' }}>🚀 Только текущая сессия</span>)}
            {filters.messageSearch && searchMatches > 0 && (<span style={{ marginLeft: '15px', color: '#ff9800', fontSize: '12px' }}>🔍 Совпадений по поиску: {searchMatches}</span>)}
            {autoRefresh && (<span style={{ marginLeft: '15px', color: '#28a745', fontSize: '12px' }}>🔄 Автообновление каждые {refreshInterval} сек</span>)}
            {lastUpdateTime && (<span style={{ marginLeft: '15px', color: '#6c757d', fontSize: '12px' }}>Последнее обновление: {formatDate(lastUpdateTime.toISOString())}</span>)}
          </div>
        </div>
        <div className="logs-columns-header">
          <div className="column-header">🕒 Время</div>
          <div className="column-header">📊 Уровень</div>
          <div className="column-header">📁 Класс</div>
          <div className="column-header">⚙️ Метод</div>
          <div className="column-header">💬 Сообщение</div>
        </div>
        {loading ? (
          <div className="loading">Загрузка логов...</div>
        ) : logs.length === 0 ? (
          <div className="empty-state">
            <h3>Логи не найдены</h3>
            <p>Попробуйте изменить параметры фильтрации</p>
          </div>
        ) : (
          <div className="logs-list">
            {logs.map((log) => (
              <div key={log.id ?? `${log.date}-${log.callingClass}-${log.callingMethod}-${log.message}`} className={`log-item ${getLogItemClass(log.logLevel)}`}>
                <div className="log-date">{formatDate(log.date)}</div>
                <div className={`log-level ${getLogLevelClass(log.logLevel)}`}>{LogLevelLabels[log.logLevel]}</div>
                <div className="log-class"><span className="class-label">📁 Класс:</span><span className="class-name">{log.callingClass || 'Неизвестно'}</span></div>
                <div className="log-method"><span className="method-label">⚙️ Метод:</span><span className="method-name">{log.callingMethod || 'Неизвестно'}</span></div>
                <div className="log-message"><HighlightText text={log.message} searchTerm={filters.messageSearch} /></div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

