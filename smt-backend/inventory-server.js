/**
 * SMT Inventory REST Server — Port 3002
 *
 * ACTUAL QR FORMAT:  PART_NUMBER$PARTS_ID$LOT_ID$INITIAL_QUANTITY
 * EXAMPLE:           GME34681008DJRE$PP2344F$LT0016$10000
 *
 * The QR does NOT contain component type, reel ID, or feeder info.
 *
 * ROUTING LOGIC (fully data-driven, zero hardcoding):
 *   1. Parse QR  →  extract partNumber
 *   2. MASTER.json partMappings[partNumber]  →  componentType + file
 *   3. Open/create that category JSON file
 *   4. Duplicate check: same partNumber + partsId + lotId  →  update existing
 *   5. New reel: generate next REEL ID  →  insert
 *   6. Save file  →  broadcast via Socket.io
 *
 * REST API:
 *   GET  /api/health
 *   GET  /api/config/master
 *   GET  /api/config/qr-format
 *   GET  /api/config/lines
 *   GET  /api/inventory               — all categories
 *   GET  /api/inventory/:type         — single category
 *   POST /api/scan                    — submit raw QR string
 *   PUT  /api/reel/:reelId/quantity   — update remaining quantity (machine consumption)
 *   DELETE /api/reel/:reelId          — remove a reel
 */

const express = require('express');
const cors    = require('cors');
const fs      = require('fs');
const path    = require('path');
const { Server } = require('socket.io');
const http    = require('http');

// ─── CONFIGURATION ────────────────────────────────────────────────────────────
const PORT     = process.env.INVENTORY_PORT || 3002;
const DATA_DIR = path.join(__dirname, 'SMT_DATA');

// ─── EXPRESS + SOCKET.IO SETUP ───────────────────────────────────────────────
const app    = express();
const server = http.createServer(app);
const io     = new Server(server, { cors: { origin: '*' } });

app.use(cors());
app.use(express.json());

// ─── FILE HELPERS ─────────────────────────────────────────────────────────────

function readJsonFile(filename) {
  const filePath = path.join(DATA_DIR, filename);
  if (!fs.existsSync(filePath)) {
    throw new Error(`File not found: ${filename}`);
  }
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeJsonFile(filename, data) {
  const filePath = path.join(DATA_DIR, filename);
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
}

function loadMaster() {
  return readJsonFile('MASTER.json');
}

function loadQrFormat() {
  return readJsonFile('qr-format.json');
}

// ─── REEL ID GENERATOR ────────────────────────────────────────────────────────
/**
 * Generate the next sequential Reel ID (e.g. "REEL00009").
 * Counter is stored in reel-counter.json to persist across restarts.
 */
function generateNextReelId() {
  const counterFile = 'reel-counter.json';
  let counter;
  try {
    counter = readJsonFile(counterFile);
  } catch {
    counter = { lastId: 0 };
  }

  counter.lastId += 1;
  writeJsonFile(counterFile, counter);

  // Zero-pad to 5 digits: REEL00001, REEL00010, REEL00100
  return `REEL${String(counter.lastId).padStart(5, '0')}`;
}

// ─── QR PARSER ───────────────────────────────────────────────────────────────
/**
 * Parse a raw QR string using qr-format.json configuration.
 *
 * Actual format: GME34681008DJRE$PP2344F$LT0016$10000
 *
 * Returns: { partNumber, partsId, lotId, initialQuantity }
 * Throws if required fields are missing.
 */
function parseQrString(rawString, qrFormat) {
  const sep   = qrFormat.separator || '$';
  const parts = rawString.trim().split(sep);
  const result = {};

  for (const field of qrFormat.fields) {
    let value = (parts[field.position] !== undefined && parts[field.position] !== '')
      ? parts[field.position].trim()
      : (field.default !== undefined ? field.default : null);

    // Apply transforms
    if (value !== null) {
      if (field.transform === 'parseInt')   value = parseInt(value, 10);
      if (field.transform === 'parseFloat') value = parseFloat(value);
      if (field.transform === 'uppercase')  value = String(value).toUpperCase();
      if (field.transform === 'lowercase')  value = String(value).toLowerCase();
    }

    result[field.name] = value;
  }

  // Validate required fields
  const missing = qrFormat.fields
    .filter(f => f.required && (result[f.name] === null || result[f.name] === undefined || result[f.name] === ''))
    .map(f => f.name);

  if (missing.length > 0) {
    throw new Error(`QR data is missing required fields: ${missing.join(', ')}`);
  }

  // Validate quantity is a sensible number
  if (result.initialQuantity !== undefined && (isNaN(result.initialQuantity) || result.initialQuantity < 0)) {
    throw new Error(`Invalid initialQuantity: "${parts[3] ?? ''}". Must be a positive number.`);
  }

  return result;
}

// ─── MASTER LOOKUP: Part Number → Category File ───────────────────────────────
/**
 * Given a partNumber, look it up in MASTER.json partMappings section.
 * Returns { componentType, file, description } or throws.
 *
 * NO if/else per component type. All routing is data-driven from MASTER.json.
 */
function resolvePartNumber(partNumber, master) {
  const mapping = master.partMappings && master.partMappings[partNumber];
  if (!mapping) {
    const knownParts = Object.keys(master.partMappings || {}).join(', ');
    throw new Error(
      `Unknown part number: "${partNumber}". ` +
      `Add it to MASTER.json partMappings. ` +
      `Known parts: ${knownParts || '(none yet)'}`
    );
  }
  return mapping; // { componentType, file, description? }
}

// ─── DUPLICATE DETECTION ─────────────────────────────────────────────────────
/**
 * A physical reel is uniquely identified by the combination of:
 *   partNumber + partsId + lotId
 *
 * If all three match an existing reel, this is the SAME physical reel
 * being scanned again (not a new reel).
 *
 * Returns the existing reel object if found, null otherwise.
 */
function findExistingReel(categoryData, partNumber, partsId, lotId) {
  return (categoryData.reels || []).find(
    r => r.partNumber === partNumber &&
         r.partsId    === partsId    &&
         r.lotId      === lotId
  ) || null;
}

// ─── THRESHOLDS ─────────────────────────────────────────────────────
function loadThresholds() {
  try {
    return readJsonFile('thresholds.json');
  } catch {
    return { global: { warningQuantity: 1000, criticalQuantity: 500 }, perType: {} };
  }
}

/**
 * Compute reel status using thresholds.json absolute quantity values.
 * Checks per-component-type thresholds first, falls back to global.
 *
 * Status:
 *   CRITICAL  — remainingQuantity <= criticalQuantity
 *   WARNING   — remainingQuantity <= warningQuantity
 *   OK        — remainingQuantity > warningQuantity
 */
function computeReelStatus(reel, componentType) {
  const thresholds = loadThresholds();
  const perType = (thresholds.perType || {})[componentType] || {};
  const global  = thresholds.global || {};

  const criticalQty = perType.criticalQuantity ?? global.criticalQuantity ?? 500;
  const warningQty  = perType.warningQuantity  ?? global.warningQuantity  ?? 1000;

  if (reel.remainingQuantity <= criticalQty) return 'critical';
  if (reel.remainingQuantity <= warningQty)  return 'warning';
  return 'ok';
}

function enrichWithStatus(categoryData) {
  const thresholds = loadThresholds();
  const type = categoryData.componentType;
  const perType = (thresholds.perType || {})[type] || {};
  const global  = thresholds.global || {};
  const criticalQty = perType.criticalQuantity ?? global.criticalQuantity ?? 500;
  const warningQty  = perType.warningQuantity  ?? global.warningQuantity  ?? 1000;

  return {
    ...categoryData,
    thresholds: { criticalQuantity: criticalQty, warningQuantity: warningQty },
    reels: (categoryData.reels || []).map(r => ({
      ...r,
      computedStatus: computeReelStatus(r, type)
    }))
  };
}

// ─── BROADCAST ────────────────────────────────────────────────────────────────
function broadcastUpdate(categoryData) {
  io.emit('reel_inventory_update', enrichWithStatus(categoryData));
}

// ─────────────────────────────────────────────────────────────────────────────
// REST ENDPOINTS
// ─────────────────────────────────────────────────────────────────────────────

// GET /api/health
app.get('/api/health', (_req, res) => {
  res.json({
    status: 'ok',
    port: PORT,
    dataDir: DATA_DIR,
    timestamp: new Date().toISOString()
  });
});

// GET /api/config/master
app.get('/api/config/master', (_req, res) => {
  try {
    res.json(loadMaster());
  } catch (err) {
    res.status(500).json({ error: 'FILE_ERROR', message: err.message });
  }
});

// GET /api/config/qr-format
app.get('/api/config/qr-format', (_req, res) => {
  try {
    res.json(loadQrFormat());
  } catch (err) {
    res.status(500).json({ error: 'FILE_ERROR', message: err.message });
  }
});

// GET /api/config/thresholds
app.get('/api/config/thresholds', (_req, res) => {
  try {
    res.json(loadThresholds());
  } catch (err) {
    res.status(500).json({ error: 'FILE_ERROR', message: err.message });
  }
});

// GET /api/config/lines
app.get('/api/config/lines', (_req, res) => {
  try {
    res.json(readJsonFile('lines.json'));
  } catch (err) {
    res.status(500).json({ error: 'FILE_ERROR', message: err.message });
  }
});

// GET /api/inventory — all categories
app.get('/api/inventory', (_req, res) => {
  try {
    const master = loadMaster();
    const result = {};

    for (const [type, meta] of Object.entries(master.componentTypes || {})) {
      try {
        result[type] = enrichWithStatus(readJsonFile(meta.file));
      } catch {
        result[type] = { componentType: type, reels: [] };
      }
    }

    res.json(result);
  } catch (err) {
    res.status(500).json({ error: 'FILE_ERROR', message: err.message });
  }
});

// GET /api/inventory/:type — single category by component type name
app.get('/api/inventory/:type', (req, res) => {
  try {
    const type   = req.params.type.toUpperCase();
    const master = loadMaster();
    const meta   = master.componentTypes && master.componentTypes[type];

    if (!meta) {
      return res.status(422).json({
        error: 'UNKNOWN_TYPE',
        message: `Component type "${type}" not found in MASTER.json componentTypes`
      });
    }

    let catData;
    try {
      catData = readJsonFile(meta.file);
    } catch {
      catData = { componentType: type, reels: [] };
    }

    res.json(enrichWithStatus(catData));
  } catch (err) {
    res.status(500).json({ error: 'SERVER_ERROR', message: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/scan  — THE MAIN QR SCAN ENDPOINT
//
// Expected body:
//   { "rawQr": "GME34681008DJRE$PP2344F$LT0016$10000" }
//
// Full flow:
//   1. Parse rawQr using qr-format.json  →  { partNumber, partsId, lotId, initialQuantity }
//   2. Look up partNumber in MASTER.json partMappings  →  { componentType, file }
//   3. Load category JSON file
//   4. Duplicate check: partNumber + partsId + lotId  →  exists? update : create
//   5. If new: generate next Reel ID, insert record
//   6. Save file  →  broadcast via Socket.io
// ─────────────────────────────────────────────────────────────────────────────
app.post('/api/scan', (req, res) => {
  try {
    const { rawQr } = req.body;

    // ── STEP 1: Validate raw input ──────────────────────────────────
    if (!rawQr || typeof rawQr !== 'string' || !rawQr.trim()) {
      return res.status(400).json({
        error: 'BAD_REQUEST',
        message: 'Request body must contain "rawQr" (string). Example: "GME34681008DJRE$PP2344F$LT0016$10000"'
      });
    }

    // ── STEP 2: Parse QR string ─────────────────────────────────────
    const qrFormat = loadQrFormat();
    let qrData;
    try {
      qrData = parseQrString(rawQr, qrFormat);
    } catch (parseErr) {
      return res.status(400).json({
        error: 'INVALID_QR',
        message: parseErr.message,
        rawQr,
        hint: `Expected format: PART_NUMBER${qrFormat.separator}PARTS_ID${qrFormat.separator}LOT_ID${qrFormat.separator}INITIAL_QUANTITY`
      });
    }

    const { partNumber, partsId, lotId, initialQuantity } = qrData;

    // ── STEP 3: Look up partNumber in MASTER.json ───────────────────
    const master = loadMaster();
    let mapping;
    try {
      mapping = resolvePartNumber(partNumber, master);
    } catch (lookupErr) {
      return res.status(422).json({
        error: 'UNKNOWN_PART',
        partNumber,
        message: lookupErr.message,
        hint: `Add "${partNumber}" to the partMappings section of MASTER.json`
      });
    }

    const { componentType, file: categoryFile } = mapping;

    // ── STEP 4: Load (or initialize) category file ──────────────────
    let categoryData;
    try {
      categoryData = readJsonFile(categoryFile);
    } catch {
      // Category file doesn't exist yet — create empty structure
      categoryData = { componentType, reels: [] };
    }

    // Ensure reels array exists
    if (!Array.isArray(categoryData.reels)) {
      categoryData.reels = [];
    }

    const now = new Date().toISOString();

    // ── STEP 5: Duplicate detection ─────────────────────────────────
    // Same physical reel = same partNumber + partsId + lotId
    const existing = findExistingReel(categoryData, partNumber, partsId, lotId);

    let action;
    let reelRecord;

    if (existing) {
      // ── DUPLICATE: Same reel scanned again ──
      // Re-scanning a reel that is already registered.
      // Update the scan timestamp but do NOT change initialQuantity or reelId.
      existing.lastUpdated = now;
      existing.status = 'ACTIVE';
      action     = 'already_registered';
      reelRecord = existing;
    } else {
      // ── NEW REEL: Insert ──
      const reelId = generateNextReelId();
      reelRecord = {
        reelId,
        partNumber,
        partsId,
        lotId,
        initialQuantity,
        remainingQuantity: initialQuantity, // starts full
        status: 'ACTIVE',
        scannedAt: now,
        lastUpdated: now
      };
      categoryData.reels.push(reelRecord);
      action = 'created';
    }

    // ── STEP 6: Save to disk ─────────────────────────────────────────
    writeJsonFile(categoryFile, categoryData);

    // ── STEP 7: Broadcast via Socket.io ─────────────────────────────
    broadcastUpdate(categoryData);

    // ── STEP 8: Respond ──────────────────────────────────────────────
    const httpStatus = action === 'created' ? 201 : 200;
    return res.status(httpStatus).json({
      success: true,
      action,
      componentType,
      reelId: reelRecord.reelId,
      partNumber,
      partsId,
      lotId,
      initialQuantity,
      file: categoryFile,
      message: action === 'created'
        ? `New reel ${reelRecord.reelId} registered in ${categoryFile}`
        : `Reel ${reelRecord.reelId} already registered — scan recorded`
    });

  } catch (err) {
    console.error('[POST /api/scan] Unexpected error:', err.message);
    res.status(500).json({ error: 'SERVER_ERROR', message: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// PUT /api/reel/:reelId/quantity
// Update remaining quantity — called when machine consumption data arrives.
//
// Body: { "remainingQuantity": 7500, "componentType": "CAPACITOR" }
//       componentType is optional (speeds up search; omit to search all files)
// ─────────────────────────────────────────────────────────────────────────────
app.put('/api/reel/:reelId/quantity', (req, res) => {
  try {
    const { reelId } = req.params;
    const { remainingQuantity, componentType } = req.body;

    if (remainingQuantity === undefined || isNaN(Number(remainingQuantity))) {
      return res.status(400).json({
        error: 'BAD_REQUEST',
        message: '"remainingQuantity" must be a non-negative number'
      });
    }

    const master = loadMaster();
    // If componentType given, only search that file; otherwise search all
    const typesToSearch = componentType
      ? [componentType.toUpperCase()]
      : Object.keys(master.componentTypes || {});

    for (const type of typesToSearch) {
      const meta = master.componentTypes[type];
      if (!meta) continue;

      let catData;
      try { catData = readJsonFile(meta.file); } catch { continue; }

      const idx = (catData.reels || []).findIndex(r => r.reelId === reelId);
      if (idx >= 0) {
        const reel = catData.reels[idx];

        // Guard: can't exceed initial quantity
        const newQty = Math.max(0, Math.min(Number(remainingQuantity), reel.initialQuantity));
        reel.remainingQuantity = newQty;
        reel.lastUpdated = new Date().toISOString();
        if (newQty === 0) reel.status = 'DEPLETED';

        writeJsonFile(meta.file, catData);
        broadcastUpdate(catData);

        return res.json({
          success: true,
          reelId,
          remainingQuantity: newQty,
          componentType: type,
          status: computeReelStatus(reel)
        });
      }
    }

    res.status(404).json({
      error: 'NOT_FOUND',
      message: `Reel "${reelId}" not found in any category file`
    });

  } catch (err) {
    res.status(500).json({ error: 'SERVER_ERROR', message: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// DELETE /api/reel/:reelId
// Remove a reel record from its category file.
// Query: ?componentType=CAPACITOR  (optional, speeds up search)
// ─────────────────────────────────────────────────────────────────────────────
app.delete('/api/reel/:reelId', (req, res) => {
  try {
    const { reelId }    = req.params;
    const componentType = req.query.componentType;
    const master        = loadMaster();
    const typesToSearch = componentType
      ? [componentType.toUpperCase()]
      : Object.keys(master.componentTypes || {});

    for (const type of typesToSearch) {
      const meta = master.componentTypes[type];
      if (!meta) continue;

      let catData;
      try { catData = readJsonFile(meta.file); } catch { continue; }

      const before = catData.reels.length;
      catData.reels = catData.reels.filter(r => r.reelId !== reelId);

      if (catData.reels.length < before) {
        writeJsonFile(meta.file, catData);
        broadcastUpdate(catData);
        return res.json({ success: true, reelId, componentType: type });
      }
    }

    res.status(404).json({ error: 'NOT_FOUND', message: `Reel "${reelId}" not found` });

  } catch (err) {
    res.status(500).json({ error: 'SERVER_ERROR', message: err.message });
  }
});

// ─── SOCKET.IO ───────────────────────────────────────────────────────────────
io.on('connection', (socket) => {
  console.log(`[Socket.io] Client connected: ${socket.id}`);

  // Send full inventory snapshot on connect
  try {
    const master = loadMaster();
    const fullInventory = {};
    for (const [type, meta] of Object.entries(master.componentTypes || {})) {
      try {
        fullInventory[type] = enrichWithStatus(readJsonFile(meta.file));
      } catch {
        fullInventory[type] = { componentType: type, reels: [] };
      }
    }
    socket.emit('reel_inventory_full', fullInventory);
  } catch (err) {
    console.error('[Socket.io] Failed to send initial inventory:', err.message);
  }

  socket.on('disconnect', () => {
    console.log(`[Socket.io] Client disconnected: ${socket.id}`);
  });
});

// ─── START ────────────────────────────────────────────────────────────────────
server.listen(PORT, () => {
  console.log(`\n╔═══════════════════════════════════════════════════╗`);
  console.log(`║  SMT Inventory Server  —  port ${PORT}              ║`);
  console.log(`╚═══════════════════════════════════════════════════╝`);
  console.log(`\n  QR Format:  PART_NUMBER$PARTS_ID$LOT_ID$INITIAL_QTY`);
  console.log(`  Example:    GME34681008DJRE$PP2344F$LT0016$10000\n`);
  console.log(`  GET  http://localhost:${PORT}/api/health`);
  console.log(`  GET  http://localhost:${PORT}/api/config/master`);
  console.log(`  GET  http://localhost:${PORT}/api/config/qr-format`);
  console.log(`  GET  http://localhost:${PORT}/api/inventory`);
  console.log(`  POST http://localhost:${PORT}/api/scan`);
  console.log(`  PUT  http://localhost:${PORT}/api/reel/:reelId/quantity`);
  console.log(`  DELETE http://localhost:${PORT}/api/reel/:reelId\n`);
});
