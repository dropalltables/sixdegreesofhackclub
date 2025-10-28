# Six Degrees of Hack Club

A Slack bot that maps channel connections in the Hack Club workspace by analyzing channel mentions. This creates a graph of how channels reference each other, perfect for building a "six degrees of separation" visualization.

### Web version [here](https://github.com/dropalltables/sixdegreesofhackclub-web)

## Features

- Uses Slack WebSocket (Socket Mode) for real-time connection
- Recursively scans all channels in the workspace
- Memory-efficient: streams messages without storing them in RAM
- Writes connections to disk incrementally (batches of 5)
- Checkpoint system for resuming interrupted scans
- Channel cache to avoid rate limiting
- Debug mode for troubleshooting
- Outputs JSONL format with timestamps and message links

## Prerequisites

1. A Slack workspace (Hack Club in this case)
2. Admin access to create a Slack app
3. Node.js installed (v18 or higher recommended)

## Quick Setup with App Manifest

### Step 1: Create App from Manifest

1. Go to [api.slack.com/apps](https://api.slack.com/apps)
2. Click **"Create New App"**
3. Select **"From an app manifest"**
4. Choose your **Hack Club workspace**
5. Select **YAML** tab
6. Copy and paste the contents of `slack-app-manifest.yaml` from this project
7. Click **"Next"** → Review the configuration → Click **"Create"**

### Step 2: Get Your Tokens

#### Bot Token (xoxb-...)
1. In your app settings, go to **"OAuth & Permissions"** (left sidebar)
2. Click **"Install to Workspace"**
3. Click **"Allow"**
4. Copy the **"Bot User OAuth Token"** (starts with `xoxb-`)

#### App Token (xapp-...)
1. Go to **"Basic Information"** (left sidebar)
2. Scroll down to **"App-Level Tokens"**
3. Click **"Generate Token and Scopes"**
4. Name it something like `socket-token`
5. Add the scope: `connections:write`
6. Click **"Generate"**
7. Copy the token (starts with `xapp-`)

### Step 3: Configure Environment

1. Copy the example environment file:
   ```bash
   cp .env.example .env
   ```

2. Edit `.env` and paste your tokens:
   ```env
   SLACK_BOT_TOKEN=xoxb-your-bot-token-here
   SLACK_APP_TOKEN=xapp-your-app-token-here
   DEBUG=false
   CLEAR_CHANNEL_CACHE=false
   ```

### Step 4: Install & Run

```bash
npm install
npm start
```

## Manual Setup (Alternative)

If you prefer to set up manually instead of using the manifest:

1. Create a Slack App at [api.slack.com/apps](https://api.slack.com/apps)
2. Enable Socket Mode and generate an app-level token
3. Add these Bot Token Scopes:
   - `channels:history` - Read messages from public channels
   - `channels:read` - View basic channel info
   - `channels:join` - Join public channels
   - `groups:history` - Read messages from private channels (optional)
   - `groups:read` - View basic private channel info (optional)
4. Install app to workspace and get tokens
5. Follow steps 3-4 from Quick Setup

## File Structure

```
sixdegreesofhackclub/
├── index.js                    # Main bot implementation
├── package.json                # Dependencies
├── .env                        # Your tokens (create from .env.example)
├── .env.example               # Example environment config
├── slack-app-manifest.yaml    # Slack app configuration
├── README.md                  # This file
├── .gitignore                # Git ignore rules
│
├── channels-cache.json        # Generated: cached channel list
├── channel-links.jsonl        # Generated: output connections (JSONL format)
├── channel-metadata.json      # Generated: metadata and channel info
└── checkpoint.json            # Generated: resume state (deleted on completion)
```

## Configuration Options

### Environment Variables

- `SLACK_BOT_TOKEN` - Your bot OAuth token (required)
- `SLACK_APP_TOKEN` - Your app-level token for Socket Mode (required)
- `DEBUG` - Set to `true` for verbose output and no file writes (default: `false`)
- `CLEAR_CHANNEL_CACHE` - Set to `true` to refresh channel cache (default: `false`)

### Debug Mode (`DEBUG=true`)

When enabled:
- Prints all connections to stdout as JSON instead of writing to file
- Shows detailed batch information and message date ranges
- Displays sample messages from each channel
- Shows oldest message found in each channel
- Skips checkpoint saving/loading
- Skips metadata file generation

Useful for:
- Testing the bot on specific channels
- Troubleshooting missing links
- Verifying message scanning behavior
- Piping output to other tools

### Channel Cache

The bot caches the full channel list to `channels-cache.json` to avoid rate limiting on subsequent runs.

To refresh the cache:
```env
CLEAR_CHANNEL_CACHE=true
```

After refreshing, set it back to `false`.

## Output Format

### channel-links.jsonl

JSONL (JSON Lines) format - one connection per line:

```json
{"from":"C0266FRGT","to":"C0266FRGV","fromName":"announcements","toName":"lounge","messageTs":"1471465905.000099","messageDate":"2016-08-17T20:31:45.000Z","messageLink":"https://hackclub.slack.com/archives/C0266FRGT/p1471465905000099"}
{"from":"C0266FRGT","to":"C0M8PUPU6","fromName":"announcements","toName":"ship","messageTs":"1460848083.000005","messageDate":"2016-04-16T23:08:03.000Z","messageLink":"https://hackclub.slack.com/archives/C0266FRGT/p1460848083000005"}
```

Each connection includes:
- `from` / `to` - Channel IDs
- `fromName` / `toName` - Channel names
- `messageTs` - Slack timestamp
- `messageDate` - ISO 8601 formatted date
- `messageLink` - Direct link to the message

### channel-metadata.json

Contains workspace metadata and channel information:

```json
{
  "workspace": "Hack Club",
  "generatedAt": "2025-10-26T12:00:00.000Z",
  "totalChannels": 8348,
  "processingTimeSeconds": "3600.00",
  "outputFile": "channel-links.jsonl",
  "channels": {
    "C123456": {
      "id": "C123456",
      "name": "general"
    }
  }
}
```

### checkpoint.json

Saved automatically every 10k messages and after each channel. Allows resuming if interrupted:

```json
{
  "lastChannelIndex": 42,
  "lastChannelId": "C123456",
  "lastMessageCount": 15000,
  "timestamp": "2025-10-26T12:00:00.000Z"
}
```

## How It Works

1. **Channel Discovery**:
   - Loads channel list from cache if available
   - Otherwise fetches all public/private channels via `conversations.list`
   - Caches results to avoid rate limiting

2. **Message Scanning**:
   - For each channel, fetches message history in batches of 1000
   - Uses regex to find channel mentions: `<#CHANNELID>`, `<#CHANNELID|name>`, `<#CHANNELID|>`
   - Only stores the first reference between any two channels
   - Messages are processed in streaming fashion (not stored in RAM)

3. **Incremental Writing**:
   - Connections written to disk every 5 links found
   - Checkpoint saved every 10k messages and after each channel
   - Memory usage stays minimal regardless of workspace size

4. **Resume Capability**:
   - If interrupted (Ctrl+C), checkpoint is saved
   - Next run automatically resumes from last checkpoint
   - Checkpoint deleted on successful completion

## Rate Limiting

Built-in delays to respect Slack API limits:
- 100ms between message history pages
- 200ms between channels
- Automatic retry on rate limit errors

The Slack API has rate limits for `conversations.list` which is why the channel cache is important.

## Usage Examples

### Normal Run
```bash
npm start
```

### Debug Mode (Test on First Channel)
```bash
# Set in .env
DEBUG=true

npm start
```

### Refresh Channel Cache
```bash
# Set in .env
CLEAR_CHANNEL_CACHE=true

npm start

# Then set back to false
CLEAR_CHANNEL_CACHE=false
```

### Resume After Interruption
Simply run again - it will automatically resume from checkpoint:
```bash
npm start
```

## Troubleshooting

### "not_in_channel" errors
The bot automatically attempts to join public channels. For private channels, manually invite the bot:
```
/invite @Six Degrees Mapper
```

### Rate limit errors
If you hit rate limits frequently:
1. Use the channel cache (don't set `CLEAR_CHANNEL_CACHE=true` unnecessarily)
2. Increase delays in `index.js` if needed

### Missing recent messages
The bot scans from newest to oldest. If recent channel mentions are missing:
- Check if they use the format `<#CHANNELID>` (the bot detects this)
- Mentions in thread replies are NOT scanned (only top-level messages)
- Plain text like "check out #general" without the link format won't be detected

### Out of memory
The bot is designed to be memory-efficient:
- Messages are NOT stored in RAM
- Only a small Set of channel IDs per channel is kept
- Connections written to disk in batches of 5

If you still hit memory issues, there may be an extremely large number of unique channel references in a single channel.

## Permissions

The bot requires these permissions:
- `channels:history` - Read public channel messages
- `channels:read` - List public channels
- `channels:join` - Auto-join public channels
- `groups:history` - Read private channel messages (if invited)
- `groups:read` - List private channels (if invited)

For private channels, the bot must be explicitly invited.

## Next Steps

Use the `channel-links.jsonl` file to build a web UI that:
- Visualizes the channel graph (D3.js, vis.js, Cytoscape.js)
- Implements pathfinding algorithms (BFS/Dijkstra)
- Shows all possible paths between two channels
- Calculates "degrees of separation" statistics
- Filters by date range or specific channels
- Identifies the most connected channels
- Finds isolated channel clusters

## License

MIT
