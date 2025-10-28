import {
  CHANNEL_MENTION_REGEX,
  DEBUG,
  CHECKPOINT_EVERY_N_MESSAGES,
  WRITE_BATCH_SIZE,
  DELAY_BETWEEN_MESSAGE_PAGES
} from './config.js';
import { saveCheckpoint } from './checkpoint.js';
import { appendConnections } from './output.js';

/**
 * Scan messages in a channel for channel mentions
 */
export async function scanChannelMessages(webClient, channelId, channelName, channelIndex, channelNames) {
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

                // Write to file every N links found
                if (pendingWrites.length >= WRITE_BATCH_SIZE) {
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

      // Save checkpoint every N messages
      if (messageCount > 0 && messageCount % CHECKPOINT_EVERY_N_MESSAGES === 0) {
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
        await new Promise(resolve => setTimeout(resolve, DELAY_BETWEEN_MESSAGE_PAGES));
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
        return await scanChannelMessages(webClient, channelId, channelName, channelIndex, channelNames);
      } catch (joinError) {
        console.log(`[ERROR] Cannot access channel (may be private)`);
      }
    } else {
      console.error(`[ERROR] Failed to scan channel:`, error.data?.error || error.message);
    }
  }
}
