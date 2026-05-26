import React from 'react'

export default function HighlightText({ text, searchTerm }) {
  if (!searchTerm || !text) return <span>{text}</span>
  const regex = new RegExp(`(${searchTerm})`, 'gi')
  const parts = String(text).split(regex)
  return (
    <span>
      {parts.map((part, index) => (
        regex.test(part)
          ? <mark key={index} style={{ backgroundColor: '#ffeb3b', padding: '1px 2px', borderRadius: '2px', fontWeight: 'bold' }}>{part}</mark>
          : <span key={index}>{part}</span>
      ))}
    </span>
  )
}

