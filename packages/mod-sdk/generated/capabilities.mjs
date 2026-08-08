// Generated from packages/shared/bridge-capabilities.json — do not edit. Regenerate: node packages/shared/generate.mjs
export const capabilities = {
  "player.message": {
    "target": "player",
    "scope": "write"
  },
  "player.give_item": {
    "target": "player",
    "scope": "write"
  },
  "player.teleport": {
    "target": "player",
    "scope": "write"
  },
  "player.heal": {
    "target": "player",
    "scope": "write"
  },
  "player.count_item": {
    "target": "player",
    "scope": "read"
  },
  "player.has_item": {
    "target": "player",
    "scope": "read"
  },
  "pal.spawn": {
    "target": "player",
    "scope": "write"
  },
  "player.set_tag": {
    "target": "player",
    "scope": "write"
  },
  "player.get_tag": {
    "target": "player",
    "scope": "read"
  },
  "player.delete_tag": {
    "target": "player",
    "scope": "write"
  },
  "server.announce": {
    "target": "server",
    "scope": "write"
  },
  "permission.register": {
    "target": null,
    "scope": "write"
  },
  "permission.check": {
    "target": "player",
    "scope": "read"
  },
  "permission.grant": {
    "target": "player",
    "scope": "write"
  },
  "permission.revoke": {
    "target": "player",
    "scope": "write"
  },
  "permission.nodes": {
    "target": null,
    "scope": "read"
  },
  "permission.player": {
    "target": "player",
    "scope": "read"
  },
  "group.create": {
    "target": null,
    "scope": "write"
  },
  "group.update": {
    "target": null,
    "scope": "write"
  },
  "group.delete": {
    "target": null,
    "scope": "write"
  },
  "group.set_entry": {
    "target": null,
    "scope": "write"
  },
  "group.remove_entry": {
    "target": null,
    "scope": "write"
  },
  "group.assign": {
    "target": "player",
    "scope": "write"
  },
  "group.unassign": {
    "target": "player",
    "scope": "write"
  },
  "group.list": {
    "target": null,
    "scope": "read"
  },
  "player.position": {
    "target": "player",
    "scope": "read"
  },
  "location.save": {
    "target": null,
    "scope": "write"
  },
  "location.list": {
    "target": null,
    "scope": "read"
  },
  "location.delete": {
    "target": null,
    "scope": "write"
  },
  "pal.list": {
    "target": null,
    "scope": "read"
  },
  "player.stats": {
    "target": "player",
    "scope": "read"
  },
  "player.set_stats": {
    "target": "player",
    "scope": "write"
  },
  "player.status_points": {
    "target": "player",
    "scope": "read"
  },
  "player.status_point": {
    "target": "player",
    "scope": "write"
  },
  "player.playtime": {
    "target": "player",
    "scope": "read"
  },
  "pal.stats": {
    "target": null,
    "scope": "read"
  },
  "pal.set_stats": {
    "target": null,
    "scope": "write"
  },
  "pal.aggro": {
    "target": "player",
    "scope": "write"
  },
  "pal.inspect": {
    "target": null,
    "scope": "read"
  },
  "pal.spawn_wild": {
    "target": "player",
    "scope": "write"
  },
  "pal.force_spawn": {
    "target": "player",
    "scope": "write"
  },
  "bridge.probe": {
    "target": "player",
    "scope": "read"
  },
  "data.collections": {
    "target": null,
    "scope": "read"
  },
  "data.list": {
    "target": null,
    "scope": "read"
  },
  "data.get": {
    "target": null,
    "scope": "read"
  },
  "data.set": {
    "target": null,
    "scope": "write"
  },
  "data.delete": {
    "target": null,
    "scope": "write"
  }
};

export const events = [
  "bridge.ready",
  "bridge.hook",
  "player.chat",
  "player.join",
  "player.respawn",
  "player.death",
  "player.leave",
  "npc.spawn",
  "player.hour",
  "clock.minute",
  "clock.day",
  "player.item_use"
];
