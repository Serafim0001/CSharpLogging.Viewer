import React, { useState, useEffect } from 'react'
import axios from 'axios'

const LogLevelLabels = { 0: 'Info', 1: 'Warning', 2: 'Error', 3: 'Fatal Error' }
const LogLevelColors = { 0: '#d1ecf1', 1: '#fff3cd', 2: '#f8d7da', 3: '#f5c6cb' }

export default function LogStats({ filters, apiBaseUrl = `${window.location.origin}/api` }) {
  const [stats, setStats] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  const fetchStats = async () => {
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams()
      if (filters.startDate) params.append('startDate', new Date(filters.startDate).toISOString())
      if (filters.endDate) params.append('endDate', new Date(filters.endDate).toISOString())
      const response = await axios.get(`${apiBaseUrl}/logs/stats?${params.toString()}`)
      setStats(response.data)
    } catch (err) {
      setError('Ошибка при загрузке статистики: ' + (err.response?.data?.message || err.message))
    } finally { setLoading(false) }
  }

  useEffect(() => { fetchStats() }, [filters.startDate, filters.endDate])

  if (loading) return <div className="loading">Загрузка статистики...</div>
  if (error) return <div className="error">{error}</div>

  const statsByLevel = stats.reduce((acc, stat) => {
    const level = stat.logLevel ?? stat.loglevel
    if (!acc[level]) acc[level] = { level, total: 0, classes: [] }
    acc[level].total += parseInt(stat.count)
    acc[level].classes.push({ className: stat.callingClass ?? stat.callingclass, count: parseInt(stat.count) })
    return acc
  }, {})

  return (
    <div className="stats-container">
      <h3>Статистика логов</h3>
      <div className="stats-grid">
        {Object.values(statsByLevel).map(levelStats => (
          <div key={levelStats.level} className="stat-card">
            <div className="stat-header" style={{ backgroundColor: LogLevelColors[levelStats.level] }}>
              <h4>{LogLevelLabels[levelStats.level]}</h4>
              <span className="stat-count">{levelStats.total}</span>
            </div>
            <div className="stat-details">
              {levelStats.classes.slice(0, 5).map(classStat => (
                <div key={classStat.className} className="stat-class">
                  <span className="class-name">{classStat.className}</span>
                  <span className="class-count">{classStat.count}</span>
                </div>
              ))}
              {levelStats.classes.length > 5 && (
                <div className="stat-class">
                  <span className="class-name">...</span>
                  <span className="class-count">+{levelStats.classes.length - 5}</span>
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

