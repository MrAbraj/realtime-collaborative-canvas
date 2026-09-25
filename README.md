# Realtime Collaborative Canvas

A real-time collaborative canvas built with **React, TypeScript and WebTransport**, backed by a **Rust WebTransport server**.

Multiple users can join the same room and collaborate on the canvas in real time, including canvas updates, user presence and cursor movement.

The project explores how **WebTransport over HTTP/3/QUIC** can be used to build a low-latency real-time application where different types of data have different delivery requirements.

## Demo

See the client and server working together with multiple users
collaborating in the same room.

![Realtime Collaborative Canvas Demo](./demo/demo.gif)
[Watch the full demo video](./demo/demo.mov)

## Architecture

This project is split into two repositories.

### Frontend

**realtime-collaborative-canvas**

https://github.com/MrAbraj/realtime-collaborative-canvas

### Backend

**rust-webtransport-server**

https://github.com/MrAbraj/rust-webtransport-server

```text
                    WebTransport / QUIC
                           │
                           │
             ┌─────────────┴─────────────┐
             │                           │
             ▼                           ▼
      Reliable Streams              Datagrams
             │                           │
             │                           │
     ┌───────┴────────┐                  │
     │                │                  │
     ▼                ▼                  ▼
Room Snapshot    Room Events        Cursor Updates
     │                │                  │
     │                │                  │
     └────────────────┴──────────────────┘
                      │
                      ▼
              React Application
                      │
                      ▼
              Collaborative Canvas
```

The Rust server manages room state and connected users, while the React client consumes the real-time protocol and updates the UI.

---

# What This Project Demonstrates

This is more than a canvas UI. It is an exploration of real-time application architecture.

The project demonstrates:

* React + TypeScript
* WebTransport client implementation
* HTTP/3 / QUIC communication
* MessagePack binary serialization
* Reliable WebTransport streams
* Unreliable WebTransport datagrams
* Real-time room synchronization
* Multi-user presence
* Real-time cursor updates
* Real-time canvas element updates
* Rust + Tokio backend
* Concurrent room management
* Per-room state isolation
* Async message passing
* Separating high-frequency data from reliable application state

---

# Why WebTransport?

A collaborative application does not treat every message the same way.

For example:

**Canvas changes**

A canvas element update needs reliable delivery.

**Room events**

User join/leave events need reliable delivery.

**Cursor movement**

Cursor positions are high-frequency and short-lived. If a user moves their cursor several times before an update arrives, receiving every old position is not useful. The latest position is what matters.

WebTransport allows these different types of data to use different communication primitives while sharing the same connection.

```text
                 WebTransport
                       │
          ┌────────────┴────────────┐
          │                         │
          ▼                         ▼
   Reliable Streams             Datagrams
          │                         │
          ▼                         ▼
 Canvas / Room State          Cursor Updates
 User Events                  High-frequency data
 Snapshots                    Ephemeral state
```

WebTransport supports reliable streams and unreliable datagrams over HTTP/3, which makes this model possible.

---

# WebTransport vs WebSocket

WebSocket is a good choice for many real-time applications.

This project uses WebTransport because the collaborative canvas has multiple types of real-time traffic with different delivery requirements.

|                                     | WebSocket                           | WebTransport        |
| ----------------------------------- | ----------------------------------- | ------------------- |
| Transport                           | TCP                                 | QUIC                |
| Reliable communication              | Yes                                 | Yes                 |
| Unreliable datagrams                | No                                  | Yes                 |
| Multiple independent streams        | No                                  | Yes                 |
| HTTP/3                              | No                                  | Yes                 |
| Out-of-order / independent delivery | Limited by TCP                      | Supported by QUIC   |
| High-frequency ephemeral data       | Application-level handling required | Datagrams available |

With WebSockets, communication is built around a single reliable, ordered TCP connection.

WebTransport uses QUIC and provides independent streams as well as datagrams.

For this project, that means reliable application state and ephemeral cursor state do not have to follow exactly the same delivery model.

### Example

```text
User A
  │
  ├── Canvas update ──────► Reliable stream
  │
  ├── Cursor position ────► Datagram
  │
  └── Cursor position ────► Datagram

User B
  │
  ├── Canvas update ──────► Reliable stream
  │
  └── Cursor position ────► Datagram
```

The important advantage here is not simply that WebTransport is "faster."

The advantage is that the application can choose an appropriate transport mechanism for each workload.

---

# Why This Architecture?

The main design decision is to avoid treating every real-time message the same way.

```text
Reliable application state
        │
        ├── RoomSnapshot
        ├── ElementUpdated
        ├── UserJoined
        └── UserLeft

High-frequency ephemeral state
        │
        └── CursorUpdate
```

This allows the application to prioritize correctness for persistent collaborative state while keeping high-frequency cursor updates lightweight.

---

# Real-Time Protocol

The client communicates with the Rust server using **MessagePack**.

The protocol currently contains:

### Client → Server

```text
Join
UpdateElement
Leave
CursorUpdate
```

### Server → Client

```text
RoomSnapshot
UserJoined
UserLeft
ElementUpdated
```

---

## Message Transport

| Message        | Direction       | Transport             | Reliable |
| -------------- | --------------- | --------------------- | -------- |
| RoomSnapshot   | Server → Client | Unidirectional Stream | Yes      |
| ElementUpdated | Server → Client | Unidirectional Stream | Yes      |
| UserJoined     | Server → Client | Unidirectional Stream | Yes      |
| UserLeft       | Server → Client | Unidirectional Stream | Yes      |
| CursorUpdate   | Client ↔ Server | Datagram              | No       |

This separation is one of the main design points of the project.

---

# Connection Flow

When a client connects:

```text
1. Establish WebTransport connection
                │
                ▼
2. Join room
                │
                ▼
3. Receive RoomSnapshot
                │
                ▼
4. Receive existing members
                │
                ▼
5. Start listening for RoomEvents
                │
                ▼
6. Start receiving cursor datagrams
                │
                ▼
7. Collaborate in real time
```

The initial room snapshot gives the client the current canvas state.

After that, incremental events keep the client synchronized.

---

# Room Snapshot

When a user joins a room, the server sends the current state of the room.

```rust
pub struct RoomSnapshot {
    pub user_id: String,
    pub elements: Vec<Element>,
}
```

This avoids requiring the client to reconstruct the entire canvas from individual historical events.

---

# Room Events

After the initial snapshot, the client receives incremental events.

```text
UserJoined
UserLeft
ElementUpdated
```

For example:

```text
User A
   │
   │ UpdateElement
   ▼
Rust Room Actor
   │
   ├──────────────► User B
   ├──────────────► User C
   └──────────────► User D
```

This allows all clients in a room to receive changes without each client communicating directly with every other client.

---

# Cursor Updates

Cursor updates are handled separately from reliable room events.

```rust
pub struct CursorUpdate {
    pub user_id: String,
    pub x: f32,
    pub y: f32,
}
```

Cursor updates are sent using WebTransport datagrams.

This is intentional because cursor movement is high-frequency and intermediate positions can quickly become stale.

For example:

```text
100px → 110px → 120px → 130px → 140px
```

If the network is delayed, receiving:

```text
100px
110px
120px
130px
140px
```

is less useful than receiving the latest position:

```text
140px
```

The datagram model fits this type of ephemeral data well.

---

# MessagePack

The real-time protocol uses MessagePack instead of JSON.

The Rust server uses:

* `serde`
* `rmp-serde`
* `rmpv`

MessagePack provides a compact binary representation while still allowing structured application data to be serialized and deserialized.

This is particularly useful for frequent real-time messages where reducing payload size and serialization overhead can matter.

---

# Frontend Data Flow

The client separates transport handling from application state.

```text
WebTransport
      │
      ▼
MessagePack decoding
      │
      ▼
Message classification
      │
      ├──────────────┐
      │              │
      ▼              ▼
Room events      Cursor updates
      │              │
      ▼              ▼
Canvas state      Cursor state
      │
      ▼
React UI
```

This keeps high-frequency cursor updates separate from the main collaborative document state.

---

# Backend Architecture

The backend is implemented separately in Rust:

https://github.com/MrAbraj/rust-webtransport-server

The server uses:

* Rust
* Tokio
* WebTransport
* QUIC
* MessagePack
* DashMap
* Async channels
* Per-room actors

The room registry uses `DashMap` for concurrent room lookup.

Each room has its own asynchronous processing path, allowing room state to remain isolated.

```text
                  Room Registry
                       │
          ┌────────────┼────────────┐
          │            │            │
          ▼            ▼            ▼
       Room A        Room B       Room C
          │            │            │
          ▼            ▼            ▼
     Room Actor    Room Actor    Room Actor
          │            │            │
          ▼            ▼            ▼
       Clients       Clients      Clients
```

This avoids putting all room activity behind one global room-level lock.

---

# Performance-Oriented Design

The project is designed around low-latency real-time communication.

Important design choices include:

### WebTransport / QUIC

Provides multiplexed communication and supports both streams and datagrams.

### Datagrams for cursor updates

Avoids requiring every intermediate cursor position to be reliably delivered.

### MessagePack

Uses a compact binary protocol instead of verbose JSON messages.

### In-memory room state

Room state is kept in memory for fast access.

### Tokio

Provides asynchronous networking and concurrent task execution.

### Per-room actors

Room state is processed independently rather than having many tasks directly mutate the same room state.

### DashMap

Provides concurrent access to the global room registry.

---

# Performance and Benchmarking

The project is **performance-oriented**, but currently does not publish synthetic benchmark numbers.

Therefore, this project does not claim that WebTransport is universally faster than WebSocket.

Actual performance depends on:

* Network conditions
* Packet loss
* Number of concurrent clients
* Message frequency
* Payload size
* Browser
* Server hardware
* Room size
* Rendering workload

The main performance goal is to use the transport primitives appropriately rather than simply maximizing message throughput.

### Planned benchmarks

A future benchmark will compare the same workload using:

```text
WebSocket
    vs
WebTransport
```

Metrics will include:

* p50 latency
* p95 latency
* p99 latency
* messages/sec
* CPU usage
* memory usage
* payload size
* behavior under packet loss
* concurrent client count

Measured results will be added here once available.

---

# Technical Decisions

## Why Rust?

The backend is primarily a real-time networking experiment.

Rust provides:

* Low runtime overhead
* Strong memory safety
* Efficient concurrency
* Good control over networking resources
* A strong ecosystem for asynchronous networking

## Why Tokio?

Tokio provides the asynchronous runtime used by the server.

It allows the server to handle many concurrent connections and room tasks without dedicating a blocking thread to every operation.

## Why WebTransport?

The application needs both:

* Reliable ordered communication
* Unreliable high-frequency communication

WebTransport provides both through streams and datagrams.

## Why MessagePack?

The application sends structured real-time data frequently.

MessagePack provides a compact binary representation while retaining structured serialization.

## Why DashMap?

The server maintains a global mapping of room IDs to room handles.

`DashMap` allows concurrent room lookup without requiring one global mutex around the entire registry.

## Why Room Actors?

Each room owns its state and processes commands through asynchronous channels.

This makes ownership explicit and reduces the need for multiple tasks to directly mutate shared room state.

---

# Current Limitations

This is currently a technical exploration and does not include every concern required for a production collaborative platform.

Current limitations include:

* Room state is stored in memory.
* Persistent storage is not implemented.
* Authentication is not currently included.
* Horizontal scaling across multiple server instances is not implemented.
* Cross-server room synchronization is not implemented.
* WebSocket benchmark comparison has not yet been completed.
* Conflict resolution is currently handled by the application's element/version model rather than a full CRDT implementation.

---

# Future Improvements

Potential improvements include:

* WebSocket vs WebTransport benchmarks
* Larger room sizes
* Message batching
* Client-side update coalescing
* Reconnection and session recovery
* Authentication
* Persistent room storage
* Horizontal server scaling
* Redis/pub-sub for cross-server room synchronization
* CRDT-based conflict resolution
* Performance telemetry
* Load testing with thousands of concurrent connections

---

# Running Locally

## 1. Start the Rust Server

Clone the backend:

```bash
git clone https://github.com/MrAbraj/rust-webtransport-server.git
cd rust-webtransport-server
cargo run
```

The server starts the local WebTransport endpoint using its development TLS configuration.

## 2. Start the Client

Clone this repository:

```bash
git clone https://github.com/MrAbraj/realtime-collaborative-canvas.git
cd realtime-collaborative-canvas
npm install
```

Start the development server:

```bash
npm run dev
```

Configure the WebTransport server endpoint according to the client configuration.

Open the application in multiple browser windows and connect them to the same room to test collaboration.

---

# Project Structure

```text
src/
├── components/
├── hooks/
├── lib/
├── ...
```

The main application areas include:

* Canvas rendering
* WebTransport connection management
* MessagePack encoding/decoding
* Room synchronization
* Real-time event handling
* Cursor handling
* Collaborative state management

---

# Related Repository

### Rust WebTransport Server

https://github.com/MrAbraj/rust-webtransport-server

The backend contains the WebTransport server, room management, room actors, cursor handling and real-time event broadcasting.

### React Collaborative Canvas

https://github.com/MrAbraj/realtime-collaborative-canvas

This repository contains the frontend client that consumes the WebTransport protocol.

---

# Why I Built This

I wanted to explore how a real-time collaborative application could handle different types of data with different delivery requirements.

A collaborative canvas provides a useful real-world workload because it combines:

* High-frequency cursor movement
* Reliable canvas updates
* Initial state synchronization
* User presence
* Multiple concurrent users
* Continuous real-time events

Instead of sending everything through a single reliable channel, the project uses WebTransport streams and datagrams according to the requirements of each type of data.

The goal is to understand the trade-offs involved in building a low-latency real-time application and to experiment with a modern WebTransport + QUIC + Rust architecture.
