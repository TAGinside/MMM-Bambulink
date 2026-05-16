modules: [
  {
  module: "MMM-Bambulink",
  position: "top_left",
  config: {
    ip: "192.168.11.9",
    accessCode: "1f019aaf",        // LAN Connection Code
    serial: "01S000XXXX",          // Seial number of the printer
    mqttPort: 8883,
    useTLS: true,
    updateInterval: 5 * 1000,
    showThumbnail: true ,
    thumbnailPath: "modules/MMM-Bambulink/public/printer.png",
    }
  },
]