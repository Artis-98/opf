import { NotYetSupported, type DriverFactory } from "../../core/driver";
import { SimulatedPrinter } from "../../core/simulator";
import { BambuDriver } from "./bambu";

export const driverFactory: DriverFactory = (cfg, emit) => {
  switch (cfg.driver) {
    case "bambu":
      return new BambuDriver(cfg, emit);
    case "simulator":
      return new SimulatedPrinter(cfg, emit, { status: "idle" });
    default:
      return new NotYetSupported(cfg, emit);
  }
};
