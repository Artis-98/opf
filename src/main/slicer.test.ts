import { describe, expect, it } from "vitest";
import { strToU8, zipSync } from "fflate";
import { parseSliceInfo, readSliceInfo } from "./slicer";

// The shape Bambu Studio writes into Metadata/slice_info.config.
const xml = `<?xml version="1.0" encoding="UTF-8"?>
<config>
  <header><header_item key="X-BBL-Client-Type" value="slicer"/></header>
  <plate>
    <metadata key="index" value="1"/>
    <metadata key="printer_model_id" value="C12"/>
    <metadata key="nozzle_diameters" value="0.4"/>
    <metadata key="prediction" value="5523"/>
    <metadata key="weight" value="38.17"/>
    <object identify_id="76" name="bracket.stl" skipped="false" />
    <filament id="1" tray_info_idx="GFA00" type="PLA" color="#161616" used_m="11.85" used_g="35.33" />
    <filament id="2" tray_info_idx="GFA00" type="PLA" color="#ffffff" used_m="0.95" used_g="2.84" />
  </plate>
</config>`;

describe("slice info", () => {
  it("reads time, weight and each filament", () => {
    expect(parseSliceInfo(xml)).toEqual({
      minutes: 92,
      grams: 38,
      filaments: [
        { color: "#161616", material: "PLA", grams: 35, index: 0 },
        { color: "#FFFFFF", material: "PLA", grams: 3, index: 1 },
      ],
    });
  });

  it("reads it straight out of a .gcode.3mf", () => {
    const file = zipSync({ "Metadata/slice_info.config": strToU8(xml), "Metadata/plate_1.gcode": strToU8("G28\n") });
    expect(readSliceInfo(file).minutes).toBe(92);
  });

  it("says so when the file was never sliced", () => {
    const file = zipSync({ "3D/3dmodel.model": strToU8("<model/>") });
    expect(() => readSliceInfo(file)).toThrow(/no slice information/);
  });

  it("refuses slice info without a time", () => {
    expect(() => parseSliceInfo("<config><plate></plate></config>")).toThrow(/print time/);
  });

  it("works out grams from length when the slicer leaves the weight empty (OrcaSlicer 2.4 command line)", () => {
    const orca = `<config><plate><metadata key="index" value="1"/><metadata key="prediction" value="2303"/><metadata key="weight" value=""/>
      <filament id="1" tray_info_idx="" type="PLA" color="#F2754E" used_m="1.38" used_g="0.00" group_id="0"/></plate></config>`;
    // 1.38 m of 1.75 mm PLA ≈ 3.3 cm³ ≈ 4.1 g
    expect(parseSliceInfo(orca)).toEqual({ minutes: 38, grams: 4, filaments: [{ color: "#F2754E", material: "PLA", grams: 4, index: 0 }] });
  });
});
