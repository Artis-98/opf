// Copies OrcaSlicer's picture of each printer model OPF lists (resources/profiles/<maker>/<model>_cover.png in
// this repository) into src/renderer/src/assets/printers/<model as a slug>.png, where the farm page finds them by
// the printer's model. Run from farm/ after adding a model: node scripts/printer-pictures.cjs
const fs = require("fs");
const path = require("path");

const MODELS = {
  BBL: ["Bambu Lab X1 Carbon", "Bambu Lab X1", "Bambu Lab X1E", "Bambu Lab P1S", "Bambu Lab P1P", "Bambu Lab P2S",
    "Bambu Lab A1", "Bambu Lab A1 mini", "Bambu Lab H2D", "Bambu Lab H2S"],
  Anycubic: ["Anycubic Kobra 3 Max", "Anycubic Kobra 3", "Anycubic Kobra 3 V2", "Anycubic Kobra S1", "Anycubic Kobra S1 Max",
    "Anycubic Kobra X"],
  Prusa: ["Prusa MK4S", "Prusa CORE One", "Prusa XL"],
  Voron: ["Voron 2.4 350"],
  Creality: ["Creality K1"],
};

const slug = (model) => model.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
const profiles = path.join(__dirname, "..", "..", "resources", "profiles");
const out = path.join(__dirname, "..", "src", "renderer", "src", "assets", "printers");
fs.mkdirSync(out, { recursive: true });
for (const [maker, models] of Object.entries(MODELS))
  for (const model of models) {
    const from = path.join(profiles, maker, `${model}_cover.png`);
    if (!fs.existsSync(from)) { console.warn(`no picture: ${from}`); continue; }
    fs.copyFileSync(from, path.join(out, `${slug(model)}.png`));
    console.log(`${model} -> ${slug(model)}.png`);
  }
