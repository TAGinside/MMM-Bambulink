modules: [
  {
  module: "MMM-Bambulink",
  position: "top_left",
  config: {
    ip: "x.x.x.x",                 // IP address of the printer
    accessCode: "xxxxxxxx",        // LAN Connection Code
    serial: "XXXXXXXXXXXXXXX",     // Serial number of the printer
    mqttPort: 8883,
    useTLS: true,
    updateInterval: 5000,          // ms
    showThumbnail: true ,
    thumbnailPath: "modules/MMM-Bambulink/thumbnails/H2S.png",
    }
  },
]