/**
 * excel-manager.js — Excel (.xlsx) Archiving & Export Engine for SMT Reel Inventory
 *
 * Provides:
 *  - Per-category Excel file maintenance (e.g. CAPACITOR.xlsx, RESISTOR.xlsx)
 *  - Real-time appending & updating of scanned reels
 *  - Professional styling (headers, column widths, status colors)
 *  - Consolidated multi-sheet Excel export for all component categories
 *  - Migration utility to populate Excel files from initial JSON arrays
 */

const ExcelJS = require('exceljs');
const fs = require('fs');
const path = require('path');

const HEADERS = [
  { header: 'Reel ID', key: 'reelId', width: 16 },
  { header: 'Part Number', key: 'partNumber', width: 26 },
  { header: 'Parts ID', key: 'partsId', width: 18 },
  { header: 'Lot ID', key: 'lotId', width: 16 },
  { header: 'Initial Qty', key: 'initialQuantity', width: 15 },
  { header: 'Remaining Qty', key: 'remainingQuantity', width: 16 },
  { header: 'Level', key: 'status', width: 14 },
  { header: 'Scanned At', key: 'scannedAt', width: 22 },
  { header: 'Last Updated', key: 'lastUpdated', width: 22 }
];

function getExcelPath(dataDir, componentType) {
  const safeName = componentType.toUpperCase().replace(/[^A-Z0-9_-]/g, '_');
  return path.join(dataDir, `${safeName}.xlsx`);
}

function formatDate(isoStr) {
  if (!isoStr) return '';
  try {
    const d = new Date(isoStr);
    if (isNaN(d.getTime())) return isoStr;
    return d.toISOString().replace('T', ' ').substring(0, 19);
  } catch {
    return isoStr;
  }
}

function styleWorksheet(worksheet, componentType, meta) {
  worksheet.views = [{ state: 'frozen', ySplit: 1 }];

  // Style Header Row
  const headerRow = worksheet.getRow(1);
  headerRow.height = 28;
  headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11, name: 'Segoe UI' };
  
  // Choose header color based on component type if available
  let headerColor = 'FF1E40AF'; // Default Slate Blue
  if (meta && meta.color) {
    const hex = meta.color.replace('#', '');
    if (hex.length === 6) headerColor = `FF${hex.toUpperCase()}`;
  }

  headerRow.eachCell((cell) => {
    cell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: headerColor }
    };
    cell.alignment = { vertical: 'middle', horizontal: 'center' };
    cell.border = {
      top: { style: 'thin', color: { argb: 'FFD1D5DB' } },
      left: { style: 'thin', color: { argb: 'FFD1D5DB' } },
      bottom: { style: 'medium', color: { argb: 'FF111827' } },
      right: { style: 'thin', color: { argb: 'FFD1D5DB' } }
    };
  });
}

function styleDataRow(row, rowIndex, reel) {
  row.height = 22;
  row.font = { name: 'Segoe UI', size: 10 };

  const isEven = rowIndex % 2 === 0;
  const bgArgb = isEven ? 'FFF9FAFB' : 'FFFFFFFF';

  row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
    cell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: bgArgb }
    };
    cell.border = {
      top: { style: 'thin', color: { argb: 'FFE5E7EB' } },
      left: { style: 'thin', color: { argb: 'FFE5E7EB' } },
      bottom: { style: 'thin', color: { argb: 'FFE5E7EB' } },
      right: { style: 'thin', color: { argb: 'FFE5E7EB' } }
    };
    cell.alignment = { vertical: 'middle', horizontal: 'left' };

    // Format numbers
    if (colNumber === 5 || colNumber === 6) {
      cell.numFmt = '#,##0';
      cell.alignment = { vertical: 'middle', horizontal: 'right' };
    } else if (colNumber === 1 || colNumber === 7) {
      cell.alignment = { vertical: 'middle', horizontal: 'center' };
    }
  });

  // Status cell styling
  const statusCell = row.getCell('status');
  const st = String(reel.status || reel.computedStatus || 'OK').toUpperCase();
  if (st === 'CRITICAL') {
    statusCell.font = { bold: true, color: { argb: 'FFDC2626' } };
  } else if (st === 'WARNING') {
    statusCell.font = { bold: true, color: { argb: 'FFD97706' } };
  } else {
    statusCell.font = { bold: true, color: { argb: 'FF16A34A' } };
  }
}

/**
 * Append or update a scanned reel in the category Excel file
 */
async function appendOrUpdateReelInExcel(dataDir, componentType, reel, meta) {
  const filePath = getExcelPath(dataDir, componentType);
  const workbook = new ExcelJS.Workbook();
  const sheetName = componentType.substring(0, 31);

  if (fs.existsSync(filePath)) {
    await workbook.xlsx.readFile(filePath);
  }

  let worksheet = workbook.getWorksheet(sheetName) || workbook.worksheets[0];
  if (!worksheet) {
    worksheet = workbook.addWorksheet(sheetName);
    worksheet.columns = HEADERS;
    styleWorksheet(worksheet, componentType, meta);
  } else {
    worksheet.columns = HEADERS;
  }

  // Check if reel already exists in worksheet
  let existingRow = null;
  worksheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return; // skip header
    const rId = row.getCell('reelId').value;
    const pNum = row.getCell('partNumber').value;
    const pId = row.getCell('partsId').value;
    const lId = row.getCell('lotId').value;

    if (rId === reel.reelId || (pNum === reel.partNumber && pId === reel.partsId && lId === reel.lotId)) {
      existingRow = row;
    }
  });

  const rowData = {
    reelId: reel.reelId,
    partNumber: reel.partNumber,
    partsId: reel.partsId,
    lotId: reel.lotId,
    initialQuantity: reel.initialQuantity,
    remainingQuantity: reel.remainingQuantity !== undefined ? reel.remainingQuantity : reel.initialQuantity,
    status: (reel.computedStatus || reel.status || 'OK').toUpperCase(),
    scannedAt: formatDate(reel.scannedAt),
    lastUpdated: formatDate(reel.lastUpdated || reel.scannedAt)
  };

  if (existingRow) {
    existingRow.values = rowData;
    styleDataRow(existingRow, existingRow.number, reel);
  } else {
    const newRow = worksheet.addRow(rowData);
    styleDataRow(newRow, newRow.number, reel);
  }

  await workbook.xlsx.writeFile(filePath);
  return filePath;
}

/**
 * Initialize or sync an entire array of reels into the category Excel file
 */
async function syncCategoryReelsToExcel(dataDir, componentType, reels, meta) {
  if (!Array.isArray(reels) || reels.length === 0) return;
  const filePath = getExcelPath(dataDir, componentType);
  const workbook = new ExcelJS.Workbook();
  const sheetName = componentType.substring(0, 31);
  const worksheet = workbook.addWorksheet(sheetName);
  worksheet.columns = HEADERS;
  styleWorksheet(worksheet, componentType, meta);

  reels.forEach((reel, idx) => {
    const row = worksheet.addRow({
      reelId: reel.reelId,
      partNumber: reel.partNumber,
      partsId: reel.partsId,
      lotId: reel.lotId,
      initialQuantity: reel.initialQuantity,
      remainingQuantity: reel.remainingQuantity !== undefined ? reel.remainingQuantity : reel.initialQuantity,
      status: (reel.computedStatus || reel.status || 'OK').toUpperCase(),
      scannedAt: formatDate(reel.scannedAt),
      lastUpdated: formatDate(reel.lastUpdated || reel.scannedAt)
    });
    styleDataRow(row, idx + 2, reel);
  });

  await workbook.xlsx.writeFile(filePath);
  return filePath;
}

/**
 * Read all historical reels stored in an Excel file
 */
async function readReelsFromExcel(dataDir, componentType) {
  const filePath = getExcelPath(dataDir, componentType);
  if (!fs.existsSync(filePath)) return [];

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(filePath);
  const worksheet = workbook.worksheets[0];
  if (!worksheet) return [];

  const reels = [];
  worksheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return; // skip header
    reels.push({
      reelId: String(row.getCell(1).value || ''),
      partNumber: String(row.getCell(2).value || ''),
      partsId: String(row.getCell(3).value || ''),
      lotId: String(row.getCell(4).value || ''),
      initialQuantity: Number(row.getCell(5).value || 0),
      remainingQuantity: Number(row.getCell(6).value || 0),
      status: String(row.getCell(7).value || 'OK'),
      scannedAt: String(row.getCell(8).value || ''),
      lastUpdated: String(row.getCell(9).value || '')
    });
  });

  return reels;
}

/**
 * Generate a multi-sheet master Excel workbook containing all categories
 */
async function generateMasterWorkbook(dataDir, masterConfig) {
  const masterWorkbook = new ExcelJS.Workbook();
  masterWorkbook.creator = 'Tescom SMT Floor System';
  masterWorkbook.lastModifiedBy = 'SMT Ingestion Engine';
  masterWorkbook.created = new Date();

  const componentTypes = masterConfig.componentTypes || {};

  for (const [type, meta] of Object.entries(componentTypes)) {
    const rawName = (meta && meta.label) ? meta.label : type;
    const sheetName = rawName.replace(/[\\/?*[\]:]/g, '_').substring(0, 31);
    const worksheet = masterWorkbook.addWorksheet(sheetName);
    worksheet.columns = HEADERS;
    styleWorksheet(worksheet, type, meta);

    const reels = await readReelsFromExcel(dataDir, type);
    reels.forEach((reel, idx) => {
      const row = worksheet.addRow({
        reelId: reel.reelId,
        partNumber: reel.partNumber,
        partsId: reel.partsId,
        lotId: reel.lotId,
        initialQuantity: reel.initialQuantity,
        remainingQuantity: reel.remainingQuantity,
        status: reel.status,
        scannedAt: reel.scannedAt,
        lastUpdated: reel.lastUpdated
      });
      styleDataRow(row, idx + 2, reel);
    });
  }

  return masterWorkbook;
}

module.exports = {
  getExcelPath,
  appendOrUpdateReelInExcel,
  syncCategoryReelsToExcel,
  readReelsFromExcel,
  generateMasterWorkbook
};
