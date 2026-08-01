import fs from 'fs/promises';
import { CHANNELS_CACHE_FILE, CLEAR_CHANNEL_CACHE } from './config.js';

/**
 * Fetch all channels in the workspace, including archived ones.
 *
 * Archived channels are still referenced by messages in active channels, so
 * they're needed to resolve mention targets to names. They are not scanned -
 * the caller filters them out of the scan list.
 */
export async function getAllChannels(webClient) {
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
        exclude_archived: false,
        limit: 1000,
        cursor: cursor
      });

      allChannels.push(...result.channels);
      cursor = result.response_metadata?.next_cursor;

      console.log(`[INFO] Found ${allChannels.length} channels`);
    } while (cursor);

    const archivedCount = allChannels.filter(c => c.is_archived).length;
    console.log(`[SUCCESS] Total channels found: ${allChannels.length} (${archivedCount} archived, kept for name resolution)\n`);

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
 * Build channel name mapping
 */
export function buildChannelNameMap(channels) {
  const channelNames = new Map();
  channels.forEach(channel => {
    channelNames.set(channel.id, channel.name);
  });
  return channelNames;
}
