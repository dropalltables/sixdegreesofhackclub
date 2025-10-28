#!/usr/bin/env node
import readline from 'readline';
import { loadData } from './loader.js';
import { displayPath, displayReachable, displayStats } from './display.js';

/**
 * Interactive CLI
 */
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
        displayReachable(reachable, graph.getChannelName(fromId), maxHops, graph);
        break;
      }

      case 'stats': {
        const stats = graph.getDetailedStats();
        displayStats(stats);
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
