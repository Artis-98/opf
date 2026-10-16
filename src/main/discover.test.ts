import { describe, expect, it } from "vitest";
import { anycubicFromInfo, neighbourAddresses, parseBambuAnnouncement } from "./discover";

// As an A1 mini announces itself on the network (serial changed).
const a1mini = [
  "NOTIFY * HTTP/1.1",
  "HOST: 239.255.255.250:1900",
  "Server: UPnP/1.0",
  "Location: 192.168.1.125",
  "NT: urn:bambulab-com:device:3dprinter:1",
  "USN: 0309DA000000001",
  "Cache-Control: max-age=1800",
  "DevModel.bambu.com: N1",
  "DevName.bambu.com: Namejs",
  "DevSignal.bambu.com: -42",
  "DevConnect.bambu.com: lan",
  "DevBind.bambu.com: free",
  "DevVersion.bambu.com: 01.08.01.00",
  "",
  "",
].join("\r\n");

describe("finding printers on the network", () => {
  it("reads a Bambu printer's announcement: address, serial, name and model", () => {
    expect(parseBambuAnnouncement(a1mini)).toEqual({ driver: "bambu", host: "192.168.1.125", serial: "0309DA000000001", name: "Namejs", model: "Bambu Lab A1 mini" });
    expect(parseBambuAnnouncement(a1mini.replace("N1", "N2S"))?.model).toBe("Bambu Lab A1");
    expect(parseBambuAnnouncement(a1mini.replace("N1", "Z9"))?.model).toBeNull();
  });

  it("says when a Bambu printer is not in LAN mode, and ignores other devices' announcements", () => {
    expect(parseBambuAnnouncement(a1mini.replace("DevConnect.bambu.com: lan", "DevConnect.bambu.com: cloud"))?.note).toMatch(/LAN mode/);
    expect(parseBambuAnnouncement("NOTIFY * HTTP/1.1\r\nNT: upnp:rootdevice\r\nLocation: http://192.168.1.1:5000/\r\n")).toBeNull();
    expect(parseBambuAnnouncement(a1mini.replace("Location: 192.168.1.125", "Location: somewhere"))).toBeNull();
  });

  it("knows a Kobra in LAN mode by its answer to /info", () => {
    const info = {
      deviceType: "fdm", modelId: "20026", modelName: "Anycubic Kobra 3 Max", cn: "abcd-0000-0000-0001", ctrlType: "lan",
      ctrlInfoUrl: "http://192.168.1.192:18910/ctrl", ip: "192.168.1.192", deviceName: "Anycubic Kobra 3 Max", token: "x".repeat(32),
    };
    expect(anycubicFromInfo("192.168.1.192", info)).toEqual({ driver: "anycubic", host: "192.168.1.192", name: null, model: "Anycubic Kobra 3 Max", serial: "ABCD-0000-0000-0001" });
    expect(anycubicFromInfo("192.168.1.192", { ...info, deviceName: "Anisubik" })?.name).toBe("Anisubik");
    expect(anycubicFromInfo("192.168.1.192", { ...info, ctrlType: "cloud" })?.note).toMatch(/cloud mode/);
    expect(anycubicFromInfo("192.168.1.1", { status: "ok" })).toBeNull();
    expect(anycubicFromInfo("192.168.1.1", null)).toBeNull();
  });

  it("asks the addresses next to this computer's own, not itself, loopback or link-local", () => {
    const list = neighbourAddresses({
      Ethernet: [{ address: "192.168.1.20", netmask: "255.255.255.0", family: "IPv4", mac: "", internal: false, cidr: null }],
      Loopback: [{ address: "127.0.0.1", netmask: "255.0.0.0", family: "IPv4", mac: "", internal: true, cidr: null }],
      Other: [{ address: "169.254.3.4", netmask: "255.255.0.0", family: "IPv4", mac: "", internal: false, cidr: null }],
    });
    expect(list).toHaveLength(253);
    expect(list).toContain("192.168.1.1");
    expect(list).toContain("192.168.1.254");
    expect(list).not.toContain("192.168.1.20");
    expect(list.some((a) => a.startsWith("127.") || a.startsWith("169.254."))).toBe(false);
  });
});
