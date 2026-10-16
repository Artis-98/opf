import { NotYetSupported, type DriverFactory } from "../../core/driver";
import { simulatorFor, type SimScenario } from "../../core/simulator";
import { BambuDriver } from "./bambu";
import { AnycubicDriver } from "./anycubic";

/**
 * Real printers get their brand's driver; simulated ones run at the farm's
 * simulator speed, starting from a demo scenario when they came from the demo.
 */
export function makeDriverFactory(speed: () => number, scenarios: () => Record<string, SimScenario>): DriverFactory {
  return (cfg, emit) => {
    switch (cfg.driver) {
      case "bambu":
        return new BambuDriver(cfg, emit);
      case "anycubic":
        return new AnycubicDriver(cfg, emit);
      case "simulator":
        return simulatorFor(cfg, emit, speed, scenarios()[cfg.id]);
      default:
        return new NotYetSupported(cfg, emit);
    }
  };
}
