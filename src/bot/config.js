import dotenv from 'dotenv';

dotenv.config();

// Environment variables
export const SLACK_BOT_TOKEN = process.env.SLACK_BOT_TOKEN;
export const SLACK_APP_TOKEN = process.env.SLACK_APP_TOKEN;
export const DEBUG = process.env.DEBUG === 'true';
export const CLEAR_CHANNEL_CACHE = process.env.CLEAR_CHANNEL_CACHE === 'true';

// File paths
export const OUTPUT_FILE = 'channel-links.jsonl';
export const CHECKPOINT_FILE = 'checkpoint.json';
export const CHANNELS_CACHE_FILE = 'channels-cache.json';
export const METADATA_FILE = 'channel-metadata.json';

// Regex to match channel mentions like #channel-name or <#CHANNEL_ID>
// Matches: <#C123456>, <#C123456|channel-name>, <#C123456|>
export const CHANNEL_MENTION_REGEX = /<#([A-Z0-9]+)(?:\|[^>]*)?>/g;

// Rate limiting delays (in milliseconds)
export const DELAY_BETWEEN_MESSAGE_PAGES = 100;
export const DELAY_BETWEEN_CHANNELS = 200;

// Checkpoint intervals
export const CHECKPOINT_EVERY_N_MESSAGES = 10000;
export const WRITE_BATCH_SIZE = 5;
