import fs from 'fs/promises';
import { ChannelGraph } from './graph.js';

/**
 * Load JSONL data into graph structure
 */
export async function loadData(filename = 'channel-links.jsonl') {
  console.log(`[INFO] Loading data from ${filename}...`);
  const graph = new ChannelGraph();

  try {
    const data = await fs.readFile(filename, 'utf-8');
    const lines = data.trim().split('\n');

    for (const line of lines) {
      if (!line.trim()) continue;
      const conn = JSON.parse(line);
      graph.addConnection(
        conn.from,
        conn.to,
        conn.fromName,
        conn.toName,
        conn.messageLink,
        conn.messageDate
      );
    }

    console.log(`[SUCCESS] Loaded ${graph.getTotalChannels()} channels with ${graph.getTotalConnections()} connections\n`);
    return graph;
  } catch (error) {
    console.error(`[ERROR] Failed to load data: ${error.message}`);
    process.exit(1);
  }
}
