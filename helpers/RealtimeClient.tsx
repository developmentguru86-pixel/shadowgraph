// Reconnecting realtime client (browser). Connects to the wss endpoint
// returned by the _realtime/token response (cross-origin is fine — the token
// rides the query string), refreshes its token, auto-reconnects with
// exponential backoff + jitter, heartbeats under API Gateway's 10-min idle
// timeout, and re-subscribes on reconnect. Messages are at-most-once — use
// onReconnect() to refetch any state that may have changed while disconnected.

import { postRealtimeToken } from "../endpoints/_realtime/token_POST.schema";
import { postRealtimeSend } from "../endpoints/_realtime/send_POST.schema";
import { postRealtimeLastseen } from "../endpoints/_realtime/lastseen_POST.schema";

export type RealtimeStatus = "connecting" | "connected" | "disconnected";
type Handler = (data: any) => void;
// The current roster of a presence channel. count is the server's number on a
// batched channel (presenceBatchOf) and members.length everywhere else.
export type PresenceRoster = { members: string[]; count: number };

export class RealtimeClient {
  private ws: WebSocket | null = null;
  private channels = new Map<string, Set<Handler>>();
  // Presence handlers are tracked separately from data handlers but share the
  // same underlying channel subscription. They receive the whole roster, which
  // the client keeps per channel, so a second component watching the same
  // channel gets it at once instead of waiting for (or re-requesting) a snapshot.
  private presenceChannels = new Map<string, Set<Handler>>();
  private rosters = new Map<string, Set<string>>();
  private rosterCounts = new Map<string, number>();
  private status: RealtimeStatus = "disconnected";
  private statusListeners = new Set<(s: RealtimeStatus) => void>();
  private reconnectListeners = new Set<() => void>();
  private delay = 500;
  private readonly maxDelay = 15000;
  // Idle-based keepalive: only ping when nothing has been sent or received for
  // idlePingAfterMs (just under API Gateway's 10-min idle close). A connection
  // with real traffic never pings — its own traffic already resets the idle
  // timer — so busy connections don't send (or get billed for) redundant pings.
  private readonly idlePingAfterMs = 8 * 60 * 1000;
  private readonly idleCheckMs = 60 * 1000;
  private lastActivity = Date.now();
  private closedByUser = false;
  private hasConnectedOnce = false;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private async fetchToken(): Promise<{ token: string; wssEndpoint: string }> {
    const res = await postRealtimeToken();
    if ("error" in res) throw new Error(res.error);
    return { token: res.token, wssEndpoint: res.wssEndpoint };
  }

  async connect(): Promise<void> {
    this.closedByUser = false;
    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", this.onVisibility);
    }
    await this.open();
  }

  private setStatus(s: RealtimeStatus) {
    if (this.status === s) return;
    this.status = s;
    this.statusListeners.forEach((cb) => {
      try { cb(s); } catch {}
    });
  }

  private async open(): Promise<void> {
    if (this.closedByUser) return;
    // Tear down any previous socket BEFORE opening a new one. open() can be
    // called out-of-band (onVisibility) while an old socket is still CLOSING;
    // detach its handlers so its stale onclose/onerror (which mutate shared
    // state) can't fire against the new socket — killing its heartbeat or
    // spawning a duplicate connection.
    if (this.ws) {
      try {
        this.ws.onopen = null;
        this.ws.onmessage = null;
        this.ws.onerror = null;
        this.ws.onclose = null;
        this.ws.close();
      } catch {}
      this.ws = null;
    }
    this.setStatus("connecting");
    let creds: { token: string; wssEndpoint: string };
    try {
      creds = await this.fetchToken();
    } catch {
      // No live socket and the token fetch failed — reflect "disconnected" (not
      // "connecting") so onVisibility's connecting-guard doesn't mistake this for
      // a connect in flight and skip an immediate reconnect on foreground.
      this.setStatus("disconnected");
      this.scheduleReconnect();
      return;
    }
    // Connect directly to the realtime API endpoint (the token endpoint returns
    // it). The token rides the query string, so this works cross-origin — no
    // same-origin proxy needed.
    const sep = creds.wssEndpoint.indexOf("?") === -1 ? "?" : "&";
    const ws = new WebSocket(creds.wssEndpoint + sep + "token=" + encodeURIComponent(creds.token));
    this.ws = ws;
    ws.onopen = () => {
      this.delay = 500;
      this.lastActivity = Date.now();
      this.setStatus("connected");
      // Re-subscribe every active channel (data + presence) on (re)connect. A
      // presence re-subscribe also makes the server re-send a fresh roster
      // snapshot, so useRealtimePresence resyncs automatically after a drop.
      for (const channel of this.activeChannels()) {
        this.sendRaw({ action: "subscribe", channel });
      }
      this.startHeartbeat();
      // Fire onReconnect only on a RE-connect, not the first connect — so a
      // useRealtimeReconnect(refetch) handler doesn't double-fetch on mount.
      if (this.hasConnectedOnce) {
        this.reconnectListeners.forEach((cb) => {
          try { cb(); } catch {}
        });
      }
      this.hasConnectedOnce = true;
    };
    ws.onmessage = (ev) => {
      this.lastActivity = Date.now();
      let parsed: any;
      try {
        parsed = JSON.parse(typeof ev.data === "string" ? ev.data : "");
      } catch {
        return;
      }
      if (!parsed || typeof parsed !== "object") return;
      // Presence rides a top-level "presence" field (snapshot/join/leave/digest);
      // app messages ride "data". Route them separately so an app payload can
      // never be mistaken for a presence event (or vice-versa).
      if (parsed.presence) {
        this.applyPresence(parsed.channel, parsed.presence);
        return;
      }
      const handlers = this.channels.get(parsed.channel);
      if (handlers) {
        handlers.forEach((h) => {
          try { h(parsed.data); } catch {}
        });
      }
    };
    ws.onclose = () => {
      this.stopHeartbeat();
      if (!this.closedByUser) {
        this.setStatus("disconnected");
        this.scheduleReconnect();
      }
    };
    ws.onerror = () => {
      try { ws.close(); } catch {}
    };
  }

  private scheduleReconnect() {
    if (this.closedByUser) return;
    const jitter = Math.floor(this.delay * 0.3 * Math.random());
    const wait = Math.min(this.maxDelay, this.delay) + jitter;
    this.delay = Math.min(this.maxDelay, this.delay * 2);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.open();
    }, wait);
  }

  // Background tabs throttle our keepalive + reconnect timers, so a hidden tab
  // can idle-close and then sit disconnected. When it's foregrounded again,
  // reconnect NOW instead of waiting for a throttled backoff timer.
  private onVisibility = () => {
    if (this.closedByUser) return;
    if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
    if (this.status === "connecting") return; // a connect is already in flight
    if (this.ws && this.ws.readyState === WebSocket.OPEN) return; // already healthy
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.delay = 500;
    this.open();
  };

  private startHeartbeat() {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      // Only ping if the connection has been idle long enough to risk API
      // Gateway's 10-min timeout; active traffic keeps it alive for free.
      if (Date.now() - this.lastActivity >= this.idlePingAfterMs) {
        this.sendRaw({ action: "ping" });
      }
    }, this.idleCheckMs);
  }
  private stopHeartbeat() {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private sendRaw(obj: unknown) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      try { this.ws.send(JSON.stringify(obj)); this.lastActivity = Date.now(); } catch {}
    }
  }

  // A channel is "active" (subscribed on the socket) if it has EITHER data or
  // presence handlers — so the subscribe/unsubscribe frame is sent once for both.
  private isChannelActive(channel: string): boolean {
    return this.channels.has(channel) || this.presenceChannels.has(channel);
  }
  private activeChannels(): Set<string> {
    const active = new Set<string>();
    for (const c of this.channels.keys()) active.add(c);
    for (const c of this.presenceChannels.keys()) active.add(c);
    return active;
  }

  // Shared subscribe/unsubscribe-frame refcounting for the data and presence
  // handler maps. A channel stays subscribed on the socket while EITHER map has a
  // handler for it (isChannelActive), so the subscribe/unsubscribe frame is sent
  // exactly once across both — and the logic lives in ONE place.
  private subscribeOn(
    map: Map<string, Set<Handler>>,
    channel: string,
    handler: Handler,
  ): () => void {
    const wasActive = this.isChannelActive(channel);
    let set = map.get(channel);
    if (!set) {
      set = new Set();
      map.set(channel, set);
    }
    set.add(handler);
    if (!wasActive) this.sendRaw({ action: "subscribe", channel });
    return () => {
      const s = map.get(channel);
      if (s) {
        s.delete(handler);
        if (s.size === 0) map.delete(channel);
      }
      if (!this.isChannelActive(channel)) this.sendRaw({ action: "unsubscribe", channel });
    };
  }

  /** Subscribe to a channel's data messages. Returns an unsubscribe function. */
  subscribe(channel: string, handler: Handler): () => void {
    return this.subscribeOn(this.channels, channel, handler);
  }

  /**
   * Watch a presence channel's roster. The handler gets the whole roster each
   * time it changes, and right away if it is already known. Returns an
   * unsubscribe function. Used by useRealtimePresence; shares the underlying
   * channel subscription with any data subscribers on the same channel.
   */
  subscribePresence(
    channel: string,
    handler: (roster: PresenceRoster) => void,
  ): () => void {
    const unsub = this.subscribeOn(this.presenceChannels, channel, handler);
    const current = this.getPresence(channel);
    if (current) {
      try { handler(current); } catch {}
    }
    return () => {
      unsub();
      if (!this.presenceChannels.has(channel)) {
        this.rosters.delete(channel);
        this.rosterCounts.delete(channel);
      }
    };
  }

  /** The last known roster of a presence channel, or null before its snapshot. */
  getPresence(channel: string): PresenceRoster | null {
    const members = this.rosters.get(channel);
    if (!members) return null;
    return {
      members: Array.from(members),
      count: this.rosterCounts.get(channel) ?? members.size,
    };
  }

  // Server presence events: "snapshot" (the full roster, on every (re)subscribe),
  // "join" / "leave" (live channels, one per change) and "digest" (batched
  // channels: net joined/left + a fresh count, about every 30s when something
  // changed; resync means "too many changes, fetch a snapshot").
  private applyPresence(channel: string, p: any) {
    if (!p || typeof p !== "object") return;
    const isId = (x: unknown): x is string => typeof x === "string";
    let roster = this.rosters.get(channel);
    if (p.type === "snapshot" && Array.isArray(p.members)) {
      roster = new Set(p.members.filter(isId));
    } else if (!roster) {
      return; // a change before the snapshot — the snapshot already includes it
    } else if (p.type === "join" && isId(p.userId)) {
      roster.add(p.userId);
    } else if (p.type === "leave" && isId(p.userId)) {
      roster.delete(p.userId);
    } else if (p.type === "digest") {
      if (p.resync) {
        this.sendRaw({ action: "subscribe", channel }); // server re-sends a snapshot
      } else {
        for (const id of Array.isArray(p.joined) ? p.joined.filter(isId) : []) roster.add(id);
        for (const id of Array.isArray(p.left) ? p.left.filter(isId) : []) roster.delete(id);
      }
    } else {
      return;
    }
    this.rosters.set(channel, roster);
    if (typeof p.count === "number") this.rosterCounts.set(channel, p.count);
    else this.rosterCounts.delete(channel);
    const current = this.getPresence(channel);
    const handlers = this.presenceChannels.get(channel);
    if (current && handlers) {
      handlers.forEach((h) => {
        try { h(current); } catch {}
      });
    }
  }

  /**
   * Send a message up to the backend. In v1 this rides plain HTTP (your
   * `_realtime/send` endpoint authorizes the end-user and publishes
   * server-side); the WebSocket itself is receive-only from the browser.
   */
  async send(channel: string, data: unknown): Promise<void> {
    await postRealtimeSend({ channel, data });
  }

  /**
   * Look up last-seen timestamps (unix seconds) for a BOUNDED set of userIds on a
   * presence channel — the offline people you're rendering. Returns
   * { userId: ts }; an absent userId means online now, or last seen a long time
   * ago. Cache the result (e.g. a React Query with a long staleTime) — last-seen
   * changes slowly, so don't refetch it on every render.
   */
  async lastSeen(channel: string, userIds: string[]): Promise<Record<string, number>> {
    const res = await postRealtimeLastseen({ channel, userIds });
    return "lastSeen" in res ? res.lastSeen : {};
  }

  onStatus(cb: (s: RealtimeStatus) => void): () => void {
    this.statusListeners.add(cb);
    return () => this.statusListeners.delete(cb);
  }
  /** Fires after every (re)connect — refetch state that may have changed. */
  onReconnect(cb: () => void): () => void {
    this.reconnectListeners.add(cb);
    return () => this.reconnectListeners.delete(cb);
  }
  getStatus(): RealtimeStatus {
    return this.status;
  }
  close() {
    this.closedByUser = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (typeof document !== "undefined") {
      document.removeEventListener("visibilitychange", this.onVisibility);
    }
    this.stopHeartbeat();
    if (this.ws) {
      try { this.ws.close(); } catch {}
    }
  }
}
