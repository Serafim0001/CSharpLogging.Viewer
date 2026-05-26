-- Script to apply missing indexes to existing LogViewer database
-- Run this on the server to improve performance without rebuilding the container

\c logs;

-- Create missing indexes for Logs table
CREATE INDEX IF NOT EXISTS idx_logs_callingclass ON Logs(CallingClass);
CREATE INDEX IF NOT EXISTS idx_logs_loglevel ON Logs(LogLevel);

-- Create index for session filtering
CREATE INDEX IF NOT EXISTS idx_logs_sessionid ON Logs(SessionId);

-- Enable pg_trgm extension for ILIKE searches
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Create GIN index for ILIKE search on Message field using trigrams
CREATE INDEX IF NOT EXISTS idx_logs_message_trgm ON Logs USING GIN (Message gin_trgm_ops);

-- Analyze table to update statistics for query planner
ANALYZE Logs;

-- Show all indexes on Logs table
\di+ idx_logs*

-- Show table size and index sizes
SELECT 
    schemaname,
    tablename,
    pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) AS total_size,
    pg_size_pretty(pg_relation_size(schemaname||'.'||tablename)) AS table_size,
    pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename) - pg_relation_size(schemaname||'.'||tablename)) AS indexes_size
FROM pg_tables
WHERE tablename = 'logs';

