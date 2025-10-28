/**
 * Display path with links
 */
export function displayPath(result, startName, endName) {
  if (!result) {
    console.log(`\n[NOT FOUND] No path exists from #${startName} to #${endName}\n`);
    return;
  }

  const { path, links } = result;
  console.log(`\n[PATH FOUND] ${path.length - 1} hop(s) from #${startName} to #${endName}:\n`);

  for (let i = 0; i < links.length; i++) {
    const link = links[i];
    console.log(`  ${i + 1}. #${link.from} → #${link.to}`);
    console.log(`     ${link.messageLink}`);
    console.log(`     ${link.messageDate}\n`);
  }
}

/**
 * Display reachable channels
 */
export function displayReachable(reachable, startName, maxHops, graph) {
  if (reachable.size === 0) {
    console.log(`\n[INFO] No channels reachable within ${maxHops} hop(s) from #${startName}\n`);
    return;
  }

  console.log(`\n[REACHABLE] ${reachable.size} channel(s) within ${maxHops} hop(s) from #${startName}:\n`);

  // Group by number of hops
  const byHops = new Map();
  for (const [channelId, { path, links }] of reachable.entries()) {
    const hops = path.length - 1;
    if (!byHops.has(hops)) {
      byHops.set(hops, []);
    }
    byHops.get(hops).push({ channelId, path, links });
  }

  // Display grouped
  for (const [hops, channels] of Array.from(byHops.entries()).sort((a, b) => a[0] - b[0])) {
    console.log(`${hops} hop(s): ${channels.length} channel(s)`);
    for (const { path, links } of channels.slice(0, 5)) { // Show first 5
      const channelName = path[path.length - 1];
      console.log(`  - #${graph.getChannelName(channelName)}`);
    }
    if (channels.length > 5) {
      console.log(`  ... and ${channels.length - 5} more`);
    }
    console.log();
  }
}

/**
 * Display statistics
 */
export function displayStats(stats) {
  console.log('\n[STATS] Graph Statistics:');
  console.log(`  Total channels: ${stats.totalChannels}`);
  console.log(`  Total connections: ${stats.totalConnections}`);

  // Average connections
  const avgConnections = (stats.totalConnections / stats.totalChannels).toFixed(2);
  console.log(`  Average connections per channel: ${avgConnections}`);

  // Most connected channels
  console.log('\n  Most Connected Channels:');
  for (let i = 0; i < Math.min(10, stats.channelsByConnections.length); i++) {
    const ch = stats.channelsByConnections[i];
    console.log(`    ${i + 1}. #${ch.name} - ${ch.total} total (${ch.outgoing} out, ${ch.incoming} in)`);
  }

  // Least connected channels
  console.log('\n  Least Connected Channels:');
  const leastConnected = stats.channelsByConnections.slice(-10).reverse();
  for (let i = 0; i < leastConnected.length; i++) {
    const ch = leastConnected[i];
    console.log(`    ${i + 1}. #${ch.name} - ${ch.total} total (${ch.outgoing} out, ${ch.incoming} in)`);
  }

  // Isolated channels (no connections at all)
  const isolated = stats.channelsByConnections.filter(ch => ch.total === 0);
  if (isolated.length > 0) {
    console.log(`\n  Isolated Channels (no connections): ${isolated.length}`);
    for (let i = 0; i < Math.min(5, isolated.length); i++) {
      console.log(`    - #${isolated[i].name}`);
    }
    if (isolated.length > 5) {
      console.log(`    ... and ${isolated.length - 5} more`);
    }
  }

  console.log();
}
