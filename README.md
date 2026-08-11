# SMT Floor Dashboard: Real-Time IIoT Ingestion & Visualization

## 1. Executive Summary
The SMT Floor Dashboard is a real-time, event-driven Industrial IoT (IIoT) web application. It bridges the gap between high-frequency, legacy manufacturing edge devices (Yamaha SMT machines) and modern browser interfaces. 

By implementing an **OS-level File Watcher**, a **Predictive Node.js Middleware Engine**, and a **Zustand O(1) Dictionary Store**, this system guarantees zero-latency UI updates, prevents browser memory exhaustion via DOM Virtualization, and completely protects enterprise databases (Oracle/ERP) from polling-induced throttling.

---

## 2. End-to-End System Architecture

The data lifecycle follows a strict, unidirectional Pub/Sub (Publish-Subscribe) flow divided into three distinct layers.

### Layer 1: The Edge (Data Generation)
* **Mechanism:** Physical Yamaha machines (simulated by a background script) drop raw CSV files into a network drive at varying intervals (5s, 7s, 9s, 11s).
* **Data Shape:** These files contain strictly physical state data: `line_id`, `feeder_position`, `part_number`, `current_quantity`.

### Layer 2: The Middleware (Ingestion & Predictive Math)
* **OS-Level Watcher (`chokidar`):** Hooks directly into the operating system kernel to detect file write completions, eliminating CPU-heavy polling loops.
* **Stateful Cache & Diffing Engine:** When a new CSV arrives, the Node server compares the new quantities against the previous tick stored in memory.
* **Predictive Math:** The server calculates the `parts_per_second` (velocity) and `time_left_seconds` (lifespan) before appending this enriched data to the JSON payload.
* **Socket.io Broker:** The server blasts the enriched JSON payload over a persistent full-duplex TCP WebSocket connection to all subscribed UI clients.

### Layer 3: The Presentation (React UI)
* **O(1) Memory Store (Zustand):** Data arrives at the browser and is merged into a Dictionary (Object Map) using a composite key (`line_id-feeder_position`). React only re-renders the exact DOM nodes that mathematically changed.
* **Decoupled Rendering:** Both the HTML Table and the SVG Bar Chart subscribe to the exact same Zustand memory slice. Toggling views destroys/re-mounts the DOM elements instantly without re-requesting data.
* **DOM Virtualization (TanStack):** Only the ~20 table rows visible in the user's viewport are physically rendered in the browser memory, allowing the app to scale to thousands of SMT components without dropping frames.

---

## 3. Directory Structure & File Navigation

The codebase is contained within a single overarching repository. The backend ingestion service is nested inside the frontend project directory for consolidated local development.

```text
smt-dashboard/                   <-- Root Project Directory
├── node_modules/                <-- Frontend dependencies
├── public/                      <-- Static public assets
│
├── smt-backend/                 <-- ⚙️ NESTED NODE.JS MIDDLEWARE
│   ├── dropzone/                <-- OS Watcher target for simulated CSVs
│   ├── node_modules/            <-- Backend-specific dependencies
│   ├── package.json         
│   ├── server.js                <-- Core WebSocket & Predictive Math Engine
│   └── simulator.js             <-- Physical Yamaha Machine Digital Twin
│
├── src/                         <-- 💻 REACT FRONTEND
│   ├── assets/              
│   ├── components/          
│   │   ├── dashboard/       
│   │   │   └── LineOverview.tsx <-- Headless line selector & ERP tooltip
│   │   └── inventory/       
│   │       ├── ComponentTable.tsx 
│   │       └── ComponentChart.tsx 
│   ├── hooks/               
│   │   └── useSmtSocket.ts      <-- WebSocket gateway & topic subscriber
│   ├── store/               
│   │   └── useSmtStore.ts       <-- Zustand O(1) Dictionary Map
│   ├── types/               
│   │   └── index.ts             <-- Strict TypeScript data contracts
│   ├── App.tsx                  <-- Main UI layout & toggle state manager
│   └── main.tsx                 <-- React DOM entry point
│
├── .gitignore
└── package.json                 <-- Frontend Vite/React configuration
