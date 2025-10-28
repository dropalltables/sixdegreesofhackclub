import fs from 'fs/promises';
import { CHECKPOINT_FILE, DEBUG } from './config.js';

/**
 * Load checkpoint to resume from previous run
 */
export async function loadCheckpoint() {
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
export async function saveCheckpoint(channelIndex, channelId, messageCount) {
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
 * Delete checkpoint file on successful completion
 */
export async function clearCheckpoint() {
  try {
    await fs.unlink(CHECKPOINT_FILE);
    console.log('[SUCCESS] Checkpoint file removed');
  } catch (error) {
    // Ignore if checkpoint doesn't exist
  }
}
