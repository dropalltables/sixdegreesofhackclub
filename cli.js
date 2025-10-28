#!/usr/bin/env node
import fs from 'fs/promises';
import readline from 'readline';

// Graph structure to store channel connections
class ChannelGraph {
  constructor() {
    this.channels = new Map(); // channelId -> {name, connections: [{to, messageLink, messageDate}]}
    this.nameToId = new Map(); // channelName -> channelId
  }

  addConnection(from, to, fromName, toName, messageLink, messageDate) {
    // Add channel if not exists
    if (!this.channels.has(from)) {
      this.channels.set(from, { name: fromName, connections: [] });
      this.nameToId.set(fromName.toLowerCase(), from);
    }
    if (!this.channels.has(to)) {
      this.channels.set(to, { name: toName, connections: [] });
      this.nameToId.set(toName.toLowerCase(), to);
    }

    // Add connection
    this.channels.get(from).connections.push({
      to,
      messageLink,
      messageDate
    });
  }

  getChannelId(nameOrId) {
    // Try as ID first
    if (this.channels.has(nameOrId)) {
      return nameOrId;
    }
    // Try as name
    return this.nameToId.get(nameOrId.toLowerCase());
  }

  getChannelName(id) {
    return this.channels.get(id)?.name || id;
  }

  // BFS to find shortest path
  findPath(startId, endId, maxHops = Infinity) {
    if (startId === endId) {
      return { path: [startId], links: [] };
    }

    const queue = [[startId]];
    const visited = new Set([startId]);

    while (queue.length > 0) {
      const path = queue.shift();
      const current = path[path.length - 1];

      // Check if we've exceeded max hops
      if (path.length > maxHops) {
        continue;
      }

      const channelData = this.channels.get(current);
      if (!channelData) continue;

      for (const connection of channelData.connections) {
        if (connection.to === endId) {
          // Found the destination
          const fullPath = [...path, endId];
          const links = this.buildLinks(fullPath);
          return { path: fullPath, links };
        }

        if (!visited.has(connection.to)) {
          visited.add(connection.to);
          queue.push([...path, connection.to]);
        }
      }
    }

    return null; // No path found
  }

  // Find all paths within X hops
  findAllPathsWithinHops(startId, maxHops) {
    const reachable = new Map(); // channelId -> {path, links}
    const queue = [[startId]];
    const visited = new Set([startId]);

    while (queue.length > 0) {
      const path = queue.shift();
      const current = path[path.length - 1];

      if (path.length > maxHops + 1) {
        continue;
      }

      const channelData = this.channels.get(current);
      if (!channelData) continue;

      for (const connection of channelData.connections) {
        if (!visited.has(connection.to)) {
          visited.add(connection.to);
          const newPath = [...path, connection.to];
          queue.push(newPath);

          const links = this.buildLinks(newPath);
          reachable.set(connection.to, { path: newPath, links });
        }
      }
    }

    return reachable;
  }

  // Build link information for a path
  buildLinks(path) {
    const links = [];
    for (let i = 0; i < path.length - 1; i++) {
      const from = path[i];
      const to = path[i + 1];
      const channelData = this.channels.get(from);
      const connection = channelData?.connections.find(c => c.to === to);

      if (connection) {
        links.push({
          from: this.getChannelName(from),
          to: this.getChannelName(to),
          messageLink: connection.messageLink,
          messageDate: connection.messageDate
        });
      }
    }
    return links;
  }

  getTotalChannels() {
    return this.channels.size;
  }

  getTotalConnections() {
    let total = 0;
    for (const channel of this.channels.values()) {
      total += channel.connections.length;
    }
    return total;
  }
}

// Load JSONL data
async function loadData(filename = 'channel-links.jsonl') {
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

// Display path with links
function displayPath(result, startName, endName) {
  if (!result) {
    console.log(`\n[NOT FOUND] No path exists from #${startName} to #${endName}\n`);
    return;
  }

  const { path, links } = result;
  console.log(`\n[PATH FOUND] ${path.length - 1} hop(s) from #${startName} to #${endName}:\n`);

  for (let i = 0; i < links.length; i++) {
    const link = links[i];
    console.log(`  ${i + 1}. #${link.from} → #${link.to}`);
    console.log(`     ${link.messageLink}`);
    console.log(`     ${link.messageDate}\n`);
  }
}

// Display reachable channels
function displayReachable(reachable, startName, maxHops) {
  if (reachable.size === 0) {
    console.log(`\n[INFO] No channels reachable within ${maxHops} hop(s) from #${startName}\n`);
    return;
  }

  console.log(`\n[REACHABLE] ${reachable.size} channel(s) within ${maxHops} hop(s) from #${startName}:\n`);

  // Group by number of hops
  const byHops = new Map();
  for (const [channelId, { path, links }] of reachable.entries()) {
    const hops = path.length - 1;
    if (!byHops.has(hops)) {
      byHops.set(hops, []);
    }
    byHops.get(hops).push({ channelId, path, links });
  }

  // Display grouped
  for (const [hops, channels] of Array.from(byHops.entries()).sort((a, b) => a[0] - b[0])) {
    console.log(`${hops} hop(s): ${channels.length} channel(s)`);
    for (const { path, links } of channels.slice(0, 5)) { // Show first 5
      const channelName = path[path.length - 1];
      console.log(`  - #${graph.getChannelName(channelName)}`);
    }
    if (channels.length > 5) {
      console.log(`  ... and ${channels.length - 5} more`);
    }
    console.log();
  }
}

// Interactive CLI
async function startCLI(graph) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: 'sixdegrees> '
  });

  console.log('='.repeat(60));
  console.log('Six Degrees of Hack Club - Channel Hopper');
  console.log('='.repeat(60));
  console.log('\nCommands:');
  console.log('  path <from> <to>          - Find path between two channels');
  console.log('  hops <from> <max>         - Show all channels within X hops');
  console.log('  stats                     - Show graph statistics');
  console.log('  help                      - Show this help');
  console.log('  exit                      - Exit the CLI');
  console.log('\nExample: path lounge announcements');
  console.log('Example: hops lounge 3\n');

  rl.prompt();

  rl.on('line', (input) => {
    const parts = input.trim().split(/\s+/);
    const command = parts[0]?.toLowerCase();

    switch (command) {
      case 'path': {
        if (parts.length < 3) {
          console.log('[ERROR] Usage: path <from> <to>');
          break;
        }

        const fromName = parts[1];
        const toName = parts[2];

        const fromId = graph.getChannelId(fromName);
        const toId = graph.getChannelId(toName);

        if (!fromId) {
          console.log(`[ERROR] Channel not found: ${fromName}`);
          break;
        }
        if (!toId) {
          console.log(`[ERROR] Channel not found: ${toName}`);
          break;
        }

        const result = graph.findPath(fromId, toId);
        displayPath(result, graph.getChannelName(fromId), graph.getChannelName(toId));
        break;
      }

      case 'hops': {
        if (parts.length < 3) {
          console.log('[ERROR] Usage: hops <from> <max>');
          break;
        }

        const fromName = parts[1];
        const maxHops = parseInt(parts[2]);

        if (isNaN(maxHops) || maxHops < 1) {
          console.log('[ERROR] Max hops must be a positive number');
          break;
        }

        const fromId = graph.getChannelId(fromName);
        if (!fromId) {
          console.log(`[ERROR] Channel not found: ${fromName}`);
          break;
        }

        const reachable = graph.findAllPathsWithinHops(fromId, maxHops);
        displayReachable(reachable, graph.getChannelName(fromId), maxHops);
        break;
      }

      case 'stats': {
        console.log('\n[STATS] Graph Statistics:');
        console.log(`  Total channels: ${graph.getTotalChannels()}`);
        console.log(`  Total connections: ${graph.getTotalConnections()}\n`);
        break;
      }

      case 'help': {
        console.log('\nCommands:');
        console.log('  path <from> <to>          - Find path between two channels');
        console.log('  hops <from> <max>         - Show all channels within X hops');
        console.log('  stats                     - Show graph statistics');
        console.log('  help                      - Show this help');
        console.log('  exit                      - Exit the CLI\n');
        break;
      }

      case 'exit':
      case 'quit':
        console.log('\nGoodbye!\n');
        rl.close();
        process.exit(0);
        return;

      case '':
        break;

      default:
        console.log(`[ERROR] Unknown command: ${command}`);
        console.log('Type "help" for available commands');
    }

    rl.prompt();
  });

  rl.on('close', () => {
    console.log('\nGoodbye!\n');
    process.exit(0);
  });
}

// Main
const graph = await loadData();
await startCLI(graph);
