import { WebClient } from '@slack/web-api';
import { SocketModeClient } from '@slack/socket-mode';
import dotenv from 'dotenv';
import fs from 'fs/promises';

dotenv.config();

const webClient = new WebClient(process.env.SLACK_BOT_TOKEN);
const socketModeClient = new SocketModeClient({
  appToken: process.env.SLACK_APP_TOKEN,
});

// Map to store channel names for reference
const channelNames = new Map();

// Regex to match channel mentions like #channel-name or <#CHANNEL_ID>
// Matches: <#C123456>, <#C123456|channel-name>, <#C123456|>
const CHANNEL_MENTION_REGEX = /<#([A-Z0-9]+)(?:\|[^>]*)?>/g;

// Debug mode
const DEBUG = process.env.DEBUG === 'true';
const CLEAR_CHANNEL_CACHE = process.env.CLEAR_CHANNEL_CACHE === 'true';

// File paths
const OUTPUT_FILE = 'channel-links.jsonl';
const CHECKPOINT_FILE = 'checkpoint.json';
const CHANNELS_CACHE_FILE = 'channels-cache.json';

/**
 * Load checkpoint to resume from previous run
 */
async function loadCheckpoint() {
  if (DEBUG) {
    console.log('[DEBUG] Debug mode - skipping checkpoint loading');
    return { lastChannelIndex: -1, processedChannels: [] };
  }

  try {
    const data = await fs.readFile(CHECKPOINT_FILE, 'utf-8');
    const checkpoint = JSON.parse(data);
    console.log('[INFO] Loaded checkpoint, resuming from channel index:', checkpoint.lastChannelIndex);
    return checkpoint;
  } catch (error) {
    console.log('[INFO] No checkpoint found, starting fresh');
    return { lastChannelIndex: -1, processedChannels: [] };
  }
}

/**
 * Save checkpoint
 */
async function saveCheckpoint(channelIndex, channelId, messageCount) {
  if (DEBUG) return; // Skip checkpoints in debug mode

  const checkpoint = {
    lastChannelIndex: channelIndex,
    lastChannelId: channelId,
    lastMessageCount: messageCount,
    timestamp: new Date().toISOString()
  };
  await fs.writeFile(CHECKPOINT_FILE, JSON.stringify(checkpoint, null, 2), 'utf-8');
  console.log('[CHECKPOINT] Saved at channel index:', channelIndex);
}

/**
 * Append connections to output file in batches
 */
async function appendConnections(connections) {
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
 * Fetch all channels in the workspace
 */
async function getAllChannels() {
  // Clear cache if flag is set
  if (CLEAR_CHANNEL_CACHE) {
    console.log('[INFO] CLEAR_CHANNEL_CACHE flag set, deleting cache...');
    try {
      await fs.unlink(CHANNELS_CACHE_FILE);
      console.log('[INFO] Channel cache cleared');
    } catch (error) {
      // Ignore if file doesn't exist
    }
  }

  // Try to load from cache first
  if (!CLEAR_CHANNEL_CACHE) {
    try {
      const cacheData = await fs.readFile(CHANNELS_CACHE_FILE, 'utf-8');
      const cache = JSON.parse(cacheData);
      console.log(`[INFO] Loaded ${cache.channels.length} channels from cache (cached at ${cache.cachedAt})`);
      return cache.channels;
    } catch (error) {
      console.log('[INFO] No channel cache found, fetching from API...');
    }
  }

  // Fetch from API
  console.log('[INFO] Fetching all channels...');
  const allChannels = [];
  let cursor = undefined;

  try {
    do {
      const result = await webClient.conversations.list({
        types: 'public_channel,private_channel',
        exclude_archived: true,
        limit: 1000,
        cursor: cursor
      });

      allChannels.push(...result.channels);
      cursor = result.response_metadata?.next_cursor;

      console.log(`[INFO] Found ${allChannels.length} channels`);
    } while (cursor);

    console.log(`[SUCCESS] Total channels found: ${allChannels.length}\n`);

    // Cache the results
    const cache = {
      cachedAt: new Date().toISOString(),
      totalChannels: allChannels.length,
      channels: allChannels
    };
    await fs.writeFile(CHANNELS_CACHE_FILE, JSON.stringify(cache, null, 2), 'utf-8');
    console.log(`[INFO] Channels cached to ${CHANNELS_CACHE_FILE}\n`);

    return allChannels;
  } catch (error) {
    console.error('[ERROR] Failed to fetch channels:', error);
    throw error;
  }
}

/**
 * Scan messages in a channel for channel mentions
 */
async function scanChannelMessages(channelId, channelName, channelIndex) {
  console.log(`[SCAN] #${channelName} (${channelId})`);

  const seenLinks = new Set(); // Track which links we've already found (to avoid duplicates)
  const pendingWrites = []; // Buffer for batched writes
  let cursor = undefined;
  let messageCount = 0;
  let batchCount = 0;
  let totalLinksFound = 0;
  let oldestMessageTs = null;
  let oldestMessageText = null;

  try {
    do {
      const result = await webClient.conversations.history({
        channel: channelId,
        limit: 1000,
        cursor: cursor
        // Don't use 'oldest' parameter - it filters messages, we want ALL messages
        // The API returns newest first and paginates backwards automatically
      });

      batchCount++;

      // Debug: log message date range in this batch
      if (DEBUG && result.messages.length > 0) {
        const oldestMsg = result.messages[result.messages.length - 1];
        const newestMsg = result.messages[0];
        const oldestDate = new Date(parseFloat(oldestMsg.ts) * 1000).toISOString();
        const newestDate = new Date(parseFloat(newestMsg.ts) * 1000).toISOString();
        console.log(`[DEBUG] Batch ${batchCount}: ${result.messages.length} messages, date range: ${oldestDate} to ${newestDate}`);

        // Track the oldest message seen so far
        if (!oldestMessageTs || parseFloat(oldestMsg.ts) < parseFloat(oldestMessageTs)) {
          oldestMessageTs = oldestMsg.ts;
          oldestMessageText = oldestMsg.text || '[no text]';
        }
      }

      // Track newest message timestamp for the first batch
      if (batchCount === 1 && result.messages.length > 0) {
        const newestMsg = result.messages[0];
        const newestDate = new Date(parseFloat(newestMsg.ts) * 1000).toISOString();
        if (DEBUG) {
          console.log(`[DEBUG] Newest message in channel: ${newestDate}`);
        }
      }

      // Process messages in batches without storing them
      for (const message of result.messages) {
        if (message.text) {
          // Debug: log every message text in first batch to see what we're checking
          if (DEBUG && batchCount === 1 && messageCount < 5) {
            console.log(`[DEBUG] Sample message text: "${message.text.substring(0, 200).replace(/\n/g, ' ')}"`);
          }

          // Find all channel mentions in the message
          const matches = message.text.matchAll(CHANNEL_MENTION_REGEX);
          for (const match of matches) {
            const mentionedChannelId = match[1];
            if (mentionedChannelId !== channelId) { // Don't count self-references
              if (!seenLinks.has(mentionedChannelId)) {
                seenLinks.add(mentionedChannelId);

                const messageLink = `https://hackclub.slack.com/archives/${channelId}/p${message.ts.replace('.', '')}`;
                const messageDate = new Date(parseFloat(message.ts) * 1000).toISOString();
                const connection = {
                  from: channelId,
                  to: mentionedChannelId,
                  fromName: channelName,
                  toName: channelNames.get(mentionedChannelId) || mentionedChannelId,
                  messageTs: message.ts,
                  messageDate: messageDate,
                  messageLink: messageLink
                };

                pendingWrites.push(connection);
                totalLinksFound++;

                // Debug: print every link as it's found
                if (DEBUG) {
                  const targetName = channelNames.get(mentionedChannelId) || mentionedChannelId;
                  console.log(`[DEBUG] #${channelName} > #${targetName}`);
                  console.log(`[DEBUG] ${messageLink}`);
                }

                // Write to file every 5 links found
                if (pendingWrites.length >= 5) {
                  await appendConnections(pendingWrites);
                  pendingWrites.length = 0; // Clear the buffer
                }
              }
            }
          }
        }
        messageCount++;
      }

      cursor = result.response_metadata?.next_cursor;

      // Debug: log pagination status
      if (DEBUG) {
        console.log(`[DEBUG] Has more pages: ${!!cursor}, Total messages so far: ${messageCount}`);
      }

      // Save checkpoint every 10k messages
      if (messageCount > 0 && messageCount % 10000 === 0) {
        await saveCheckpoint(channelIndex, channelId, messageCount);
      }

      // Show progress for large channels (every 10 batches = 10k messages)
      if (cursor && batchCount % 10 === 0) {
        console.log(`[PROGRESS] ${messageCount.toLocaleString()} messages scanned, ${totalLinksFound} unique links found`);

        // Show latest 5 links discovered
        if (totalLinksFound > 0) {
          const latest5 = Array.from(seenLinks).slice(-5);
          console.log('[LINKS] Latest discovered:');
          for (const targetId of latest5) {
            const targetName = channelNames.get(targetId) || targetId;
            console.log(`  #${channelName} > #${targetName}`);
          }
        }
      }

      // Optional: Add a small delay to avoid rate limits
      if (cursor) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    } while (cursor);

    // Debug: log final stats
    if (DEBUG) {
      console.log(`[DEBUG] Channel complete: ${batchCount} batches, ${messageCount} total messages`);
      if (oldestMessageTs) {
        const oldestDate = new Date(parseFloat(oldestMessageTs) * 1000).toISOString();
        const messagePreview = oldestMessageText.substring(0, 100).replace(/\n/g, ' ');
        console.log(`[DEBUG] Oldest message found: ${oldestDate}`);
        console.log(`[DEBUG] Message preview: "${messagePreview}${oldestMessageText.length > 100 ? '...' : ''}"`);
        console.log(`[DEBUG] Message link: https://hackclub.slack.com/archives/${channelId}/p${oldestMessageTs.replace('.', '')}`);
      }
    }

    // Flush any remaining pending writes
    if (pendingWrites.length > 0) {
      await appendConnections(pendingWrites);
    }

    console.log(`[COMPLETE] Scanned ${messageCount.toLocaleString()} messages, found ${totalLinksFound} unique channel links`);
  } catch (error) {
    if (error.data?.error === 'not_in_channel') {
      console.log(`[WARN] Bot not in channel, attempting to join...`);
      try {
        await webClient.conversations.join({ channel: channelId });
        console.log(`[SUCCESS] Joined channel, retrying scan...`);
        return await scanChannelMessages(channelId, channelName, channelIndex);
      } catch (joinError) {
        console.log(`[ERROR] Cannot access channel (may be private)`);
      }
    } else {
      console.error(`[ERROR] Failed to scan channel:`, error.data?.error || error.message);
    }
  }
}

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
  const channels = await getAllChannels();

  // Store channel names for reference
  channels.forEach(channel => {
    channelNames.set(channel.id, channel.name);
  });

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

    await scanChannelMessages(channel.id, channel.name, i);

    // Save checkpoint after each channel
    await saveCheckpoint(i, channel.id, 0);

    console.log(''); // Empty line for readability

    // Rate limiting: pause between channels to be respectful
    await new Promise(resolve => setTimeout(resolve, 200));
  }

  // Step 3: Generate metadata file (skip in debug mode)
  if (!DEBUG) {
    console.log('=' .repeat(60));
    console.log('[INFO] Generating metadata file');

    const metadata = {
      workspace: 'Hack Club',
      generatedAt: new Date().toISOString(),
      totalChannels: channels.length,
      processingTimeSeconds: ((Date.now() - startTime) / 1000).toFixed(2),
      outputFile: OUTPUT_FILE,
      channels: {}
    };

    // Build channels object
    channels.forEach(channel => {
      metadata.channels[channel.id] = {
        id: channel.id,
        name: channel.name
      };
    });

    // Write metadata file
    await fs.writeFile(
      'channel-metadata.json',
      JSON.stringify(metadata, null, 2),
      'utf-8'
    );

    console.log('[SUCCESS] Output saved to ' + OUTPUT_FILE);
    console.log('[SUCCESS] Metadata saved to channel-metadata.json');
    console.log('\n[STATS] Summary:');
    console.log(`  Total channels: ${channels.length}`);
    console.log(`  Processing time: ${metadata.processingTimeSeconds}s`);
    console.log('\n[DONE] Mapping complete\n');
    console.log('[INFO] Cleaning up checkpoint file...');

    // Delete checkpoint file on successful completion
    try {
      await fs.unlink(CHECKPOINT_FILE);
      console.log('[SUCCESS] Checkpoint file removed');
    } catch (error) {
      // Ignore if checkpoint doesn't exist
    }
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
