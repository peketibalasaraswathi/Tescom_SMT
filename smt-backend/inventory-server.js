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
 *   4. Save complete historical reel record to category Excel (.xlsx) file
 *   5. Save ONLY the most recent scan in child JSON file for live dashboard
 *   6. Broadcast via Socket.io
 *
 * REST API:
 *   GET  /api/health
 *   GET  /api/config/master
 *   GET  /api/config/qr-format
 *   GET  /api/config/lines
 *   GET  /api/inventory                    — all categories (recent scan only)
 *   GET  /api/inventory/:type              — single category (recent scan only)
 *   GET  /api/inventory/:type/excel        — download category Excel file (.xlsx)
 *   GET  /api/inventory/:type/history      — all historical reels from Excel
 *   GET  /api/inventory/export/all-excel   — download master multi-sheet Excel file
 *   POST /api/scan                         — submit raw QR string
 *   PUT  /api/reel/:reelId/quantity        — update remaining quantity
 *   DELETE /api/reel/:reelId               — remove a reel
 */

const express = require('express');
const cors    = require('cors');
const fs      = require('fs');
const path    = require('path');
const { Server } = require('socket.io');
const http    = require('http');
const excelManager = require('./excel-manager');

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

// ─── STARTUP MIGRATION / INITIALIZATION ───────────────────────────────────────
/**
 * Ensures that all existing historical reels in JSON files are stored into
 * their respective .xlsx files, and that the JSON files only hold the single
 * most recent scanned reel.
 */
async function initializeExcelArchivesAndPruneJson() {
  try {
    const master = loadMaster();
    for (const [type, meta] of Object.entries(master.componentTypes || {})) {
      const jsonPath = path.join(DATA_DIR, meta.file);
      if (!fs.existsSync(jsonPath)) continue;

      let catData = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
      const reels = catData.reels || [];

      // 1. Ensure Excel file exists and contains all historical reels
      const excelPath = excelManager.getExcelPath(DATA_DIR, type);
      if (!fs.existsSync(excelPath) && reels.length > 0) {
        await excelManager.syncCategoryReelsToExcel(DATA_DIR, type, reels, meta);
        console.log(`[Excel Init] Created ${type}.xlsx with ${reels.length} historical reel(s)`);
      }

      // 2. Prune JSON file to contain ONLY the single most recent reel
      if (reels.length > 1) {
        // Sort descending by scannedAt / lastUpdated
        reels.sort((a, b) => new Date(b.lastUpdated || b.scannedAt || 0) - new Date(a.lastUpdated || a.scannedAt || 0));
        catData.reels = [reels[0]]; // Keep only the latest reel
        writeJsonFile(meta.file, catData);
        console.log(`[JSON Prune] Kept 1 most recent reel (${catData.reels[0].reelId}) in ${meta.file}`);
      }
    }
  } catch (err) {
    console.error('[Excel Init Error] Failed during startup migration:', err.message);
  }
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

// GET /api/inventory — all categories (recent scan only)
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

// GET /api/inventory/:type — single category by component type name (recent scan only)
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

// GET /api/inventory/:type/excel — Download category Excel file (.xlsx)
app.get('/api/inventory/:type/excel', async (req, res) => {
  try {
    const type   = req.params.type.toUpperCase();
    const master = loadMaster();
    const meta   = master.componentTypes && master.componentTypes[type];

    if (!meta) {
      return res.status(404).json({ error: 'NOT_FOUND', message: `Unknown category "${type}"` });
    }

    const excelPath = excelManager.getExcelPath(DATA_DIR, type);

    // If file doesn't exist yet, generate it from current JSON data
    if (!fs.existsSync(excelPath)) {
      let catData = { componentType: type, reels: [] };
      try { catData = readJsonFile(meta.file); } catch {}
      await excelManager.syncCategoryReelsToExcel(DATA_DIR, type, catData.reels || [], meta);
    }

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${type}_Reel_Inventory.xlsx"`);
    res.sendFile(excelPath);
  } catch (err) {
    res.status(500).json({ error: 'EXCEL_ERROR', message: err.message });
  }
});

// GET /api/inventory/:type/history — Full historical list from Excel
app.get('/api/inventory/:type/history', async (req, res) => {
  try {
    const type = req.params.type.toUpperCase();
    const reels = await excelManager.readReelsFromExcel(DATA_DIR, type);
    res.json({ componentType: type, totalReels: reels.length, reels });
  } catch (err) {
    res.status(500).json({ error: 'HISTORY_ERROR', message: err.message });
  }
});

// GET /api/inventory/export/all-excel — Download consolidated multi-sheet Excel
app.get('/api/inventory/export/all-excel', async (_req, res) => {
  try {
    const master = loadMaster();
    const workbook = await excelManager.generateMasterWorkbook(DATA_DIR, master);

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="SMT_All_Categories_Inventory.xlsx"');

    await workbook.xlsx.write(res);
    res.end();
  } catch (err) {
    console.error('[Export All Excel Error]:', err.message);
    res.status(500).json({ error: 'EXPORT_ERROR', message: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/scan  — THE MAIN QR SCAN ENDPOINT
//
// Expected body:
//   { "rawQr": "GME34681008DJRE$PP2344F$LT0016$10000" }
//
// Flow:
//   1. Parse rawQr
//   2. Look up partNumber in MASTER.json
//   3. Generate next Reel ID (or find existing)
//   4. Save / append full record to <CATEGORY>.xlsx
//   5. Keep ONLY the single latest scan in <CATEGORY>.json for dashboard
//   6. Broadcast via Socket.io
// ─────────────────────────────────────────────────────────────────────────────
app.post('/api/scan', async (req, res) => {
  try {
    const { rawQr } = req.body;

    // ── STEP 1: Validate raw input ──────────────────────────────────
    if (!rawQr || typeof rawQr !== 'string' || !rawQr.trim()) {
      return res.status(400).json({
        error: 'BAD_REQUEST',
        message: 'Request body must contain "rawQr" (string).'
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
    const meta = master.componentTypes[componentType] || {};

    // ── STEP 4: Load category file ───────────────────────────────────
    let categoryData;
    try {
      categoryData = readJsonFile(categoryFile);
    } catch {
      categoryData = { componentType, reels: [] };
    }

    const now = new Date().toISOString();

    // ── STEP 5: Duplicate check ──────────────────────────────────────
    const existing = findExistingReel(categoryData, partNumber, partsId, lotId);

    let action;
    let reelRecord;

    if (existing) {
      existing.lastUpdated = now;
      existing.status = 'ACTIVE';
      action     = 'already_registered';
      reelRecord = existing;
    } else {
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
      action = 'created';
    }

    // Compute status level
    reelRecord.computedStatus = computeReelStatus(reelRecord, componentType);

    // ── STEP 6: Save full record into Category Excel (.xlsx) Archive ─
    await excelManager.appendOrUpdateReelInExcel(DATA_DIR, componentType, reelRecord, meta);

    // ── STEP 7: Save ONLY the single latest scan to child JSON ───────
    categoryData.reels = [reelRecord];
    writeJsonFile(categoryFile, categoryData);

    // ── STEP 8: Broadcast recent scan via Socket.io ──────────────────
    broadcastUpdate(categoryData);

    // ── STEP 9: Respond ──────────────────────────────────────────────
    const httpStatus = action === 'created' ? 201 : 200;
    const excelFilename = `${componentType}.xlsx`;

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
      excelFile: excelFilename,
      message: action === 'created'
        ? `New reel ${reelRecord.reelId} saved to ${categoryFile} (Recent) and logged to ${excelFilename} (Excel Archive)`
        : `Reel ${reelRecord.reelId} updated in ${categoryFile} & ${excelFilename}`
    });

  } catch (err) {
    console.error('[POST /api/scan] Unexpected error:', err.message);
    res.status(500).json({ error: 'SERVER_ERROR', message: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// PUT /api/reel/:reelId/quantity
// Update remaining quantity
// ─────────────────────────────────────────────────────────────────────────────
app.put('/api/reel/:reelId/quantity', async (req, res) => {
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
        const newQty = Math.max(0, Math.min(Number(remainingQuantity), reel.initialQuantity));
        reel.remainingQuantity = newQty;
        reel.lastUpdated = new Date().toISOString();
        if (newQty === 0) reel.status = 'DEPLETED';

        reel.computedStatus = computeReelStatus(reel, type);

        // Update in JSON
        writeJsonFile(meta.file, catData);

        // Update in Excel Archive
        await excelManager.appendOrUpdateReelInExcel(DATA_DIR, type, reel, meta);

        broadcastUpdate(catData);

        return res.json({
          success: true,
          reelId,
          remainingQuantity: newQty,
          componentType: type,
          status: reel.computedStatus
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
});

// ─── START ────────────────────────────────────────────────────────────────────
server.listen(PORT, async () => {
  console.log(`\n╔═══════════════════════════════════════════════════╗`);
  console.log(`║  SMT Inventory Server  —  port ${PORT}              ║`);
  console.log(`║  Excel Archiving & Recent Scan Filter Enabled     ║`);
  console.log(`╚═══════════════════════════════════════════════════╝\n`);

  await initializeExcelArchivesAndPruneJson();

  console.log(`  REST Endpoints:`);
  console.log(`  GET  http://localhost:${PORT}/api/inventory               (Recent only)`);
  console.log(`  GET  http://localhost:${PORT}/api/inventory/:type/excel   (Category Excel)`);
  console.log(`  GET  http://localhost:${PORT}/api/inventory/export/all-excel (All Excel)`);
  console.log(`  POST http://localhost:${PORT}/api/scan\n`);
});
