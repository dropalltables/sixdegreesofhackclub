import fs from 'fs/promises';
import { OUTPUT_FILE, DEBUG } from './config.js';

/**
 * Append connections to output file in batches
 */
export async function appendConnections(connections) {
  if (connections.length === 0) return;

  if (DEBUG) {
    // In debug mode, just print to stdout
    connections.forEach(conn => {
      console.log(JSON.stringify(conn));
    });
  } else {
    // Normal mode: write to file
    const lines = connections.map(conn => JSON.stringify(conn)).join('\n') + '\n';
    await fs.appendFile(OUTPUT_FILE, lines, 'utf-8');
  }
}

/**
 * Generate metadata file
 */
export async function generateMetadata(channels, startTime, outputFile) {
  const metadata = {
    workspace: 'Hack Club',
    generatedAt: new Date().toISOString(),
    totalChannels: channels.length,
    processingTimeSeconds: ((Date.now() - startTime) / 1000).toFixed(2),
    outputFile: outputFile,
    channels: {}
  };

  // Build channels object
  channels.forEach(channel => {
    metadata.channels[channel.id] = {
      id: channel.id,
      name: channel.name
    };
  });

  return metadata;
}

/**
 * Write metadata to file
 */
export async function writeMetadata(metadata, filename) {
  await fs.writeFile(
    filename,
    JSON.stringify(metadata, null, 2),
    'utf-8'
  );
}
