modules: [
  {
    module: "MMM-Bambulink",
    position: "top_left",
    config: {
      ip: "192.168.1.x",                // IP address of the printer
      accessCode: "xxxxxxxx",           // LAN Access Code
      serial: "XXXXXXXX",               // Serial number of the printer
      updateInterval: 5000,             // Connection status check in ms
      offlineTimeout: 60000,            // No data for this long (ms) => "printer offline"
      pushallInterval: 300000,          // Ask the printer for a full status every 5 min (min 60000, 0 = off)
      printerModel: "H2S",              // Printer model (H2S, A1, P2S, or Name)
      temperatureDisplayMode: "tiles",  // "tiles" or "graph"

      display: {
        scale: 1,
        width: 320,
        graphMinutes: 1
      },

      temperatureColors: {
        nozzle: "#ff4d4f",              // Red
        bed: "#ff9f1a",                 // Orange
        chamber: "#4da3ff"              // Blue
      }
    }
  },
]
