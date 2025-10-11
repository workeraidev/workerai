-- Database Schema for Cloudflare Worker AI Agent
-- File: schema.sql

-- Users table for authentication
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  password TEXT NOT NULL,
  name TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER DEFAULT (strftime('%s', 'now')),
  settings TEXT DEFAULT '{}',
  avatar_url TEXT,
  last_login INTEGER
);

CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_created_at ON users(created_at);

-- Chat sessions metadata
CREATE TABLE IF NOT EXISTS chat_sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  title TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER DEFAULT (strftime('%s', 'now')),
  model TEXT DEFAULT '@cf/meta/llama-3.1-8b-instruct',
  message_count INTEGER DEFAULT 0,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX idx_sessions_user ON chat_sessions(user_id);
CREATE INDEX idx_sessions_created ON chat_sessions(created_at);

-- API keys for external services
CREATE TABLE IF NOT EXISTS api_keys (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  service TEXT NOT NULL,
  key_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  last_used INTEGER,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX idx_api_keys_user ON api_keys(user_id);

-- Code snippets and templates
CREATE TABLE IF NOT EXISTS code_snippets (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  code TEXT NOT NULL,
  language TEXT NOT NULL,
  tags TEXT, -- JSON array
  created_at INTEGER NOT NULL,
  updated_at INTEGER DEFAULT (strftime('%s', 'now')),
  is_public INTEGER DEFAULT 0,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX idx_snippets_user ON code_snippets(user_id);
CREATE INDEX idx_snippets_language ON code_snippets(language);

-- Workflow executions
CREATE TABLE IF NOT EXISTS workflow_executions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  workflow_type TEXT NOT NULL,
  status TEXT NOT NULL, -- pending, running, completed, failed
  input TEXT, -- JSON
  output TEXT, -- JSON
  error TEXT,
  started_at INTEGER NOT NULL,
  completed_at INTEGER,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX idx_workflows_user ON workflow_executions(user_id);
CREATE INDEX idx_workflows_status ON workflow_executions(status);

-- Usage tracking
CREATE TABLE IF NOT EXISTS usage_logs (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  action TEXT NOT NULL,
  resource TEXT,
  tokens_used INTEGER DEFAULT 0,
  cost REAL DEFAULT 0.0,
  timestamp INTEGER NOT NULL,
  metadata TEXT, -- JSON
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX idx_usage_user ON usage_logs(user_id);
CREATE INDEX idx_usage_timestamp ON usage_logs(timestamp);
CREATE INDEX idx_usage_action ON usage_logs(action);
