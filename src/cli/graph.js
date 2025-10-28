/**
 * Graph structure to store channel connections
 */
export class ChannelGraph {
  constructor() {
    this.channels = new Map(); // channelId -> {name, connections: [{to, messageLink, messageDate}]}
    this.nameToId = new Map(); // channelName -> channelId
  }

  addConnection(from, to, fromName, toName, messageLink, messageDate) {
    // Add channel if not exists
    if (!this.channels.has(from)) {
      this.channels.set(from, { name: fromName, connections: [] });
      this.nameToId.set(fromName.toLowerCase(), from);
    }
    if (!this.channels.has(to)) {
      this.channels.set(to, { name: toName, connections: [] });
      this.nameToId.set(toName.toLowerCase(), to);
    }

    // Add connection
    this.channels.get(from).connections.push({
      to,
      messageLink,
      messageDate
    });
  }

  getChannelId(nameOrId) {
    // Try as ID first
    if (this.channels.has(nameOrId)) {
      return nameOrId;
    }
    // Try as name
    return this.nameToId.get(nameOrId.toLowerCase());
  }

  getChannelName(id) {
    return this.channels.get(id)?.name || id;
  }

  // BFS to find shortest path
  findPath(startId, endId, maxHops = Infinity) {
    if (startId === endId) {
      return { path: [startId], links: [] };
    }

    const queue = [[startId]];
    const visited = new Set([startId]);

    while (queue.length > 0) {
      const path = queue.shift();
      const current = path[path.length - 1];

      // Check if we've exceeded max hops
      if (path.length > maxHops) {
        continue;
      }

      const channelData = this.channels.get(current);
      if (!channelData) continue;

      for (const connection of channelData.connections) {
        if (connection.to === endId) {
          // Found the destination
          const fullPath = [...path, endId];
          const links = this.buildLinks(fullPath);
          return { path: fullPath, links };
        }

        if (!visited.has(connection.to)) {
          visited.add(connection.to);
          queue.push([...path, connection.to]);
        }
      }
    }

    return null; // No path found
  }

  // Find all paths within X hops
  findAllPathsWithinHops(startId, maxHops) {
    const reachable = new Map(); // channelId -> {path, links}
    const queue = [[startId]];
    const visited = new Set([startId]);

    while (queue.length > 0) {
      const path = queue.shift();
      const current = path[path.length - 1];

      if (path.length > maxHops + 1) {
        continue;
      }

      const channelData = this.channels.get(current);
      if (!channelData) continue;

      for (const connection of channelData.connections) {
        if (!visited.has(connection.to)) {
          visited.add(connection.to);
          const newPath = [...path, connection.to];
          queue.push(newPath);

          const links = this.buildLinks(newPath);
          reachable.set(connection.to, { path: newPath, links });
        }
      }
    }

    return reachable;
  }

  // Build link information for a path
  buildLinks(path) {
    const links = [];
    for (let i = 0; i < path.length - 1; i++) {
      const from = path[i];
      const to = path[i + 1];
      const channelData = this.channels.get(from);
      const connection = channelData?.connections.find(c => c.to === to);

      if (connection) {
        links.push({
          from: this.getChannelName(from),
          to: this.getChannelName(to),
          messageLink: connection.messageLink,
          messageDate: connection.messageDate
        });
      }
    }
    return links;
  }

  getTotalChannels() {
    return this.channels.size;
  }

  getTotalConnections() {
    let total = 0;
    for (const channel of this.channels.values()) {
      total += channel.connections.length;
    }
    return total;
  }

  getDetailedStats() {
    const stats = {
      totalChannels: this.channels.size,
      totalConnections: this.getTotalConnections(),
      channelsByConnections: []
    };

    // Calculate connections per channel (outgoing)
    // Skip channels where name equals ID (private/archived)
    for (const [id, data] of this.channels.entries()) {
      // Skip if name is the same as ID (private/archived channel)
      if (data.name === id) {
        continue;
      }

      stats.channelsByConnections.push({
        id,
        name: data.name,
        outgoing: data.connections.length,
        incoming: 0
      });
    }

    // Calculate incoming connections
    for (const channel of this.channels.values()) {
      for (const conn of channel.connections) {
        const target = stats.channelsByConnections.find(c => c.id === conn.to);
        // Only count if target is not private/archived
        if (target) {
          target.incoming++;
        }
      }
    }

    // Calculate total connections (in + out)
    for (const channel of stats.channelsByConnections) {
      channel.total = channel.incoming + channel.outgoing;
    }

    // Sort by total connections
    stats.channelsByConnections.sort((a, b) => b.total - a.total);

    return stats;
  }
}
