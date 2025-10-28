import { WebClient } from '@slack/web-api';
import { SocketModeClient } from '@slack/socket-mode';
import {
  SLACK_BOT_TOKEN,
  SLACK_APP_TOKEN,
  DEBUG,
  OUTPUT_FILE,
  METADATA_FILE,
  DELAY_BETWEEN_CHANNELS
} from './config.js';
import { loadCheckpoint, saveCheckpoint, clearCheckpoint } from './checkpoint.js';
import { getAllChannels, buildChannelNameMap } from './channels.js';
import { scanChannelMessages } from './scanner.js';
import { generateMetadata, writeMetadata } from './output.js';

const webClient = new WebClient(SLACK_BOT_TOKEN);
const socketModeClient = new SocketModeClient({
  appToken: SLACK_APP_TOKEN,
});

/**
 * Main function to map all channel connections
 */
async function mapChannelConnections() {
  console.log('[START] Six Degrees of Hack Club mapper');
  console.log('=' .repeat(60));

  const startTime = Date.now();

  // Load checkpoint to resume if needed
  const checkpoint = await loadCheckpoint();

  // Step 1: Get all channels
  const channels = await getAllChannels(webClient);

  // Build channel name mapping
  const channelNames = buildChannelNameMap(channels);

  console.log('=' .repeat(60));
  console.log('[INFO] Starting message scan\n');

  // Step 2: Scan each channel for links
  let startIndex = checkpoint.lastChannelIndex + 1;
  if (startIndex > 0) {
    console.log(`[INFO] Resuming from channel index ${startIndex}`);
  }

  for (let i = startIndex; i < channels.length; i++) {
    const channel = channels[i];
    console.log(`[${i + 1}/${channels.length}]`);

    await scanChannelMessages(webClient, channel.id, channel.name, i, channelNames);

    // Save checkpoint after each channel
    await saveCheckpoint(i, channel.id, 0);

    console.log(''); // Empty line for readability

    // Rate limiting: pause between channels to be respectful
    await new Promise(resolve => setTimeout(resolve, DELAY_BETWEEN_CHANNELS));
  }

  // Step 3: Generate metadata file (skip in debug mode)
  if (!DEBUG) {
    console.log('=' .repeat(60));
    console.log('[INFO] Generating metadata file');

    const metadata = await generateMetadata(channels, startTime, OUTPUT_FILE);
    await writeMetadata(metadata, METADATA_FILE);

    console.log('[SUCCESS] Output saved to ' + OUTPUT_FILE);
    console.log('[SUCCESS] Metadata saved to ' + METADATA_FILE);
    console.log('\n[STATS] Summary:');
    console.log(`  Total channels: ${channels.length}`);
    console.log(`  Processing time: ${metadata.processingTimeSeconds}s`);
    console.log('\n[DONE] Mapping complete\n');
    console.log('[INFO] Cleaning up checkpoint file...');

    // Delete checkpoint file on successful completion
    await clearCheckpoint();
  } else {
    console.log('\n[DEBUG] Debug mode complete - no files written');
    console.log(`[DEBUG] Total channels scanned: ${channels.length}`);
    console.log(`[DEBUG] Processing time: ${((Date.now() - startTime) / 1000).toFixed(2)}s`);
  }
}

/**
 * Start the bot
 */
async function start() {
  try {
    // Connect to Slack via WebSocket
    console.log('[INFO] Connecting to Slack via WebSocket...');
    await socketModeClient.start();
    console.log('[SUCCESS] Connected to Slack\n');

    // Run the mapping
    await mapChannelConnections();

    // Disconnect
    console.log('[INFO] Disconnecting from Slack...');
    await socketModeClient.disconnect();
    process.exit(0);
  } catch (error) {
    console.error('[FATAL] Error:', error);
    process.exit(1);
  }
}

start();
