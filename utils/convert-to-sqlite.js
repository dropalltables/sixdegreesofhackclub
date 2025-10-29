#!/usr/bin/env node

import fs from 'fs';
import readline from 'readline';
import Database from 'better-sqlite3';

// Database schema:
// - channels: All channel information
// - connections: Channel-to-channel mentions with metadata
// - workspace: Workspace-level metadata

const DB_FILE = 'channel-graph.db';

async function main() {
  console.log('Creating SQLite database...');

  // Remove old database if it exists
  if (fs.existsSync(DB_FILE)) {
    fs.unlinkSync(DB_FILE);
    console.log('Removed existing database');
  }

  const db = new Database(DB_FILE);

  // Create tables
  console.log('Creating tables...');
  db.exec(`
    CREATE TABLE workspace (
      key TEXT PRIMARY KEY,
      value TEXT
    );

    CREATE TABLE channels (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      name_normalized TEXT,
      created INTEGER,
      creator TEXT,
      is_private INTEGER,
      is_archived INTEGER,
      is_general INTEGER,
      is_channel INTEGER,
      updated INTEGER,
      message_count INTEGER DEFAULT 0
    );

    CREATE INDEX idx_channel_name ON channels(name);
    CREATE INDEX idx_channel_archived ON channels(is_archived);

    CREATE TABLE connections (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      from_channel_id TEXT NOT NULL,
      to_channel_id TEXT NOT NULL,
      from_channel_name TEXT NOT NULL,
      to_channel_name TEXT NOT NULL,
      message_ts TEXT NOT NULL,
      message_date TEXT NOT NULL,
      message_link TEXT NOT NULL,
      author_user_id TEXT,
      message_text TEXT
    );

    CREATE INDEX idx_conn_from ON connections(from_channel_id);
    CREATE INDEX idx_conn_to ON connections(to_channel_id);
    CREATE INDEX idx_conn_date ON connections(message_date);
    CREATE INDEX idx_conn_author ON connections(author_user_id);
    CREATE UNIQUE INDEX idx_conn_unique ON connections(from_channel_id, to_channel_id, message_ts);
  `);

  // Load metadata
  console.log('Loading metadata...');
  if (fs.existsSync('channel-metadata.json')) {
    const metadata = JSON.parse(fs.readFileSync('channel-metadata.json', 'utf8'));
    const insertWorkspace = db.prepare('INSERT INTO workspace (key, value) VALUES (?, ?)');

    insertWorkspace.run('workspace_name', metadata.workspace);
    insertWorkspace.run('generated_at', metadata.generatedAt);
    insertWorkspace.run('total_channels', metadata.totalChannels.toString());
    insertWorkspace.run('processing_time_seconds', metadata.processingTimeSeconds);

    console.log(`Workspace: ${metadata.workspace}`);
  }

  // Load channels from cache (has more complete data)
  console.log('Loading channels...');
  let channelCount = 0;

  if (fs.existsSync('channels-cache.json')) {
    const cache = JSON.parse(fs.readFileSync('channels-cache.json', 'utf8'));

    // Load message counts from metadata if available
    let messageCountsMap = new Map();
    if (fs.existsSync('channel-metadata.json')) {
      const metadata = JSON.parse(fs.readFileSync('channel-metadata.json', 'utf8'));
      if (metadata.channels) {
        Object.values(metadata.channels).forEach(ch => {
          if (ch.messageCount !== undefined) {
            messageCountsMap.set(ch.id, ch.messageCount);
          }
        });
      }
    }

    const insertChannel = db.prepare(`
      INSERT OR IGNORE INTO channels
      (id, name, name_normalized, created, creator, is_private, is_archived, is_general, is_channel, updated, message_count)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const insertMany = db.transaction((channels) => {
      for (const channel of channels) {
        insertChannel.run(
          channel.id,
          channel.name,
          channel.name_normalized || channel.name,
          channel.created || null,
          channel.creator || null,
          channel.is_private ? 1 : 0,
          channel.is_archived ? 1 : 0,
          channel.is_general ? 1 : 0,
          channel.is_channel ? 1 : 0,
          channel.updated || null,
          messageCountsMap.get(channel.id) || 0
        );
      }
    });

    insertMany(cache.channels);
    channelCount = cache.channels.length;
    console.log(`Inserted ${channelCount} channels`);
  }

  // Fallback: load channels from metadata if cache doesn't exist
  if (channelCount === 0 && fs.existsSync('channel-metadata.json')) {
    const metadata = JSON.parse(fs.readFileSync('channel-metadata.json', 'utf8'));
    const insertChannel = db.prepare(`
      INSERT OR IGNORE INTO channels (id, name, name_normalized, message_count) VALUES (?, ?, ?, ?)
    `);

    const channels = Object.values(metadata.channels);
    const insertMany = db.transaction((channels) => {
      for (const channel of channels) {
        insertChannel.run(
          channel.id,
          channel.name,
          channel.name,
          channel.messageCount || 0
        );
      }
    });

    insertMany(channels);
    channelCount = channels.length;
    console.log(`Inserted ${channelCount} channels from metadata`);
  }

  // Load connections from JSONL
  console.log('Loading connections from JSONL...');

  const insertConnection = db.prepare(`
    INSERT OR IGNORE INTO connections
    (from_channel_id, to_channel_id, from_channel_name, to_channel_name, message_ts, message_date, message_link, author_user_id, message_text)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  let connectionCount = 0;
  let batchSize = 1000;
  let batch = [];

  const fileStream = fs.createReadStream('channel-links.jsonl');
  const rl = readline.createInterface({
    input: fileStream,
    crlfDelay: Infinity
  });

  const insertBatch = db.transaction((connections) => {
    for (const conn of connections) {
      insertConnection.run(
        conn.from,
        conn.to,
        conn.fromName,
        conn.toName,
        conn.messageTs,
        conn.messageDate,
        conn.messageLink,
        conn.authorUserId || null,
        conn.messageText || null
      );
    }
  });

  for await (const line of rl) {
    if (line.trim()) {
      const connection = JSON.parse(line);
      batch.push(connection);

      if (batch.length >= batchSize) {
        insertBatch(batch);
        connectionCount += batch.length;
        batch = [];
        process.stdout.write(`\rProcessed ${connectionCount} connections...`);
      }
    }
  }

  // Insert remaining batch
  if (batch.length > 0) {
    insertBatch(batch);
    connectionCount += batch.length;
  }

  console.log(`\nInserted ${connectionCount} connections`);

  // Create some useful views
  console.log('Creating views...');
  db.exec(`
    -- View: Channel statistics
    CREATE VIEW channel_stats AS
    SELECT
      c.id,
      c.name,
      c.is_archived,
      c.message_count,
      COUNT(DISTINCT conn_out.to_channel_id) as outgoing_connections,
      COUNT(DISTINCT conn_in.from_channel_id) as incoming_connections,
      COUNT(DISTINCT conn_out.to_channel_id) + COUNT(DISTINCT conn_in.from_channel_id) as total_connections
    FROM channels c
    LEFT JOIN connections conn_out ON c.id = conn_out.from_channel_id
    LEFT JOIN connections conn_in ON c.id = conn_in.to_channel_id
    GROUP BY c.id, c.name, c.is_archived, c.message_count;

    -- View: Most connected channels
    CREATE VIEW most_connected_channels AS
    SELECT * FROM channel_stats
    ORDER BY total_connections DESC;

    -- View: Connection details with channel info
    CREATE VIEW connection_details AS
    SELECT
      conn.id,
      conn.from_channel_id,
      conn.from_channel_name,
      from_ch.is_archived as from_archived,
      conn.to_channel_id,
      conn.to_channel_name,
      to_ch.is_archived as to_archived,
      conn.message_date,
      conn.message_link,
      conn.author_user_id,
      conn.message_text
    FROM connections conn
    LEFT JOIN channels from_ch ON conn.from_channel_id = from_ch.id
    LEFT JOIN channels to_ch ON conn.to_channel_id = to_ch.id;
  `);

  // Print summary statistics
  console.log('\n=== Database Summary ===');
  const stats = db.prepare('SELECT COUNT(*) as count FROM channels').get();
  console.log(`Total channels: ${stats.count}`);

  const connStats = db.prepare('SELECT COUNT(*) as count FROM connections').get();
  console.log(`Total connections: ${connStats.count}`);

  const activeChannels = db.prepare('SELECT COUNT(*) as count FROM channels WHERE is_archived = 0').get();
  console.log(`Active channels: ${activeChannels.count}`);

  const archivedChannels = db.prepare('SELECT COUNT(*) as count FROM channels WHERE is_archived = 1').get();
  console.log(`Archived channels: ${archivedChannels.count}`);

  console.log('\n=== Top 10 Most Connected Channels ===');
  const topChannels = db.prepare(`
    SELECT name, total_connections, outgoing_connections, incoming_connections, message_count, is_archived
    FROM most_connected_channels
    LIMIT 10
  `).all();

  topChannels.forEach((ch, i) => {
    const archived = ch.is_archived ? ' [ARCHIVED]' : '';
    const msgCount = ch.message_count > 0 ? ` | ${ch.message_count.toLocaleString()} msgs` : '';
    console.log(`${i + 1}. ${ch.name}${archived}: ${ch.total_connections} total (${ch.outgoing_connections} out, ${ch.incoming_connections} in)${msgCount}`);
  });

  db.close();
  console.log(`\n✓ Database created successfully: ${DB_FILE}`);
  console.log('\nExample queries to try:');
  console.log('  sqlite3 channel-graph.db "SELECT * FROM most_connected_channels LIMIT 10"');
  console.log('  sqlite3 channel-graph.db "SELECT * FROM channels WHERE name LIKE \'%hack%\'"');
  console.log('  sqlite3 channel-graph.db "SELECT * FROM connections WHERE from_channel_name = \'announcements\' LIMIT 10"');
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
