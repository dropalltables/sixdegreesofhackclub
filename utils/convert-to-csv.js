#!/usr/bin/env node

import fs from 'fs';
import readline from 'readline';

// Writes two spreadsheet-friendly files from the scan output:
// - channel-links.csv: one row per connection
// - channels.csv:      one row per channel, with degree counts

const LINKS_IN = 'channel-links.jsonl';
const META_IN = 'channel-metadata.json';
const LINKS_OUT = 'channel-links.csv';
const NODES_OUT = 'channels.csv';
// Just the edge and where to read it - no dates, authors or message text
const MINIMAL_OUT = 'channel-links-minimal.csv';

/**
 * Quote a value for CSV. Excel needs doubled quotes, and any field holding a
 * comma, quote or newline must be wrapped - message text has all three.
 */
function csv(value) {
  if (value === null || value === undefined) return '';
  const s = String(value);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function row(values) {
  return values.map(csv).join(',') + '\n';
}

async function main() {
  if (!fs.existsSync(LINKS_IN)) {
    console.error(`[ERROR] ${LINKS_IN} not found - run the bot first`);
    process.exit(1);
  }

  const metadata = fs.existsSync(META_IN)
    ? JSON.parse(fs.readFileSync(META_IN, 'utf8'))
    : { channels: {} };

  const outDegree = new Map();
  const inDegree = new Map();
  const seenNames = new Map();

  const linksOut = fs.createWriteStream(LINKS_OUT, 'utf8');
  linksOut.write(row([
    'from_id', 'to_id', 'from_name', 'to_name',
    'message_date', 'message_ts', 'message_link', 'author_user_id', 'message_text'
  ]));

  const minimalOut = fs.createWriteStream(MINIMAL_OUT, 'utf8');
  minimalOut.write(row(['source_channel', 'mentioned_channel', 'message_link']));

  let count = 0;
  const rl = readline.createInterface({
    input: fs.createReadStream(LINKS_IN, 'utf8'),
    crlfDelay: Infinity
  });

  for await (const line of rl) {
    if (!line.trim()) continue;
    const c = JSON.parse(line);

    linksOut.write(row([
      c.from, c.to, c.fromName, c.toName,
      c.messageDate, c.messageTs, c.messageLink, c.authorUserId,
      // Strip newlines so each connection stays on one spreadsheet row
      c.messageText ? c.messageText.replace(/[\r\n]+/g, ' ') : ''
    ]));

    minimalOut.write(row([c.fromName, c.toName, c.messageLink]));

    outDegree.set(c.from, (outDegree.get(c.from) || 0) + 1);
    inDegree.set(c.to, (inDegree.get(c.to) || 0) + 1);
    if (!seenNames.has(c.from)) seenNames.set(c.from, c.fromName);
    if (!seenNames.has(c.to)) seenNames.set(c.to, c.toName);

    count++;
  }

  await new Promise(resolve => linksOut.end(resolve));
  await new Promise(resolve => minimalOut.end(resolve));
  console.log(`[SUCCESS] ${LINKS_OUT}: ${count.toLocaleString()} connections`);
  console.log(`[SUCCESS] ${MINIMAL_OUT}: ${count.toLocaleString()} connections`);

  // Every channel we know about, whether from metadata or seen only as a mention target
  const ids = new Set([...Object.keys(metadata.channels || {}), ...seenNames.keys()]);

  const rows = [...ids].map(id => {
    const meta = metadata.channels?.[id];
    const out = outDegree.get(id) || 0;
    const inc = inDegree.get(id) || 0;
    return {
      id,
      name: meta?.name || seenNames.get(id) || id,
      resolved: !!meta?.name,
      archived: meta?.isArchived ? 'TRUE' : 'FALSE',
      messages: meta?.messageCount ?? '',
      out,
      inc,
      total: out + inc
    };
  }).sort((a, b) => b.total - a.total);

  const nodesOut = fs.createWriteStream(NODES_OUT, 'utf8');
  nodesOut.write(row([
    'id', 'name', 'name_resolved', 'is_archived',
    'message_count', 'out_degree', 'in_degree', 'total_degree'
  ]));
  for (const r of rows) {
    nodesOut.write(row([r.id, r.name, r.resolved ? 'TRUE' : 'FALSE', r.archived, r.messages, r.out, r.inc, r.total]));
  }
  await new Promise(resolve => nodesOut.end(resolve));

  console.log(`[SUCCESS] ${NODES_OUT}: ${rows.length.toLocaleString()} channels`);
}

main();
