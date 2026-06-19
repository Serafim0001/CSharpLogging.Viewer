import React, { useState, useEffect } from 'react'
import axios from 'axios'

const LogLevelLabels = { 0: 'Info', 1: 'Warning', 2: 'Error', 3: 'Fatal Error' }
const LogLevelColors = { 0: '#d1ecf1', 1: '#fff3cd', 2: '#f8d7da', 3: '#f5c6cb' }

export default function LogStats({ filters, apiBaseUrl = `${window.location.origin}/api` }) {
  const [summary, setSummary] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  const fetchStats = async () => {
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams()
      if (filters.startDate) params.append('startDate', new Date(filters.startDate).toISOString())
      if (filters.endDate) params.append('endDate', new Date(filters.endDate).toISOString())
      if (filters.selectedClasses?.length) {
        filters.selectedClasses.forEach(cls => params.append('className', cls))
      }
      const response = await axios.get(`${apiBaseUrl}/logs/summary?${params.toString()}`)
      setSummary(response.data)
    } catch (err) {
      setError('Ошибка при загрузке статистики: ' + (err.response?.data?.message || err.message))
    } finally { setLoading(false) }
  }

  useEffect(() => { fetchStats() }, [filters.startDate, filters.endDate, filters.selectedClasses])

  if (loading) return <div className="loading">Загрузка статистики...</div>
  if (error) return <div className="error">{error}</div>
  if (!summary) return null

  const levelCards = [
    { level: 0, count: summary.infoCount },
    { level: 1, count: summary.warningCount },
    { level: 2, count: summary.errorCount },
    { level: 3, count: summary.fatalCount }
  ].filter(x => x.count > 0)

  const classesByLevel = summary.topClasses.reduce((acc, row) => {
    const add = (level, count) => {
      if (!count) return
      if (!acc[level]) acc[level] = []
      acc[level].push({ className: row.callingClass, count })
    }
    add(1, row.warningCount)
    add(2, row.errorCount)
    add(3, row.fatalCount)
    return acc
  }, {})

  return (
    <div className="stats-container">
      <h3>Статистика логов (всего: {summary.totalCount})</h3>
      <div className="stats-grid">
        {levelCards.map(({ level, count }) => (
          <div key={level} className="stat-card">
            <div className="stat-header" style={{ backgroundColor: LogLevelColors[level] }}>
              <h4>{LogLevelLabels[level]}</h4>
              <span className="stat-count">{count}</span>
            </div>
            <div className="stat-details">
              {(classesByLevel[level] || []).slice(0, 5).map(classStat => (
                <div key={`${level}-${classStat.className}`} className="stat-class">
                  <span className="class-name">{classStat.className}</span>
                  <span className="class-count">{classStat.count}</span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
