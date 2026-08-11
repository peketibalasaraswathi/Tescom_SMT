const fs = require('fs');
const path = require('path');

const dropzonePath = path.join(__dirname, 'dropzone');
if (!fs.existsSync(dropzonePath)) fs.mkdirSync(dropzonePath);

// Deterministic baseline generator
function generateBaseline(lineId) {
  const components = [];
  const maxCapacities = [1000, 5000, 10000];
  
  for (let i = 1; i <= 200; i++) {
    // Deterministically assign max quantity (cycles through the 3 options)
    const max_quantity = maxCapacities[i % 3];
    // Deterministically assign a consumption rate between 15 and 35
    const consumption_rate = 15 + (i % 21);

    components.push({
      line_id: lineId,
      feeder_position: `Feeder_${i}`,
      part_number: `PART-${1000 + i}`,
      description: `Component ${i} for ${lineId}`,
      max_quantity: max_quantity,
      current_quantity: max_quantity, // Starts completely full
      consumption_rate: consumption_rate,
      quantity_threshold: 500
    });
  }
  return components;
}

const factoryState = {
  line_1: generateBaseline('line_1'),
  line_2: generateBaseline('line_2'),
  line_3: generateBaseline('line_3'),
  line_4: generateBaseline('line_4'),
};

function writeCsvToFile(lineId, data) {
  // CRITICAL: The CSV only contains raw physical data. No status, no time left!
  const header = "line_id,feeder_position,part_number,description,current_quantity,quantity_threshold\n";
  const rows = data.map(item => 
    `${item.line_id},${item.feeder_position},${item.part_number},${item.description},${item.current_quantity},${item.quantity_threshold}`
  ).join('\n');

  fs.writeFileSync(path.join(dropzonePath, `${lineId}_inventory.csv`), header + rows);
}

// Function to process a tick for a specific line
function processLineTick(lineId) {
  factoryState[lineId] = factoryState[lineId].map(comp => {
    let newQuantity = comp.current_quantity - comp.consumption_rate;
    // Replenish back to max if it drops to 20 or below
    if (newQuantity <= 20) {
      newQuantity = comp.max_quantity;
    }
    return { ...comp, current_quantity: newQuantity };
  });
  writeCsvToFile(lineId, factoryState[lineId]);
  console.log(`[Machine Drop] Wrote new CSV for ${lineId}`);
}

console.log("🚀 Starting Deterministic Yamaha Simulator...");

// Start the 4 asynchronous loops
setInterval(() => processLineTick('line_1'), 5000);  // 5 seconds
setInterval(() => processLineTick('line_2'), 7000);  // 7 seconds
setInterval(() => processLineTick('line_3'), 9000);  // 9 seconds
setInterval(() => processLineTick('line_4'), 11000); // 11 seconds